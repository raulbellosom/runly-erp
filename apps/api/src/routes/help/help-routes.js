// GET /help/* — read-only module help/documentation endpoints, plus the
// Phase 2 free-text assistant (POST /help/ask). Every route is guarded by
// the single "runly.help.read" permission (granted to every user via
// BASE_PERMISSION_KEYS in index.js — help content is not sensitive business
// data, see docs/superpowers/specs/2026-09-26-module-help-system-design.md §18).
import { Hono } from 'hono'
import { helpSearchQuerySchema, helpResolvePathQuerySchema, helpAskBodySchema } from '@runly/validators'
import { createHelpService } from '../../services/help-service.js'
import { createHelpAssistantService, HelpAssistantServiceError } from './help-assistant-service.js'

export function createHelpRouter({ prisma, requirePermission, env, fetchImpl }) {
  const app = new Hono()
  const helpService = createHelpService({ prisma })
  const assistant = createHelpAssistantService({ helpService, env, fetchImpl })
  const guard = requirePermission('runly.help.read')

  function handleAssistantError(c, err) {
    if (err instanceof HelpAssistantServiceError) return c.json({ error: err.message }, err.status)
    console.error('[help/ask]', err)
    return c.json({ error: 'El asistente no pudo responder.' }, 500)
  }

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

  app.get('/help/assistant/status', guard, async (c) => {
    return c.json({ data: { available: assistant.isConfigured() } })
  })

  app.post('/help/ask', guard, async (c) => {
    const parsed = helpAskBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'Cuerpo invalido.' }, 400)
    try {
      const data = await assistant.ask({
        actorId: c.get('authUserId') ?? 'anonymous',
        path: parsed.data.path,
        question: parsed.data.question,
        history: parsed.data.history ?? [],
      })
      return c.json({ data })
    } catch (err) {
      return handleAssistantError(c, err)
    }
  })

  return app
}
