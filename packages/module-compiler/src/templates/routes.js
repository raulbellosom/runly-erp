import { toPascal, moduleSlug, permKey } from './helpers.js'

export function generateRoutes(config, entity) {
  const slug = moduleSlug(config.key)
  const pascal = toPascal(entity.name)
  const errorClass = toPascal(slug) + 'ServiceError'
  const base = `/${slug}/${entity.name}s`
  const softDelete = entity.softDelete !== false
  const companyScoped = entity.companyScoped !== false

  const selectFields = entity.fields.filter((f) => f.type === 'select')
  const filterQueryParams = selectFields.map((f) => '    const ' + f.name + ' = c.req.query(\'' + f.name + '\')').join('\n')
  const filterServiceParams = selectFields.map((f) => ' ' + f.name + ': ' + f.name + ',').join('')

  const listParams = ['page: c.req.query(\'page\')', 'pageSize: c.req.query(\'pageSize\')', 'search: c.req.query(\'search\')']
  if (filterServiceParams) listParams.push(filterServiceParams.trim().replace(/,$/, ''))

  return `import { Hono } from 'hono'
import { z } from 'zod'
import { create${pascal}Schema, update${pascal}Schema } from '../validators/index.js'
import { create${pascal}Service } from './${entity.name}-service.js'
import { ${errorClass} } from './service-helpers.js'

const enabledSchema = z.object({ enabled: z.boolean() })

function getValidationErrorMessage(error) {
  const issue = error?.issues?.[0]
  if (!issue) return 'Datos invalidos.'
  const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : null
  return path ? \`Datos invalidos en \${path}: \${issue.message}\` : \`Datos invalidos: \${issue.message}\`
}

function getCompanyIdFromContext(c) {
  const companyId = c.get('userContext')?.memberships?.[0]?.companyId
  return typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null
}

function getActorIdFromContext(c) {
  const actorId = c.get('userContext')?.profile?.id
  return typeof actorId === 'string' && actorId.trim() ? actorId.trim() : null
}

function handleRouteError(c, err, { fallbackError, route, moduleKey, operation }) {
  if (err instanceof ${errorClass}) return c.json({ error: err.message }, err.status)
  if (process.env.NODE_ENV !== 'production') {
    console.error('[${config.key}] route error', { route, moduleKey, operation, error: { name: err?.name, message: err?.message, stack: err?.stack } })
  }
  return c.json({ error: fallbackError }, 500)
}

export function create${pascal}Router({ prisma, requirePermission, moduleContext }) {
  const app = new Hono()
  const service = create${pascal}Service({ prisma })
  const moduleKey = moduleContext?.moduleKey ?? '${config.key}'

  app.get('${base}', requirePermission('${permKey(slug, entity.name, 'read')}'), async (c) => {
    try {
      const companyId = getCompanyIdFromContext(c)
${filterQueryParams ? filterQueryParams + '\n' : ''}      const result = await service.list${pascal}s({ companyId, ${listParams.join(', ')} })
      return c.json(result)
    } catch (err) {
      return handleRouteError(c, err, { fallbackError: 'No se pudieron listar los registros.', route: '${base}', moduleKey, operation: 'list${pascal}s' })
    }
  })

  app.get('${base}/:id', requirePermission('${permKey(slug, entity.name, 'read')}'), async (c) => {
    try {
      const companyId = getCompanyIdFromContext(c)
      const row = await service.get${pascal}ById({ companyId, id: c.req.param('id') })
      return c.json({ data: row })
    } catch (err) {
      return handleRouteError(c, err, { fallbackError: 'No se pudo obtener el registro.', route: '${base}/:id', moduleKey, operation: 'get${pascal}ById' })
    }
  })

  app.post('${base}', requirePermission('${permKey(slug, entity.name, 'create')}'), async (c) => {
    try {
      const companyId = getCompanyIdFromContext(c)
      const actorId = getActorIdFromContext(c)
      const body = await c.req.json()
      const parsed = create${pascal}Schema.safeParse(body)
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const created = await service.create${pascal}({ companyId, data: parsed.data, actorId })
      return c.json({ data: created }, 201)
    } catch (err) {
      return handleRouteError(c, err, { fallbackError: 'No se pudo crear el registro.', route: '${base}', moduleKey, operation: 'create${pascal}' })
    }
  })

  app.patch('${base}/:id', requirePermission('${permKey(slug, entity.name, 'update')}'), async (c) => {
    try {
      const companyId = getCompanyIdFromContext(c)
      const actorId = getActorIdFromContext(c)
      const body = await c.req.json()
      const parsed = update${pascal}Schema.safeParse(body)
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const updated = await service.update${pascal}({ companyId, id: c.req.param('id'), data: parsed.data, actorId })
      return c.json({ data: updated })
    } catch (err) {
      return handleRouteError(c, err, { fallbackError: 'No se pudo actualizar el registro.', route: '${base}/:id', moduleKey, operation: 'update${pascal}' })
    }
  })
${softDelete ? `
  app.patch('${base}/:id/enabled', requirePermission('${permKey(slug, entity.name, 'delete')}'), async (c) => {
    try {
      const companyId = getCompanyIdFromContext(c)
      const actorId = getActorIdFromContext(c)
      const body = await c.req.json()
      const parsed = enabledSchema.safeParse(body)
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const updated = await service.set${pascal}Enabled({ companyId, id: c.req.param('id'), enabled: parsed.data.enabled, actorId })
      return c.json({ data: updated })
    } catch (err) {
      return handleRouteError(c, err, { fallbackError: 'No se pudo actualizar el estado del registro.', route: '${base}/:id/enabled', moduleKey, operation: 'set${pascal}Enabled' })
    }
  })
` : ''}
  return app
}
`
}
