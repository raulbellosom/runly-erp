import { toPascal, moduleSlug, entityRouteBase, permKey, toKebab } from './helpers.js'
import { dashboardFileName } from './dashboard.js'
import { kanbanFileName } from './kanban.js'
import { recordsViewFileName } from './records-view.js'
import { isRecordsViewKind } from '../records-views.js'

export function generateManifest(config) {
  const slug = moduleSlug(config.key)
  const version = config.version || '0.1.0'
  const description = config.description || ''
  const entities = config.entities

  const modelPaths = entities
    .map((e) => `  './models/${e.name}.model.js',`)
    .join('\n')

  const viewPaths = entities
    .flatMap((e) => [
      `  './views/${e.name}.table.js',`,
      `  './views/${e.name}.form.js',`,
      `  './views/${e.name}.detail.js',`,
      `  './views/${e.name}.page.js',`,
    ])
    .concat(config.preset === 'crud-custom' ? [`  './views/dashboard.custom.js',`] : [])
    .concat((config.views ?? []).filter((view) => view.kind === 'DASHBOARD').map((view) => `  './${dashboardFileName(view)}',`))
    .concat((config.views ?? []).filter((view) => view.kind === 'KANBAN').map((view) => `  './${kanbanFileName(view)}',`))
    .concat((config.views ?? []).filter((view) => isRecordsViewKind(view.kind)).map((view) => `  './${recordsViewFileName(view)}',`))
    .join('\n')

  const permissions = (config.permissions ?? entities.flatMap((e) => [
      { key: permKey(slug, e.name, 'read'), name: buildPermLabel('Ver', e.label) },
      { key: permKey(slug, e.name, 'create'), name: buildPermLabel('Crear', e.label) },
      { key: permKey(slug, e.name, 'update'), name: buildPermLabel('Editar', e.label) },
      { key: permKey(slug, e.name, 'delete'), name: buildPermLabel('Desactivar', e.label) },
    ]))
    .map((permission) => `  { key: '${permission.key}', name: '${permission.name ?? permission.key}' },`)
    .join('\n')

  const navigation = (config.navigation ?? entities.map((e) => ({
      label: e.labelPlural || e.label + 's',
      path: `/app/m/${config.key}/${slug}-${toKebab(e.name)}s`,
      icon: config.icon,
      permission: permKey(slug, e.name, 'read'),
    })))
    .map((item) => {
      return [
        `  {`,
        `    label: '${item.label}',`,
        `    path: '${item.path}',`,
        `    icon: '${item.icon ?? config.icon}',`,
        `    layout: 'main',`,
        `    permissionKey: '${item.permission ?? item.permissionKey}',`,
        `  },`,
      ].join('\n')
    })
    .concat(
      config.preset === 'crud-custom'
        ? [[
            `  {`,
            `    label: 'Dashboard',`,
            `    path: '/app/m/${config.key}/dashboard',`,
            `    icon: '${config.icon}',`,
            `    layout: 'main',`,
            `    permissionKey: '${permKey(slug, entities[0].name, 'read')}',`,
            `  },`,
          ].join('\n')]
        : []
    )
    .join('\n')

  const ownedModels = entities
    .map((e) => `  '${slug}.${e.name}',`)
    .join('\n')

  const ownedTables = entities
    .map((e) => `  '${slug}_${e.name}',`)
    .join('\n')

  return `import { defineRunlyModule } from '@runly/module-engine'

export default defineRunlyModule({
  key: '${config.key}',
  name: ${JSON.stringify(config.name)},
  version: '${version}',
  kind: 'FEATURE',
  description: ${JSON.stringify(description)},
  icon: '${config.icon}',
  color: '${config.color}',
  pwa: {
    shortName: '${config.pwa.shortName}',
    startPath: '${config.pwa.startPath}',
  },
  dependencies: ${JSON.stringify(config.dependencies ?? [{ key: 'runly.core' }])},
  models: [
${modelPaths}
  ],
  views: [
${viewPaths}
  ],
  lifecycle: {
    installable: true,
    uninstallable: true,
    resettable: true,
    supportsDataPurge: true,
    defaultUninstallPolicy: 'purge-owned-tables',
    ownedModels: [
${ownedModels}
    ],
    ownedTables: [
${ownedTables}
    ],
  },
  permissions: [
${permissions}
  ],
  navigation: [
${navigation}
  ],
})
`
}

function buildPermLabel(verb, label) {
  return `${verb} ${label.toLowerCase()}`
}
