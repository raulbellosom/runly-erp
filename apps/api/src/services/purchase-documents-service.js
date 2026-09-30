// runly.purchases — purchase orders and supplier invoices: detail, create,
// draft edit (lines replaced as a set) and status transitions.
import { buildStageMap, policyBlockers, resolveTransition } from './purchase-policies.js'
import { policyCheckFor } from './purchase-case-bundle.js'
import { inheritFromOrders } from './purchase-relations-service.js'
import {
  DECISION_STATUS, KINDS, MODULE_KEY, PurchasesServiceError, SUPPLIER_SELECT, asDate, asMoney, assertLineCategories, assertSupplier,
  broadcast, cleanText, createApproval, createCase, currency, dateKey, invalidTransition, markCaseInProgress, allocateNumber,
  normalizeLine, notFound, num, plain, policyBlocked, relate, replaceLines, resolveApprovals, totalsFromLines, writeAudit,
} from './purchases-shared.js'

const EVENT = { orders: 'purchase.order', invoices: 'purchase.invoice' }

export function createPurchaseDocumentsService({ prisma, broadcaster, workflowService, caseBundle, hydrator }) {
  const def = kind => {
    if (!EVENT[kind]) throw new PurchasesServiceError('Tipo de documento no válido.')
    return KINDS[kind]
  }

  async function findDoc(kind, companyId, id, client = prisma) {
    const doc = await client[def(kind).model].findFirst({ where: { id, companyId } })
    if (!doc) throw notFound()
    return doc
  }

  async function linesFor(companyId, ownerType, ownerId) {
    const lines = await prisma.purchaseLine.findMany({ where: { companyId, ownerType, ownerId }, orderBy: { sortOrder: 'asc' } })
    if (!lines.length) return []
    const allocations = await prisma.purchaseAllocation.groupBy({
      by: ['purchaseLineId'],
      where: { companyId, purchaseLineId: { in: lines.map(line => line.id) }, targetType: 'inventory_item' },
      _count: { _all: true },
    })
    const counts = new Map(allocations.map(row => [row.purchaseLineId, row._count._all]))
    return lines.map(line => ({
      ...plain(line),
      pendingQuantity: Math.max(0, Math.round((num(line.quantity) - num(line.receivedQuantity)) * 10000) / 10000),
      inventoryCount: counts.get(line.id) ?? 0,
    }))
  }

  async function get(kind, companyId, id, canRead) {
    const meta = def(kind)
    const doc = await findDoc(kind, companyId, id)
    const workflow = await workflowService.ensureWorkflow(companyId)
    const [supplier, lines, relations, bundle, approvals] = await Promise.all([
      doc.supplierId ? prisma.contact.findFirst({ where: { id: doc.supplierId, companyId }, select: SUPPLIER_SELECT }) : null,
      linesFor(companyId, meta.ownerType, doc.id),
      hydrator.relationsFor(companyId, MODULE_KEY, meta.entityType, doc.id, canRead),
      caseBundle.loadBundle(companyId, doc.caseId),
      prisma.purchaseApproval.findMany({ where: { companyId, ownerType: meta.ownerType, ownerId: doc.id }, orderBy: { createdAt: 'desc' } }),
    ])
    const related = type => relations.filter(entry => entry.other.type === type).map(entry => ({ ...entry.other, relationId: entry.id, origin: entry.origin }))
    const data = {
      ...plain(doc),
      issueDate: dateKey(doc.issueDate),
      supplier,
      supplierName: supplier?.name ?? null,
      lines,
      relations,
      case: bundle.case ? { id: bundle.case.id, number: bundle.case.number, title: bundle.case.title, status: bundle.case.status } : null,
      stageMap: buildStageMap(workflow, bundle),
      approvals: approvals.map(plain),
      quotes: bundle.quotes.map(plain),
      policyCheck: stripContext(policyCheckFor(workflow, bundle, kind, doc)),
    }
    if (kind === 'orders') {
      data.expectedDate = dateKey(doc.expectedDate)
      const receipts = await prisma.purchaseReceipt.findMany({ where: { companyId, orderId: doc.id }, include: { lines: true }, orderBy: { createdAt: 'desc' } })
      data.receipts = receipts.map(receipt => ({ ...plain(receipt), receivedAt: dateKey(receipt.receivedAt), lines: receipt.lines.map(plain) }))
      const billed = related('purchase_invoice')
      const inCase = bundle.invoices.filter(invoice => !billed.some(entry => entry.id === invoice.id)).map(invoice => ({ ...plain(invoice), path: `/purchases/invoices/${invoice.id}` }))
      data.invoices = [...billed, ...inCase]
    } else {
      data.dueDate = dateKey(doc.dueDate)
      data.paidAt = dateKey(doc.paidAt)
      data.balance = Math.max(0, Math.round((num(doc.total) - num(doc.paidAmount)) * 100) / 100)
      data.orders = related('purchase_order')
    }
    return data
  }

  function stripContext(check) {
    const { context: _context, blockers: _blockers, ...rest } = check
    return rest
  }

  function headerData(kind, input, existing = null) {
    const data = {}
    if (!existing || 'supplierId' in input) data.supplierId = input.supplierId || null
    if (!existing || 'issueDate' in input) data.issueDate = asDate(input.issueDate, { fallbackToday: true })
    if (!existing || 'currency' in input) data.currency = currency(input.currency, existing?.currency)
    if (!existing || 'notes' in input) data.notes = cleanText(input.notes)
    if (kind === 'orders') {
      if (!existing || 'expectedDate' in input) data.expectedDate = asDate(input.expectedDate)
      if (!existing || 'supplierReference' in input) data.supplierReference = cleanText(input.supplierReference, 100)
      if (!existing || 'paymentTerms' in input) data.paymentTerms = cleanText(input.paymentTerms, 120)
    } else {
      if (!existing || 'dueDate' in input) data.dueDate = asDate(input.dueDate)
      if (!existing || 'fiscalUuid' in input) data.fiscalUuid = cleanText(input.fiscalUuid, 36)
    }
    return data
  }

  async function validateOrderIds(client, companyId, orderIds) {
    const ids = [...new Set((orderIds ?? []).filter(Boolean))]
    if (!ids.length) return []
    const rows = await client.purchaseOrder.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, caseId: true } })
    if (rows.length !== ids.length) throw notFound('Una o más órdenes no existen o pertenecen a otra empresa.')
    return rows
  }

  async function validateInventoryIds(companyId, ids) {
    const unique = [...new Set((ids ?? []).filter(Boolean))]
    if (!unique.length) return []
    await workflowService.assertCapability(companyId, 'inventoryRelations')
    const rows = await prisma.invItem.findMany({ where: { companyId, id: { in: unique }, enabled: true }, select: { id: true } })
    if (rows.length !== unique.length) throw notFound('Uno o más inventarios no existen o pertenecen a otra empresa.')
    return unique
  }

  async function linkOrders(tx, { companyId, actorId, invoiceId, orders, inheritItems }) {
    for (const order of orders) {
      await relate(tx, { companyId, actorId, sourceType: 'purchase_invoice', sourceId: invoiceId, targetType: 'purchase_order', targetId: order.id, relationType: 'BILLED_FROM' })
    }
    if (inheritItems) await inheritFromOrders(tx, { companyId, actorId, invoiceId, orderIds: orders.map(order => order.id) })
  }

  async function create(kind, companyId, actorId, input = {}) {
    const meta = def(kind)
    const workflow = await workflowService.assertCapability(companyId, meta.capability, actorId)
    await assertSupplier(prisma, companyId, input.supplierId)
    const lines = (Array.isArray(input.lines) ? input.lines : []).map(normalizeLine).filter(Boolean)
    await assertLineCategories(prisma, companyId, lines)
    const orders = kind === 'invoices' ? await validateOrderIds(prisma, companyId, input.orderIds) : []
    const inventoryIds = await validateInventoryIds(companyId, input.inventoryIds)
    let caseRow = null
    if (input.caseId) {
      caseRow = await prisma.purchaseCase.findFirst({ where: { id: input.caseId, companyId } })
      if (!caseRow) throw notFound('El expediente no existe.')
    }
    if (input.requestId) {
      const request = await prisma.purchaseRequest.findFirst({ where: { id: input.requestId, companyId } })
      if (!request) throw notFound('La solicitud no existe.')
      if (!caseRow) caseRow = await prisma.purchaseCase.findFirst({ where: { id: request.caseId, companyId } })
    }
    if (!caseRow && orders.length) caseRow = await prisma.purchaseCase.findFirst({ where: { id: orders[0].caseId, companyId } })
    const totals = totalsFromLines(lines, input)
    const created = await prisma.$transaction(async tx => {
      const { sequence, number } = await allocateNumber(tx, { companyId, kind, number: input.number, date: input.issueDate })
      const purchaseCase = caseRow ?? await createCase(tx, {
        companyId, actorId, workflowId: workflow.id, title: (kind === 'orders' ? 'Orden ' : 'Factura ') + number,
        currency: input.currency, estimatedTotal: totals.total, supplierId: input.supplierId,
      })
      const doc = await tx[meta.model].create({
        data: { companyId, caseId: purchaseCase.id, number, sequence, status: 'DRAFT', ...headerData(kind, input), ...totals, createdById: actorId || null },
      })
      await replaceLines(tx, companyId, meta.ownerType, doc.id, lines)
      await relate(tx, { companyId, actorId, sourceType: 'purchase_case', sourceId: purchaseCase.id, targetType: meta.entityType, targetId: doc.id, relationType: 'CONTAINS', origin: 'AUTOMATIC' })
      for (const targetId of inventoryIds) {
        await relate(tx, { companyId, actorId, sourceType: meta.entityType, sourceId: doc.id, targetModule: 'runly.inventory', targetType: 'inventory_item', targetId, relationType: kind === 'orders' ? 'PURCHASED_IN' : 'INVOICED_ITEM' })
      }
      if (orders.length) await linkOrders(tx, { companyId, actorId, invoiceId: doc.id, orders, inheritItems: input.inheritItems === true })
      await markCaseInProgress(tx, companyId, caseRow?.id)
      await writeAudit(tx, { companyId, actorId, entityType: meta.entityType, entityId: doc.id, action: `${EVENT[kind]}.created`, after: doc })
      return doc
    })
    await broadcast(broadcaster, companyId, `${EVENT[kind]}.created`, { id: created.id, caseId: created.caseId })
    return plain(created)
  }

  async function update(kind, companyId, actorId, id, input = {}) {
    const meta = def(kind)
    await workflowService.assertCapability(companyId, meta.capability, actorId)
    const before = await findDoc(kind, companyId, id)
    if (before.status !== 'DRAFT') throw invalidTransition('Solo se pueden editar documentos en borrador.')
    if ('supplierId' in input) await assertSupplier(prisma, companyId, input.supplierId)
    const lines = Array.isArray(input.lines) ? input.lines.map(normalizeLine).filter(Boolean) : null
    if (lines) await assertLineCategories(prisma, companyId, lines)
    const orders = kind === 'invoices' ? await validateOrderIds(prisma, companyId, input.orderIds) : []
    const data = headerData(kind, input, before)
    if (input.number !== undefined) data.number = cleanText(input.number, kind === 'orders' ? 40 : 100) || before.number
    if (lines) Object.assign(data, totalsFromLines(lines, input))
    else if (['subtotal', 'tax', 'total'].some(key => key in input)) {
      const subtotal = asMoney(input.subtotal ?? before.subtotal)
      const tax = asMoney(input.tax ?? before.tax)
      Object.assign(data, { subtotal, tax, total: asMoney(input.total ?? subtotal + tax) })
    }
    const updated = await prisma.$transaction(async tx => {
      const doc = await tx[meta.model].update({ where: { id }, data })
      if (lines) await replaceLines(tx, companyId, meta.ownerType, id, lines)
      if (orders.length) await linkOrders(tx, { companyId, actorId, invoiceId: id, orders, inheritItems: input.inheritItems === true })
      await writeAudit(tx, { companyId, actorId, entityType: meta.entityType, entityId: id, action: `${EVENT[kind]}.updated`, before, after: doc })
      return doc
    })
    await broadcast(broadcaster, companyId, `${EVENT[kind]}.updated`, { id, caseId: updated.caseId })
    return plain(updated)
  }

  async function transition(kind, companyId, actorId, id, action, payload = {}) {
    const meta = def(kind)
    const workflow = await workflowService.assertCapability(companyId, meta.capability, actorId)
    const doc = await findDoc(kind, companyId, id)
    const rule = resolveTransition(kind, action, doc.status)
    if (!rule) throw invalidTransition()
    const bundle = await caseBundle.loadBundle(companyId, doc.caseId)
    const check = policyCheckFor(workflow, bundle, kind, doc)
    const data = {}
    let approvalReason = null
    const decision = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : null

    if (action === 'submit') {
      const approval = check.requirements.find(requirement => requirement.stage === 'APPROVAL' && !requirement.satisfied)
      if (approval) { data.status = 'PENDING_APPROVAL'; approvalReason = approval.reason }
      else data.status = kind === 'orders' ? 'APPROVED' : 'PENDING'
    } else if (decision) {
      data.status = DECISION_STATUS[meta.ownerType][decision]
    } else if (action === 'issue') {
      const blockers = policyBlockers(workflow, { ...check.context, approved: check.context.approved || doc.status === 'APPROVED' }, 'PURCHASE_ORDER')
      if (blockers.length) throw policyBlocked(blockers)
      Object.assign(data, { status: 'ISSUED', issuedAt: new Date() })
    } else if (action === 'close') {
      Object.assign(data, { status: 'CLOSED', closedAt: new Date() })
    } else if (action === 'cancel') {
      data.status = 'CANCELLED'
      if (kind === 'orders') data.cancelledAt = new Date()
    } else if (action === 'pay') {
      await workflowService.assertCapability(companyId, 'payments', actorId)
      if (check.blocked) throw policyBlocked(check.blockers)
      const balance = Math.round((num(doc.total) - num(doc.paidAmount)) * 100) / 100
      const amount = payload.amount == null || payload.amount === '' ? balance : asMoney(payload.amount)
      if (amount <= 0) throw new PurchasesServiceError('El monto del pago debe ser mayor a cero.')
      if (amount > balance + 0.001) throw new PurchasesServiceError('El pago excede el saldo pendiente de la factura.')
      const paidAmount = Math.round((num(doc.paidAmount) + amount) * 100) / 100
      Object.assign(data, {
        paidAmount,
        status: paidAmount + 0.001 >= num(doc.total) ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: asDate(payload.paidAt, { fallbackToday: true }),
        paymentReference: cleanText(payload.reference, 120) ?? doc.paymentReference,
        paymentMethod: cleanText(payload.method, 40) ?? doc.paymentMethod,
      })
    }

    const updated = await prisma.$transaction(async tx => {
      const result = await tx[meta.model].update({ where: { id }, data })
      if (approvalReason) await createApproval(tx, { companyId, caseId: doc.caseId, ownerType: meta.ownerType, ownerId: id, reason: approvalReason, actorId })
      if (decision) await resolveApprovals(tx, { companyId, ownerType: meta.ownerType, ownerId: id, decision, actorId, comment: payload.comment })
      if (action === 'cancel') await resolveApprovals(tx, { companyId, ownerType: meta.ownerType, ownerId: id, decision: 'REJECTED', actorId, comment: 'Documento cancelado' })
      await markCaseInProgress(tx, companyId, doc.caseId)
      await writeAudit(tx, {
        companyId, actorId, entityType: meta.entityType, entityId: id, action: `${EVENT[kind]}.${action}`,
        before: { status: doc.status }, after: { status: result.status }, metadata: action === 'pay' ? { amount: num(result.paidAmount) - num(doc.paidAmount) } : undefined,
      })
      return result
    })
    await broadcast(broadcaster, companyId, `${EVENT[kind]}.${action}`, { id, caseId: doc.caseId, status: updated.status })
    return plain(updated)
  }

  return { get, create, update, transition, linesFor }
}
