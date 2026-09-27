import { moduleSlug } from './helpers.js'

export function generateModel(config, entity) {
  const slug = moduleSlug(config.key)
  const table = `${slug}_${entity.name}`
  const modelKey = `${slug}.${entity.name}`
  const companyScoped = entity.companyScoped !== false
  const softDelete = entity.softDelete !== false

  const fieldLines = entity.fields
    .map((f) => fieldToDefineModelField(f))
    .join('\n')

  const indexLines = buildDefaultIndexes(entity, companyScoped)

  return `import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: '${entity.name}',
  name: '${modelKey}',
  label: '${entity.label}',
  tableName: '${table}',
  companyScoped: ${companyScoped},
  softDelete: ${softDelete},
  fields: [
${fieldLines}
  ],${indexLines}
})
`
}

function fieldToDefineModelField(field) {
  const parts = [`    name: '${field.name}'`, `    type: '${field.type}'`, `    label: '${field.label || field.name}'`]
  if (field.required) parts.push('    required: true')
  if (field.maxLength) parts.push(`    maxLength: ${field.maxLength}`)
  if (field.default !== undefined) {
    const val = typeof field.default === 'string' ? `'${field.default}'` : JSON.stringify(field.default)
    parts.push(`    default: ${val}`)
  }
  if (Array.isArray(field.options) && field.options.length > 0) {
    const opts = field.options.map((o) => JSON.stringify(o)).join(', ')
    parts.push(`    options: [${opts}]`)
  }
  if (field.relatedModel) parts.push(`    relatedModel: '${field.relatedModel}'`)

  return '  {\n' + parts.map((p) => '  ' + p).join(',\n') + ',\n  },'
}

function buildDefaultIndexes(entity, companyScoped) {
  if (!companyScoped) return ''

  const requiredFields = entity.fields.filter((f) => f.required && f.type !== 'relation' && f.type !== 'file')
  const indexEntries = []

  if (requiredFields.length > 0) {
    const first = requiredFields[0]
    indexEntries.push(`    { fields: ['company_id', '${first.name}'], unique: false },`)
  }

  const selectFields = entity.fields.filter((f) => f.type === 'select')
  for (const sf of selectFields) {
    indexEntries.push(`    { fields: ['company_id', '${sf.name}'] },`)
  }

  if (indexEntries.length === 0) return ''

  return `
  indexes: [
${indexEntries.join('\n')}
  ],`
}
