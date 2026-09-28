export class EncuestasServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'EncuestasServiceError'
    this.status = status
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function toScopedCompanyUuid(companyId) {
  const value = typeof companyId === 'string' ? companyId.trim() : ''
  if (!value) throw new EncuestasServiceError('companyId es requerido.', 400)
  if (!UUID_REGEX.test(value)) throw new EncuestasServiceError('companyId debe ser UUID válido.', 400)
  return value.toLowerCase()
}

export function normalizeRecordId(id, message = 'Registro no encontrado.') {
  const value = String(id ?? '').trim()
  if (!UUID_REGEX.test(value)) throw new EncuestasServiceError(message, 404)
  return value.toLowerCase()
}

export function normalizePagination({ page, pageSize }) {
  const parsedPage = Number.parseInt(String(page ?? '1'), 10)
  const parsedSize = Number.parseInt(String(pageSize ?? '50'), 10)
  const safePage = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1
  const safePageSize = Number.isFinite(parsedSize) ? Math.min(100, Math.max(1, parsedSize)) : 50
  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize }
}

export function normalizeSearch(search) {
  const value = String(search ?? '').trim()
  return value ? value : null
}

export function firstRow(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

export function toCount(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

export function jsonText(value) {
  return JSON.stringify(value ?? null)
}

export function isTableNotFoundError(error) {
  const code = String(error?.code ?? error?.cause?.code ?? '')
  const message = String(error?.message ?? '').toLowerCase()
  return code === '42P01' || message.includes('42p01') || (message.includes('relation') && message.includes('does not exist'))
}

export async function withDbErrorMapping(fn) {
  try {
    return await fn()
  } catch (error) {
    if (isTableNotFoundError(error)) throw new EncuestasServiceError('Las tablas del módulo todavía no están disponibles.', 503)
    throw error
  }
}
