import {
  isTableNotFoundError, isUniqueViolation, firstRow, hasOwn, normalizeOptionalString,
} from './service-helpers.js'
import { LedgerServiceError } from './ledger-service.js'

export function createCategoriesService({ prisma }) {

  async function listCategories({ companyId, actorId }) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT *, (owner_id IS NULL) AS is_system
        FROM ledger_category
        WHERE company_id = ${companyId}::uuid
          AND enabled = true
          AND (owner_id IS NULL OR owner_id = ${actorId}::uuid)
        ORDER BY owner_id NULLS FIRST, name
      `
      return { data: rows }
    } catch (err) {
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }

  async function getCategory({ companyId, categoryId }) {
    const rows = await prisma.$queryRaw`
      SELECT *, (owner_id IS NULL) AS is_system
      FROM ledger_category
      WHERE id = ${categoryId}::uuid AND company_id = ${companyId}::uuid
    `
    const row = firstRow(rows)
    if (!row) throw new LedgerServiceError('Categoria no encontrada.', 404)
    return row
  }

  async function createCategory({ companyId, actorId, data }) {
    const name  = String(data.name).trim()
    const color = normalizeOptionalString(data.color) ?? null
    const kind  = data.kind ?? 'both'
    try {
      const rows = await prisma.$queryRaw`
        INSERT INTO ledger_category (company_id, owner_id, name, color, kind, enabled, updated_at)
        VALUES (${companyId}::uuid, ${actorId}::uuid, ${name}, ${color}, ${kind}, true, NOW())
        RETURNING *, (owner_id IS NULL) AS is_system
      `
      return firstRow(rows)
    } catch (err) {
      if (isUniqueViolation(err)) throw new LedgerServiceError(`Ya existe una categoria con el nombre "${name}".`, 409)
      throw err
    }
  }

  async function updateCategory({ companyId, categoryId, actorId, data }) {
    const existing = await getCategory({ companyId, categoryId })
    if (existing.is_system) throw new LedgerServiceError('Las categorias de sistema no se pueden editar.', 403)
    const name  = hasOwn(data, 'name')  ? String(data.name).trim()             : existing.name
    const color = hasOwn(data, 'color') ? (normalizeOptionalString(data.color) ?? null) : existing.color
    const kind  = hasOwn(data, 'kind')  ? data.kind                            : existing.kind
    try {
      const rows = await prisma.$queryRaw`
        UPDATE ledger_category
        SET name = ${name}, color = ${color}, kind = ${kind}, updated_at = NOW()
        WHERE id = ${categoryId}::uuid AND company_id = ${companyId}::uuid AND owner_id = ${actorId}::uuid
        RETURNING *, (owner_id IS NULL) AS is_system
      `
      const row = firstRow(rows)
      if (!row) throw new LedgerServiceError('Categoria no encontrada o sin permiso para editarla.', 404)
      return row
    } catch (err) {
      if (err instanceof LedgerServiceError) throw err
      if (isUniqueViolation(err)) throw new LedgerServiceError(`Ya existe una categoria con el nombre "${name}".`, 409)
      throw err
    }
  }

  async function setCategoryEnabled({ companyId, categoryId, actorId, enabled }) {
    const existing = await getCategory({ companyId, categoryId })
    if (existing.is_system) throw new LedgerServiceError('Las categorias de sistema no se pueden desactivar.', 403)
    const rows = await prisma.$queryRaw`
      UPDATE ledger_category
      SET enabled = ${enabled}, updated_at = NOW()
      WHERE id = ${categoryId}::uuid AND company_id = ${companyId}::uuid AND owner_id = ${actorId}::uuid
      RETURNING *, (owner_id IS NULL) AS is_system
    `
    const row = firstRow(rows)
    if (!row) throw new LedgerServiceError('Categoria no encontrada o sin permiso para modificarla.', 404)
    return row
  }

  return { listCategories, getCategory, createCategory, updateCategory, setCategoryEnabled }
}
