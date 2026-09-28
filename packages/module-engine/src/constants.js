// Reserved namespace prefixes — enforced at discovery time for modules in modules/custom/.
// validateManifest validates key structure only; namespace ownership is enforced by the discovery service (Phase 2).
export const RESERVED_NAMESPACES = ['runly.', 'atlas.', 'core.', 'system.', 'identity.']

// Forbidden SQL table name prefixes (PostgreSQL system namespaces).
export const RESERVED_TABLE_PREFIXES = ['pg_', '_pg_', 'sql_']

export const MODULE_KINDS = Object.freeze({
  CORE:        'CORE',
  FEATURE:     'FEATURE',
  INTEGRATION: 'INTEGRATION',
  WEBSITE:     'WEBSITE',
})

export const BLUEPRINT_KINDS = Object.freeze({
  ENTITY:    'ENTITY',
  FORM:      'FORM',
  TABLE:     'TABLE',
  DETAIL:    'DETAIL',
  PAGE:      'PAGE',
  DASHBOARD: 'DASHBOARD',
  KANBAN:    'KANBAN',
  CARDS:     'CARDS',
  CALENDAR:  'CALENDAR',
  TIMELINE:  'TIMELINE',
  REPORT:    'REPORT',
  ACTION:    'ACTION',
  RELATION:  'RELATION',
  CUSTOM:    'CUSTOM',
})

// 17 supported field types. Use FIELD_TYPES.TEXT etc. in module code for IDE-friendliness.
export const FIELD_TYPES = Object.freeze({
  TEXT:        'text',
  TEXTAREA:    'textarea',
  NUMBER:      'number',
  DECIMAL:     'decimal',
  BOOLEAN:     'boolean',
  SELECT:      'select',
  MULTISELECT: 'multiselect',
  DATE:        'date',
  DATETIME:    'datetime',
  EMAIL:       'email',
  PHONE:       'phone',
  RELATION:    'relation',
  FILE:        'file',
  JSON:        'json',
  MARKDOWN:    'markdown',
  COLOR:       'color',
  RICHTEXT:    'richtext',
})
