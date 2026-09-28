import { moduleSlug, toPascal } from './helpers.js'
import { inboundRelations, isSameModuleRelation, resolveLabelField } from '../relations.js'

const esc = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

function tableOf(config, entityName) {
  return `${moduleSlug(config.key)}_${entityName}`
}

function entityByName(config, name) {
  return config.entities.find((entity) => entity.name === name)
}

// Outbound same-module relations of `entity` with their target metadata.
export function outboundRelations(config, entity) {
  return entity.fields.filter(isSameModuleRelation).map((field, index) => {
    const target = entityByName(config, field.targetEntity)
    return {
      field: field.name,
      label: field.label || field.name,
      alias: `r${index}`,
      table: tableOf(config, field.targetEntity),
      labelField: resolveLabelField(target, field.labelField),
      companyScoped: target?.companyScoped !== false,
      softDelete: target?.softDelete !== false,
    }
  })
}

function inboundFor(config, entity) {
  return inboundRelations(config.entities, entity.name).map(({ source, field, rule }) => ({
    table: tableOf(config, source.name),
    field: field.name,
    sourceName: source.name,
    sourcePascal: toPascal(source.name),
    plural: source.labelPlural || `${source.label}s`,
    companyScoped: source.companyScoped !== false,
    softDelete: source.softDelete !== false,
    // A source without soft delete cannot be disabled, so cascade degrades
    // to restrict for it.
    rule: rule === 'cascade' && source.softDelete === false ? 'restrict' : rule,
  }))
}

export function hasRelationsModule(config, entity) {
  return outboundRelations(config, entity).length > 0 || inboundFor(config, entity).length > 0
}

export function hasInboundRules(config, entity) {
  return entity.softDelete !== false && inboundFor(config, entity).length > 0
}

// LEFT JOINs that expose `<field>__label` for list/get queries.
export function relationLabelSql(config, entity) {
  const withLabel = outboundRelations(config, entity).filter((relation) => relation.labelField)
  const select = withLabel.map((relation) => `, ${relation.alias}.${relation.labelField} AS ${relation.field}__label`).join('')
  const joins = withLabel.map((relation) => {
    const company = relation.companyScoped && entity.companyScoped !== false ? ` AND ${relation.alias}.company_id = t.company_id` : ''
    return ` LEFT JOIN ${relation.table} ${relation.alias} ON ${relation.alias}.id = t.${relation.field}${company}`
  }).join('')
  return { select, joins }
}

export function generateRelationsModule(config, entity) {
  const slug = moduleSlug(config.key)
  const errorClass = `${toPascal(slug)}ServiceError`
  const outbound = outboundRelations(config, entity)
  const inbound = entity.softDelete !== false ? inboundFor(config, entity) : []
  const cascades = inbound.filter((relation) => relation.rule === 'cascade')
  const imports = [...new Set(cascades.map((relation) => relation.sourceName))]
    .map((name) => `import { create${toPascal(name)}Service } from './${name}-service.js'`)

  const assertLines = outbound.flatMap((relation) => {
    const company = relation.companyScoped ? ' AND company_id = ${companyId}' : ''
    const enabled = relation.softDelete ? ' AND enabled = true' : ''
    const value = `data.${relation.field}`
    return [
      `  if (${value} !== undefined && ${value} !== null && ${value} !== '') {`,
      '    const rows = await db.$queryRaw`SELECT id FROM ' + relation.table + ' WHERE id = ${' + value + '}' + company + enabled + ' LIMIT 1`',
      `    if (!rows.length) throw new ${errorClass}('El registro seleccionado en "${esc(relation.label)}" no existe o está inactivo.', 400)`,
      '  }',
    ]
  })

  const scope = (relation) => (relation.companyScoped ? ' AND company_id = ${companyId}' : '')
  const active = (relation) => (relation.softDelete ? ' AND enabled = true' : '')
  const restrictLines = inbound.filter((relation) => relation.rule === 'restrict').flatMap((relation) => [
    '  {',
    '    const rows = await db.$queryRaw`SELECT COUNT(*)::int AS total FROM ' + relation.table + ' WHERE ' + relation.field + ' = ${id}' + scope(relation) + active(relation) + '`',
    '    const total = Number(rows[0]?.total ?? 0)',
    `    if (total > 0) throw new ${errorClass}('No se puede desactivar: ' + total + ' ${esc(relation.plural)} lo usan.', 409)`,
    '  }',
  ])
  const setNullLines = inbound.filter((relation) => relation.rule === 'setNull').map((relation) => (
    '  await db.$executeRaw`UPDATE ' + relation.table + ' SET ' + relation.field + ' = NULL, updated_at = now() WHERE ' + relation.field + ' = ${id}' + scope(relation) + '`'
  ))
  const cascadeLines = cascades.flatMap((relation) => [
    '  {',
    '    const rows = await db.$queryRaw`SELECT id FROM ' + relation.table + ' WHERE ' + relation.field + ' = ${id}' + scope(relation) + active(relation) + '`',
    `    const service = create${relation.sourcePascal}Service({ prisma: db })`,
    `    for (const row of rows) await service.set${relation.sourcePascal}Enabled({ companyId, id: row.id, enabled: false, actorId, inTransaction: true })`,
    '  }',
  ])

  return `// Generated: same-module relation integrity for ${entity.name}.
import { ${errorClass} } from './service-helpers.js'
${imports.join('\n')}${imports.length ? '\n' : ''}
// Every relation value must point to an existing, enabled record of the
// same company.
export async function assertRelationTargets(db, { companyId, data }) {
${assertLines.join('\n')}
}

// Runs before a ${entity.name} is disabled (inside the caller's transaction):
// restrict rules first, then setNull, then cascade through each child's own
// service so its rules apply too.
export async function beforeDisable(db, { companyId, id, actorId }) {
${[...restrictLines, ...setNullLines, ...cascadeLines].join('\n')}
}
`
}
