// Starter ModuleDefinition factories for the Module Builder's "Crear módulo"
// template picker (Etapa 19). Each factory returns a plain, JSON-compatible
// object shaped like @runly/module-compiler's ModuleDefinition v1 input —
// there is no separate template engine; normalizeModuleDefinition() (called
// by module-builder-service.js on every read/save) fills in defaults
// (permissions, generated views, navigation) the same way it does for any
// other draft. Keeping these as data factories, not code generators, means
// the scaffolder's createCrudDefinition()/createCrudCustomDefinition() stay
// the only place that turns a definition into files.
export const BUILDER_TEMPLATE_KEYS = ['blank', 'simple-crud', 'inventory-lite']

function baseMeta({ moduleKey, name, description, icon, color, startPath }) {
  return {
    schemaVersion: 1,
    key: moduleKey,
    name,
    version: '0.1.0',
    description: description ?? '',
    icon: icon ?? 'Boxes',
    color: color ?? '#2563EB',
    pwa: { shortName: name.slice(0, 14), startPath: startPath ?? `/${moduleKey.split('.').pop()}` },
    preset: 'crud',
    entities: [],
  }
}

export function blankTemplate({ moduleKey, name, description, icon, color }) {
  return baseMeta({ moduleKey, name, description, icon, color })
}

export function simpleCrudTemplate({ moduleKey, name, description, icon, color }) {
  return {
    ...baseMeta({ moduleKey, name, description, icon, color }),
    entities: [
      {
        key: 'item',
        label: 'Elemento',
        pluralLabel: 'Elementos',
        companyScoped: true,
        softDelete: true,
        fields: [
          { key: 'title', label: 'Título', type: 'text', required: true },
          { key: 'notes', label: 'Notas', type: 'textarea' },
          { key: 'active', label: 'Activo', type: 'boolean', default: true },
        ],
      },
    ],
  }
}

export function inventoryLiteTemplate({ moduleKey, name, description, icon, color }) {
  const statusOptions = [
    { value: 'ACTIVE', label: 'Activo' },
    { value: 'MAINTENANCE', label: 'Mantenimiento' },
    { value: 'INACTIVE', label: 'Baja' },
  ]
  return {
    ...baseMeta({ moduleKey, name, description, icon: icon ?? 'Package', color }),
    entities: [
      {
        key: 'item',
        label: 'Artículo',
        pluralLabel: 'Artículos',
        companyScoped: true,
        softDelete: true,
        fields: [
          { key: 'name', label: 'Nombre', type: 'text', required: true },
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'category', label: 'Categoría', type: 'select', options: [
            { value: 'GENERAL', label: 'General' },
            { value: 'ELECTRONICS', label: 'Electrónica' },
            { value: 'SUPPLIES', label: 'Insumos' },
          ] },
          { key: 'status', label: 'Estado', type: 'select', options: statusOptions, default: 'ACTIVE' },
          { key: 'quantity', label: 'Cantidad', type: 'number', default: 0 },
          { key: 'unit_cost', label: 'Costo unitario', type: 'decimal' },
        ],
      },
    ],
    // TABLE/FORM/DETAIL/PAGE are not listed here — normalizeModuleDefinition()
    // always generates one set per entity (see its comment in definition.js);
    // listing them here too would just be redundant with what the compiler
    // already emits for every entity.
    views: [
      {
        key: `${moduleKey.split('.').pop()}.item.kanban`,
        kind: 'KANBAN',
        entity: 'item',
        title: 'Tablero por estado',
        groupBy: 'status',
        card: { titleField: 'name', subtitleField: 'sku', badgeField: 'category' },
      },
      {
        key: `${moduleKey.split('.').pop()}.dashboard`,
        kind: 'DASHBOARD',
        title: name,
        widgets: [
          { key: 'total_items', type: 'stat', title: 'Total de artículos', source: { entity: 'item', aggregate: 'count' } },
          { key: 'by_status', type: 'chart', chart: 'bar', title: 'Por estado', source: { entity: 'item', aggregate: 'count', groupBy: 'status' } },
        ],
      },
    ],
  }
}

const TEMPLATE_FACTORIES = {
  blank: blankTemplate,
  'simple-crud': simpleCrudTemplate,
  'inventory-lite': inventoryLiteTemplate,
}

export function buildDefinitionFromTemplate(templateKey, meta) {
  const factory = TEMPLATE_FACTORIES[templateKey ?? 'blank']
  if (!factory) {
    const error = new Error(`Plantilla desconocida: ${templateKey}`)
    error.code = 'UNKNOWN_BUILDER_TEMPLATE'
    throw error
  }
  return factory(meta)
}
