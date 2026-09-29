// Builder public links (definition.publicLinks): a public record card
// (mode 'view') or a public form that creates a record of another entity
// (mode 'submit'). Compiles to manifest `publicResources`, one public CUSTOM
// view per link and api/public.js. Spec section 7 of
// docs/superpowers/specs/2026-09-28-module-public-links-design.md.
import { moduleSlug, permKey, toKebab, toPascal } from './templates/helpers.js'
import { isSameModuleRelation } from './relations.js'
import { hasConditionalRequired } from './templates/visibility.js'

export const PUBLIC_LINKS_MAX = 10
const MAX_FIELDS = 30
const LINK_KEY = /^[a-z][a-z0-9_]{1,40}$/
const DISPLAY_EXCLUDED_TYPES = new Set(['file', 'json'])
const FORM_TYPES = new Set(['text', 'textarea', 'markdown', 'number', 'decimal', 'boolean', 'select', 'multiselect', 'date', 'datetime', 'email', 'phone'])
const UNSAFE_TEXT = /[\u0000]/

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

const fieldKey = (field) => field.key ?? field.name
const entityKey = (entity) => entity.key ?? entity.name

export function isDisplayableField(field) {
  if (DISPLAY_EXCLUDED_TYPES.has(field.type)) return false
  if (field.type === 'relation') return isSameModuleRelation(field)
  return true
}

export function isPublicFormField(field) {
  return FORM_TYPES.has(field.type)
}

export function validatePublicLinks(definition, permissionKeys, errors) {
  const links = definition.publicLinks
  if (links === undefined || links === null) return
  if (!Array.isArray(links)) { errors.push(diagnostic('publicLinks', 'PUBLIC_LINKS_INVALID', 'publicLinks must be an array.')); return }
  if (links.length > PUBLIC_LINKS_MAX) errors.push(diagnostic('publicLinks', 'PUBLIC_LINKS_TOO_MANY', `At most ${PUBLIC_LINKS_MAX} public links.`))
  const entities = new Map((definition.entities ?? []).map((entity) => [entityKey(entity), entity]))
  const slug = moduleSlug(definition.key ?? 'custom.invalid')
  const seen = new Set()
  links.forEach((link, index) => {
    const base = `publicLinks[${index}]`
    const err = (suffix, code, message) => errors.push(diagnostic(`${base}${suffix}`, code, message))
    if (!link || typeof link !== 'object') { err('', 'PUBLIC_LINK_INVALID', 'Public link must be an object.'); return }
    if (!LINK_KEY.test(link.key ?? '')) err('.key', 'PUBLIC_LINK_KEY_INVALID', 'Key must be 2-41 lowercase letters, digits or underscores.')
    else if (seen.has(link.key)) err('.key', 'PUBLIC_LINK_DUPLICATE', `Duplicate public link "${link.key}".`)
    seen.add(link.key)
    if (!['view', 'submit'].includes(link.mode)) err('.mode', 'PUBLIC_LINK_MODE_INVALID', 'Mode must be view or submit.')
    for (const prop of ['title', 'description', 'submitLabel', 'successMessage']) {
      if (link[prop] !== undefined && (typeof link[prop] !== 'string' || UNSAFE_TEXT.test(link[prop]) || link[prop].length > 300)) err(`.${prop}`, 'UNSAFE_SOURCE_TEXT', `${prop} must be plain text up to 300 characters.`)
    }
    if (!String(link.title ?? '').trim()) err('.title', 'REQUIRED', 'Public link needs a title.')
    const entity = entities.get(link.entity)
    if (!entity) { err('.entity', 'PUBLIC_LINK_ENTITY_NOT_FOUND', `Entity "${link.entity}" does not exist.`); return }
    if (entity.companyScoped === false) err('.entity', 'PUBLIC_LINK_NOT_COMPANY_SCOPED', 'Shared entity must be company scoped.')
    if (!permissionKeys.has(permKey(slug, link.entity, 'update'))) err('.entity', 'UNKNOWN_PERMISSION', `Permission "${permKey(slug, link.entity, 'update')}" is not declared by the module.`)
    const fields = Array.isArray(link.fields) ? link.fields : []
    if (link.fields !== undefined && !Array.isArray(link.fields)) err('.fields', 'PUBLIC_LINK_FIELDS_INVALID', 'fields must be an array.')
    if (fields.length > MAX_FIELDS) err('.fields', 'PUBLIC_LINK_TOO_MANY_FIELDS', `At most ${MAX_FIELDS} fields.`)
    if (link.mode === 'view' && fields.length === 0) err('.fields', 'PUBLIC_LINK_FIELDS_REQUIRED', 'A public card needs at least one field.')
    const byKey = new Map(entity.fields.map((field) => [fieldKey(field), field]))
    fields.forEach((key, fieldIndex) => {
      const field = byKey.get(key)
      if (!field) err(`.fields[${fieldIndex}]`, 'PUBLIC_LINK_FIELD_NOT_FOUND', `Field "${key}" does not exist in ${link.entity}.`)
      else if (!isDisplayableField(field)) err(`.fields[${fieldIndex}]`, 'PUBLIC_LINK_FIELD_NOT_ALLOWED', `Field "${key}" cannot be shown publicly.`)
    })
    if (link.mode !== 'submit') return
    const target = entities.get(link.targetEntity)
    if (!target) { err('.targetEntity', 'PUBLIC_LINK_ENTITY_NOT_FOUND', `Entity "${link.targetEntity}" does not exist.`); return }
    if (target.companyScoped === false) err('.targetEntity', 'PUBLIC_LINK_NOT_COMPANY_SCOPED', 'Form entity must be company scoped.')
    const targetFields = new Map(target.fields.map((field) => [fieldKey(field), field]))
    const formFields = Array.isArray(link.formFields) ? link.formFields : []
    if (formFields.length === 0) err('.formFields', 'PUBLIC_LINK_FIELDS_REQUIRED', 'A public form needs at least one field.')
    if (formFields.length > MAX_FIELDS) err('.formFields', 'PUBLIC_LINK_TOO_MANY_FIELDS', `At most ${MAX_FIELDS} fields.`)
    formFields.forEach((key, fieldIndex) => {
      const field = targetFields.get(key)
      if (!field) err(`.formFields[${fieldIndex}]`, 'PUBLIC_LINK_FIELD_NOT_FOUND', `Field "${key}" does not exist in ${link.targetEntity}.`)
      else if (!isPublicFormField(field)) err(`.formFields[${fieldIndex}]`, 'PUBLIC_LINK_FIELD_NOT_ALLOWED', `Field "${key}" cannot be filled in a public form.`)
      else if (key === link.linkField) err(`.formFields[${fieldIndex}]`, 'PUBLIC_LINK_FIELD_NOT_ALLOWED', 'The link field is filled automatically.')
    })
    if (link.linkField) {
      const linkField = targetFields.get(link.linkField)
      if (!linkField || !isSameModuleRelation(linkField) || linkField.targetEntity !== link.entity) {
        err('.linkField', 'PUBLIC_LINK_LINK_FIELD_INVALID', `linkField must be a relation of ${link.targetEntity} to ${link.entity}.`)
      }
    }
    for (const field of target.fields) {
      const key = fieldKey(field)
      if (field.required && key !== link.linkField && !formFields.includes(key)) {
        err('.formFields', 'PUBLIC_LINK_REQUIRED_FIELD_MISSING', `Required field "${key}" of ${link.targetEntity} must be in the form.`)
      }
    }
  })
}

// ---- generators ----------------------------------------------------------

export function publicLinkViewKey(definition, link) {
  return `${moduleSlug(definition.key)}.${link.key}.public`
}

export function publicLinkViewFile(link) {
  return `views/${link.key}.public.js`
}

export function publicLinkPath(definition, link) {
  return `/p/${moduleSlug(definition.key)}/${toKebab(link.key)}`
}

function entityOf(definition, key) {
  return definition.entities.find((entity) => entityKey(entity) === key)
}

function fieldMeta(entity, key) {
  const field = entity.fields.find((item) => fieldKey(item) === key)
  const options = field.options?.map((option) => (typeof option === 'string' ? { value: option, label: option } : { value: option.value, label: option.label ?? option.value }))
  return {
    key,
    label: field.label ?? key,
    type: field.type,
    ...(field.required ? { required: true } : {}),
    ...(options?.length ? { options } : {}),
  }
}

export function generatePublicResources(definition) {
  const slug = moduleSlug(definition.key)
  return (definition.publicLinks ?? []).map((link) => ({
    key: link.key,
    entity: link.entity,
    mode: link.mode,
    view: publicLinkViewKey(definition, link),
    title: link.title,
    managePermission: permKey(slug, link.entity, 'update'),
  }))
}

export function generatePublicLinkView(definition, link) {
  const entity = entityOf(definition, link.entity)
  const target = link.mode === 'submit' ? entityOf(definition, link.targetEntity) : null
  const schema = {
    path: publicLinkPath(definition, link),
    public: true,
    component: 'runly.public:RecordPage',
    title: link.title,
    publicPage: {
      resource: link.key,
      mode: link.mode,
      title: link.title,
      description: link.description ?? '',
      display: (link.fields ?? []).map((key) => fieldMeta(entity, key)),
      form: target ? link.formFields.map((key) => fieldMeta(target, key)) : [],
      submitLabel: link.submitLabel || 'Enviar',
      successMessage: link.successMessage || 'Gracias. Recibimos tu información.',
    },
  }
  return `import { defineView } from '@runly/module-engine'

// Generated by the Module Builder (public link "${link.key}").
export default defineView(${JSON.stringify({ key: publicLinkViewKey(definition, link), kind: 'CUSTOM', version: '0.1.0', schema }, null, 2)})
`
}

export function generatePublicApi(definition) {
  const links = definition.publicLinks ?? []
  const entityKeys = [...new Set(links.flatMap((link) => [link.entity, link.mode === 'submit' ? link.targetEntity : null]).filter(Boolean))]
  const targetKeys = [...new Set(links.filter((link) => link.mode === 'submit').map((link) => link.targetEntity))]
  const imports = [
    "import { Hono } from 'hono'",
    ...entityKeys.map((key) => `import { create${toPascal(key)}Service } from './${key}-service.js'`),
  ]
  if (targetKeys.length) imports.push(`import { ${targetKeys.map((key) => `create${toPascal(key)}Schema`).join(', ')} } from '../validators/index.js'`)
  for (const key of targetKeys) {
    const target = entityOf(definition, key)
    if (hasConditionalRequired(target)) imports.push(`import { findMissingConditionalRequired as missing${toPascal(key)} } from './${key}-visibility.js'`)
  }
  const config = Object.fromEntries(links.map((link) => {
    const entity = entityOf(definition, link.entity)
    const target = link.mode === 'submit' ? entityOf(definition, link.targetEntity) : null
    const relationFields = (link.fields ?? []).filter((key) => entity.fields.find((field) => fieldKey(field) === key)?.type === 'relation')
    return [link.key, {
      entity: link.entity,
      mode: link.mode,
      fields: link.fields ?? [],
      relationFields,
      ...(target ? {
        targetEntity: link.targetEntity,
        formFields: link.formFields,
        linkField: link.linkField || null,
        labels: Object.fromEntries(link.formFields.map((key) => [key, fieldMeta(target, key).label])),
      } : {}),
    }]
  }))
  const getters = entityKeys.map((key) => `    ${key}: (args) => services.${key}.get${toPascal(key)}ById(args),`).join('\n')
  const creators = targetKeys.map((key) => {
    const pascal = toPascal(key)
    const target = entityOf(definition, key)
    return `    ${key}: { schema: create${pascal}Schema, create: (args) => services.${key}.create${pascal}(args)${hasConditionalRequired(target) ? `, missing: missing${pascal}` : ''} },`
  }).join('\n')
  return `// Generated by the Module Builder: public link routes, served only through
// /public/m/<moduleKey>/<token>/* (docs/ai-context/rme3-public-links.md).
${imports.join('\n')}

const LINKS = ${JSON.stringify(config, null, 2)}

function pick(row, fields, relationFields) {
  const out = {}
  for (const key of fields) out[key] = relationFields.includes(key) ? (row[key + '__label'] ?? null) : (row[key] ?? null)
  return out
}

export default function createPublicRouter({ prisma }) {
  const app = new Hono()
  const services = {
${entityKeys.map((key) => `    ${key}: create${toPascal(key)}Service({ prisma }),`).join('\n')}
  }
  const getters = {
${getters}
  }
  const creators = {
${creators}
  }

  function resolve(c) {
    const publicLink = c.get('publicLink')
    return { publicLink, config: LINKS[publicLink?.resource] ?? null }
  }

  async function loadRecord(publicLink, config) {
    if (!publicLink.recordId) return null
    return getters[config.entity]({ companyId: publicLink.companyId, id: publicLink.recordId })
  }

  app.get('/record', async (c) => {
    const { publicLink, config } = resolve(c)
    if (!config) return c.json({ error: 'No encontrado.' }, 404)
    try {
      const row = await loadRecord(publicLink, config)
      return c.json({ data: row ? pick(row, config.fields, config.relationFields) : null })
    } catch (err) {
      return c.json({ error: 'Registro no disponible.' }, err?.status === 404 ? 404 : 500)
    }
  })

  app.post('/submit', async (c) => {
    const { publicLink, config } = resolve(c)
    if (!config || config.mode !== 'submit') return c.json({ error: 'No encontrado.' }, 404)
    try {
      await loadRecord(publicLink, config)
    } catch (err) {
      return c.json({ error: 'Registro no disponible.' }, err?.status === 404 ? 404 : 500)
    }
    const body = c.get('publicBody') ?? {}
    const data = {}
    for (const key of config.formFields) {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') data[key] = body[key]
    }
    if (config.linkField && publicLink.recordId) data[config.linkField] = publicLink.recordId
    const creator = creators[config.targetEntity]
    const parsed = creator.schema.safeParse(data)
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path?.[0]
      return c.json({ error: config.labels[field] ? 'Revisa el campo ' + config.labels[field] + '.' : 'Revisa los datos del formulario.' }, 400)
    }
    const missing = creator.missing ? creator.missing(parsed.data) : null
    if (missing) return c.json({ error: 'El campo ' + missing.label + ' es requerido.' }, 400)
    try {
      await creator.create({ companyId: publicLink.companyId, data: parsed.data, actorId: null })
      return c.json({ ok: true }, 201)
    } catch (err) {
      const status = Number(err?.status)
      if (status >= 400 && status < 500) return c.json({ error: err.message }, status)
      console.error('[public-link]', err?.message)
      return c.json({ error: 'No se pudo enviar. Intenta de nuevo.' }, 500)
    }
  })

  return app
}
`
}
