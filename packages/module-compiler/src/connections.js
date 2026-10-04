// Builder connections (definition.connections): the same shape as the manifest
// `connections` contract (packages/module-engine/src/manifest-connections.js),
// emitted verbatim into module.manifest.js. Spec
// docs/superpowers/specs/2026-10-03-rme3-module-platform-v2-design.md §15.1.
import { validateConnections } from '@runly/module-engine/browser'

// Targets whose owning module has a "Conexiones" screen; the API accepts other
// relation targets but nobody could activate them yet.
export const BUILDER_CONNECTION_TARGETS = Object.freeze(['inventory_item', 'contact', 'hr_employee', 'project'])
// Relations would show a raw id inside the system screen.
export const CONNECTION_FIELD_EXCLUDED_TYPES = Object.freeze(['file', 'json', 'relation'])

const SURFACES = ['form', 'detail', 'column', 'search']
const fieldKey = (field) => field.key ?? field.name
const entityKey = (entity) => entity.key ?? entity.name

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

export function validateDefinitionConnections(definition, errors) {
  const list = definition.connections
  if (list === undefined || list === null) return
  const shape = []
  validateConnections({ connections: list }, shape)
  for (const message of shape) {
    const path = /^(connections(?:\[\d+\])?(?:\.\w+)*)/.exec(message)?.[1] ?? 'connections'
    errors.push(diagnostic(path, 'CONNECTION_INVALID', message))
  }
  if (!Array.isArray(list)) return
  const entities = new Map((definition.entities ?? []).map((entity) => [entityKey(entity), entity]))
  list.forEach((connection, index) => {
    const base = `connections[${index}]`
    if (!connection || typeof connection !== 'object') return
    if (!BUILDER_CONNECTION_TARGETS.includes(connection.target)) {
      errors.push(diagnostic(`${base}.target`, 'CONNECTION_TARGET_UNSUPPORTED', `System entity "${connection.target}" cannot receive connections.`))
    }
    const entity = entities.get(connection.entity)
    if (!entity) { errors.push(diagnostic(`${base}.entity`, 'CONNECTION_ENTITY_NOT_FOUND', `Entity "${connection.entity}" does not exist.`)); return }
    const fields = new Map((entity.fields ?? []).map((field) => [fieldKey(field), field]))
    const targetField = fields.get(connection.targetField)
    if (!targetField || targetField.type !== 'relation' || targetField.targetExternal !== connection.target) {
      errors.push(diagnostic(`${base}.targetField`, 'CONNECTION_TARGET_FIELD_INVALID', `Field "${connection.targetField}" must be a relation to "${connection.target}".`))
    } else if (connection.kind === 'related' && (connection.onTargetDelete ?? 'setNull') === 'setNull' && targetField.required) {
      errors.push(diagnostic(`${base}.onTargetDelete`, 'CONNECTION_SET_NULL_REQUIRED', 'setNull needs a non-required relation field.'))
    }
    for (const [fieldIndex, offered] of (connection.fields ?? []).entries()) {
      const field = fields.get(offered?.field)
      if (!field) errors.push(diagnostic(`${base}.fields[${fieldIndex}].field`, 'CONNECTION_FIELD_NOT_FOUND', `Field "${offered?.field}" does not exist in "${connection.entity}".`))
      else if (CONNECTION_FIELD_EXCLUDED_TYPES.includes(field.type)) errors.push(diagnostic(`${base}.fields[${fieldIndex}].field`, 'CONNECTION_FIELD_TYPE_UNSUPPORTED', `Field type "${field.type}" cannot be shown in a system module.`))
    }
  })
}

// Manifest literal: only the contract's properties, surfaces as booleans.
export function manifestConnections(definition) {
  return (definition.connections ?? []).map((connection) => ({
    key: connection.key,
    target: connection.target,
    kind: connection.kind,
    entity: connection.entity,
    targetField: connection.targetField,
    label: connection.label,
    ...(connection.kind === 'related' ? { onTargetDelete: connection.onTargetDelete ?? 'setNull' } : {}),
    ...(connection.required ? { required: true } : {}),
    fields: (connection.fields ?? []).map((field) => ({
      field: field.field,
      ...Object.fromEntries(SURFACES.map((surface) => [surface, field[surface] === true])),
    })),
  }))
}
