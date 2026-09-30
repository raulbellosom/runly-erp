// Read-only, company-scoped helpers for a future MirAI integration with
// runly.purchases (spec §10). Returns compact JSON. Not wired into MirAI yet;
// follow the inventory-chat-actions.js pattern when it is.
import { toLocalIso } from '@runly/core'
import { KINDS, cleanText, dateKey, num, supplierNames } from './purchases-shared.js'

export function createPurchasesAssistantContext({ prisma }) {
  async function pendingActions(companyId) {
    const today = new Date(toLocalIso() + 'T00:00:00.000Z')
    const [approvals, overdue, awaitingReceipt, drafts] = await Promise.all([
      prisma.purchaseApproval.count({ where: { companyId, status: 'PENDING' } }),
      prisma.purchaseInvoice.findMany({ where: { companyId, status: { in: ['PENDING', 'PARTIALLY_PAID'] }, dueDate: { lt: today } }, select: { number: true, total: true, paidAmount: true, dueDate: true }, take: 10 }),
      prisma.purchaseOrder.findMany({ where: { companyId, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } }, select: { number: true, expectedDate: true }, take: 10 }),
      prisma.purchaseOrder.count({ where: { companyId, status: 'DRAFT' } }),
    ])
    return {
      pendingApprovals: approvals,
      draftOrders: drafts,
      overdueInvoices: overdue.map(row => ({ number: row.number, balance: num(row.total) - num(row.paidAmount), dueDate: dateKey(row.dueDate) })),
      awaitingReceipt: awaitingReceipt.map(row => ({ number: row.number, expectedDate: dateKey(row.expectedDate) })),
    }
  }

  async function findDocuments(companyId, { type = 'orders', search, limit = 10 } = {}) {
    const kind = KINDS[type] ? type : 'orders'
    const text = cleanText(search, 120)
    const rows = await prisma[KINDS[kind].model].findMany({
      where: { companyId, ...(text ? { number: { contains: text, mode: 'insensitive' } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(25, Math.max(1, Number(limit) || 10)),
    })
    const names = await supplierNames(prisma, companyId, rows.map(row => row.supplierId))
    return rows.map(row => ({ kind, number: row.number ?? row.reference ?? null, status: row.status, total: num(row.total ?? row.estimatedTotal), currency: row.currency ?? null, supplier: names.get(row.supplierId) ?? null }))
  }

  async function supplierSpend(companyId, { limit = 10 } = {}) {
    const grouped = await prisma.purchaseInvoice.groupBy({
      by: ['supplierId'],
      where: { companyId, supplierId: { not: null }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      _sum: { total: true },
    })
    const top = grouped.sort((a, b) => num(b._sum.total) - num(a._sum.total)).slice(0, Math.min(25, Number(limit) || 10))
    const names = await supplierNames(prisma, companyId, top.map(row => row.supplierId))
    return top.map(row => ({ supplier: names.get(row.supplierId) ?? null, invoiced: num(row._sum.total) }))
  }

  async function itemPurchaseHistory(companyId, itemId) {
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId }, select: { id: true, assetTag: true, name: true } })
    if (!item) return null
    const relations = await prisma.entityRelation.findMany({ where: { companyId, targetType: 'inventory_item', targetId: itemId, sourceModule: 'runly.purchases' }, select: { sourceType: true, sourceId: true, origin: true } })
    const docs = []
    for (const [kind, def] of Object.entries(KINDS)) {
      const ids = relations.filter(relation => relation.sourceType === def.entityType).map(relation => relation.sourceId)
      if (!ids.length) continue
      const rows = await prisma[def.model].findMany({ where: { companyId, id: { in: ids } } })
      for (const row of rows) docs.push({ kind, number: row.number ?? row.reference ?? null, status: row.status, total: row.total != null ? num(row.total) : null })
    }
    return { item: { assetTag: item.assetTag, name: item.name }, documents: docs }
  }

  return { pendingActions, findDocuments, supplierSpend, itemPurchaseHistory }
}
