// GET /help/* — read-only module help/documentation endpoints. Every route
// is guarded by the single "runly.help.read" permission (granted to every
// user via BASE_PERMISSION_KEYS in index.js — help content is not sensitive
// business data, see docs/superpowers/specs/2026-09-26-module-help-system-design.md §18).
import { Hono } from 'hono'
import { helpSearchQuerySchema, helpResolvePathQuerySchema } from '@runly/validators'
import { createHelpService } from '../../services/help-service.js'

export function createHelpRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const helpService = createHelpService({ prisma })
  const guard = requirePermission('runly.help.read')

  app.get('/help/modules', guard, async (c) => {
    const data = await helpService.listModulesWithHelp()
    return c.json({ data })
  })

  app.get('/help/modules/:moduleKey', guard, async (c) => {
    const data = await helpService.getModuleHelp(c.req.param('moduleKey'))
    if (!data) return c.json({ error: 'Modulo no encontrado.' }, 404)
    return c.json({ data })
  })

  app.get('/help/resolve', guard, async (c) => {
    const parsed = helpResolvePathQuerySchema.safeParse({ path: c.req.query('path') })
    if (!parsed.success) return c.json({ error: 'path invalido.' }, 400)
    const data = await helpService.resolveHelp(parsed.data.path)
    return c.json({ data })
  })

  app.get('/help/search', guard, async (c) => {
    const parsed = helpSearchQuerySchema.safeParse({ q: c.req.query('q') })
    if (!parsed.success) return c.json({ error: 'q invalido (2-200 caracteres).' }, 400)
    const data = await helpService.searchHelp(parsed.data.q)
    return c.json({ data })
  })

  return app
}
