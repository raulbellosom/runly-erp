// @runly/module-engine — Runly Module Engine v3 public API
// Phase 1: error class, manifest/model/view/page declarations and validators,
//          registries, SQL generator, migration safety guard, model checksum.

export { ModuleEngineError }             from './errors.js'
export { validateAiManifest,
         isIdentifyingAiField }          from './ai-manifest.js'
export { validatePublicResources,
         findPublicResource,
         PUBLIC_RESOURCE_MODES }         from './public-resources-manifest.js'
export { defineRunlyModule,
         // Kept for the @atlas/* package-scope compatibility system (vite.config.js):
         // a custom RME3 module authored against the old @atlas/module-engine import
         // must still find this exact export.
         defineRunlyModule as defineAtlasModule,
         validateManifest,
         validateModulePwaIdentity }     from './define-module.js'
export { defineModel,
         validateModel }                 from './define-model.js'
export { FIELD_TYPES }                   from './constants.js'
export { defineView,
         validateView }                  from './define-view.js'
export { validateDashboardSchema, DASHBOARD_WIDGET_TYPES, DASHBOARD_CHART_TYPES,
         DASHBOARD_AGGREGATES, DASHBOARD_FILTER_OPERATORS, DASHBOARD_MAX_WIDGETS,
         DASHBOARD_DEFAULT_LIST_LIMIT, DASHBOARD_MAX_LIST_LIMIT } from './dashboard-schema.js'
export { DATA_VIEW_FILTER_OPERATORS, DATA_VIEW_MAX_FILTER_VALUES,
         validateDataViewFilters, validateDataViewOrder } from './data-view-schema.js'
export { validateKanbanSchema, KANBAN_GROUP_FIELD_TYPES, KANBAN_MAX_COLUMNS,
         KANBAN_DEFAULT_LIMIT, KANBAN_MAX_LIMIT } from './kanban-schema.js'
export { validateRecordsViewSchema, RECORDS_VIEW_KINDS, RECORDS_VIEW_DATE_FIELD_TYPES,
         RECORDS_VIEW_DEFAULT_LIMIT, RECORDS_VIEW_MAX_LIMIT, REPORT_AGGREGATES,
         REPORT_MAX_MEASURES, REPORT_MAX_GROUPS } from './records-view-schema.js'
export { definePage,
         validatePage }                  from './define-page.js'
export { loadHelpBlueprints }             from './load-help-blueprints.js'
export { ModuleRegistry }               from './module-registry.js'
export { ModelRegistry }                from './model-registry.js'
export { ComponentRegistry }            from './component-registry.js'
export { generateCreateTableSql,
         assertSafeMigrationSql }        from './sql-generator.js'
export { createChecksum }               from './checksum.js'
export { normalizeModelSchema,
         hashNormalizedSchema,
         diffModelSchemas,
         compileMigrationPlan }         from './schema-diff.js'

// Additional constants re-exported for module authors
export { MODULE_KINDS, BLUEPRINT_KINDS,
         RESERVED_NAMESPACES,
         RESERVED_TABLE_PREFIXES }       from './constants.js'
export { SQL_TYPE_MAP }                  from './field-types.js'
export { MODULE_ICON_NAMES,
         isModuleIconName }              from './module-icons.js'
export { CONNECTION_KINDS, CONNECTION_DELETE_POLICIES, CONNECTION_SURFACES,
         validateConnections, normalizeConnection,
         validateConnectionsAgainstModels }        from './manifest-connections.js'
