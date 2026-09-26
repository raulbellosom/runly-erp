// apps/api/src/routes/users-routes.js
import { Hono } from 'hono'
import { userSearchQuerySchema } from './ledger/validators.js'
import { getCompanyId, getActorId } from './ledger/service-helpers.js'

export function createUsersRouter({ prisma, requirePermission }) {
  const app = new Hono()

  app.get('/users/search', requirePermission('ledger.accounts.read'), async (c) => {
    const parsed = userSearchQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return c.json({ error: 'Parametro "q" invalido (min 2 chars cuando se envia).' }, 400)
    }
    const { q, limit } = parsed.data
    const companyId = getCompanyId(c)
    const actorId   = getActorId(c)
    // No "q": default listing (e.g. the "Compartir" picker before the user
    // types anything) — a lower default cap than search mode so this never
    // becomes a de facto "dump the whole company directory" endpoint.
    const effectiveLimit = q ? limit : 20
    const pattern = q ? `%${q}%` : null

    try {
      const rows = await prisma.$queryRaw`
        SELECT DISTINCT p.id, p.display_name, p.email
        FROM user_profile p
        INNER JOIN membership m ON m.user_id = p.id AND m.enabled = true
        WHERE m.company_id = ${companyId}::uuid
          AND p.id != ${actorId}::uuid
          AND p.is_bot = false
          AND (
            ${pattern}::text IS NULL
            OR p.display_name ILIKE ${pattern}
            OR p.email ILIKE ${pattern}
          )
        ORDER BY p.display_name
        LIMIT ${effectiveLimit}
      `
      return c.json({ data: rows })
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('[users/search]', err)
      return c.json({ error: 'No se pudo realizar la busqueda.' }, 500)
    }
  })

  return app
}
