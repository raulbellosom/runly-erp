// Same-module relation contract: display field, disable rule and integrity
// metadata shared by validation and the generated API. See
// docs/superpowers/specs/2026-09-28-rme3-builder-relations-integrity-design.md.

const LABEL_FIELD_TYPES = new Set(['text', 'email', 'phone'])
const NON_LABEL_TYPES = new Set(['relation', 'file', 'json', 'multiselect'])
export const ON_DISABLE_RULES = ['restrict', 'setNull', 'cascade']

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

const keyOf = (item) => item?.key ?? item?.name

export function isSameModuleRelation(field) {
  return field?.type === 'relation' && Boolean(field.targetEntity)
}

// Display field of an entity: the explicit one, else the first text-like field.
export function resolveLabelField(target, explicit) {
  if (explicit) return explicit
  return keyOf((target?.fields ?? []).find((field) => LABEL_FIELD_TYPES.has(field.type))) ?? null
}

export function onDisableOf(field) {
  return field.onDisable ?? 'restrict'
}

// Relations of other entities (same module) pointing at `entityKey`, with the
// rule to apply when a record of `entityKey` is disabled.
export function inboundRelations(entities, entityKey) {
  const target = entities.find((entity) => keyOf(entity) === entityKey)
  if (!target || target.softDelete === false) return []
  return entities.flatMap((source) => (source.fields ?? [])
    .filter((field) => isSameModuleRelation(field) && field.targetEntity === entityKey)
    .map((field) => ({ source, field, rule: onDisableOf(field) })))
}

function findCascadeCycle(entities) {
  // Edge target -> source: disabling target disables source rows.
  const edges = new Map()
  for (const source of entities) {
    for (const field of source.fields ?? []) {
      if (!isSameModuleRelation(field) || onDisableOf(field) !== 'cascade') continue
      if (!edges.has(field.targetEntity)) edges.set(field.targetEntity, new Set())
      edges.get(field.targetEntity).add(keyOf(source))
    }
  }
  const state = new Map()
  const visit = (node, trail) => {
    if (state.get(node) === 'active') return [...trail, node]
    if (state.get(node) === 'done') return null
    state.set(node, 'active')
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next, [...trail, node])
      if (cycle) return cycle
    }
    state.set(node, 'done')
    return null
  }
  for (const node of edges.keys()) {
    const cycle = visit(node, [])
    if (cycle) return cycle
  }
  return null
}

export function validateRelations(entities, errors) {
  const byKey = new Map(entities.map((entity) => [keyOf(entity), entity]))
  entities.forEach((entity, entityIndex) => {
    ;(entity.fields ?? []).forEach((field, fieldIndex) => {
      if (!isSameModuleRelation(field)) return
      const path = `entities[${entityIndex}].fields[${fieldIndex}]`
      const target = byKey.get(field.targetEntity)
      if (!target) return
      if (field.labelField !== undefined) {
        const labelField = (target.fields ?? []).find((item) => keyOf(item) === field.labelField)
        if (!labelField || NON_LABEL_TYPES.has(labelField.type)) errors.push(diagnostic(`${path}.labelField`, 'RELATION_LABEL_FIELD_NOT_FOUND', `labelField "${field.labelField}" must be a displayable field of "${field.targetEntity}".`))
      }
      if (field.onDisable !== undefined && !ON_DISABLE_RULES.includes(field.onDisable)) errors.push(diagnostic(`${path}.onDisable`, 'RELATION_INVALID_ON_DISABLE', 'onDisable must be restrict, setNull or cascade.'))
      if (field.onDisable === 'setNull' && field.required) errors.push(diagnostic(`${path}.onDisable`, 'RELATION_SET_NULL_REQUIRED', 'A required relation cannot be cleared when its target is disabled.'))
    })
  })
  const cycle = findCascadeCycle(entities)
  if (cycle) errors.push(diagnostic('entities', 'RELATION_CASCADE_CYCLE', `Cascade disable forms a cycle: ${cycle.join(' -> ')}.`))
}

// Validates a layout section `{ type: 'related', source: { entity, field } }`.
export function validateRelatedSource(section, entityKey, entities, path, errors) {
  const source = entities.find((entity) => keyOf(entity) === section.source?.entity)
  const field = (source?.fields ?? []).find((item) => keyOf(item) === section.source?.field)
  if (!isSameModuleRelation(field) || field.targetEntity !== entityKey) {
    errors.push(diagnostic(`${path}.source`, 'LAYOUT_RELATED_INVALID_SOURCE', 'Related section source must be a relation of another entity pointing to this entity.'))
  }
}
