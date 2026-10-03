// Reads of connected data for core screens (spec
// 2026-10-03-rme3-module-platform-v2 §12.2): sections for a core record's
// detail/form, values for list columns, and target ids matching a search —
// all from the central index (public.connection_record), one query each.
import { can, createConnectionCatalog, entityPermission, surfaceFields } from './connection-catalog.js'

const RELATED_PREVIEW_LIMIT = 10
const SEARCH_ID_LIMIT = 500

// 'lab 20' -> 'lab:* & 20:*' (prefix match per word); null when nothing usable.
export function prefixTsQuery(text) {
  const words = String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length ? words.slice(0, 8).map((word) => `${word}:*`).join(' & ') : null
}

function pick(data, fields) {
  const out = {}
  for (const field of fields) out[field.name] = data?.[field.name] ?? null
  return out
}

// Required fields of the entity that are not offered to the form: creating a
// record from the core form would fail validation, so the section is read-only.
function missingRequired(connection, formFields) {
  const offered = new Set(formFields.map((field) => field.name))
  return (connection.model?.fields ?? [])
    .filter((field) => field.required && field.name !== connection.targetField && !offered.has(field.name))
    .map((field) => field.label ?? field.name)
}

export function createConnectionReadService({ prisma }) {
  const catalog = createConnectionCatalog({ prisma })

  // Sections for one core record. surface: 'detail' | 'form'.
  async function recordsFor({ companyId, targetType, targetId, surface = 'detail', user }) {
    const connections = await catalog.activeConnections({ companyId, targetType, user })
    if (!connections.length) return []
    const rows = await prisma.connectionRecord.findMany({
      where: {
        companyId, targetType, targetId, enabled: true,
        OR: connections.map((c) => ({ moduleKey: c.moduleKey, connectionKey: c.connectionKey })),
      },
      orderBy: { updatedAt: 'desc' },
    })
    const sections = []
    for (const connection of connections) {
      const fields = surfaceFields(connection, surface)
      if (!fields.length) continue
      const mine = rows.filter((row) => row.moduleKey === connection.moduleKey && row.connectionKey === connection.connectionKey)
      const section = {
        connectionId: connection.id,
        moduleKey: connection.moduleKey,
        moduleName: connection.moduleName,
        icon: connection.moduleIcon,
        label: connection.label,
        kind: connection.kind,
        entity: connection.sourceEntity,
        fields,
      }
      if (connection.kind === 'fields') {
        const row = mine[0] ?? null
        section.record = row ? { id: row.sourceRecordId, values: pick(row.data, fields), updatedAt: row.updatedAt } : null
        if (surface === 'form') {
          const missing = missingRequired(connection, fields)
          const action = row ? 'update' : 'create'
          const allowed = can(user, entityPermission(connection.moduleKey, connection.sourceEntity, action))
          section.editable = allowed && (row ? true : missing.length === 0)
          section.readOnlyReason = !allowed
            ? 'No tienes permiso para editar estos datos.'
            : (!row && missing.length ? `Para crearlo faltan campos obligatorios: ${missing.join(', ')}. Complétalo en ${connection.moduleName}.` : null)
        }
      } else {
        section.total = mine.length
        section.records = mine.slice(0, RELATED_PREVIEW_LIMIT).map((row) => ({ id: row.sourceRecordId, values: pick(row.data, fields), updatedAt: row.updatedAt }))
        section.canCreate = can(user, entityPermission(connection.moduleKey, connection.sourceEntity, 'create'))
      }
      sections.push(section)
    }
    return sections
  }

  // { [targetId]: { [connectionId]: { [field]: value } } } for list columns.
  async function columnsFor({ companyId, targetType, targetIds, user }) {
    const ids = [...new Set(targetIds ?? [])].slice(0, 200)
    if (!ids.length) return { columns: [], values: {} }
    const connections = (await catalog.activeConnections({ companyId, targetType, user })).filter((c) => c.kind === 'fields')
    const columns = connections.flatMap((c) => surfaceFields(c, 'column').map((field) => ({ connectionId: c.id, label: c.label, ...field })))
    if (!columns.length) return { columns: [], values: {} }
    const rows = await prisma.connectionRecord.findMany({
      where: {
        companyId, targetType, enabled: true, targetId: { in: ids },
        OR: connections.map((c) => ({ moduleKey: c.moduleKey, connectionKey: c.connectionKey })),
      },
    })
    const byKey = new Map(connections.map((c) => [`${c.moduleKey}:${c.connectionKey}`, c]))
    const values = {}
    for (const row of rows) {
      const connection = byKey.get(`${row.moduleKey}:${row.connectionKey}`)
      if (!connection) continue
      values[row.targetId] ??= {}
      values[row.targetId][connection.id] = pick(row.data, surfaceFields(connection, 'column'))
    }
    return { columns, values }
  }

  // Core record ids whose connected searchable fields match `term`. Only
  // connections with at least one field enabled for search are used (the
  // index stores the module's offered search fields; per-field admin
  // narrowing turns a connection's search on/off as a whole in v1).
  async function searchTargetIds({ companyId, targetType, term, user }) {
    const query = String(term ?? '').trim().length >= 2 ? prefixTsQuery(term) : null
    if (!query) return []
    const connections = (await catalog.activeConnections({ companyId, targetType, user }))
      .filter((c) => surfaceFields(c, 'search').length > 0)
    if (!connections.length) return []
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT target_id FROM public.connection_record
      WHERE company_id = ${companyId}::uuid AND target_type = ${targetType} AND enabled = true
        AND (module_key || ':' || connection_key) = ANY(${connections.map((c) => `${c.moduleKey}:${c.connectionKey}`)}::text[])
        AND search_text @@ to_tsquery('simple', ${query})
      LIMIT ${SEARCH_ID_LIMIT}`
    return rows.map((row) => row.target_id)
  }

  return { recordsFor, columnsFor, searchTargetIds, listForTarget: catalog.activeConnections }
}
