import { toPascal, moduleSlug } from './helpers.js'
import { isSameModuleRelation } from '../relations.js'
import { hasInboundRules, hasRelationsModule, outboundRelations, relationLabelSql } from './relations.js'

function toPascalSimple(str) {
  return str.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

export function generateService(config, entity) {
  const slug = moduleSlug(config.key)
  const errorClass = toPascal(slug) + 'ServiceError'
  const pascal = toPascal(entity.name)
  const table = `${slug}_${entity.name}`
  const companyScoped = entity.companyScoped !== false
  const softDelete = entity.softDelete !== false

  const firstTextField = entity.fields.find((f) => ['text', 'email', 'phone'].includes(f.type))
  const selectFields = entity.fields.filter((f) => f.type === 'select')
  const allFields = entity.fields.map((f) => f.name)
  const rel = {
    module: hasRelationsModule(config, entity),
    outbound: outboundRelations(config, entity).length > 0,
    inbound: hasInboundRules(config, entity),
    sql: relationLabelSql(config, entity),
    filterFields: entity.fields.filter(isSameModuleRelation),
  }

  const importLine = `import { ${errorClass}, toScopedCompanyUuid, normalizeRecordId, normalizePagination, normalizeSearch, normalizeOptionalString, toCount, firstRow, withDbErrorMapping, isUniqueViolation, recordActivity } from './service-helpers.js'`
  const moduleKeyLine = `const MODULE_KEY = '${config.key}'`
    + (rel.filterFields.length ? '\nconst UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i' : '')
  const relationsImport = rel.module ? `\nimport { assertRelationTargets, beforeDisable } from './${entity.name}-relations.js'` : ''

  const listFn = buildListFn(pascal, table, entity, companyScoped, softDelete, firstTextField, selectFields, rel)
  const getByIdFn = buildGetByIdFn(pascal, table, entity, companyScoped, softDelete, errorClass, rel)
  const createFn = buildCreateFn(pascal, table, entity, companyScoped, errorClass, allFields, rel, config)
  const updateFn = buildUpdateFn(pascal, table, entity, companyScoped, softDelete, errorClass, allFields, rel, config)
  const setEnabledFn = softDelete ? buildSetEnabledFn(pascal, table, companyScoped, errorClass, entity, rel, config) : null

  const returnedMethods = [`list${pascal}s`, `get${pascal}ById`, `create${pascal}`, `update${pascal}`]
  if (softDelete) returnedMethods.push(`set${pascal}Enabled`)

  const fnBodies = [listFn, getByIdFn, createFn, updateFn, setEnabledFn].filter(Boolean)
    .map((fn) => indent(fn, 2))
    .join('\n\n')

  return `${importLine}${relationsImport}

${moduleKeyLine}

export function create${pascal}Service({ prisma }) {
${fnBodies}

  return { ${returnedMethods.join(', ')} }
}
`
}

function buildListFn(pascal, table, entity, companyScoped, softDelete, firstTextField, selectFields, rel) {
  const searchParam = firstTextField ? ', search' : ''
  const filterParams = [...selectFields, ...rel.filterFields].map((f) => `, ${f.name}`).join('')
  const safeCompany = companyScoped ? `  const safeCompanyId = toScopedCompanyUuid(companyId)\n` : ''
  const enabledFilter = softDelete ? '\n      AND t.enabled = true' : ''
  const companyFilter = companyScoped ? '\n      WHERE t.company_id = ${safeCompanyId}' : '\n      WHERE 1=1'
  const searchFilter = firstTextField
    ? '\n      AND (${likeValue}::text IS NULL OR t.' + firstTextField.name + ' ILIKE ${likeValue})'
    : ''
  const fieldFilters = selectFields
    .map((f) => '\n      AND (${' + f.name + 'Filter}::text IS NULL OR t.' + f.name + ' = ${' + f.name + 'Filter})')
    .join('')
    + rel.filterFields
      .map((f) => '\n      AND (${' + f.name + 'Filter}::uuid IS NULL OR t.' + f.name + ' = ${' + f.name + 'Filter}::uuid)')
      .join('')

  const lines = []
  lines.push(`async function list${pascal}s({ companyId, page, pageSize${searchParam}${filterParams} }) {`)
  lines.push(safeCompany.trimEnd())
  lines.push('  const pagination = normalizePagination({ page, pageSize })')
  if (firstTextField) {
    lines.push('  const normalizedSearch = normalizeSearch(search)')
    lines.push('  const likeValue = normalizedSearch ? `%${normalizedSearch}%` : null')
  }
  for (const sf of selectFields) {
    lines.push(`  const ${sf.name}Filter = normalizeOptionalString(${sf.name}) ?? null`)
  }
  for (const rf of rel.filterFields) {
    lines.push(`  const ${rf.name}Filter = UUID_PATTERN.test(String(${rf.name} ?? '')) ? String(${rf.name}) : null`)
  }
  lines.push('  const [rows, totalRows] = await withDbErrorMapping(async () => {')
  lines.push('    const data = await prisma.$queryRaw`')
  lines.push('      SELECT t.*' + rel.sql.select + ' FROM ' + table + ' t' + rel.sql.joins + companyFilter + enabledFilter + searchFilter + fieldFilters)
  lines.push('      ORDER BY t.created_at DESC')
  lines.push('      LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}')
  lines.push('    `')
  lines.push('    const count = await prisma.$queryRaw`')
  lines.push('      SELECT COUNT(*)::bigint AS total FROM ' + table + ' t' + companyFilter + enabledFilter + searchFilter + fieldFilters)
  lines.push('    `')
  lines.push('    return [data, count]')
  lines.push('  })')
  lines.push('  return { data: rows, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: toCount(firstRow(totalRows)?.total) } }')
  lines.push('}')
  return lines.join('\n')
}

function buildGetByIdFn(pascal, table, entity, companyScoped, softDelete, errorClass, rel) {
  const companyFilter = companyScoped ? ' AND t.company_id = ${safeCompanyId}' : ''
  const enabledFilter = softDelete ? ' AND t.enabled = true' : ''
  const notFoundMsg = escSingle(entity.label) + ' no encontrado.'
  const lines = []
  lines.push(`async function get${pascal}ById({ companyId, id }) {`)
  if (companyScoped) lines.push('  const safeCompanyId = toScopedCompanyUuid(companyId)')
  lines.push(`  const safeId = normalizeRecordId(id, '${notFoundMsg}')`)
  lines.push('  const row = await withDbErrorMapping(async () => {')
  lines.push('    const rows = await prisma.$queryRaw`')
  lines.push('      SELECT t.*' + rel.sql.select + ' FROM ' + table + ' t' + rel.sql.joins + ' WHERE t.id = ${safeId}' + companyFilter + enabledFilter + ' LIMIT 1')
  lines.push('    `')
  lines.push('    return firstRow(rows)')
  lines.push('  })')
  lines.push(`  if (!row) throw new ${errorClass}('${notFoundMsg}', 404)`)
  lines.push('  return row')
  lines.push('}')
  return lines.join('\n')
}

// Audit-trail Activity row next to each AuditLog write (spec
// 2026-10-03-audit-trail-design §2.6). `rowVar`/`beforeVar` are the generated
// local names; `verbExpr` is a JS expression yielding the verb.
function activityCall(config, entity, { companyExpr, verbExpr, rowVar, beforeVar = 'null', afterExpr = null, indent = '    ' }) {
  const slug = moduleSlug(config.key)
  const titleField = entity.fields.find((f) => ['text', 'email', 'phone'].includes(f.type))
  const title = titleField ? `${rowVar}?.${titleField.name} ?? null` : 'null'
  const label = escSingle(entity.label ?? entity.name)
  return `${indent}await recordActivity(prisma, { companyId: ${companyExpr}, actorId, type: '${slug}.${entity.name}.' + ${verbExpr}, verb: ${verbExpr}, entityType: '${slug}.${entity.name}', entityId: ${rowVar}?.id ?? null, entityLabel: '${label}', title: ${title}, before: ${beforeVar}, after: ${afterExpr ?? rowVar} })`
}

function buildCreateFn(pascal, table, entity, companyScoped, errorClass, allFields, rel, config) {
  const cols = companyScoped ? ['company_id', ...allFields] : allFields
  const vals = companyScoped
    ? ['${safeCompanyId}', ...allFields.map((f) => buildFieldValue(entity, f))]
    : allFields.map((f) => buildFieldValue(entity, f))
  const entityType = toPascalSimple(entity.name)
  const lines = []
  lines.push(`async function create${pascal}({ companyId, data, actorId }) {`)
  if (companyScoped) lines.push('  const safeCompanyId = toScopedCompanyUuid(companyId)')
  if (rel.outbound) lines.push(`  await assertRelationTargets(prisma, { companyId: ${companyScoped ? 'safeCompanyId' : 'companyId'}, data })`)
  lines.push('  try {')
  lines.push('    const row = await withDbErrorMapping(async () => {')
  lines.push('      const rows = await prisma.$queryRaw`')
  lines.push('        INSERT INTO ' + table + ' (' + cols.join(', ') + ')')
  lines.push('        VALUES (' + vals.join(', ') + ')')
  lines.push('        RETURNING *')
  lines.push('      `')
  lines.push('      return firstRow(rows)')
  lines.push('    })')
  lines.push(`    await prisma.auditLog.create({ data: { actorId: actorId ?? null, moduleKey: MODULE_KEY, entityType: '${entityType}', entityId: row?.id ?? null, action: '${entity.name}.create', before: null, after: row } })`)
  lines.push(activityCall(config, entity, { companyExpr: companyScoped ? 'safeCompanyId' : 'companyId', verbExpr: "'create'", rowVar: 'row' }))
  lines.push('    return row')
  lines.push('  } catch (error) {')
  lines.push(`    if (isUniqueViolation(error)) throw new ${errorClass}('Ya existe un registro con esos datos.', 409)`)
  lines.push('    throw error')
  lines.push('  }')
  lines.push('}')
  return lines.join('\n')
}

function buildUpdateFn(pascal, table, entity, companyScoped, softDelete, errorClass, allFields, rel, config) {
  const companyWhere = companyScoped ? ' AND company_id = ${safeCompanyId}' : ''
  const enabledWhere = softDelete ? ' AND enabled = true' : ''
  const notFoundMsg = escSingle(entity.label) + ' no encontrado.'
  const entityType = toPascalSimple(entity.name)
  const hasVars = allFields.map((f) => 'has' + toPascalSimple(f))
  const setLines = allFields.map((f) => {
    const hv = 'has' + toPascalSimple(f)
    const val = buildFieldValue(entity, f)
    return '        ' + f + ' = CASE WHEN ${' + hv + '} THEN ' + val + ' ELSE ' + f + ' END,'
  })
  const lines = []
  lines.push(`async function update${pascal}({ companyId, id, data, actorId }) {`)
  if (companyScoped) lines.push('  const safeCompanyId = toScopedCompanyUuid(companyId)')
  lines.push(`  const safeId = normalizeRecordId(id, '${notFoundMsg}')`)
  for (const f of allFields) lines.push(`  const has${toPascalSimple(f)} = data.${f} !== undefined`)
  lines.push(`  if (!${hasVars.join(' && !')}) throw new ${errorClass}('No hay campos validos para actualizar.', 400)`)
  const companyArg = companyScoped ? 'safeCompanyId' : 'null'
  lines.push(`  const before = await get${pascal}ById({ companyId: ${companyArg}, id: safeId })`)
  if (rel.outbound) lines.push(`  await assertRelationTargets(prisma, { companyId: ${companyScoped ? 'safeCompanyId' : 'companyId'}, data })`)
  lines.push('  try {')
  lines.push('    const updated = await withDbErrorMapping(async () => {')
  lines.push('      const rows = await prisma.$queryRaw`')
  lines.push('        UPDATE ' + table)
  lines.push('        SET')
  lines.push(setLines.join('\n'))
  lines.push('            updated_at = now()')
  lines.push('        WHERE id = ${safeId}' + companyWhere + enabledWhere)
  lines.push('        RETURNING *')
  lines.push('      `')
  lines.push('      return firstRow(rows)')
  lines.push('    })')
  lines.push(`    if (!updated) throw new ${errorClass}('${notFoundMsg}', 404)`)
  lines.push(`    await prisma.auditLog.create({ data: { actorId: actorId ?? null, moduleKey: MODULE_KEY, entityType: '${entityType}', entityId: updated.id, action: '${entity.name}.update', before, after: updated } })`)
  // With relations, re-read the row so the diff compares relation labels
  // (<field>__label) instead of raw ids.
  const afterExpr = rel.sql.select ? `await get${pascal}ById({ companyId: ${companyArg}, id: updated.id }).catch(() => updated)` : null
  lines.push(activityCall(config, entity, { companyExpr: companyScoped ? 'safeCompanyId' : 'companyId', verbExpr: "'update'", rowVar: 'updated', beforeVar: 'before', afterExpr }))
  lines.push('    return updated')
  lines.push('  } catch (error) {')
  lines.push(`    if (isUniqueViolation(error)) throw new ${errorClass}('Ya existe un registro con esos datos.', 409)`)
  lines.push('    throw error')
  lines.push('  }')
  lines.push('}')
  return lines.join('\n')
}

function buildSetEnabledFn(pascal, table, companyScoped, errorClass, entity, rel, config) {
  const companyWhere = companyScoped ? ' AND company_id = ${safeCompanyId}' : ''
  const entityType = toPascalSimple(entity.name)
  const lines = []
  lines.push(`async function set${pascal}Enabled({ companyId, id, enabled, actorId${rel.inbound ? ', inTransaction = false' : ''} }) {`)
  if (companyScoped) lines.push('  const safeCompanyId = toScopedCompanyUuid(companyId)')
  lines.push('  const safeId = normalizeRecordId(id, \'Registro no encontrado.\')')
  if (rel.inbound) {
    // Disabling applies the inbound relation rules atomically: the first call
    // opens a transaction and re-enters with the transaction client and
    // inTransaction: true, which runs the rules and the update.
    lines.push('  if (!enabled && !inTransaction) {')
    lines.push(`    return prisma.$transaction((tx) => create${pascal}Service({ prisma: tx }).set${pascal}Enabled({ companyId, id, enabled, actorId, inTransaction: true }))`)
    lines.push('  }')
    lines.push(`  if (!enabled) await beforeDisable(prisma, { companyId: ${companyScoped ? 'safeCompanyId' : 'companyId'}, id: safeId, actorId })`)
  }
  lines.push(`  const before = await get${pascal}ById({ companyId: ${companyScoped ? 'safeCompanyId' : 'null'}, id: safeId })`)
  lines.push('  const updated = await withDbErrorMapping(async () => {')
  lines.push('    const rows = await prisma.$queryRaw`')
  lines.push('      UPDATE ' + table + ' SET enabled = ${Boolean(enabled)}, updated_at = now() WHERE id = ${safeId}' + companyWhere + ' RETURNING *')
  lines.push('    `')
  lines.push('    return firstRow(rows)')
  lines.push('  })')
  lines.push(`  if (!updated) throw new ${errorClass}('Registro no encontrado.', 404)`)
  lines.push(`  await prisma.auditLog.create({ data: { actorId: actorId ?? null, moduleKey: MODULE_KEY, entityType: '${entityType}', entityId: updated.id, action: '${entity.name}.' + (enabled ? 'enable' : 'disable'), before, after: updated } })`)
  lines.push(activityCall(config, entity, { companyExpr: companyScoped ? 'safeCompanyId' : 'companyId', verbExpr: "(enabled ? 'enable' : 'disable')", rowVar: 'updated', beforeVar: 'before', indent: '  ' }))
  lines.push('  return updated')
  lines.push('}')
  return lines.join('\n')
}

function buildFieldValue(entity, fieldName) {
  const field = entity.fields.find((f) => f.name === fieldName)
  if (!field) return '${data.' + fieldName + ' ?? null}'
  if (field.type === 'boolean') return '${data.' + fieldName + ' ?? false}'
  if (field.required && !['relation', 'file', 'number', 'decimal'].includes(field.type)) {
    return '${data.' + fieldName + '}'
  }
  return '${data.' + fieldName + ' ?? null}'
}

function indent(str, spaces) {
  const pad = ' '.repeat(spaces)
  return str.split('\n').map((line) => (line ? pad + line : '')).join('\n')
}

function escSingle(str) {
  return String(str).replace(/'/g, "\\'")
}
