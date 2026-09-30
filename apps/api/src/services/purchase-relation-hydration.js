// Turns raw entity_relation rows into labelled endpoints for the UI.
// Every lookup is filtered by companyId, so a relation pointing at another
// company's row (or at a deleted one) is dropped instead of leaking its label.
import { KINDS, dateKey, num, supplierNames } from './purchases-shared.js'

export const READ_PERMISSION_BY_TYPE = {
  inventory_item: 'inventory.item.read',
  purchase_case: 'purchases.case.read',
  purchase_request: 'purchases.request.read',
  purchase_quote: 'purchases.quote.read',
  purchase_order: 'purchases.order.read',
  purchase_receipt: 'purchases.receipt.read',
  purchase_invoice: 'purchases.invoice.read',
}

export const PURCHASE_ENTITY_TYPES = ['purchase_case', 'purchase_request', 'purchase_quote', 'purchase_order', 'purchase_receipt', 'purchase_invoice']

// (userContext) -> (entityType) -> boolean
export function readCheckerFor(userContext) {
  return (type) => {
    const key = READ_PERMISSION_BY_TYPE[type]
    if (!key) return false
    if (!userContext || userContext.isAdmin) return true
    const set = userContext.permissionSet
    return Boolean(set?.has?.(key))
  }
}

const allowAll = () => true

export function createRelationHydrator({ prisma }) {
  // Loads labelled summaries for { type -> ids }; returns Map(`${type}:${id}` -> endpoint).
  async function loadEndpoints(companyId, idsByType) {
    const out = new Map()
    const jobs = Object.entries(idsByType).map(async ([type, idSet]) => {
      const ids = [...idSet]
      if (!ids.length) return
      if (type === 'inventory_item') {
        const rows = await prisma.invItem.findMany({
          where: { companyId, id: { in: ids }, enabled: true },
          select: { id: true, name: true, assetTag: true, status: true, category: { select: { name: true } } },
        })
        for (const row of rows) {
          out.set(`${type}:${row.id}`, {
            module: 'runly.inventory', type, id: row.id, label: row.name, sublabel: row.assetTag,
            status: row.status, total: null, currency: null, path: `/inventory/${row.id}`, categoryName: row.category?.name ?? null,
          })
        }
        return
      }
      const kind = Object.keys(KINDS).find(key => KINDS[key].entityType === type)
      if (!kind) return
      const rows = await prisma[KINDS[kind].model].findMany({ where: { companyId, id: { in: ids } } })
      let names = new Map()
      let orderNumbers = new Map()
      if (['orders', 'invoices', 'quotes', 'cases'].includes(kind)) names = await supplierNames(prisma, companyId, rows.map(row => row.supplierId))
      if (kind === 'receipts') {
        const orders = await prisma.purchaseOrder.findMany({ where: { companyId, id: { in: rows.map(row => row.orderId) } }, select: { id: true, number: true, supplierId: true, currency: true } })
        orderNumbers = new Map(orders.map(order => [order.id, order]))
        names = await supplierNames(prisma, companyId, orders.map(order => order.supplierId))
      }
      for (const row of rows) {
        out.set(`${type}:${row.id}`, describe(kind, type, row, names, orderNumbers))
      }
    })
    await Promise.all(jobs)
    return out
  }

  function describe(kind, type, row, names, orderNumbers) {
    const base = { module: 'runly.purchases', type, id: row.id, status: row.status, path: `${KINDS[kind].path}/${row.id}`, currency: row.currency ?? null }
    switch (kind) {
      case 'cases': return { ...base, label: row.number, sublabel: row.title, total: row.estimatedTotal != null ? num(row.estimatedTotal) : null, date: row.createdAt }
      case 'requests': return { ...base, label: row.number, sublabel: row.title, total: num(row.estimatedTotal), date: row.createdAt }
      case 'quotes': return { ...base, label: row.reference || 'Cotización', sublabel: names.get(row.supplierId) ?? null, total: num(row.total), date: dateKey(row.issueDate) }
      case 'receipts': {
        const order = orderNumbers.get(row.orderId)
        return { ...base, label: row.number, sublabel: order ? `${order.number}${names.get(order.supplierId) ? ' · ' + names.get(order.supplierId) : ''}` : null, total: null, currency: order?.currency ?? null, date: dateKey(row.receivedAt) }
      }
      default: return { ...base, label: row.number, sublabel: names.get(row.supplierId) ?? null, total: num(row.total), date: dateKey(row.issueDate) }
    }
  }

  // hydrate(companyId, relations, self?, canRead?) -> [{ id, relationType, origin, createdAt, direction, other }]
  async function hydrate(companyId, relations, self = null, canRead = allowAll) {
    const pick = relation => {
      const isSource = self && relation.sourceType === self.type && relation.sourceId === self.id && (!self.module || relation.sourceModule === self.module)
      return isSource
        ? { direction: 'outgoing', type: relation.targetType, id: relation.targetId }
        : { direction: self ? 'incoming' : 'outgoing', type: self ? relation.sourceType : relation.targetType, id: self ? relation.sourceId : relation.targetId }
    }
    const idsByType = {}
    const picked = relations.map(relation => ({ relation, ...pick(relation) }))
    for (const entry of picked) {
      if (!canRead(entry.type)) continue
      ;(idsByType[entry.type] ??= new Set()).add(entry.id)
    }
    const endpoints = await loadEndpoints(companyId, idsByType)
    return picked
      .filter(entry => canRead(entry.type) && endpoints.has(`${entry.type}:${entry.id}`))
      .map(entry => ({
        id: entry.relation.id,
        relationType: entry.relation.relationType,
        origin: entry.relation.origin,
        createdAt: entry.relation.createdAt,
        direction: entry.direction,
        metadata: entry.relation.metadata ?? null,
        other: endpoints.get(`${entry.type}:${entry.id}`),
      }))
  }

  async function relationsFor(companyId, moduleKey, entityType, entityId, canRead = allowAll) {
    const relations = await prisma.entityRelation.findMany({
      where: {
        companyId,
        OR: [
          { sourceModule: moduleKey, sourceType: entityType, sourceId: entityId },
          { targetModule: moduleKey, targetType: entityType, targetId: entityId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    return hydrate(companyId, relations, { module: moduleKey, type: entityType, id: entityId }, canRead)
  }

  return { loadEndpoints, hydrate, relationsFor }
}
