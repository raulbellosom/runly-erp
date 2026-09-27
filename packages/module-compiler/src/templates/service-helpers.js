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
