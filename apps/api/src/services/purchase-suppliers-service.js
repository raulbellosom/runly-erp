// runly.purchases — suppliers. Contact stays the identity source of truth;
// purchase_supplier_profile only adds purchasing data (code, terms, notes).
import { buildAvatarUrlMapByFileIds } from '../lib/avatar-url-map.js'
import { KINDS, SUPPLIER_SELECT, broadcast, cleanText, dateKey, notFound, num, pagination, plain, writeAudit } from './purchases-shared.js'

const COUNTED = { notIn: ['CANCELLED', 'DRAFT'] }

export function createPurchaseSuppliersService({ prisma, broadcaster, supabaseAdmin }) {
  // Contact photos, signed like the contacts directory does; best effort.
  async function withAvatars(rows, variant = 'thumb') {
    const ids = rows.map(row => row.avatarFileId).filter(Boolean)
    const map = supabaseAdmin && ids.length
      ? await buildAvatarUrlMapByFileIds(ids, variant, { prisma, supabaseAdmin }).catch(() => new Map())
      : new Map()
    return rows.map(row => ({ ...row, avatarUrl: map.get(row.avatarFileId) ?? null }))
  }

  async function statsByContact(companyId, contactIds) {
    const where = { companyId, supplierId: contactIds ? { in: contactIds } : { not: null } }
    const [orders, invoices] = await Promise.all([
      prisma.purchaseOrder.groupBy({ by: ['supplierId'], where: { ...where, status: COUNTED }, _sum: { total: true }, _count: { _all: true }, _max: { issueDate: true } }),
      prisma.purchaseInvoice.groupBy({ by: ['supplierId'], where: { ...where, status: COUNTED }, _sum: { total: true, paidAmount: true }, _count: { _all: true }, _max: { issueDate: true } }),
    ])
    const stats = new Map()
    const entry = id => {
      if (!stats.has(id)) stats.set(id, { orders: 0, invoices: 0, ordered: 0, invoiced: 0, paid: 0, lastPurchaseAt: null })
      return stats.get(id)
    }
    for (const row of orders) {
      const value = entry(row.supplierId)
      value.orders = row._count._all
      value.ordered = num(row._sum.total)
      value.lastPurchaseAt = dateKey(row._max.issueDate)
    }
    for (const row of invoices) {
      const value = entry(row.supplierId)
      value.invoices = row._count._all
      value.invoiced = num(row._sum.total)
      value.paid = num(row._sum.paidAmount)
      const last = dateKey(row._max.issueDate)
      if (last && (!value.lastPurchaseAt || last > value.lastPurchaseAt)) value.lastPurchaseAt = last
    }
    for (const value of stats.values()) value.payable = Math.max(0, Math.round((value.invoiced - value.paid) * 100) / 100)
    return stats
  }

  // All company contacts (so the list doubles as supplier picker); suppliers
  // with activity first. scope=suppliers keeps only profiled/active suppliers.
  async function list(companyId, query = {}) {
    const { page, pageSize, skip } = pagination(query, { defaultSize: 25, max: 100 })
    const search = cleanText(query.search, 120)
    const contacts = await prisma.contact.findMany({
      where: {
        companyId, enabled: true,
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { legalName: { contains: search, mode: 'insensitive' } }, { taxId: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      select: SUPPLIER_SELECT,
      orderBy: { name: 'asc' },
      take: 1000,
    })
    const [profiles, stats] = await Promise.all([
      prisma.purchaseSupplierProfile.findMany({ where: { companyId, enabled: true } }),
      statsByContact(companyId),
    ])
    const profileMap = new Map(profiles.map(profile => [profile.contactId, profile]))
    let rows = contacts.map(contact => {
      const stat = stats.get(contact.id) ?? { orders: 0, invoices: 0, ordered: 0, invoiced: 0, paid: 0, payable: 0, lastPurchaseAt: null }
      const profile = profileMap.get(contact.id) ?? null
      return {
        ...contact,
        profile: profile ? plain(profile) : null,
        supplier: profile ? { supplierCode: profile.supplierCode, paymentTerms: profile.paymentTerms } : null,
        isSupplier: Boolean(profile) || stat.orders + stat.invoices > 0,
        documents: stat.orders + stat.invoices,
        spend: stat.invoiced || stat.ordered,
        stats: stat,
      }
    })
    if (query.scope === 'suppliers') rows = rows.filter(row => row.isSupplier)
    rows.sort((a, b) => (b.spend - a.spend) || (Number(b.isSupplier) - Number(a.isSupplier)) || a.name.localeCompare(b.name, 'es'))
    return { data: await withAvatars(rows.slice(skip, skip + pageSize)), total: rows.length, page, pageSize, pagination: { page, pageSize, total: rows.length } }
  }

  async function get(companyId, contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, companyId }, select: SUPPLIER_SELECT })
    if (!contact) throw notFound('El proveedor no existe o pertenece a otra empresa.')
    const now = new Date()
    const months = []
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset, 1))
      months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    const since = new Date(months[0] + '-01T00:00:00.000Z')
    const [profile, stats, orders, invoices, monthOrders, monthInvoices] = await Promise.all([
      prisma.purchaseSupplierProfile.findFirst({ where: { companyId, contactId } }),
      statsByContact(companyId, [contactId]),
      prisma.purchaseOrder.findMany({ where: { companyId, supplierId: contactId }, orderBy: { issueDate: 'desc' }, take: 10 }),
      prisma.purchaseInvoice.findMany({ where: { companyId, supplierId: contactId }, orderBy: { issueDate: 'desc' }, take: 10 }),
      prisma.purchaseOrder.findMany({ where: { companyId, supplierId: contactId, status: COUNTED, issueDate: { gte: since } }, select: { issueDate: true, total: true } }),
      prisma.purchaseInvoice.findMany({ where: { companyId, supplierId: contactId, status: COUNTED, issueDate: { gte: since } }, select: { issueDate: true, total: true } }),
    ])
    const monthly = months.map(month => ({ month, ordered: 0, invoiced: 0 }))
    const byMonth = new Map(monthly.map(row => [row.month, row]))
    for (const row of monthOrders) { const bucket = byMonth.get(dateKey(row.issueDate).slice(0, 7)); if (bucket) bucket.ordered += num(row.total) }
    for (const row of monthInvoices) { const bucket = byMonth.get(dateKey(row.issueDate).slice(0, 7)); if (bucket) bucket.invoiced += num(row.total) }
    const recent = [
      ...orders.map(row => ({ kind: 'orders', type: 'purchase_order', id: row.id, number: row.number, status: row.status, total: num(row.total), currency: row.currency, date: dateKey(row.issueDate), path: `${KINDS.orders.path}/${row.id}` })),
      ...invoices.map(row => ({ kind: 'invoices', type: 'purchase_invoice', id: row.id, number: row.number, status: row.status, total: num(row.total), currency: row.currency, date: dateKey(row.issueDate), path: `${KINDS.invoices.path}/${row.id}` })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12)
    const [withPhoto] = await withAvatars([contact], 'full')
    return {
      ...withPhoto,
      profile: profile ? plain(profile) : null,
      stats: stats.get(contactId) ?? { orders: 0, invoices: 0, ordered: 0, invoiced: 0, paid: 0, payable: 0, lastPurchaseAt: null },
      recent,
      monthly,
    }
  }

  async function updateProfile(companyId, actorId, contactId, input = {}) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, companyId, enabled: true }, select: { id: true } })
    if (!contact) throw notFound('El proveedor no existe o pertenece a otra empresa.')
    const data = {
      paymentTerms: cleanText(input.paymentTerms, 120),
      supplierCode: cleanText(input.supplierCode, 60),
      notes: cleanText(input.notes, 1000),
      enabled: input.enabled === false ? false : true,
    }
    const profile = await prisma.$transaction(async tx => {
      const before = await tx.purchaseSupplierProfile.findFirst({ where: { companyId, contactId } })
      const value = before
        ? await tx.purchaseSupplierProfile.update({ where: { id: before.id }, data })
        : await tx.purchaseSupplierProfile.create({ data: { companyId, contactId, ...data } })
      await writeAudit(tx, { companyId, actorId, entityType: 'purchase_supplier_profile', entityId: value.id, action: 'purchase.supplier.updated', before, after: value })
      return value
    })
    await broadcast(broadcaster, companyId, 'purchase.supplier.updated', { contactId })
    return plain(profile)
  }

  return { list, get, updateProfile }
}
