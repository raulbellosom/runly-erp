// Manifest `connections` (spec 2026-10-03-rme3-module-platform-v2 §15.1): a
// custom module's declared links to core entities.
//
//   connections: [{ key: 'calibracion_item', target: 'inventory_item', kind: 'fields',
//     entity: 'calibracion', targetField: 'articulo', label: 'Calibración',
//     fields: [{ field: 'certificado', form: true, detail: true, column: false, search: true }],
//     onTargetDelete: 'cascade', required: false }]
//
// validateConnections() checks the shape inside validateManifest (no models
// available there); validateConnectionsAgainstModels() checks entities and
// fields when the module is installed. Target types are validated by the API,
// which owns the target registry.

export const CONNECTION_KINDS = Object.freeze(['fields', 'related'])
export const CONNECTION_DELETE_POLICIES = Object.freeze(['cascade', 'setNull', 'restrict'])
export const CONNECTION_SURFACES = Object.freeze(['form', 'detail', 'column', 'search'])
export const MAX_CONNECTIONS = 10

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/
const IDENT_RE = /^[a-z_][a-z0-9_]*$/

export function validateConnections(manifest, errors) {
  const list = manifest?.connections
  if (list === undefined) return
  if (!Array.isArray(list)) { errors.push('connections must be an array'); return }
  if (list.length > MAX_CONNECTIONS) errors.push(`connections must declare at most ${MAX_CONNECTIONS} entries`)
  const seen = new Set()
  list.forEach((entry, i) => {
    const at = `connections[${i}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at} must be an object`); return }
    if (!KEY_RE.test(String(entry.key ?? ''))) errors.push(`${at}.key must match ${KEY_RE}`)
    else if (seen.has(entry.key)) errors.push(`${at}.key "${entry.key}" is duplicated`)
    else seen.add(entry.key)
    if (!IDENT_RE.test(String(entry.target ?? ''))) errors.push(`${at}.target is required (e.g. inventory_item)`)
    if (!CONNECTION_KINDS.includes(entry.kind)) errors.push(`${at}.kind must be one of: ${CONNECTION_KINDS.join(', ')}`)
    if (!IDENT_RE.test(String(entry.entity ?? ''))) errors.push(`${at}.entity is required`)
    if (!IDENT_RE.test(String(entry.targetField ?? ''))) errors.push(`${at}.targetField is required (relation field holding the core record id)`)
    if (!String(entry.label ?? '').trim()) errors.push(`${at}.label is required`)
    if (entry.onTargetDelete !== undefined) {
      if (entry.kind === 'fields') errors.push(`${at}.onTargetDelete only applies to related connections (fields always cascade)`)
      else if (!CONNECTION_DELETE_POLICIES.includes(entry.onTargetDelete)) errors.push(`${at}.onTargetDelete must be one of: ${CONNECTION_DELETE_POLICIES.join(', ')}`)
    }
    if (entry.required !== undefined && typeof entry.required !== 'boolean') errors.push(`${at}.required must be a boolean`)
    if (!Array.isArray(entry.fields) || entry.fields.length === 0) { errors.push(`${at}.fields must offer at least one field`); return }
    const fieldNames = new Set()
    entry.fields.forEach((field, j) => {
      const fat = `${at}.fields[${j}]`
      if (!field || typeof field !== 'object') { errors.push(`${fat} must be an object`); return }
      if (!IDENT_RE.test(String(field.field ?? ''))) errors.push(`${fat}.field is required`)
      else if (fieldNames.has(field.field)) errors.push(`${fat}.field "${field.field}" is duplicated`)
      else fieldNames.add(field.field)
      if (field.field === entry.targetField) errors.push(`${fat}.field cannot be the targetField`)
      for (const surface of CONNECTION_SURFACES) {
        if (field[surface] !== undefined && typeof field[surface] !== 'boolean') errors.push(`${fat}.${surface} must be a boolean`)
      }
    })
  })
}

// Defaults: every surface off unless declared; related -> setNull.
export function normalizeConnection(entry) {
  return {
    key: entry.key,
    target: entry.target,
    kind: entry.kind,
    entity: entry.entity,
    targetField: entry.targetField,
    label: String(entry.label).trim(),
    required: entry.required === true,
    onTargetDelete: entry.kind === 'fields' ? 'cascade' : (entry.onTargetDelete ?? 'setNull'),
    fields: entry.fields.map((field) => ({
      field: field.field,
      form: field.form === true,
      detail: field.detail === true,
      column: field.column === true,
      search: field.search === true,
    })),
  }
}

// models: defineModel outputs ({ key, tableName, fields: [{ name, type, required }] }).
// Returns errors (empty when every connection matches the module's models).
export function validateConnectionsAgainstModels(connections, models) {
  const errors = []
  const byKey = new Map((models ?? []).map((model) => [model.key, model]))
  for (const connection of connections ?? []) {
    const at = `connections.${connection.key}`
    const model = byKey.get(connection.entity)
    if (!model) { errors.push(`${at}: entity "${connection.entity}" is not a model of this module`); continue }
    const fields = new Map((model.fields ?? []).map((field) => [field.name, field]))
    const target = fields.get(connection.targetField)
    if (!target) errors.push(`${at}: targetField "${connection.targetField}" is not a field of ${connection.entity}`)
    else if (target.type !== 'relation') errors.push(`${at}: targetField "${connection.targetField}" must be a relation field`)
    else if (connection.onTargetDelete === 'setNull' && target.required) errors.push(`${at}: onTargetDelete "setNull" needs an optional targetField`)
    for (const offered of connection.fields ?? []) {
      if (!fields.has(offered.field)) errors.push(`${at}: offered field "${offered.field}" is not a field of ${connection.entity}`)
    }
  }
  return errors
}
