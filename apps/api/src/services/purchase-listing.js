// Generic, company-scoped list endpoint for every purchase document kind.
// Envelope: { data, total, page, pageSize, pagination }.
import { toLocalIso } from '@runly/core'
import { KINDS, cleanText, dateKey, num, pagination, plain, statusFilter, supplierNames } from './purchases-shared.js'

const SEARCH_FIELDS = {
  cases: ['number', 'title'],
  requests: ['number', 'title'],
  quotes: ['reference', 'notes'],
  orders: ['number', 'notes', 'supplierReference'],
  receipts: ['number', 'notes'],
  invoices: ['number', 'notes', 'fiscalUuid'],
}
const WITH_SUPPLIER = new Set(['cases', 'quotes', 'orders', 'invoices'])
const DATE_FIELD = { quotes: 'issueDate', orders: 'issueDate', invoices: 'issueDate', receipts: 'receivedAt' }

export function createPurchaseListing({ prisma }) {
  async function list(kind, companyId, query = {}) {
    const def = KINDS[kind]
    const { page, pageSize, skip, take } = pagination(query)
    const search = cleanText(query.search, 120)
    const where = { companyId }
    const status = statusFilter(query.status)
    if (status) where.status = status
    if (query.supplierId && WITH_SUPPLIER.has(kind)) where.supplierId = String(query.supplierId)
    if (query.caseId && kind !== 'cases') where.caseId = String(query.caseId)
    if (query.orderId && kind === 'receipts') where.orderId = String(query.orderId)
    if (query.requestId && kind === 'quotes') where.requestId = String(query.requestId)
    if (kind === 'invoices' && String(query.overdue) === 'true') {
      where.status = { in: ['PENDING', 'PARTIALLY_PAID'] }
      where.dueDate = { lt: new Date(toLocalIso() + 'T00:00:00.000Z') }
    }
    if (kind === 'receipts' && query.supplierId) {
      const orders = await prisma.purchaseOrder.findMany({ where: { companyId, supplierId: String(query.supplierId) }, select: { id: true } })
      where.orderId = { in: orders.map(order => order.id) }
    }
    if (search) where.OR = SEARCH_FIELDS[kind].map(field => ({ [field]: { contains: search, mode: 'insensitive' } }))
    const model = prisma[def.model]
    const [rows, total] = await Promise.all([
      model.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      model.count({ where }),
    ])
    let orders = new Map()
    if (kind === 'receipts' && rows.length) {
      const orderRows = await prisma.purchaseOrder.findMany({ where: { companyId, id: { in: rows.map(row => row.orderId) } }, select: { id: true, number: true, supplierId: true, total: true, currency: true } })
      orders = new Map(orderRows.map(order => [order.id, order]))
    }
    const names = await supplierNames(prisma, companyId, kind === 'receipts' ? [...orders.values()].map(order => order.supplierId) : rows.map(row => row.supplierId))
    const data = rows.map(row => {
      const out = { ...plain(row), path: `${def.path}/${row.id}` }
      if (DATE_FIELD[kind]) out.date = dateKey(row[DATE_FIELD[kind]])
      if (kind === 'receipts') {
        const order = orders.get(row.orderId)
        out.orderNumber = order?.number ?? null
        out.supplierId = order?.supplierId ?? null
        out.supplierName = names.get(order?.supplierId) ?? null
        out.currency = order?.currency ?? null
      } else if (WITH_SUPPLIER.has(kind)) {
        out.supplierName = names.get(row.supplierId) ?? null
      }
      if (kind === 'invoices') out.balance = Math.max(0, Math.round((num(row.total) - num(row.paidAmount)) * 100) / 100)
      return out
    })
    return { data, total, page, pageSize, pagination: { page, pageSize, total } }
  }

  return { list }
}
