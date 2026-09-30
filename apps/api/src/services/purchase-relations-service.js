// runly.purchases relations: single/bulk create, delete, invoice propagation
// preview/inheritance and the "Relacionar existente" document search.
import {
  KINDS, MODULE_KEY, PurchasesServiceError, broadcast, dateKey, notFound, num, pagination, plain, supplierNames, writeAudit, cleanText,
} from './purchases-shared.js'
import { PURCHASE_ENTITY_TYPES } from './purchase-relation-hydration.js'

const ITEM_RELATION_TYPE = {
  purchase_order: 'PURCHASED_IN',
  purchase_invoice: 'INVOICED_ITEM',
  purchase_case: 'ACQUIRED_IN',
  purchase_receipt: 'RECEIVED_IN',
  purchase_request: 'REQUESTED_IN',
  purchase_quote: 'QUOTED_IN',
}

export function defaultRelationType(sourceType, targetType) {
  if (targetType === 'inventory_item') return ITEM_RELATION_TYPE[sourceType] ?? 'RELATED'
  if (sourceType === 'purchase_invoice' && targetType === 'purchase_order') return 'BILLED_FROM'
  if (sourceType === 'purchase_case') return 'CONTAINS'
  return 'RELATED'
}

const moduleForType = type => (type === 'inventory_item' ? 'runly.inventory' : MODULE_KEY)

// Copies the inventory relations of the given orders onto an invoice
// (origin INHERITED). Receives the transaction client explicitly.
export async function inheritFromOrders(tx, { companyId, actorId, invoiceId, orderIds }) {
  if (!orderIds?.length) return 0
  const inherited = await tx.entityRelation.findMany({
    where: { companyId, sourceModule: MODULE_KEY, sourceType: 'purchase_order', sourceId: { in: orderIds }, targetType: 'inventory_item' },
  })
  if (!inherited.length) return 0
  const result = await tx.entityRelation.createMany({
    data: inherited.map(relation => ({
      companyId, sourceModule: MODULE_KEY, sourceType: 'purchase_invoice', sourceId: invoiceId,
      targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: relation.targetId,
      relationType: 'INVOICED_ITEM', origin: 'INHERITED', sourceRelationId: relation.id, createdById: actorId || null,
    })),
    skipDuplicates: true,
  })
  return result.count
}

export function createPurchaseRelationsService({ prisma, broadcaster, workflowService }) {
  async function assertEndpoint(companyId, type, id) {
    if (!id) throw new PurchasesServiceError('La relación está incompleta.')
    if (type === 'inventory_item') {
      const row = await prisma.invItem.findFirst({ where: { id, companyId, enabled: true }, select: { id: true } })
      if (!row) throw notFound('El inventario no existe o pertenece a otra empresa.')
      return
    }
    const kind = Object.keys(KINDS).find(key => KINDS[key].entityType === type)
    if (!kind) throw new PurchasesServiceError('El tipo de entidad todavía no admite relaciones de compra.', 400, 'VALIDATION')
    const row = await prisma[KINDS[kind].model].findFirst({ where: { id, companyId }, select: { id: true } })
    if (!row) throw notFound('La entidad no existe o pertenece a otra empresa.')
  }

  async function assertInventoryCapability(companyId, ...types) {
    if (types.includes('inventory_item')) await workflowService.assertCapability(companyId, 'inventoryRelations')
  }

  async function createRelation(companyId, actorId, input = {}) {
    const sourceType = input.sourceType
    const targetType = input.targetType
    if (!sourceType || !targetType || !input.sourceId || !input.targetId) throw new PurchasesServiceError('La relación está incompleta.')
    if (!PURCHASE_ENTITY_TYPES.includes(sourceType) && !PURCHASE_ENTITY_TYPES.includes(targetType)) {
      throw new PurchasesServiceError('Al menos un extremo de la relación debe ser un documento de compra.')
    }
    if (sourceType === targetType && input.sourceId === input.targetId) throw new PurchasesServiceError('Una entidad no puede relacionarse consigo misma.')
    await assertInventoryCapability(companyId, sourceType, targetType)
    await assertEndpoint(companyId, sourceType, input.sourceId)
    await assertEndpoint(companyId, targetType, input.targetId)
    const data = {
      companyId,
      sourceModule: moduleForType(sourceType), sourceType, sourceId: input.sourceId,
      targetModule: moduleForType(targetType), targetType, targetId: input.targetId,
      relationType: cleanText(input.relationType, 80) || defaultRelationType(sourceType, targetType),
      origin: ['MANUAL', 'INHERITED', 'AUTOMATIC'].includes(input.origin) ? input.origin : 'MANUAL',
      metadata: input.metadata ?? undefined,
      createdById: actorId || null,
    }
    const existing = await prisma.entityRelation.findFirst({
      where: { companyId, sourceModule: data.sourceModule, sourceType, sourceId: data.sourceId, targetModule: data.targetModule, targetType, targetId: data.targetId, relationType: data.relationType },
    })
    if (existing) return existing
    const relation = await prisma.$transaction(async tx => {
      const value = await tx.entityRelation.create({ data })
      await writeAudit(tx, { companyId, actorId, entityType: 'entity_relation', entityId: value.id, action: 'purchase.relation.created', after: value })
      return value
    })
    await broadcast(broadcaster, companyId, 'purchase.relation.created', { relationId: relation.id, sourceType, sourceId: relation.sourceId, targetType, targetId: relation.targetId })
    return relation
  }

  async function bulkRelate(companyId, actorId, input = {}) {
    const { sourceType, sourceId } = input
    const targetType = input.targetType || 'inventory_item'
    if (targetType !== 'inventory_item') throw new PurchasesServiceError('La vinculación múltiple solo admite inventarios.')
    if (!PURCHASE_ENTITY_TYPES.includes(sourceType)) throw new PurchasesServiceError('El documento de origen no es válido.')
    const targetIds = [...new Set((input.targetIds ?? []).filter(Boolean))]
    if (!targetIds.length) throw new PurchasesServiceError('Selecciona al menos un inventario.')
    if (targetIds.length > 200) throw new PurchasesServiceError('Puedes vincular hasta 200 inventarios a la vez.')
    await assertInventoryCapability(companyId, targetType)
    await assertEndpoint(companyId, sourceType, sourceId)
    const items = await prisma.invItem.findMany({ where: { companyId, id: { in: targetIds }, enabled: true }, select: { id: true } })
    if (items.length !== targetIds.length) throw notFound('Uno o más inventarios no existen o pertenecen a otra empresa.')
    const relationType = defaultRelationType(sourceType, targetType)
    const result = await prisma.$transaction(async tx => {
      const created = await tx.entityRelation.createMany({
        data: targetIds.map(targetId => ({
          companyId, sourceModule: MODULE_KEY, sourceType, sourceId, targetModule: 'runly.inventory', targetType, targetId,
          relationType, origin: 'MANUAL', createdById: actorId || null,
        })),
        skipDuplicates: true,
      })
      await writeAudit(tx, { companyId, actorId, entityType: sourceType, entityId: sourceId, action: 'purchase.relation.bulk_created', metadata: { targetType, targetIds, created: created.count } })
      return created
    })
    await broadcast(broadcaster, companyId, 'purchase.relation.created', { sourceType, sourceId, targetType, targetIds, bulk: true })
    return { created: result.count, skipped: targetIds.length - result.count }
  }

  async function deleteRelation(companyId, actorId, id) {
    const relation = await prisma.entityRelation.findFirst({ where: { id, companyId } })
    if (!relation) throw notFound('La relación no existe.')
    if (relation.sourceModule !== MODULE_KEY && relation.targetModule !== MODULE_KEY) throw notFound('La relación no existe.')
    await prisma.$transaction(async tx => {
      await tx.entityRelation.delete({ where: { id } })
      await writeAudit(tx, { companyId, actorId, entityType: 'entity_relation', entityId: id, action: 'purchase.relation.deleted', before: relation })
    })
    await broadcast(broadcaster, companyId, 'purchase.relation.deleted', { relationId: id, sourceType: relation.sourceType, sourceId: relation.sourceId, targetType: relation.targetType, targetId: relation.targetId })
  }

  // Items linked to the orders but not yet to the invoice.
  async function propagationPreview(companyId, { invoiceId, orderIds } = {}) {
    const ids = [...new Set((Array.isArray(orderIds) ? orderIds : String(orderIds ?? '').split(',')).map(value => String(value).trim()).filter(Boolean))]
    if (!ids.length) return []
    const orders = await prisma.purchaseOrder.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, number: true } })
    if (orders.length !== ids.length) throw notFound('Una o más órdenes no existen o pertenecen a otra empresa.')
    if (invoiceId) {
      const invoice = await prisma.purchaseInvoice.findFirst({ where: { id: invoiceId, companyId }, select: { id: true } })
      if (!invoice) throw notFound('La factura no existe o pertenece a otra empresa.')
    }
    const relations = await prisma.entityRelation.findMany({
      where: { companyId, sourceModule: MODULE_KEY, sourceType: 'purchase_order', sourceId: { in: ids }, targetType: 'inventory_item' },
    })
    const already = invoiceId
      ? new Set((await prisma.entityRelation.findMany({
        where: { companyId, sourceModule: MODULE_KEY, sourceType: 'purchase_invoice', sourceId: invoiceId, targetType: 'inventory_item' },
        select: { targetId: true },
      })).map(row => row.targetId))
      : new Set()
    const pending = relations.filter(relation => !already.has(relation.targetId))
    const items = pending.length
      ? await prisma.invItem.findMany({ where: { companyId, id: { in: pending.map(relation => relation.targetId) }, enabled: true }, select: { id: true, name: true, assetTag: true, status: true } })
      : []
    const itemMap = new Map(items.map(item => [item.id, item]))
    const orderMap = new Map(orders.map(order => [order.id, order]))
    const seen = new Set()
    return pending
      .filter(relation => itemMap.has(relation.targetId) && !seen.has(relation.targetId) && seen.add(relation.targetId))
      .map(relation => {
        const item = itemMap.get(relation.targetId)
        return { itemId: item.id, assetTag: item.assetTag, name: item.name, status: item.status, orderId: relation.sourceId, orderNumber: orderMap.get(relation.sourceId)?.number ?? null, relationId: relation.id }
      })
  }

  // "Relacionar existente": orders or invoices of the company.
  async function searchDocuments(companyId, query = {}) {
    const type = String(query.type ?? 'order').toLowerCase().replace(/s$/, '')
    const kind = type === 'invoice' ? 'invoices' : type === 'order' ? 'orders' : null
    if (!kind) throw new PurchasesServiceError('Tipo de documento no válido.')
    await workflowService.assertCapability(companyId, KINDS[kind].capability)
    const { page, pageSize, skip, take } = pagination(query, { defaultSize: 10, max: 50 })
    const search = cleanText(query.search, 120)
    const model = prisma[KINDS[kind].model]
    const where = {
      companyId,
      status: { not: 'CANCELLED' },
      ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { notes: { contains: search, mode: 'insensitive' } }] } : {}),
    }
    const [rows, total] = await Promise.all([
      model.findMany({ where, orderBy: { issueDate: 'desc' }, skip, take }),
      model.count({ where }),
    ])
    const names = await supplierNames(prisma, companyId, rows.map(row => row.supplierId))
    const data = rows.map(row => ({
      ...plain(row), type: KINDS[kind].entityType, kind, supplierName: names.get(row.supplierId) ?? null,
      date: dateKey(row.issueDate), total: num(row.total), path: `${KINDS[kind].path}/${row.id}`,
    }))
    return { data, total, page, pageSize }
  }

  return { createRelation, bulkRelate, deleteRelation, propagationPreview, searchDocuments, assertEndpoint }
}
