import { Hono } from 'hono'
import { createTypeSchema, updateTypeSchema, enabledSchema } from './validators.js'
import { createTypesService } from './types-service.js'
import { LedgerServiceError } from './ledger-service.js'
import { getCompanyId, getValidationErrorMessage } from './service-helpers.js'

function handleError(c, err, fallback) {
  if (err instanceof LedgerServiceError) return c.json({ error: err.message }, err.status)
  if (err instanceof SyntaxError) return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger:types]', err)
  return c.json({ error: fallback }, 500)
}

export function createTypesRouter({ prisma, requirePermission, requireAnyPermission }) {
  const app     = new Hono()
  const service = createTypesService({ prisma })
  const canRead = requireAnyPermission(['ledger.types.read', 'ledger.types.manage'])

  app.get('/ledger/types', canRead, async (c) => {
    try { return c.json(await service.listTypes({ companyId: getCompanyId(c) })) }
    catch (err) { return handleError(c, err, 'No se pudieron listar los tipos.') }
  })

  app.post('/ledger/types', requirePermission('ledger.types.manage'), async (c) => {
    try {
      const parsed = createTypeSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      return c.json({ data: await service.createType({ companyId: getCompanyId(c), data: parsed.data }) }, 201)
    } catch (err) { return handleError(c, err, 'No se pudo crear el tipo.') }
  })

  app.get('/ledger/types/:id', canRead, async (c) => {
    try { return c.json({ data: await service.getType({ companyId: getCompanyId(c), typeId: c.req.param('id') }) }) }
    catch (err) { return handleError(c, err, 'No se pudo obtener el tipo.') }
  })

  app.patch('/ledger/types/:id', requirePermission('ledger.types.manage'), async (c) => {
    try {
      const parsed = updateTypeSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      return c.json({ data: await service.updateType({ companyId: getCompanyId(c), typeId: c.req.param('id'), data: parsed.data }) })
    } catch (err) { return handleError(c, err, 'No se pudo actualizar el tipo.') }
  })

  app.patch('/ledger/types/:id/enabled', requirePermission('ledger.types.manage'), async (c) => {
    try {
      const parsed = enabledSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: 'Se requiere { enabled: boolean }.' }, 400)
      return c.json({ data: await service.setTypeEnabled({ companyId: getCompanyId(c), typeId: c.req.param('id'), enabled: parsed.data.enabled }) })
    } catch (err) { return handleError(c, err, 'No se pudo actualizar el estado del tipo.') }
  })

  return app
}
