// @runly/module-engine — Runly Module Engine v3 public API
// Phase 1: error class, manifest/model/view/page declarations and validators,
//          registries, SQL generator, migration safety guard, model checksum.

export { ModuleEngineError }             from './errors.js'
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
export { definePage,
         validatePage }                  from './define-page.js'
export { loadHelpBlueprints }             from './load-help-blueprints.js'
export { ModuleRegistry }               from './module-registry.js'
export { ModelRegistry }                from './model-registry.js'
export { ComponentRegistry }            from './component-registry.js'
export { generateCreateTableSql,
         assertSafeMigrationSql }        from './sql-generator.js'
export { createChecksum }               from './checksum.js'

// Additional constants re-exported for module authors
export { MODULE_KINDS, BLUEPRINT_KINDS,
         RESERVED_NAMESPACES,
         RESERVED_TABLE_PREFIXES }       from './constants.js'
export { SQL_TYPE_MAP }                  from './field-types.js'
export { MODULE_ICON_NAMES,
         isModuleIconName }              from './module-icons.js'
