// Shared helpers for the runly.purchases services: errors, input coercion,
// numbering, audit, money/serialization and the document-kind registry.
// Helpers that touch the database always receive the client (`tx`) explicitly.

export const MODULE_KEY = 'runly.purchases'

export class PurchasesServiceError extends Error {
  constructor(message, status = 400, code = 'VALIDATION', extra = undefined) {
    super(message)
    this.name = 'PurchasesServiceError'
    this.status = status
    this.code = code
    if (extra) Object.assign(this, extra)
  }
}

export const notFound = (message = 'El documento no existe o pertenece a otra empresa.') =>
  new PurchasesServiceError(message, 404, 'NOT_FOUND')
export const invalidTransition = (message = 'La acción no está permitida en el estado actual.') =>
  new PurchasesServiceError(message, 409, 'INVALID_TRANSITION')
export const policyBlocked = blockers =>
  new PurchasesServiceError(
    'Faltan etapas requeridas por la política de compras.',
    409,
    'POLICY_BLOCKED',
    { reasons: blockers.map(blocker => blocker.reason), blockers },
  )

// Document kinds: route segment -> model, entity type, owner type, prefix.
export const KINDS = {
  cases: { model: 'purchaseCase', entityType: 'purchase_case', prefix: 'EXP', path: '/purchases/cases' },
  requests: { model: 'purchaseRequest', entityType: 'purchase_request', ownerType: 'PURCHASE_REQUEST', prefix: 'SOL', path: '/purchases/requests', capability: 'requests' },
  quotes: { model: 'purchaseQuote', entityType: 'purchase_quote', prefix: null, path: '/purchases/quotes', capability: 'quotes' },
  orders: { model: 'purchaseOrder', entityType: 'purchase_order', ownerType: 'PURCHASE_ORDER', prefix: 'OC', path: '/purchases/orders', capability: 'purchaseOrders' },
  receipts: { model: 'purchaseReceipt', entityType: 'purchase_receipt', prefix: 'REC', path: '/purchases/receipts', capability: 'receipts' },
  invoices: { model: 'purchaseInvoice', entityType: 'purchase_invoice', ownerType: 'PURCHASE_INVOICE', prefix: 'FAC', path: '/purchases/invoices', capability: 'invoices' },
}

export const ENTITY_TYPE_TO_KIND = Object.fromEntries(Object.entries(KINDS).map(([kind, def]) => [def.entityType, kind]))
export const OWNER_TYPE_TO_KIND = { PURCHASE_REQUEST: 'requests', PURCHASE_ORDER: 'orders', PURCHASE_INVOICE: 'invoices' }

export function cleanText(value, max = 2000) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, max) : null
}

export function asMoney(value, fallback = 0) {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number) || number < 0) throw new PurchasesServiceError('Los importes deben ser números positivos.')
  return Math.round(number * 100) / 100
}

export function asQuantity(value, fallback = 1) {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number) || number <= 0) throw new PurchasesServiceError('Las cantidades deben ser mayores a cero.')
  return Math.round(number * 10000) / 10000
}

export function num(value) {
  if (value == null) return 0
  const number = typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : Number(value)
  return Number.isFinite(number) ? number : 0
}

// Parses YYYY-MM-DD into a UTC-midnight Date (matches Postgres DATE columns).
export function asDate(value, { required = false, fallbackToday = false } = {}) {
  if (!value) {
    if (fallbackToday) return new Date(new Date().setUTCHours(0, 0, 0, 0))
    if (required) throw new PurchasesServiceError('La fecha es obligatoria.')
    return null
  }
  const date = new Date(String(value).slice(0, 10) + 'T00:00:00.000Z')
  if (Number.isNaN(date.getTime())) throw new PurchasesServiceError('La fecha no es válida.')
  return date
}

// YYYY-MM-DD of a DATE column value (stored as UTC midnight).
export function dateKey(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

export function currency(value, fallback = 'MXN') {
  const code = String(value || fallback).trim().toUpperCase().slice(0, 3)
  return /^[A-Z]{3}$/.test(code) ? code : fallback
}

export function pagination(query = {}, { defaultSize = 25, max = 100 } = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(max, Math.max(1, Number(query.pageSize ?? query.limit) || defaultSize))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function statusFilter(value) {
  if (!value) return undefined
  const list = String(value).split(',').map(item => item.trim().toUpperCase()).filter(Boolean)
  if (!list.length) return undefined
  return list.length === 1 ? list[0] : { in: list }
}

const MONEY_FIELDS = ['subtotal', 'tax', 'total', 'estimatedTotal', 'paidAmount', 'quantity', 'unitAmount',
  'taxAmount', 'taxRate', 'receivedQuantity', 'allocatedAmount', 'allocationPercentage']

// Converts Prisma Decimal fields into plain numbers for JSON responses.
export function plain(row) {
  if (!row) return row
  const out = { ...row }
  for (const field of MONEY_FIELDS) if (field in out && out[field] != null) out[field] = num(out[field])
  return out
}

export async function writeAudit(tx, { companyId, actorId, entityType, entityId, action, before, after, metadata }) {
  await tx.auditLog.create({
    data: { companyId, actorId: actorId || null, moduleKey: MODULE_KEY, entityType, entityId, action, before, after, metadata },
  })
}

// Sequential per-company numbering guarded by a transaction-scoped advisory lock.
export async function nextNumber(tx, companyId, prefix, model) {
  const lockKey = companyId + ':' + prefix
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`
  const count = await tx[model].count({ where: { companyId } })
  return prefix + '-' + String(count + 1).padStart(6, '0')
}

export async function assertSupplier(client, companyId, supplierId) {
  if (!supplierId) return null
  const contact = await client.contact.findFirst({ where: { id: supplierId, companyId, enabled: true }, select: { id: true, name: true } })
  if (!contact) throw notFound('El proveedor no existe o no pertenece a esta empresa.')
  return contact
}

export async function supplierNames(client, companyId, ids) {
  const unique = [...new Set((ids ?? []).filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await client.contact.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, name: true } })
  return new Map(rows.map(row => [row.id, row.name]))
}

// Normalizes an editor line into purchase_line data (amounts computed server side).
export function normalizeLine(line, index) {
  // The concept text is optional: a line counts when it has text or an amount.
  const description = cleanText(line?.description, 500) ?? ''
  const unitAmount = asMoney(line?.unitAmount)
  if (!description && !(unitAmount > 0)) return null
  const quantity = asQuantity(line.quantity, 1)
  const taxRate = Math.min(1, Math.max(0, Number(line.taxRate ?? 0) || 0))
  const base = Math.round(quantity * unitAmount * 100) / 100
  const taxAmount = line.taxAmount != null && line.taxRate == null ? asMoney(line.taxAmount) : Math.round(base * taxRate * 100) / 100
  return {
    description,
    quantity,
    unitAmount,
    taxRate,
    taxAmount,
    total: Math.round((base + taxAmount) * 100) / 100,
    itemKind: String(line.itemKind || 'GOODS').toUpperCase() === 'SERVICE' ? 'SERVICE' : 'GOODS',
    unit: cleanText(line.unit, 20),
    inventoryCategoryId: line.inventoryCategoryId || null,
    sortOrder: index,
  }
}

export function totalsFromLines(lines, input = {}) {
  if (lines.length) {
    const subtotal = lines.reduce((sum, line) => sum + line.total - line.taxAmount, 0)
    const tax = lines.reduce((sum, line) => sum + line.taxAmount, 0)
    return { subtotal: Math.round(subtotal * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((subtotal + tax) * 100) / 100 }
  }
  const subtotal = asMoney(input.subtotal ?? input.total)
  const tax = asMoney(input.tax)
  return { subtotal, tax, total: asMoney(input.total ?? subtotal + tax) }
}

// Validates that inventory categories referenced by lines belong to the company.
export async function assertLineCategories(client, companyId, lines) {
  const ids = [...new Set(lines.map(line => line.inventoryCategoryId).filter(Boolean))]
  if (!ids.length) return
  const rows = await client.invCategory.findMany({ where: { companyId, id: { in: ids } }, select: { id: true } })
  if (rows.length !== ids.length) throw notFound('Una o más categorías de inventario no pertenecen a esta empresa.')
}

export async function replaceLines(tx, companyId, ownerType, ownerId, lines) {
  await tx.purchaseLine.deleteMany({ where: { companyId, ownerType, ownerId } })
  if (lines.length) {
    await tx.purchaseLine.createMany({ data: lines.map(line => ({ ...line, companyId, ownerType, ownerId })) })
  }
}

export async function createApproval(tx, { companyId, caseId, ownerType, ownerId, reason, actorId }) {
  const existing = await tx.purchaseApproval.findFirst({ where: { companyId, ownerType, ownerId, status: 'PENDING' } })
  if (existing) return existing
  return tx.purchaseApproval.create({
    data: { companyId, caseId, ownerType, ownerId, reason: cleanText(reason, 500), status: 'PENDING', requestedById: actorId || null },
  })
}

// Closes every pending approval of an owner with the given decision.
export async function resolveApprovals(tx, { companyId, ownerType, ownerId, decision, actorId, comment }) {
  await tx.purchaseApproval.updateMany({
    where: { companyId, ownerType, ownerId, status: 'PENDING' },
    data: { status: decision, decidedById: actorId || null, decidedAt: new Date(), comment: cleanText(comment, 1000) },
  })
}

export const SUPPLIER_SELECT = { id: true, name: true, legalName: true, email: true, phone: true, taxId: true, avatarFileId: true }

export async function createCase(tx, { companyId, actorId, workflowId, title, currency: code, estimatedTotal, supplierId, requestId }) {
  const number = await nextNumber(tx, companyId, 'EXP', 'purchaseCase')
  return tx.purchaseCase.create({
    data: {
      companyId, workflowId: workflowId || null, number, title: (cleanText(title, 255) || number),
      currency: currency(code), estimatedTotal: estimatedTotal ?? null, supplierId: supplierId || null,
      requestId: requestId || null, createdById: actorId || null,
    },
  })
}

// Owner status after an approval decision (only applied while it waits).
export const DECISION_STATUS = {
  PURCHASE_REQUEST: { waiting: 'SUBMITTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
  PURCHASE_ORDER: { waiting: 'PENDING_APPROVAL', APPROVED: 'APPROVED', REJECTED: 'DRAFT' },
  PURCHASE_INVOICE: { waiting: 'PENDING_APPROVAL', APPROVED: 'PENDING', REJECTED: 'DRAFT' },
}

export async function markCaseInProgress(tx, companyId, caseId) {
  if (!caseId) return
  await tx.purchaseCase.updateMany({ where: { id: caseId, companyId, status: 'OPEN' }, data: { status: 'IN_PROGRESS' } })
}

export async function relate(tx, { companyId, actorId, sourceType, sourceId, targetModule = MODULE_KEY, targetType, targetId, relationType, origin = 'MANUAL', sourceRelationId = null, metadata }) {
  await tx.entityRelation.createMany({
    data: [{
      companyId, sourceModule: MODULE_KEY, sourceType, sourceId, targetModule, targetType, targetId,
      relationType, origin, sourceRelationId, metadata, createdById: actorId || null,
    }],
    skipDuplicates: true,
  })
}

export function broadcast(broadcaster, companyId, event, payload = {}) {
  return Promise.resolve(broadcaster?.broadcastToCompany?.(companyId, event, { moduleKey: MODULE_KEY, ...payload })).catch(() => {})
}
