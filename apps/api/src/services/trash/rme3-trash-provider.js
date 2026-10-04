// Generic Desactivados provider for RME3/Builder module entities (spec
// 2026-10-03-records-trash-design §9): one provider per soft-delete,
// company-scoped model of an installed module. Restore re-enables the row;
// purge deletes it (connection triggers clean the index, FKs enforce
// "Impedir la eliminación").
import { TrashError, TrashInUseError, isForeignKeyViolation } from './trash-errors.js'

const IDENT = /^[a-z_][a-z0-9_]*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LABEL_TYPES = ['text', 'email', 'phone', 'select', 'textarea', 'markdown']

// Column that names a record: first text-like field, else none (id shown).
export function labelColumnOf(model) {
  const fields = model?.fields ?? []
  for (const type of LABEL_TYPES) {
    const field = fields.find((item) => item.type === type && IDENT.test(item.name ?? ''))
    if (field) return field.name
  }
  return null
}

// Deactivate permission of the entity, as the module declares it.
export function restorePermissionOf(moduleKey, manifest, model) {
  const slug = String(moduleKey).split('.').pop()
  const keys = new Set((manifest?.permissions ?? []).map((permission) => permission.key))
  for (const action of ['delete', 'update']) {
    const key = `${slug}.${model.key}.${action}`
    if (keys.has(key)) return key
  }
  return null
}

export function createRme3TrashProvider({ moduleKey, moduleName, manifest, model }) {
  const table = model.tableName
  if (!IDENT.test(table ?? '') || model.softDelete !== true || model.companyScoped === false) return null
  const restorePermission = restorePermissionOf(moduleKey, manifest, model)
  if (!restorePermission) return null
  const labelColumn = labelColumnOf(model)
  const labelSql = labelColumn ? `"${labelColumn}"::text` : 'NULL::text'
  const assertId = (id) => { if (!UUID.test(String(id ?? ''))) throw new TrashError('Registro no válido.', 400) }

  return {
    id: `${moduleKey}:${model.key}`,
    table,
    transactional: true,
    moduleKey,
    moduleName,
    label: model.label ?? model.key,
    pluralLabel: model.pluralLabel ?? model.label ?? model.key,
    permissions: { restore: restorePermission },

    async count({ prisma, companyId }) {
      const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}" WHERE company_id = $1::uuid AND enabled = false`, companyId)
      return count
    },

    async expired({ prisma, companyId }, before, limit = 200) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id::text AS id FROM "${table}" WHERE company_id = $1::uuid AND enabled = false AND updated_at < $2 ORDER BY updated_at ASC LIMIT ${Number(limit) || 200}`,
        companyId, before,
      )
      return rows.map((row) => row.id)
    },

    async list({ prisma, companyId }, { search = '', page = 1, pageSize = 25 } = {}) {
      const term = String(search ?? '').trim()
      const filter = term && labelColumn ? ` AND "${labelColumn}"::text ILIKE $2` : ''
      const params = term && labelColumn ? [companyId, `%${term}%`] : [companyId]
      const offset = (Math.max(1, Number(page) || 1) - 1) * pageSize
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id::text AS id, ${labelSql} AS label, updated_at AS "deactivatedAt" FROM "${table}"
          WHERE company_id = $1::uuid AND enabled = false${filter}
          ORDER BY updated_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
        ...params,
      )
      const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}" WHERE company_id = $1::uuid AND enabled = false${filter}`, ...params)
      return { items: rows, total: count }
    },

    async restore({ prisma, companyId }, id) {
      assertId(id)
      const rows = await prisma.$queryRawUnsafe(
        `UPDATE "${table}" SET enabled = true, updated_at = now() WHERE id = $1::uuid AND company_id = $2::uuid AND enabled = false RETURNING id::text AS id, ${labelSql} AS label`,
        id, companyId,
      )
      if (!rows.length) throw new TrashError('El registro no está desactivado o no existe.', 404)
      return rows[0]
    },

    async purge({ prisma, companyId }, id) {
      assertId(id)
      try {
        const rows = await prisma.$queryRawUnsafe(
          `DELETE FROM "${table}" WHERE id = $1::uuid AND company_id = $2::uuid AND enabled = false RETURNING id::text AS id, ${labelSql} AS label`,
          id, companyId,
        )
        if (!rows.length) throw new TrashError('El registro no está desactivado o no existe.', 404)
        return rows[0]
      } catch (error) {
        if (isForeignKeyViolation(error)) throw new TrashInUseError()
        throw error
      }
    },
  }
}
