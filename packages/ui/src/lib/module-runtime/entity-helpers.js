// Pure helpers behind the module runtime (spec 2026-10-03-rme3-module-platform-v2
// §5.4): resolve an entity's blueprints and API path from the module's own
// blueprint rows, and build list URLs. No React here so they are unit-testable.

const kindOf = (row) => String(row?.kind ?? row?.type ?? '').toUpperCase()

// The module's blueprint row of `kind` (TABLE / FORM / DETAIL) for `entity`.
export function findEntityBlueprint(blueprints, kind, entity) {
  const wanted = String(kind).toUpperCase()
  return (blueprints ?? []).find((row) => kindOf(row) === wanted && row?.schema?.entity === entity) ?? null
}

// REST base of an entity (`/visitas/visitas`), taken from any of its views.
export function entityApiPath(blueprints, entity) {
  for (const kind of ['TABLE', 'FORM', 'DETAIL']) {
    const apiPath = findEntityBlueprint(blueprints, kind, entity)?.schema?.apiPath
    if (typeof apiPath === 'string' && apiPath.trim()) return apiPath.trim().replace(/\/+$/, '')
  }
  return null
}

// Every entity the module exposes, with its label and API path.
export function listModuleEntities(blueprints) {
  const names = new Set()
  for (const row of blueprints ?? []) {
    if (['TABLE', 'FORM', 'DETAIL'].includes(kindOf(row)) && row?.schema?.entity) names.add(row.schema.entity)
  }
  return [...names].map((name) => ({
    name,
    apiPath: entityApiPath(blueprints, name),
    label: findEntityBlueprint(blueprints, 'TABLE', name)?.schema?.title
      ?? findEntityBlueprint(blueprints, 'FORM', name)?.schema?.sections?.[0]?.label
      ?? name,
  }))
}

// `${apiBaseUrl}${apiPath}?page=&pageSize=&search=&<filter>=` (empty values skipped).
export function buildListUrl(apiBaseUrl, apiPath, { page = 1, pageSize = 20, search = '', filters = {} } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  if (search) params.set('search', search)
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  return `${String(apiBaseUrl ?? '').replace(/\/+$/, '')}${apiPath}?${params.toString()}`
}

export function entityQueryKey(moduleKey, entity, ...rest) {
  return ['module-entity', moduleKey, entity, ...rest]
}

// Field definitions of an entity from its TABLE / FORM / DETAIL blueprints
// (shared with apps/desktop BlueprintCrudScreen): a top-level `fields` array
// wins; otherwise fields are collected from sections, FORM types last so its
// explicit types (e.g. "markdown") override table/detail defaults.
export function extractBlueprintFields(tableBlueprint, formBlueprint, detailBlueprint) {
  for (const blueprint of [tableBlueprint, formBlueprint, detailBlueprint]) {
    if (Array.isArray(blueprint?.fields) && blueprint.fields.length > 0) return blueprint.fields
    if (Array.isArray(blueprint?.schema?.fields) && blueprint.schema.fields.length > 0) return blueprint.schema.fields
  }
  const fieldTypeMap = new Map()
  for (const blueprint of [detailBlueprint, tableBlueprint, formBlueprint]) {
    const sections = blueprint?.schema?.sections
    if (!Array.isArray(sections)) continue
    for (const section of sections) {
      if (!Array.isArray(section?.fields)) continue
      for (const f of section.fields) {
        if (!f || typeof f !== 'object') continue
        const name = String(f.field ?? f.name ?? f.key ?? '').trim()
        if (!name) continue
        const existing = fieldTypeMap.get(name)
        const newType = typeof f.type === 'string' ? f.type : 'text'
        if (!existing) fieldTypeMap.set(name, { name, label: f.label ?? name, type: newType, options: f.options ?? null })
        else if (newType !== 'text') fieldTypeMap.set(name, { ...existing, type: newType })
      }
    }
  }
  return fieldTypeMap.size > 0 ? [...fieldTypeMap.values()] : undefined
}

export function entityFields(blueprints, entity) {
  return extractBlueprintFields(
    findEntityBlueprint(blueprints, 'TABLE', entity),
    findEntityBlueprint(blueprints, 'FORM', entity),
    findEntityBlueprint(blueprints, 'DETAIL', entity),
  )
}
