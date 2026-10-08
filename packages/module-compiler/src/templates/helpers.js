// Shared utilities for all template functions.

export function toPascal(str) {
  return str
    .split(/[_\-\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function toCamel(str) {
  const pascal = toPascal(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export function toKebab(str) {
  return str.replace(/_/g, '-')
}

export function moduleSlug(moduleKey) {
  // 'custom.crm' -> 'crm'
  const parts = moduleKey.split('.')
  return parts[parts.length - 1]
}

export function tableName(slug, entityName) {
  return `${slug}_${entityName}`
}

export function entityRouteBase(slug, entityName) {
  return `/${slug}/${entityName}s`
}

export function permKey(slug, entityName, action) {
  return `${slug}.${entityName}.${action}`
}

// Returns the Zod schema expression for a field (for create schema, required matters)
export function zodFieldSchema(field, forCreate = true) {
  const { type, required, options, maxLength } = field
  let base

  switch (type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'color':
    case 'markdown':
    case 'richtext': {
      const isEmail = type === 'email'
      let s = 'z.string()'
      if (isEmail) s += '.email()'
      if (maxLength) s += `.max(${maxLength})`
      base = s
      break
    }
    case 'textarea':
      base = maxLength ? `z.string().max(${maxLength})` : 'z.string()'
      break
    case 'number':
      base = 'z.number().int()'
      break
    case 'decimal':
      base = 'z.number()'
      break
    case 'boolean':
      base = 'z.boolean()'
      break
    case 'select':
      base = 'z.enum([' + (options || []).map((o) => JSON.stringify(o)).join(', ') + '])'
      break
    case 'multiselect':
      base = 'z.array(z.string())'
      break
    case 'date':
      base = "z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/, 'Debe ser una fecha ISO valida (YYYY-MM-DD).')"
      break
    case 'datetime':
      base = 'z.string()'
      break
    case 'relation':
    case 'file':
      base = 'z.string().uuid()'
      break
    case 'json':
      base = 'z.record(z.string(), z.any())'
      break
    default:
      base = 'z.string()'
  }

  if (forCreate && required) {
    // for select/enum/boolean/numeric, required means the key must be present — not a value constraint
    if (type === 'select') return base
    if (type === 'boolean') return base
    if (type === 'number' || type === 'decimal') return base
    if (type === 'json') return base + '.refine(value => Object.keys(value).length > 0)'
    return base + '.min(1)'
  }

  // Every optional persisted field accepts NULL; required PATCH fields may be
  // omitted but cannot be explicitly cleared.
  if (!required) {
    return base + '.nullable().optional()'
  }
  return base + '.optional()'
}
