import { toPascal, moduleSlug } from './helpers.js'

export function generateServiceHelpers(config) {
  const slug = moduleSlug(config.key)
  const errorClass = toPascal(slug) + 'ServiceError'

  return `export class ${errorClass} extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = '${errorClass}'
    this.status = status
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function toScopedCompanyUuid(companyId, ErrorClass = ${errorClass}) {
  const normalized = (typeof companyId === 'string' && companyId.trim()) ? companyId.trim() : null
  if (!normalized) throw new ErrorClass('companyId es requerido.', 400)
  if (!UUID_REGEX.test(normalized)) throw new ErrorClass('companyId debe ser UUID valido.', 400)
  return normalized.toLowerCase()
}

export function normalizeRecordId(id, notFoundMessage, ErrorClass = ${errorClass}) {
  const value = String(id ?? '').trim()
  if (!UUID_REGEX.test(value)) throw new ErrorClass(notFoundMessage, 404)
  return value.toLowerCase()
}

export function normalizePagination({ page, pageSize }) {
  const safePage = Math.max(1, toInt(page, 1))
  const safePageSize = Math.min(100, Math.max(1, toInt(pageSize, 20)))
  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize }
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeSearch(search) {
  const value = String(search ?? '').trim()
  return value.length > 0 ? value : null
}

export function normalizeOptionalString(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

export function isTableNotFoundError(error) {
  const codes = [error?.code, error?.meta?.code, error?.cause?.code, error?.originalError?.code]
  if (codes.includes('42P01')) return true
  const msg = String(error?.message ?? '').toLowerCase()
  return msg.includes('42p01') || (msg.includes('relation') && msg.includes('does not exist'))
}

export function isUniqueViolation(error) {
  const codes = [
    error?.code, error?.meta?.code, error?.cause?.code, error?.cause?.originalCode,
    error?.originalError?.code, error?.meta?.driverAdapterError?.cause?.code,
    error?.meta?.driverAdapterError?.cause?.originalCode,
  ].map((v) => (v == null ? null : String(v))).filter(Boolean)
  if (codes.includes('23505')) return true
  return String(error?.message ?? '').toLowerCase().includes('duplicate key value violates unique constraint')
}

export function toCount(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function firstRow(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

const AUDIT_SKIP_FIELDS = new Set(['id', 'company_id', 'created_at', 'updated_at', 'enabled'])
const AUDIT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function auditValue(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) value = value.map(String).join(', ')
  if (typeof value === 'object') return undefined
  const text = String(value)
  return text.length > 140 ? text.slice(0, 140) + '…' : value
}

// Field-level diff of two rows for the audit trail; capped to fit the
// activity payload limit (4 KB).
export function auditChanges(before, after) {
  if (!before || !after) return []
  const out = []
  let bytes = 2
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (AUDIT_SKIP_FIELDS.has(field) || field.startsWith('_')) continue
    // A relation diffs through its readable label column, not its id.
    if ((field + '__label') in before || (field + '__label') in after) continue
    const oldValue = auditValue(before[field])
    const newValue = auditValue(after[field])
    if (oldValue === undefined || newValue === undefined) continue
    if (String(oldValue ?? '') === String(newValue ?? '')) continue
    const entry = { field, oldValue, newValue }
    const size = JSON.stringify(entry).length + 1
    if (out.length >= 25 || bytes + size > 3200) break
    out.push(entry)
    bytes += size
  }
  return out
}

const AUDIT_VERBS = { create: 'creó', update: 'actualizó', enable: 'reactivó', disable: 'desactivó' }

// Publishes the record's audit-trail entry (Activity) next to its AuditLog
// row. Best effort: a failure here never fails the write.
export async function recordActivity(prisma, { companyId, actorId, type, verb, entityType, entityId, entityLabel, title, before = null, after = null }) {
  try {
    if (!companyId || !AUDIT_UUID.test(String(companyId)) || !entityId) return
    const actor = actorId && AUDIT_UUID.test(String(actorId))
      ? await prisma.userProfile.findUnique({ where: { id: actorId }, select: { displayName: true, firstName: true, lastName: true } })
      : null
    const actorName = actor?.displayName || [actor?.firstName, actor?.lastName].filter(Boolean).join(' ').trim() || 'Sistema'
    const label = title ? ' «' + String(title).slice(0, 120) + '»' : ''
    const changes = verb === 'update' ? auditChanges(before, after) : []
    await prisma.activity.create({
      data: {
        companyId,
        actorId: actor ? actorId : null,
        type,
        entityType,
        entityId,
        summary: actorName + ' ' + (AUDIT_VERBS[verb] ?? verb) + ' ' + entityLabel + label,
        severity: verb === 'create' ? 'success' : verb === 'disable' ? 'warning' : 'info',
        payload: changes.length ? { changes } : undefined,
        source: 'audit_bridge',
      },
    })
  } catch {
    // best effort
  }
}

export async function withDbErrorMapping(fn, ErrorClass = ${errorClass}) {
  try {
    return await fn()
  } catch (error) {
    if (isTableNotFoundError(error)) throw new ErrorClass('Las tablas del modulo no estan disponibles aun.', 503)
    throw error
  }
}
`
}
