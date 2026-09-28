import { conditionalRequiredFields } from '../layout.js'

export function hasConditionalRequired(entity) {
  return conditionalRequiredFields(entity).length > 0
}

// Generated per entity with required fields that the layout can hide. The
// rule semantics match the renderer's (packages/ui visibility-rules.js), so
// "required only while visible" means the same thing in UI and API.
export function generateVisibilityModule(entity) {
  const entries = conditionalRequiredFields(entity)
  return `// Generated: required fields that are required only while visible.
export const CONDITIONAL_REQUIRED = ${JSON.stringify(entries, null, 2)}

function matchesRule(rule, values) {
  const value = values?.[rule.field]
  if (Object.prototype.hasOwnProperty.call(rule, 'equals')) return value === rule.equals
  if (Object.prototype.hasOwnProperty.call(rule, 'notEquals')) return value !== rule.notEquals
  if (Array.isArray(rule.in)) return rule.in.includes(value)
  if (Object.prototype.hasOwnProperty.call(rule, 'truthy')) return Boolean(value) === Boolean(rule.truthy)
  return true
}

function isEmpty(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  return Array.isArray(value) && value.length === 0
}

// Returns the first visible required field without a value, or null.
export function findMissingConditionalRequired(values) {
  return CONDITIONAL_REQUIRED.find((entry) => entry.rules.every((rule) => matchesRule(rule, values)) && isEmpty(values?.[entry.field])) ?? null
}
`
}
