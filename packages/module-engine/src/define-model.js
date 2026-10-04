import { FIELD_TYPES, RESERVED_TABLE_PREFIXES } from './constants.js'
import { ModuleEngineError } from './errors.js'

const FIELD_TYPE_SET = new Set(Object.values(FIELD_TYPES))
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const MODEL_DEFAULTS = {
  companyScoped: true,
  softDelete:    false,
  indexes:       [],
  foreignKeys:   [],
  checks:        [],
}

// Returns { valid: boolean, errors: string[] }. Never throws.
export function validateModel(model) {
  const errors = []

  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return { valid: false, errors: ['model must be a plain object'] }
  }

  if (!model.key || typeof model.key !== 'string' || !model.key.trim()) {
    errors.push('key is required and must be a non-empty string')
  } else if (!IDENTIFIER_RE.test(model.key)) {
    errors.push('key must be a valid identifier: letters, digits, underscores; must start with letter or underscore')
  }

  if (!model.tableName || typeof model.tableName !== 'string') {
    errors.push('tableName is required and must be a string')
  } else if (!IDENTIFIER_RE.test(model.tableName)) {
    errors.push('tableName must be a valid SQL identifier: letters, digits, underscores; must start with letter or underscore; no spaces or special characters')
  } else {
    const lower = model.tableName.toLowerCase()
    const reserved = RESERVED_TABLE_PREFIXES.find((p) => lower.startsWith(p))
    if (reserved) {
      errors.push(`tableName must not start with reserved prefix "${reserved}" (PostgreSQL system namespace)`)
    }
  }

  if (!Array.isArray(model.fields)) {
    errors.push('fields must be an array')
  } else {
    model.fields.forEach((field, i) => {
      if (!field.name || typeof field.name !== 'string' || !IDENTIFIER_RE.test(field.name)) {
        errors.push(`fields[${i}].name must be a valid identifier`)
      }
      if (!field.type || !FIELD_TYPE_SET.has(field.type)) {
        errors.push(`fields[${i}].type "${field.type}" is not a supported type. Use FIELD_TYPES constants. Supported: ${[...FIELD_TYPE_SET].join(', ')}`)
      }
      // Optional stable id (UUID): keeps the column when the field is renamed.
      if (field.id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(field.id))) {
        errors.push(`fields[${i}].id must be a UUID`)
      }
    })
    const ids = model.fields.map((field) => field.id).filter(Boolean).map((id) => String(id).toLowerCase())
    if (new Set(ids).size !== ids.length) errors.push('fields[].id must be unique')
  }

  if (model.indexes !== undefined && !Array.isArray(model.indexes)) {
    errors.push('indexes must be an array')
  }
  if (model.foreignKeys !== undefined) {
    if (!Array.isArray(model.foreignKeys)) {
      errors.push('foreignKeys must be an array')
    } else {
      model.foreignKeys.forEach((fk, i) => {
        if (!fk || typeof fk !== 'object' || Array.isArray(fk)) {
          errors.push(`foreignKeys[${i}] must be an object`)
          return
        }
        if (!fk.field || typeof fk.field !== 'string' || !IDENTIFIER_RE.test(fk.field)) {
          errors.push(`foreignKeys[${i}].field must be a valid identifier`)
        }
        if (!fk.references || typeof fk.references !== 'object' || Array.isArray(fk.references)) {
          errors.push(`foreignKeys[${i}].references must be an object`)
        } else {
          if (!fk.references.table || typeof fk.references.table !== 'string' || !IDENTIFIER_RE.test(fk.references.table)) {
            errors.push(`foreignKeys[${i}].references.table must be a valid identifier`)
          }
          if (!fk.references.field || typeof fk.references.field !== 'string' || !IDENTIFIER_RE.test(fk.references.field)) {
            errors.push(`foreignKeys[${i}].references.field must be a valid identifier`)
          }
        }
        if (fk.onDelete !== undefined && !['CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'NO ACTION'].includes(String(fk.onDelete).toUpperCase())) {
          errors.push(`foreignKeys[${i}].onDelete must be one of: CASCADE, RESTRICT, SET NULL, SET DEFAULT, NO ACTION`)
        }
        if (fk.onUpdate !== undefined && !['CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'NO ACTION'].includes(String(fk.onUpdate).toUpperCase())) {
          errors.push(`foreignKeys[${i}].onUpdate must be one of: CASCADE, RESTRICT, SET NULL, SET DEFAULT, NO ACTION`)
        }
      })
    }
  }
  if (model.checks !== undefined) {
    if (!Array.isArray(model.checks)) {
      errors.push('checks must be an array')
    } else {
      model.checks.forEach((check, i) => {
        if (!check || typeof check !== 'object' || Array.isArray(check)) {
          errors.push(`checks[${i}] must be an object`)
          return
        }
        if (!check.name || typeof check.name !== 'string' || !IDENTIFIER_RE.test(check.name)) {
          errors.push(`checks[${i}].name must be a valid identifier`)
        }
        if (!check.expression || typeof check.expression !== 'string' || !check.expression.trim()) {
          errors.push(`checks[${i}].expression must be a non-empty string`)
        }
      })
    }
  }

  return { valid: errors.length === 0, errors }
}

// Validates and returns the model with defaults applied. Throws ModuleEngineError on invalid input.
export function defineModel(model) {
  const { valid, errors } = validateModel(model)
  if (!valid) {
    throw new ModuleEngineError(`Invalid model definition: ${errors.join('; ')}`, 'AME_INVALID_MODEL')
  }
  return {
    ...MODEL_DEFAULTS,
    ...model,
    fields:  model.fields ?? [],
    indexes: model.indexes ?? [],
    foreignKeys: model.foreignKeys ?? [],
    checks: model.checks ?? [],
  }
}
