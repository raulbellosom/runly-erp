// Declarative preview for the Module Builder (Etapa 13). Renders a
// normalized ModuleDefinition view against synthetic sample rows generated
// purely from field types — no database, no temporary install, no arbitrary
// code execution. Per
// docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md
// §21 ("Preview"), this never writes to the module root or touches
// production tables.
import { toLocalIso } from '@runly/core'

const SAMPLE_ROW_COUNT = 5

function sampleValueForField(field, rowIndex) {
  const n = rowIndex + 1
  switch (field.type) {
    case 'text': return `${field.label ?? 'Ejemplo'} ${n}`
    case 'textarea': return `Descripción de ejemplo para el registro ${n}.`
    case 'number': return 100 + n * 5
    case 'decimal': return Number((99.5 + n * 1.25).toFixed(2))
    case 'boolean': return n % 2 === 0
    case 'select': {
      const options = field.options ?? []
      if (!options.length) return null
      const option = options[n % options.length]
      return typeof option === 'string' ? option : option.value
    }
    case 'multiselect': {
      const options = field.options ?? []
      if (!options.length) return []
      const option = options[n % options.length]
      return [typeof option === 'string' ? option : option.value]
    }
    case 'date': {
      const d = new Date()
      d.setDate(d.getDate() - n)
      return toLocalIso(d)
    }
    case 'datetime': {
      const d = new Date()
      d.setHours(d.getHours() - n)
      return d.toISOString()
    }
    case 'email': return `ejemplo${n}@correo.com`
    case 'phone': return `+52 55 0000 00${String(n).padStart(2, '0')}`
    case 'relation': return { id: `preview-${field.key}-${n}`, label: `Relacionado #${n}` }
    case 'file': return null
    case 'json': return {}
    case 'markdown': return `**Ejemplo ${n}**\n\nTexto de muestra.`
    case 'color': return ['#2563EB', '#16A34A', '#DC2626', '#D97706', '#7C3AED'][n % 5]
    case 'richtext': return `<p>Contenido de ejemplo ${n}.</p>`
    default: return null
  }
}

export function generateSampleRows(entity, count = SAMPLE_ROW_COUNT) {
  const fields = entity.fields ?? []
  return Array.from({ length: count }, (_, index) => {
    const row = {
      id: `preview-${entity.key}-${index + 1}`,
      created_at: new Date(Date.now() - index * 86400000).toISOString(),
      updated_at: new Date(Date.now() - index * 43200000).toISOString(),
      enabled: true,
    }
    for (const field of fields) row[field.key] = field.default ?? sampleValueForField(field, index)
    return row
  })
}

function findEntity(definition, entityKey) {
  return (definition.entities ?? []).find((entity) => entity.key === entityKey) ?? null
}

// Returns everything the Builder preview panel needs to render one view:
// the normalized view schema, its owning entity (when applicable) and
// synthetic rows shaped like real API responses for that entity.
export function buildPreview(definition, viewKey) {
  const views = definition.views ?? []
  const view = viewKey ? views.find((item) => item.key === viewKey) : views[0]
  if (!view) {
    const error = new Error('VIEW_NOT_FOUND')
    error.code = 'BUILDER_PREVIEW_VIEW_NOT_FOUND'
    throw error
  }
  const entityKey = view.entity ?? view.schema?.entity ?? null
  const entity = entityKey ? findEntity(definition, entityKey) : null
  const rows = entity ? generateSampleRows(entity) : []
  return {
    view,
    entity,
    rows,
    availableViews: views.map((item) => ({ key: item.key, kind: item.kind, entity: item.entity ?? item.schema?.entity ?? null })),
  }
}
