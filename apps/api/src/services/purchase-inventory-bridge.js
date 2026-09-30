// Inventory <-> Compras bridge: the "Compra" timeline of an item, the item
// picker candidates and creating inventory items from a purchase line through
// the official inventory service. Works (degrades) when runly.inventory is off.
import { STAGE_LABELS, enabledStages } from './purchase-policies.js'
import { MODULE_KEY, PurchasesServiceError, broadcast, cleanText, dateKey, notFound, num, pagination, writeAudit } from './purchases-shared.js'

const TYPE_STAGE = {
  purchase_request: 'REQUEST',
  purchase_quote: 'QUOTES',
  purchase_order: 'PURCHASE_ORDER',
  purchase_receipt: 'RECEIPT',
  purchase_invoice: 'INVOICE',
}
const TIMELINE_STAGES = ['REQUEST', 'QUOTES', 'PURCHASE_ORDER', 'RECEIPT', 'INVOICE', 'PAYMENT']

export function createPurchaseInventoryBridge({ prisma, broadcaster, workflowService, hydrator, getInventoryService }) {
  // True when runly.inventory is installed + enabled and not disabled for the company.
  async function inventoryAvailable(companyId) {
    const moduleRow = await prisma.runlyModule.findFirst({ where: { key: 'runly.inventory' }, select: { id: true, status: true, enabled: true } }).catch(() => null)
    if (!moduleRow || moduleRow.status !== 'INSTALLED' || moduleRow.enabled === false) return false
    const disabled = await prisma.companyModule.findFirst({ where: { companyId, moduleId: moduleRow.id, enabled: false }, select: { moduleId: true } }).catch(() => null)
    return !disabled
  }

  async function inventorySummary(companyId, itemId, canRead) {
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId }, select: { id: true } })
    if (!item) throw notFound('El inventario no existe o pertenece a otra empresa.')
    const workflow = await workflowService.ensureWorkflow(companyId)
    const relations = await prisma.entityRelation.findMany({
      where: {
        companyId,
        OR: [
          { targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: itemId, sourceModule: MODULE_KEY },
          { sourceModule: 'runly.inventory', sourceType: 'inventory_item', sourceId: itemId, targetModule: MODULE_KEY },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
    const hydrated = await hydrator.hydrate(companyId, relations, { module: 'runly.inventory', type: 'inventory_item', id: itemId }, canRead)
    const docs = hydrated.map(entry => ({
      type: entry.other.type, id: entry.other.id, number: entry.other.label, status: entry.other.status,
      total: entry.other.total, currency: entry.other.currency, date: entry.other.date ?? null, path: entry.other.path,
      origin: entry.origin, relationId: entry.id, supplierName: entry.other.type === 'purchase_receipt' ? null : entry.other.sublabel,
    }))

    // Receipts of related orders appear as inherited (they carry no item relation).
    const orderIds = docs.filter(doc => doc.type === 'purchase_order').map(doc => doc.id)
    if (orderIds.length && canRead('purchase_receipt')) {
      const receipts = await prisma.purchaseReceipt.findMany({ where: { companyId, orderId: { in: orderIds }, status: { not: 'CANCELLED' } } })
      const seen = new Set(docs.map(doc => `${doc.type}:${doc.id}`))
      for (const receipt of receipts) {
        if (seen.has(`purchase_receipt:${receipt.id}`)) continue
        docs.push({ type: 'purchase_receipt', id: receipt.id, number: receipt.number, status: receipt.status, total: null, currency: null, date: dateKey(receipt.receivedAt), path: `/purchases/receipts/${receipt.id}`, origin: 'INHERITED', relationId: null })
      }
    }

    const capabilities = workflow.capabilities ?? {}
    const enabled = new Set(enabledStages(workflow).map(stage => stage.type))
    const timeline = []
    const caseDocs = docs.filter(doc => doc.type === 'purchase_case')
    if (caseDocs.length) timeline.push({ stage: 'CASE', label: 'Expediente', docs: caseDocs })
    for (const stage of TIMELINE_STAGES) {
      if (!enabled.has(stage)) continue
      const stageDocs = stage === 'PAYMENT'
        ? docs.filter(doc => doc.type === 'purchase_invoice' && ['PARTIALLY_PAID', 'PAID'].includes(doc.status))
        : docs.filter(doc => TYPE_STAGE[doc.type] === stage)
      timeline.push({ stage, label: STAGE_LABELS[stage], docs: stageDocs })
    }
    const allocations = await prisma.purchaseAllocation.aggregate({
      where: { companyId, targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: itemId },
      _sum: { allocatedAmount: true },
    })
    return {
      capabilities,
      timeline,
      allocatedAmount: num(allocations._sum.allocatedAmount),
      currency: docs.find(doc => doc.currency)?.currency ?? 'MXN',
    }
  }

  async function inventoryCandidates(companyId, query = {}) {
    const { page, pageSize, skip, take } = pagination(query, { defaultSize: 20, max: 50 })
    if (!(await inventoryAvailable(companyId))) return { data: [], total: 0, page, pageSize, available: false }
    const search = cleanText(query.search, 120)
    const where = {
      companyId,
      enabled: true,
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { assetTag: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
      ] } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.invItem.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select: { id: true, assetTag: true, name: true, status: true, category: { select: { name: true } } } }),
      prisma.invItem.count({ where }),
    ])
    return {
      data: rows.map(row => ({ id: row.id, assetTag: row.assetTag, name: row.name, status: row.status, categoryName: row.category?.name ?? null })),
      total, page, pageSize, available: true,
    }
  }

  // Creates inventory items from a GOODS line, relates each to the line's
  // document (origin AUTOMATIC) and allocates the line unit amount.
  async function createInventoryFromLine(companyId, actor, lineId, input = {}) {
    const items = Array.isArray(input.items) ? input.items : []
    if (!items.length) throw new PurchasesServiceError('Indica al menos un inventario a crear.')
    if (items.length > 100) throw new PurchasesServiceError('Puedes crear hasta 100 inventarios a la vez.')
    await workflowService.assertCapability(companyId, 'inventoryRelations')
    if (!(await inventoryAvailable(companyId))) {
      throw new PurchasesServiceError('El módulo Inventario no está habilitado para esta empresa.', 409, 'CAPABILITY_DISABLED')
    }
    const line = await prisma.purchaseLine.findFirst({ where: { id: lineId, companyId } })
    if (!line) throw notFound('El concepto no existe o pertenece a otra empresa.')
    if (line.itemKind === 'SERVICE') throw new PurchasesServiceError('Los conceptos de servicio no generan inventario.')
    const ownerModel = line.ownerType === 'PURCHASE_ORDER' ? 'purchaseOrder' : 'purchaseInvoice'
    const sourceType = line.ownerType === 'PURCHASE_ORDER' ? 'purchase_order' : 'purchase_invoice'
    const doc = await prisma[ownerModel].findFirst({ where: { id: line.ownerId, companyId } })
    if (!doc) throw notFound()
    if (doc.status === 'CANCELLED') throw new PurchasesServiceError('El documento está cancelado.', 409, 'INVALID_TRANSITION')
    const existing = await prisma.purchaseAllocation.count({ where: { companyId, purchaseLineId: line.id, targetType: 'inventory_item' } })
    const capacity = Math.ceil(num(line.quantity)) - existing
    if (items.length > capacity) {
      throw new PurchasesServiceError(`El concepto solo admite ${Math.max(0, capacity)} inventario(s) más.`)
    }
    // Validate every referenced catalog id against the company before creating anything.
    const categoryIds = items.map(entry => entry.categoryId || line.inventoryCategoryId).filter(Boolean)
    const locationIds = items.map(entry => entry.locationId).filter(Boolean)
    const modelIds = items.map(entry => entry.modelId).filter(Boolean)
    const checks = [
      ['invCategory', categoryIds, 'El tipo de inventario'],
      ['invLocation', locationIds, 'La ubicación'],
      ['invModel', modelIds, 'El modelo'],
    ]
    for (const [model, ids, label] of checks) {
      const unique = [...new Set(ids)]
      if (!unique.length) continue
      const count = await prisma[model].count({ where: { companyId, id: { in: unique } } })
      if (count !== unique.length) throw notFound(`${label} no pertenece a esta empresa.`)
    }

    const inventoryService = getInventoryService()
    const created = []
    for (const entry of items) {
      const item = await inventoryService.createItem({
        name: cleanText(entry.name, 255) || line.description.slice(0, 255),
        serialNumber: cleanText(entry.serialNumber, 255) ?? undefined,
        categoryId: entry.categoryId || line.inventoryCategoryId || undefined,
        locationId: entry.locationId || undefined,
        modelId: entry.modelId || undefined,
        acquisitionOrigin: 'PURCHASE',
      }, companyId, actor.authUserId)
      created.push(item)
    }
    const unitAmount = num(line.unitAmount)
    await prisma.$transaction(async tx => {
      await tx.entityRelation.createMany({
        data: created.map(item => ({
          companyId, sourceModule: MODULE_KEY, sourceType, sourceId: doc.id,
          targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: item.id,
          relationType: sourceType === 'purchase_order' ? 'PURCHASED_IN' : 'INVOICED_ITEM',
          origin: 'AUTOMATIC', metadata: { purchaseLineId: line.id }, createdById: actor.profileId || null,
        })),
        skipDuplicates: true,
      })
      await tx.purchaseAllocation.createMany({
        data: created.map(item => ({
          companyId, purchaseLineId: line.id, targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: item.id,
          quantity: 1, unitAmount, allocatedAmount: unitAmount, createdById: actor.profileId || null,
        })),
        skipDuplicates: true,
      })
      await writeAudit(tx, {
        companyId, actorId: actor.profileId, entityType: sourceType, entityId: doc.id, action: 'purchase.inventory.created_from_line',
        metadata: { purchaseLineId: line.id, itemIds: created.map(item => item.id) },
      })
    })
    await broadcast(broadcaster, companyId, 'purchase.inventory.created', { sourceType, sourceId: doc.id, lineId: line.id, itemIds: created.map(item => item.id) })
    return created.map(item => ({ id: item.id, assetTag: item.assetTag, name: item.name, status: item.status }))
  }

  return { inventoryAvailable, inventorySummary, inventoryCandidates, createInventoryFromLine }
}
