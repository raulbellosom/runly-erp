import { FIELD_TYPES, KANBAN_GROUP_FIELD_TYPES, KANBAN_MAX_COLUMNS, RESERVED_NAMESPACES, isModuleIconName, validateDashboardSchema, validateKanbanSchema } from '@runly/module-engine/browser'
import { moduleSlug, permKey, toKebab } from './templates/helpers.js'
import { isRecordsViewKind, normalizeRecordsView, validateRecordsView } from './records-views.js'
import { validateEntityLayout, validateFileFieldOptions } from './layout.js'
import { validateRelations } from './relations.js'
import { validateExtensions } from './extensions.js'
import { validatePublicLinks } from './public-links.js'
import { validateDefinitionConnections } from './connections.js'
import { automationConsumes, normalizeAutomations, validateDefinitionAutomations } from './automations.js'
import { externalRelationDependencies, externalTarget } from './external-relations.js'

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const MODULE_KEY = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const SAFE_PATH = /^\/(?:[a-zA-Z0-9._~-]+\/?)*$/
const FIELD_TYPE_SET = new Set(Object.values(FIELD_TYPES))
const PRESETS = new Set(['crud', 'crud-custom'])
const RESERVED_FIELDS = new Set(['id', 'company_id', 'enabled', 'created_at', 'updated_at'])
const UNSAFE_SOURCE_TEXT = /['\\\r\n]/

export const CURRENT_MODULE_DEFINITION_SCHEMA_VERSION = 1

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

function isJsonValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).every(isJsonValue)
  }
  return false
}

export function validateModuleDefinition(definition) {
  const errors = []
  const warnings = []
  if (!isJsonValue(definition) || !definition || Array.isArray(definition)) {
    return { valid: false, errors: [diagnostic('', 'NOT_JSON_COMPATIBLE', 'ModuleDefinition must be a JSON-compatible object.')], warnings }
  }
  if (definition.schemaVersion !== 1) errors.push(diagnostic('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION', 'Only ModuleDefinition schemaVersion 1 is supported.'))
  if (!MODULE_KEY.test(definition.key ?? '')) errors.push(diagnostic('key', 'INVALID_MODULE_KEY', 'Module key must use <namespace>.<slug> lowercase format.'))
  if (RESERVED_NAMESPACES.some((prefix) => definition.key?.startsWith(prefix))) errors.push(diagnostic('key', 'RESERVED_MODULE_NAMESPACE', 'Module namespace is reserved.'))
  if (!definition.name?.trim()) errors.push(diagnostic('name', 'REQUIRED', 'Module name is required.'))
  // name/description are emitted via JSON.stringify() in generateManifest()
  // (packages/module-compiler/src/templates/manifest.js), which safely
  // escapes quotes, backslashes and newlines — unlike entity/field/permission/
  // navigation labels below, which are still naively interpolated into
  // single-quoted string literals elsewhere and so still need this check.
  if (!/^\d+\.\d+\.\d+$/.test(definition.version ?? '')) errors.push(diagnostic('version', 'INVALID_SEMVER', 'Version must use x.y.z semver.'))
  if (!isModuleIconName(definition.icon ?? '')) errors.push(diagnostic('icon', 'INVALID_ICON', 'Icon is not supported by the module catalog.'))
  if (!HEX_COLOR.test(definition.color ?? '')) errors.push(diagnostic('color', 'INVALID_COLOR', 'Color must be a six-digit hexadecimal value.'))
  if (!definition.pwa?.shortName || definition.pwa.shortName.length > 14) errors.push(diagnostic('pwa.shortName', 'INVALID_PWA_SHORT_NAME', 'PWA short name is required and limited to 14 characters.'))
  if (!SAFE_PATH.test(definition.pwa?.startPath ?? '') || definition.pwa?.startPath?.includes('..') || definition.pwa?.startPath?.startsWith('/app')) errors.push(diagnostic('pwa.startPath', 'UNSAFE_ROUTE_PATH', 'PWA start path must be a safe module-relative path.'))
  if (!PRESETS.has(definition.preset ?? 'crud')) errors.push(diagnostic('preset', 'INVALID_PRESET', 'Preset must be crud or crud-custom.'))
  if (!Array.isArray(definition.entities) || !definition.entities.length) {
    errors.push(diagnostic('entities', 'REQUIRED', 'At least one entity is required.'))
    return { valid: false, errors, warnings }
  }
  for (const key of ['consumes', 'events']) {
    if (definition[key] !== undefined) errors.push(diagnostic(key, 'BUILDER_INTEGRATION_UNSUPPORTED', `${key} is supported in manual manifests but not preserved by ModuleDefinition v1.`))
  }
  const entityKeys = new Set()
  definition.entities.forEach((entity, entityIndex) => {
    const base = `entities[${entityIndex}]`
    const key = entity.key ?? entity.name
    if (!IDENTIFIER.test(key ?? '')) errors.push(diagnostic(`${base}.key`, 'INVALID_ENTITY_KEY', 'Entity key must be lowercase snake_case.'))
    if (entityKeys.has(key)) errors.push(diagnostic(`${base}.key`, 'DUPLICATE_ENTITY_KEY', `Duplicate entity key "${key}".`))
    entityKeys.add(key)
    if (!entity.label?.trim()) errors.push(diagnostic(`${base}.label`, 'REQUIRED', 'Entity label is required.'))
    for (const [path, value] of [[`${base}.label`, entity.label], [`${base}.pluralLabel`, entity.pluralLabel]]) {
      if (UNSAFE_SOURCE_TEXT.test(value ?? '')) errors.push(diagnostic(path, 'UNSAFE_SOURCE_TEXT', `${path} contains characters that cannot be emitted safely.`))
    }
    if (!Array.isArray(entity.fields) || !entity.fields.length) errors.push(diagnostic(`${base}.fields`, 'REQUIRED', 'At least one field is required.'))
    const fieldKeys = new Set()
    for (const [fieldIndex, field] of (entity.fields ?? []).entries()) {
      const fieldPath = `${base}.fields[${fieldIndex}]`
      const fieldKey = field.key ?? field.name
      if (!IDENTIFIER.test(fieldKey ?? '') || RESERVED_FIELDS.has(fieldKey)) errors.push(diagnostic(`${fieldPath}.key`, 'INVALID_FIELD_KEY', `Invalid or reserved field key "${fieldKey}".`))
      if (fieldKeys.has(fieldKey)) errors.push(diagnostic(`${fieldPath}.key`, 'DUPLICATE_FIELD_KEY', `Duplicate field key "${fieldKey}".`))
      fieldKeys.add(fieldKey)
      if (!FIELD_TYPE_SET.has(field.type)) errors.push(diagnostic(`${fieldPath}.type`, 'INVALID_FIELD_TYPE', `Unsupported field type "${field.type}".`))
      if (UNSAFE_SOURCE_TEXT.test(field.label ?? '')) errors.push(diagnostic(`${fieldPath}.label`, 'UNSAFE_SOURCE_TEXT', 'Field label contains characters that cannot be emitted safely.'))
      if (['select', 'multiselect'].includes(field.type)) {
        if (!Array.isArray(field.options) || !field.options.length) errors.push(diagnostic(`${fieldPath}.options`, 'INVALID_SELECT_OPTIONS', 'Select fields require at least one option.'))
        else {
          const optionValues = field.options.map((option) => typeof option === 'string' ? option : option.value)
          const seen = new Set()
          for (const value of optionValues) {
            if (seen.has(value)) { errors.push(diagnostic(`${fieldPath}.options`, 'DUPLICATE_SELECT_OPTION_VALUE', `Select option value "${value}" is declared more than once.`)); break }
            seen.add(value)
          }
        }
      }
      if (field.type === 'relation' && !field.targetEntity && !field.targetModel && !field.relatedModel && !field.targetExternal) errors.push(diagnostic(fieldPath, 'MISSING_RELATION_TARGET', 'Relation field requires targetEntity, targetModel or targetExternal.'))
      if (field.type === 'relation' && field.targetExternal !== undefined) {
        if (!externalTarget(field.targetExternal)) errors.push(diagnostic(`${fieldPath}.targetExternal`, 'EXTERNAL_RELATION_TARGET_NOT_FOUND', `Unknown system entity "${field.targetExternal}".`))
        if (field.targetEntity) errors.push(diagnostic(`${fieldPath}.targetExternal`, 'RELATION_TARGET_CONFLICT', 'A relation targets either an entity of this module or a system entity, not both.'))
      }
      if (field.default !== undefined && !['string', 'number', 'boolean'].includes(typeof field.default)) errors.push(diagnostic(`${fieldPath}.default`, 'UNSAFE_DEFAULT', 'Defaults must be string, number or boolean literals.'))
      validateFileFieldOptions(field, fieldPath, errors)
    }
    validateEntityLayout(entity, base, errors, warnings, definition.entities)
  })
  definition.entities.forEach((entity, entityIndex) => {
    for (const [fieldIndex, field] of (entity.fields ?? []).entries()) {
      if (field.type === 'relation' && field.targetEntity && !entityKeys.has(field.targetEntity)) {
        errors.push(diagnostic(`entities[${entityIndex}].fields[${fieldIndex}].targetEntity`, 'RELATION_TARGET_NOT_FOUND', `Relation target "${field.targetEntity}" does not exist.`))
      }
    }
  })
  validateRelations(definition.entities, errors)
  const viewKeys = new Set()
  for (const [viewIndex, view] of (definition.views ?? []).entries()) {
    if (viewKeys.has(view.key)) errors.push(diagnostic(`views[${viewIndex}].key`, 'DUPLICATE_VIEW_KEY', `Duplicate view key "${view.key}".`))
    viewKeys.add(view.key)
    if (!['DASHBOARD', 'KANBAN'].includes(view.kind) && !entityKeys.has(view.entity ?? view.schema?.entity)) errors.push(diagnostic(`views[${viewIndex}].entity`, 'VIEW_ENTITY_NOT_FOUND', `View entity "${view.entity}" does not exist.`))
    if (view.kind === 'DASHBOARD') {
      const normalizedView = { ...view, schema: dashboardSchemaFromView(view, definition) }
      const dashboard = validateDashboardSchema(normalizedView.schema)
      for (const message of dashboard.errors) errors.push(diagnostic(`views[${viewIndex}]`, dashboardDiagnosticCode(message), message))
      validateDashboardReferences(normalizedView, definition.entities, viewIndex, errors)
    }
    if (isRecordsViewKind(view.kind)) validateRecordsView(view, definition, viewIndex, errors)
    if (view.kind === 'KANBAN') {
      const normalizedView = { ...view, schema: kanbanSchemaFromView(view, definition) }
      for (const message of validateKanbanSchema(normalizedView.schema).errors) errors.push(diagnostic(`views[${viewIndex}]`, kanbanDiagnosticCode(message), message))
      validateKanbanReferences(normalizedView, definition.entities, viewIndex, errors)
    }
  }
  const permissionKeys = new Set((definition.permissions ?? definition.entities.flatMap((entity) =>
    ['read', 'create', 'update', 'delete'].map((action) => ({ key: permKey(moduleSlug(definition.key), entity.key ?? entity.name, action) }))
  )).map((permission) => permission.key))
  validateExtensions(definition, permissionKeys, errors)
  validatePublicLinks(definition, permissionKeys, errors)
  validateDefinitionConnections(definition, errors)
  validateDefinitionAutomations(definition, errors)
  for (const [permissionIndex, permission] of (definition.permissions ?? []).entries()) {
    const slug = definition.key?.split('.').pop()
    if (!permission.key?.startsWith(`${slug}.`)) errors.push(diagnostic(`permissions[${permissionIndex}].key`, 'PERMISSION_NAMESPACE_ESCAPE', 'Permission must stay inside the module slug namespace.'))
    if (UNSAFE_SOURCE_TEXT.test(permission.name ?? '')) errors.push(diagnostic(`permissions[${permissionIndex}].name`, 'UNSAFE_SOURCE_TEXT', 'Permission name contains characters that cannot be emitted safely.'))
  }
  for (const [navigationIndex, item] of (definition.navigation ?? []).entries()) {
    if (!viewKeys.has(item.page)) errors.push(diagnostic(`navigation[${navigationIndex}].page`, 'NAVIGATION_PAGE_NOT_FOUND', `Navigation page "${item.page}" does not exist.`))
    if (!permissionKeys.has(item.permission)) errors.push(diagnostic(`navigation[${navigationIndex}].permission`, 'NAVIGATION_PERMISSION_NOT_FOUND', `Navigation permission "${item.permission}" does not exist.`))
    if (!item.path?.startsWith(`/app/m/${definition.key}/`) || item.path.includes('..')) errors.push(diagnostic(`navigation[${navigationIndex}].path`, 'UNSAFE_ROUTE_PATH', 'Navigation path must remain inside the module.'))
    if (UNSAFE_SOURCE_TEXT.test(item.label ?? '')) errors.push(diagnostic(`navigation[${navigationIndex}].label`, 'UNSAFE_SOURCE_TEXT', 'Navigation label contains characters that cannot be emitted safely.'))
  }
  for (const [viewIndex, view] of (definition.views ?? []).entries()) {
    if (view.kind !== 'DASHBOARD') continue
    const dashboardSchema = dashboardSchemaFromView(view, definition)
    for (const [path, permission] of [
      [`views[${viewIndex}].schema.permissionKey`, dashboardSchema.permissionKey],
      ...(dashboardSchema.widgets ?? []).map((widget, widgetIndex) => [`views[${viewIndex}].schema.widgets[${widgetIndex}].permissionKey`, widget.permissionKey]),
    ]) {
      if (permission && !permissionKeys.has(permission)) errors.push(diagnostic(path, 'UNKNOWN_PERMISSION', `Dashboard permission "${permission}" is not declared by the module.`))
    }
  }
  return { valid: errors.length === 0, errors, warnings }
}

// Relations to system entities make the owning module a dependency, so it
// cannot be uninstalled while this module uses it.
function withExternalDependencies(dependencies, entities, automations) {
  const next = [...dependencies]
  for (const key of [...externalRelationDependencies(entities), ...Object.keys(automationConsumes({ automations }))]) {
    if (!next.some((dependency) => (typeof dependency === 'string' ? dependency : dependency.key) === key)) next.push({ key })
  }
  return next
}

export function normalizeModuleDefinition(input) {
  const definition = {
    schemaVersion: input.schemaVersion ?? 1,
    key: input.key,
    name: input.name,
    version: input.version || '0.1.0',
    description: input.description || '',
    icon: input.icon,
    color: input.color,
    pwa: { shortName: input.pwa?.shortName, startPath: input.pwa?.startPath },
    preset: input.preset || 'crud',
    dependencies: withExternalDependencies(input.dependencies ?? [{ key: 'runly.core' }], input.entities, input.automations),
    entities: (input.entities ?? []).map((entity) => ({
      id: entity.id ?? entity.key ?? entity.name,
      key: entity.key ?? entity.name,
      label: entity.label,
      pluralLabel: entity.pluralLabel ?? entity.labelPlural ?? `${entity.label}s`,
      companyScoped: entity.companyScoped !== false,
      softDelete: entity.softDelete !== false,
      ...(entity.layout ? { layout: entity.layout } : {}),
      fields: (entity.fields ?? []).map((field) => ({
        ...field,
        key: field.key ?? field.name,
        label: field.label ?? field.key ?? field.name,
        options: field.options?.map((option) => typeof option === 'string' ? { value: option, label: option } : option),
        targetModel: field.targetModel ?? field.relatedModel,
      })),
    })),
  }
  const slug = moduleSlug(definition.key ?? 'custom.invalid')
  definition.permissions = input.permissions ?? definition.entities.flatMap((entity) =>
    ['read', 'create', 'update', 'delete'].map((action) => ({
      key: permKey(slug, entity.key, action),
      name: `${({ read: 'Ver', create: 'Crear', update: 'Editar', delete: 'Desactivar' })[action]} ${entity.label.toLowerCase()}`,
      action,
      entity: entity.key,
    })))
  // compileModule() always emits a table/form/detail/page file per entity
  // (packages/module-compiler/src/compiler.js), independent of whatever
  // `input.views` contains — so these generated entries must always be
  // present here too. Treating `input.views` as a full replacement (as this
  // used to) silently dropped the entity's `<slug>.<entity>.page` view the
  // moment a caller added one DASHBOARD/KANBAN view of their own, which then
  // failed NAVIGATION_PAGE_NOT_FOUND validation for a view the compiler was
  // going to generate anyway. `input.views` is therefore additive: any
  // custom view reusing a generated key is dropped in favor of the
  // generated one (today's generated kinds have no per-view schema to
  // override), everything else is kept alongside it.
  const generatedViews = definition.entities.flatMap((entity) => ['TABLE', 'FORM', 'DETAIL', 'PAGE'].map((kind) => ({
    key: `${slug}.${entity.key}.${kind.toLowerCase()}`,
    kind,
    entity: entity.key,
    generated: true,
  })))
  const generatedViewKeys = new Set(generatedViews.map((view) => view.key))
  const customViews = (input.views ?? [])
    .filter((view) => !generatedViewKeys.has(view.key))
    .map((view) => view.kind === 'DASHBOARD' ? normalizeDashboardView(view, definition) : view.kind === 'KANBAN' ? normalizeKanbanView(view, definition) : isRecordsViewKind(view.kind) ? normalizeRecordsView(view, definition) : view)
  definition.views = [...generatedViews, ...customViews]
  if (input.extensions) definition.extensions = input.extensions
  if (input.publicLinks?.length) definition.publicLinks = input.publicLinks
  if (input.connections?.length) definition.connections = input.connections
  if (input.automations?.length) definition.automations = normalizeAutomations(input.automations)
  definition.navigation = input.navigation ?? definition.entities.map((entity) => ({
    label: entity.pluralLabel,
    icon: definition.icon,
    path: `/app/m/${definition.key}/${slug}-${toKebab(entity.key)}s`,
    page: `${slug}.${entity.key}.page`,
    permission: permKey(slug, entity.key, 'read'),
    generated: true,
  }))
  return JSON.parse(JSON.stringify(definition))
}

function normalizeDashboardView(view, definition) {
  const schema = dashboardSchemaFromView(view, definition)
  return { key: view.key, kind: 'DASHBOARD', version: view.version ?? '0.1.0', generated: false, schema }
}

function dashboardSchemaFromView(view, definition) {
  return view.schema ?? {
    title: view.title ?? definition.name,
    description: view.description,
    path: view.path ?? `/app/m/${definition.key}/dashboard`,
    permissionKey: view.permissionKey,
    layout: { columns: 12, gap: 'md', ...(view.layout ?? {}) },
    widgets: view.widgets ?? [],
  }
}

function normalizeKanbanView(view, definition) {
  return { key: view.key, kind: 'KANBAN', version: view.version ?? '0.1.0', generated: false, schema: kanbanSchemaFromView(view, definition) }
}

function kanbanSchemaFromView(view, definition) {
  const entity = view.entity ?? view.schema?.entity
  const slug = moduleSlug(definition.key ?? 'custom.invalid')
  const base = view.schema ?? {
    title: view.title ?? definition.name,
    description: view.description,
    path: view.path ?? `/app/m/${definition.key}/${entity}-kanban`,
    entity,
    apiPath: view.apiPath ?? `/${slug}/${toKebab(entity)}s`,
    groupBy: view.groupBy,
    card: view.card,
    orderBy: view.orderBy ?? { field: 'created_at', direction: 'desc' },
    filters: view.filters ?? [],
    limit: view.limit ?? 200,
  }
  if (base.columns) return base
  const entityDefinition = definition.entities?.find((item) => item.key === entity)
  const groupField = entityDefinition?.fields?.find((field) => field.key === base.groupBy)
  const columns = groupField?.type === 'select'
    ? (groupField.options ?? []).map((option) => typeof option === 'object'
      ? { value: option.value, label: option.label ?? String(option.value) }
      : { value: option, label: String(option) })
    : undefined
  return columns ? { ...base, columns } : base
}

function kanbanDiagnosticCode(message) {
  if (message.includes('path')) return 'UNSAFE_PATH'
  if (message.includes('filters')) return 'INVALID_FILTER'
  if (message.includes('orderBy')) return 'INVALID_ORDER_FIELD'
  return 'INVALID_KANBAN'
}

function validateKanbanReferences(view, entities, viewIndex, errors) {
  const path = `views[${viewIndex}].schema`
  const entity = entities.find((item) => item.key === view.schema?.entity)
  if (!entity) { errors.push(diagnostic(`${path}.entity`, 'UNKNOWN_ENTITY', `Unknown Kanban entity "${view.schema?.entity}".`)); return }
  const fields = new Map(entity.fields.map((field) => [field.key, field]))
  const groupField = fields.get(view.schema.groupBy)
  if (!groupField) errors.push(diagnostic(`${path}.groupBy`, 'UNKNOWN_GROUP_FIELD', `Unknown group field "${view.schema.groupBy}".`))
  else if (!KANBAN_GROUP_FIELD_TYPES.includes(groupField.type)) errors.push(diagnostic(`${path}.groupBy`, 'INVALID_GROUP_FIELD_TYPE', 'Kanban groupBy must be select or boolean.'))
  else if (groupField.type === 'select' && (groupField.options?.length ?? 0) > KANBAN_MAX_COLUMNS) errors.push(diagnostic(`${path}.groupBy`, 'TOO_MANY_COLUMNS', `Kanban supports at most ${KANBAN_MAX_COLUMNS} select options.`))
  for (const [property, fieldKey] of Object.entries(view.schema.card ?? {})) {
    if (!fieldKey) continue
    const field = fields.get(fieldKey)
    if (!field) errors.push(diagnostic(`${path}.card.${property}`, 'UNKNOWN_CARD_FIELD', `Unknown card field "${fieldKey}".`))
    else if (field.type === 'relation') errors.push(diagnostic(`${path}.card.${property}`, 'UNSUPPORTED_CARD_FIELD', 'Relation display is not supported by declarative Kanban v1.'))
    else if (property === 'imageField' && field.type !== 'file') errors.push(diagnostic(`${path}.card.${property}`, 'INVALID_CARD_FIELD_TYPE', 'imageField must use a file field.'))
  }
  const available = new Set([...fields.keys(), 'created_at', 'updated_at'])
  if (view.schema.orderBy && !available.has(view.schema.orderBy.field)) errors.push(diagnostic(`${path}.orderBy.field`, 'INVALID_ORDER_FIELD', `Unknown order field "${view.schema.orderBy.field}".`))
  for (const filter of view.schema.filters ?? []) if (!available.has(filter.field) && filter.field !== 'enabled') errors.push(diagnostic(`${path}.filters`, 'INVALID_FILTER', `Unknown filter field "${filter.field}".`))
}

function dashboardDiagnosticCode(message) {
  if (message.includes('unique')) return 'DUPLICATE_WIDGET_KEY'
  if (message.includes('.type')) return 'INVALID_WIDGET_TYPE'
  if (message.includes('aggregate')) return 'INVALID_AGGREGATE'
  if (message.includes('operator')) return 'INVALID_FILTER_OPERATOR'
  if (message.includes('layout') || message.includes('at most')) return 'INVALID_LAYOUT'
  return 'INVALID_DASHBOARD'
}

function validateDashboardReferences(view, entities, viewIndex, errors) {
  const entityMap = new Map(entities.map((entity) => [entity.key, entity]))
  const numeric = new Set(['number', 'decimal'])
  for (const [widgetIndex, widget] of (view.schema?.widgets ?? []).entries()) {
    const path = `views[${viewIndex}].schema.widgets[${widgetIndex}]`
    const entity = entityMap.get(widget.source?.entity)
    if (!entity) { errors.push(diagnostic(`${path}.source.entity`, 'UNKNOWN_ENTITY', `Unknown dashboard entity "${widget.source?.entity}".`)); continue }
    const fields = new Map(entity.fields.map((field) => [field.key, field]))
    for (const fieldKey of [widget.source?.aggregateField, widget.source?.groupBy, widget.source?.orderBy?.field, widget.display?.titleField, widget.display?.subtitleField].filter(Boolean)) {
      if (!fields.has(fieldKey) && !['created_at', 'updated_at'].includes(fieldKey)) errors.push(diagnostic(path, 'UNKNOWN_FIELD', `Unknown dashboard field "${fieldKey}".`))
    }
    for (const filter of widget.source?.filters ?? []) if (!fields.has(filter.field) && !['created_at', 'updated_at'].includes(filter.field)) errors.push(diagnostic(path, 'UNKNOWN_FIELD', `Unknown dashboard filter field "${filter.field}".`))
    if (['sum', 'avg'].includes(widget.source?.aggregate) && !numeric.has(fields.get(widget.source?.aggregateField)?.type)) errors.push(diagnostic(`${path}.source.aggregateField`, 'AGGREGATE_TYPE_MISMATCH', `${widget.source.aggregate} requires a numeric field.`))
  }
}

export function createDefinitionFromScaffoldConfig(config) {
  return config.preset === 'crud-custom' ? createCrudCustomDefinition(config) : createCrudDefinition(config)
}

export function createCrudDefinition(input) {
  return normalizeModuleDefinition({ ...input, schemaVersion: input.schemaVersion ?? 1, preset: 'crud' })
}

export function createCrudCustomDefinition(input) {
  return normalizeModuleDefinition({ ...input, schemaVersion: input.schemaVersion ?? 1, preset: 'crud-custom' })
}

export function upgradeModuleDefinition(definition, targetVersion = CURRENT_MODULE_DEFINITION_SCHEMA_VERSION) {
  if (definition?.schemaVersion !== 1 || targetVersion !== 1) {
    const error = new Error('UNSUPPORTED_MODULE_DEFINITION_SCHEMA_VERSION')
    error.code = 'UNSUPPORTED_MODULE_DEFINITION_SCHEMA_VERSION'
    throw error
  }
  return normalizeModuleDefinition(definition)
}

export function assertValidModuleDefinition(definition) {
  const result = validateModuleDefinition(definition)
  if (!result.valid) {
    const error = new Error('INVALID_MODULE_DEFINITION')
    error.code = 'INVALID_MODULE_DEFINITION'
    error.diagnostics = result
    throw error
  }
  return result
}
