// runly.purchases — goods receipts with partial reception.
import { buildStageMap } from './purchase-policies.js'
import {
  MODULE_KEY, PurchasesServiceError, SUPPLIER_SELECT, asDate, broadcast, cleanText, dateKey, invalidTransition, nextNumber, notFound, num, plain, writeAudit,
} from './purchases-shared.js'

const EPSILON = 1e-6
const round4 = value => Math.round(value * 10000) / 10000

// Pure receipt math. orderLines: [{ id, quantity, receivedQuantity, itemKind }],
// requested: [{ orderLineId, quantity }]. Returns the new received quantity per
// line and the resulting order status; throws on unknown lines or over-receipt.
export function planReceipt(orderLines, requested) {
  const byId = new Map(orderLines.map(line => [line.id, line]))
  const totals = new Map()
  for (const entry of requested ?? []) {
    const line = byId.get(entry?.orderLineId)
    if (!line) throw new PurchasesServiceError('Un concepto no pertenece a la orden.', 400, 'VALIDATION')
    const quantity = Number(entry.quantity)
    if (!Number.isFinite(quantity) || quantity < 0) throw new PurchasesServiceError('Las cantidades recibidas no son válidas.', 400, 'VALIDATION')
    if (quantity === 0) continue
    totals.set(line.id, (totals.get(line.id) ?? 0) + quantity)
  }
  if (!totals.size) throw new PurchasesServiceError('Indica al menos una cantidad recibida.', 400, 'VALIDATION')
  const updates = []
  for (const [lineId, quantity] of totals) {
    const line = byId.get(lineId)
    const pending = num(line.quantity) - num(line.receivedQuantity)
    if (quantity > pending + EPSILON) {
      throw new PurchasesServiceError(`La cantidad recibida de «${line.description ?? 'concepto'}» excede lo pendiente (${round4(Math.max(0, pending))}).`, 400, 'VALIDATION')
    }
    updates.push({ lineId, quantity: round4(quantity), receivedQuantity: round4(num(line.receivedQuantity) + quantity) })
  }
  const after = new Map(updates.map(update => [update.lineId, update.receivedQuantity]))
  const goods = orderLines.filter(line => (line.itemKind ?? 'GOODS') !== 'SERVICE')
  const tracked = goods.length ? goods : orderLines
  const complete = tracked.every(line => (after.get(line.id) ?? num(line.receivedQuantity)) + EPSILON >= num(line.quantity))
  return { lines: updates, orderStatus: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' }
}

export function createPurchaseReceiptsService({ prisma, broadcaster, workflowService, caseBundle, hydrator }) {
  async function get(companyId, id, canRead) {
    await workflowService.assertCapability(companyId, 'receipts')
    const workflow = await workflowService.ensureWorkflow(companyId)
    const receipt = await prisma.purchaseReceipt.findFirst({ where: { id, companyId }, include: { lines: true } })
    if (!receipt) throw notFound('La recepción no existe o pertenece a otra empresa.')
    const order = await prisma.purchaseOrder.findFirst({ where: { id: receipt.orderId, companyId } })
    const orderLines = await prisma.purchaseLine.findMany({ where: { companyId, ownerType: 'PURCHASE_ORDER', ownerId: receipt.orderId } })
    const lineMap = new Map(orderLines.map(line => [line.id, line]))
    const [supplier, bundle, relations] = await Promise.all([
      order?.supplierId ? prisma.contact.findFirst({ where: { id: order.supplierId, companyId }, select: SUPPLIER_SELECT }) : null,
      caseBundle.loadBundle(companyId, receipt.caseId),
      hydrator.relationsFor(companyId, MODULE_KEY, 'purchase_receipt', id, canRead),
    ])
    return {
      ...plain(receipt),
      receivedAt: dateKey(receipt.receivedAt),
      supplier,
      supplierName: supplier?.name ?? null,
      order: order ? { ...plain(order), path: `/purchases/orders/${order.id}` } : null,
      orders: order ? [{ ...plain(order), path: `/purchases/orders/${order.id}` }] : [],
      lines: receipt.lines.map(line => {
        const orderLine = lineMap.get(line.orderLineId)
        return {
          ...plain(line),
          description: orderLine?.description ?? null,
          unit: orderLine?.unit ?? null,
          itemKind: orderLine?.itemKind ?? null,
          orderedQuantity: num(orderLine?.quantity),
          receivedQuantity: num(orderLine?.receivedQuantity),
        }
      }),
      relations,
      approvals: [],
      stageMap: buildStageMap(workflow, bundle),
      policyCheck: { action: null, blocked: false, reasons: [], requirements: [] },
    }
  }

  async function create(companyId, actorId, input = {}) {
    await workflowService.assertCapability(companyId, 'receipts', actorId)
    if (!input.orderId) throw new PurchasesServiceError('Selecciona la orden a recibir.')
    const order = await prisma.purchaseOrder.findFirst({ where: { id: input.orderId, companyId } })
    if (!order) throw notFound('La orden no existe o pertenece a otra empresa.')
    if (!['ISSUED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw invalidTransition('Solo se pueden recibir órdenes emitidas.')
    const receipt = await prisma.$transaction(async tx => {
      // Re-read inside the transaction so concurrent receipts cannot over-receive.
      const orderLines = await tx.purchaseLine.findMany({ where: { companyId, ownerType: 'PURCHASE_ORDER', ownerId: order.id } })
      const plan = planReceipt(orderLines, input.lines)
      const number = await nextNumber(tx, companyId, 'REC', 'purchaseReceipt')
      const created = await tx.purchaseReceipt.create({
        data: {
          companyId, caseId: order.caseId, orderId: order.id, number, status: 'COMPLETED',
          receivedAt: asDate(input.receivedAt, { fallbackToday: true }), notes: cleanText(input.notes), receivedById: actorId || null,
        },
      })
      await tx.purchaseReceiptLine.createMany({ data: plan.lines.map(line => ({ companyId, receiptId: created.id, orderLineId: line.lineId, quantity: line.quantity })) })
      for (const line of plan.lines) {
        await tx.purchaseLine.update({ where: { id: line.lineId }, data: { receivedQuantity: line.receivedQuantity } })
      }
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: plan.orderStatus } })
      await tx.entityRelation.createMany({
        data: [{ companyId, sourceModule: MODULE_KEY, sourceType: 'purchase_order', sourceId: order.id, targetModule: MODULE_KEY, targetType: 'purchase_receipt', targetId: created.id, relationType: 'RECEIVED_BY', origin: 'AUTOMATIC', createdById: actorId || null }],
        skipDuplicates: true,
      })
      await tx.purchaseCase.updateMany({ where: { id: order.caseId, companyId, status: 'OPEN' }, data: { status: 'IN_PROGRESS' } })
      await writeAudit(tx, { companyId, actorId, entityType: 'purchase_receipt', entityId: created.id, action: 'purchase.receipt.created', after: created, metadata: { orderId: order.id, lines: plan.lines, orderStatus: plan.orderStatus } })
      return { ...created, orderStatus: plan.orderStatus }
    })
    await broadcast(broadcaster, companyId, 'purchase.receipt.created', { id: receipt.id, orderId: order.id, caseId: order.caseId, orderStatus: receipt.orderStatus })
    return plain(receipt)
  }

  return { get, create }
}
