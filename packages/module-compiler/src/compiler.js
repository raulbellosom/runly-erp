import { createHash } from 'node:crypto'
import { assertValidModuleDefinition, normalizeModuleDefinition } from './definition.js'
import { generateManifest } from './templates/manifest.js'
import { generateModel } from './templates/model.js'
import { generateTableView, generateFormView, generateDetailView, generatePageView } from './templates/views.js'
import { generateComponentsIndex, generateCustomDashboardView, generateModuleDashboard } from './templates/custom.js'
import { generateServiceHelpers } from './templates/service-helpers.js'
import { generateService } from './templates/service.js'
import { generateRoutes } from './templates/routes.js'
import { generateFileRoutes } from './templates/file-routes.js'
import { generateVisibilityModule, hasConditionalRequired } from './templates/visibility.js'
import { generateRelationsModule, hasRelationsModule } from './templates/relations.js'
import { DEVELOPER_GUIDE_PATH, generateDeveloperGuide } from './templates/developer-guide.js'
import { hasFileSupport } from './templates/layout-views.js'
import { generateEntityValidators } from './templates/validators.js'
import { generateApiIndex } from './templates/api-index.js'
import { generateValidatorsIndex } from './templates/validators-index.js'
import { dashboardFileName, generateDashboardView } from './templates/dashboard.js'
import { generateKanbanView, kanbanFileName } from './templates/kanban.js'
import { generateRecordsView, recordsViewFileName } from './templates/records-view.js'
import { isRecordsViewKind } from './records-views.js'

function toTemplateConfig(definition) {
  return {
    ...definition,
    entities: definition.entities.map((entity) => ({
      ...entity,
      name: entity.key,
      labelPlural: entity.pluralLabel,
      fields: entity.fields.map((field) => ({
        ...field,
        name: field.key,
        options: field.options?.map((option) => option.value),
        relatedModel: field.targetModel ?? (field.targetEntity ? `${definition.key.split('.').pop()}.${field.targetEntity}` : undefined),
      })),
    })),
  }
}

export function compileModule(rawDefinition) {
  assertValidModuleDefinition(rawDefinition)
  const definition = normalizeModuleDefinition(rawDefinition)
  const diagnostics = assertValidModuleDefinition(definition)
  const config = toTemplateConfig(definition)
  const files = []
  const add = (filePath, content) => files.push({ path: filePath, content })
  add('.module-definition.json', `${JSON.stringify(definition, null, 2)}\n`)
  add('module.manifest.js', generateManifest(config))
  add('api/service-helpers.js', generateServiceHelpers(config))
  add('api/index.js', generateApiIndex(config))
  add('validators/index.js', generateValidatorsIndex(config))
  add(DEVELOPER_GUIDE_PATH, generateDeveloperGuide(config))
  for (const entity of config.entities) {
    add(`models/${entity.name}.model.js`, generateModel(config, entity))
    add(`views/${entity.name}.table.js`, generateTableView(config, entity))
    add(`views/${entity.name}.form.js`, generateFormView(config, entity))
    add(`views/${entity.name}.detail.js`, generateDetailView(config, entity))
    add(`views/${entity.name}.page.js`, generatePageView(config, entity))
    add(`api/${entity.name}-routes.js`, generateRoutes(config, entity))
    if (hasFileSupport(entity)) add(`api/${entity.name}-file-routes.js`, generateFileRoutes(config, entity))
    if (hasConditionalRequired(entity)) add(`api/${entity.name}-visibility.js`, generateVisibilityModule(entity))
    if (hasRelationsModule(config, entity)) add(`api/${entity.name}-relations.js`, generateRelationsModule(config, entity))
    add(`api/${entity.name}-service.js`, generateService(config, entity))
    add(`validators/${entity.name}.validators.js`, generateEntityValidators(entity))
  }
  for (const view of definition.views.filter((item) => item.kind === 'DASHBOARD')) {
    add(dashboardFileName(view), generateDashboardView(view))
  }
  for (const view of definition.views.filter((item) => item.kind === 'KANBAN')) add(kanbanFileName(view), generateKanbanView(view))
  for (const view of definition.views.filter((item) => isRecordsViewKind(item.kind))) add(recordsViewFileName(view), generateRecordsView(view))
  if (config.preset === 'crud-custom') {
    add('views/dashboard.custom.js', generateCustomDashboardView(config))
    add('components/index.js', generateComponentsIndex(config))
    add('components/ModuleDashboard.jsx', generateModuleDashboard(config))
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  const packageHash = createHash('sha256')
  for (const file of files) {
    packageHash.update(`${Buffer.byteLength(file.path)}:`).update(file.path)
    packageHash.update(`${Buffer.byteLength(file.content)}:`).update(file.content)
  }
  return {
    moduleKey: definition.key,
    definition,
    files,
    diagnostics,
    packageHash: packageHash.digest('hex'),
    manifest: { key: definition.key, version: definition.version },
    models: definition.entities.map((entity) => entity.key),
    views: definition.views,
  }
}
