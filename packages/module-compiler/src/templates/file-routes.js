import { toPascal, moduleSlug, permKey } from './helpers.js'
import { entityApiPath, entityFileType } from './layout-views.js'
import { FILE_MAX_SIZE_MB } from '../layout.js'

// Generated per entity that has a file field or an attachments section. All
// storage work goes through moduleContext.files (bound to this module's key
// by the API route loader); the entity's own permissions are the gate.
export function generateFileRoutes(config, entity) {
  const slug = moduleSlug(config.key)
  const pascal = toPascal(entity.name)
  const base = entityApiPath(config, entity)
  const read = permKey(slug, entity.name, 'read')
  const create = permKey(slug, entity.name, 'create')
  const update = permKey(slug, entity.name, 'update')
  const fileFields = entity.fields.filter((field) => field.type === 'file').map((field) => field.name)
  // Per-field upload rules enforced server-side; attachments (no field) use
  // the default 10 MB, any type.
  const fieldRules = Object.fromEntries(entity.fields.filter((field) => field.type === 'file').map((field) => [
    field.name,
    { maxSizeMB: field.maxSizeMB ?? FILE_MAX_SIZE_MB, image: field.accept === 'image' },
  ]))

  return `import { Hono } from 'hono'

const FILE_ENTITY_TYPE = '${entityFileType(config, entity)}'
const FILE_FIELDS = ${JSON.stringify(fileFields)}
const FIELD_RULES = ${JSON.stringify(fieldRules)}
const DEFAULT_RULE = { maxSizeMB: ${FILE_MAX_SIZE_MB}, image: false }

// Returns an error response when the upload breaks the target field's rules.
function checkUpload(c, file, fieldName) {
  if (!(file instanceof File) || file.size <= 0) return c.json({ error: 'Selecciona un archivo valido.' }, 400)
  const rule = fieldName ? FIELD_RULES[fieldName] : DEFAULT_RULE
  if (!rule) return c.json({ error: 'Campo de archivo desconocido.' }, 400)
  if (file.size > rule.maxSizeMB * 1024 * 1024) return c.json({ error: \`El archivo supera el limite de \${rule.maxSizeMB} MB.\` }, 413)
  if (rule.image && !String(file.type).startsWith('image/')) return c.json({ error: 'Selecciona una imagen.' }, 400)
  return null
}

function canWrite(c) {
  const tenant = c.get('tenantContext')
  return Boolean(tenant?.isAdmin || tenant?.permissionSet?.has('${create}') || tenant?.permissionSet?.has('${update}'))
}

function fileError(c, err, fallback) {
  if (Number.isInteger(err?.status)) return c.json({ error: err.message }, err.status)
  if (process.env.NODE_ENV !== 'production') console.error('[${config.key}] file route error', { message: err?.message })
  return c.json({ error: fallback }, 500)
}

// Associates every file field value of a saved record with the record, so
// the files show up in its attachments and are scoped to it.
export async function link${pascal}FileFields(c, moduleContext, record) {
  const files = moduleContext?.files
  if (!files || !record?.id) return
  for (const field of FILE_FIELDS) {
    if (!record[field]) continue
    try {
      await files.link(c, { fileId: record[field], entityType: FILE_ENTITY_TYPE, sourceEntityId: record.id })
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('[${config.key}] file link error', { field, message: err?.message })
    }
  }
}

export function create${pascal}FileRouter({ requirePermission, moduleContext }) {
  const app = new Hono()
  const files = moduleContext?.files ?? null
  const unavailable = (c) => c.json({ error: 'Los archivos no estan disponibles en esta instancia.' }, 501)

  app.post('${base}/files', requirePermission('${read}'), async (c) => {
    if (!files) return unavailable(c)
    if (!canWrite(c)) return c.json({ error: 'No tienes permiso para subir archivos.' }, 403)
    try {
      const body = await c.req.parseBody()
      const fieldName = typeof body.field === 'string' && body.field.trim() ? body.field.trim() : null
      const invalid = checkUpload(c, body.file, fieldName)
      if (invalid) return invalid
      const sourceEntityId = typeof body.entityId === 'string' && body.entityId.trim() ? body.entityId.trim() : null
      const asset = await files.upload(c, { file: body.file, entityType: FILE_ENTITY_TYPE, sourceEntityId })
      return c.json({ data: asset }, 201)
    } catch (err) {
      return fileError(c, err, 'No se pudo subir el archivo.')
    }
  })

  app.get('${base}/files/:fileId/signed-url', requirePermission('${read}'), async (c) => {
    if (!files) return unavailable(c)
    try {
      const data = await files.signedUrl(c, { fileId: c.req.param('fileId'), entityType: FILE_ENTITY_TYPE, variant: c.req.query('variant') })
      return c.json({ data })
    } catch (err) {
      return fileError(c, err, 'No se pudo generar el enlace del archivo.')
    }
  })

  app.get('${base}/:id/files', requirePermission('${read}'), async (c) => {
    if (!files) return unavailable(c)
    try {
      const data = await files.list(c, { entityType: FILE_ENTITY_TYPE, sourceEntityId: c.req.param('id') })
      return c.json({ data })
    } catch (err) {
      return fileError(c, err, 'No se pudieron cargar los archivos.')
    }
  })

  app.delete('${base}/:id/files/:fileId', requirePermission('${update}'), async (c) => {
    if (!files) return unavailable(c)
    try {
      await files.remove(c, { fileId: c.req.param('fileId'), entityType: FILE_ENTITY_TYPE, sourceEntityId: c.req.param('id') })
      return c.json({ data: { ok: true } })
    } catch (err) {
      return fileError(c, err, 'No se pudo quitar el archivo.')
    }
  })

  return app
}
`
}
