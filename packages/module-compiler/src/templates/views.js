import { moduleSlug, permKey, toKebab } from './helpers.js'

export function generateTableView(config, entity) {
  const slug = moduleSlug(config.key)
  const apiPath = `/${slug}/${entity.name}s`
  const viewKey = `${slug}.${entity.name}.table`
  const labelPlural = entity.labelPlural || entity.label + 's'

  const columns = entity.fields
    .slice(0, 5)
    .map((f) => {
      const typeHint = getColumnTypeHint(f.type)
      const base = `      { field: '${f.name}', label: '${f.label || f.name}', sortable: true`
      return typeHint ? base + `, type: '${typeHint}' },` : base + ' },'
    })
    .join('\n')

  return `import { defineView } from '@runly/module-engine'

export default defineView({
  key: '${viewKey}',
  kind: 'TABLE',
  version: '0.1.0',
  schema: {
    entity: '${entity.name}',
    component: 'RunlyTable',
    apiPath: '${apiPath}',
    searchable: true,
    searchPlaceholder: 'Buscar ${entity.label.toLowerCase()}...',
    columns: [
${columns}
    ],
    actions: [
      { label: 'Crear ${entity.label.toLowerCase()}', permission: '${permKey(slug, entity.name, 'create')}', variant: 'primary' },
    ],
    rowActions: [
      { label: 'Ver detalle', permission: '${permKey(slug, entity.name, 'read')}' },
      { label: 'Editar',      permission: '${permKey(slug, entity.name, 'update')}' },
      { label: 'Desactivar',  permission: '${permKey(slug, entity.name, 'delete')}' },
    ],
    emptyState: {
      message: 'No hay ${labelPlural.toLowerCase()} registradas.',
    },
  },
})
`
}

export function generateFormView(config, entity) {
  const slug = moduleSlug(config.key)
  const apiPath = `/${slug}/${entity.name}s`
  const viewKey = `${slug}.${entity.name}.form`

  const fields = entity.fields
    .map((f) => {
      const lines = [
        `        field: '${f.name}'`,
        `        label: '${f.label || f.name}'`,
        `        type: '${mapFormFieldType(f.type)}'`,
      ]
      if (f.required) lines.push('        required: true')
      if (f.type === 'select' && Array.isArray(f.options)) {
        const opts = f.options.map((o) => JSON.stringify(o)).join(', ')
        lines.push(`        options: [${opts}]`)
      }
      if (f.type === 'relation') {
        lines.push(`        relation: { apiPath: '/${slug}/${f.relatedModel ? f.relatedModel.split('.').pop() + 's' : f.name + 's'}', labelField: 'name', clearable: true }`)
      }
      return '      {\n' + lines.map((l) => '    ' + l + ',').join('\n') + '\n      },'
    })
    .join('\n')

  return `import { defineView } from '@runly/module-engine'

export default defineView({
  key: '${viewKey}',
  kind: 'FORM',
  version: '0.1.0',
  schema: {
    entity: '${entity.name}',
    component: 'RunlyForm',
    apiPath: '${apiPath}',
    sections: [
      {
        label: '${entity.label}',
        fields: [
${fields}
        ],
      },
    ],
    submitLabel: 'Guardar ${entity.label.toLowerCase()}',
    cancelLabel: 'Cancelar',
  },
})
`
}

export function generateDetailView(config, entity) {
  const slug = moduleSlug(config.key)
  const apiPath = `/${slug}/${entity.name}s`
  const viewKey = `${slug}.${entity.name}.detail`

  const fields = entity.fields
    .map((f) => {
      const typeHint = getDetailTypeHint(f.type)
      const base = `      { field: '${f.name}', label: '${f.label || f.name}'`
      return typeHint ? base + `, type: '${typeHint}' },` : base + ' },'
    })
    .join('\n')

  return `import { defineView } from '@runly/module-engine'

export default defineView({
  key: '${viewKey}',
  kind: 'DETAIL',
  version: '0.1.0',
  schema: {
    entity: '${entity.name}',
    component: 'RunlyDetail',
    apiPath: '${apiPath}',
    sections: [
      {
        label: '${entity.label}',
        columns: 2,
        fields: [
${fields}
        ],
      },
    ],
    actions: [
      { label: 'Editar',     permission: '${permKey(slug, entity.name, 'update')}' },
      { label: 'Desactivar', permission: '${permKey(slug, entity.name, 'delete')}' },
    ],
  },
})
`
}

export function generatePageView(config, entity) {
  const slug = moduleSlug(config.key)
  const pageKey = `${slug}.${entity.name}.page`
  const tableKey = `${slug}.${entity.name}.table`
  const path = `/app/m/${config.key}/${slug}-${toKebab(entity.name)}s`
  const labelPlural = entity.labelPlural || entity.label + 's'

  return `import { definePage } from '@runly/module-engine'

export default definePage({
  key: '${pageKey}',
  path: '${path}',
  title: '${labelPlural}',
  layout: 'main',
  view: '${tableKey}',
})
`
}

function getColumnTypeHint(type) {
  const map = { boolean: 'boolean', date: 'date', datetime: 'datetime', decimal: 'currency', number: 'number', color: 'color' }
  return map[type] || null
}

function getDetailTypeHint(type) {
  const map = { boolean: 'boolean', date: 'date', datetime: 'datetime', decimal: 'currency', number: 'number', color: 'color', markdown: 'markdown', richtext: 'richtext' }
  return map[type] || null
}

function mapFormFieldType(type) {
  const map = { textarea: 'textarea', number: 'number', decimal: 'decimal', boolean: 'boolean', select: 'select', multiselect: 'multiselect', date: 'date', datetime: 'datetime', email: 'email', phone: 'phone', relation: 'relation', file: 'file', json: 'json', markdown: 'markdown', color: 'color', richtext: 'richtext' }
  return map[type] || 'text'
}
