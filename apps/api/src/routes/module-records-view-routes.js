// POST /modules/:key/records-view/query — data for CARDS / CALENDAR /
// TIMELINE / REPORT views. Kept out of modules.js (already far past the file
// size limit); registered from createModulesRouter next to the Kanban query.
import { RECORDS_VIEW_KINDS } from '@runly/module-engine'
import { createModuleRecordsViewQueryService } from '../services/module-records-view-query-service.js'

const CLIENT_ERRORS = new Set(['INVALID_RANGE', 'UNKNOWN_FIELD', 'INVALID_DATE_FIELD', 'INVALID_ORDER_FIELD', 'INVALID_FILTER', 'AGGREGATE_TYPE_MISMATCH', 'INVALID_RECORDS_VIEW'])

export function registerRecordsViewRoutes(app, { prisma, authMiddleware, requirePermission }) {
  const querySvc = createModuleRecordsViewQueryService({ prisma })

  app.post('/:key/records-view/query', authMiddleware, async (c) => {
    try {
      const moduleKey = c.req.param('key')
      const body = await c.req.json()
      const view = await prisma.runlyView.findFirst({
        where: { moduleKey, key: body?.viewKey, type: { in: [...RECORDS_VIEW_KINDS] }, enabled: true },
        select: { key: true, type: true, schema: true },
      })
      if (!view) return c.json({ error: 'Vista no encontrada.' }, 404)
      const slug = moduleKey.split('.').at(-1)
      const permissionKey = view.schema?.permissionKey ?? `${slug}.${view.schema?.entity}.read`
      let allowed = false
      const denial = await requirePermission(permissionKey)(c, async () => { allowed = true })
      if (!allowed) return denial
      const data = await querySvc.queryView({ moduleKey, kind: view.type, schema: view.schema, companyId: c.get('companyId'), range: body?.range })
      return c.json({ data: { kind: view.type, ...data } })
    } catch (error) {
      if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400)
      if (CLIENT_ERRORS.has(error?.code)) return c.json({ error: 'La vista no es válida.', code: error.code, details: error.details ?? null }, 422)
      console.error('[modules.records-view.query]', error?.code ?? error?.message)
      return c.json({ error: 'No se pudo consultar la vista.' }, 500)
    }
  })
}
