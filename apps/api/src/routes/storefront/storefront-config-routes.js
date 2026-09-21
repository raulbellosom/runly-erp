import { Hono } from 'hono'
import { getCompanySlugHeader } from '../../lib/public-request-headers.js'
import { resolvePublicSupabaseUrl } from '../../lib/supabase-public-url.js'

export function createStorefrontConfigRoutes({ prisma }) {
  const app = new Hono()

  app.get('/realtime-config', async (c) => {
    const companySlug = getCompanySlugHeader(c)
    if (!companySlug) return c.json({ error: 'Cabecera X-Runly-Company requerida' }, 400)

    const company = await prisma.company.findUnique({ where: { slug: companySlug } })
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404)

    return c.json({
      data: {
        // Browser-facing — must be the public Supabase domain, never the
        // internal Docker hostname the API/worker use to reach Kong.
        supabaseUrl: resolvePublicSupabaseUrl(process.env),
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        companyId: company.id,
      },
    })
  })

  app.get('/chat/availability', async (c) => {
    const companySlug = getCompanySlugHeader(c)
    if (!companySlug) return c.json({ error: 'Cabecera X-Runly-Company requerida' }, 400)

    const company = await prisma.company.findUnique({ where: { slug: companySlug } })
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404)

    const agentsOnline = await prisma.userProfile.count({
      where: {
        availableForChat: true,
        memberships: { some: { enabled: true, company: { slug: companySlug } } },
      },
    })

    return c.json({ data: { available: agentsOnline > 0, agentsOnline } })
  })

  app.get('/config', async (c) => {
    const companySlug = getCompanySlugHeader(c)
    if (!companySlug) return c.json({ error: 'Cabecera X-Runly-Company requerida' }, 400)

    const company = await prisma.company.findUnique({
      where: { slug: companySlug },
      include: { brandingConfig: true },
    })
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404)

    return c.json({
      data: {
        name: company.name,
        slug: company.slug,
        primaryColor: company.brandingConfig?.primaryColor ?? null,
        logoFileId: company.brandingConfig?.logoFileId ?? null,
      },
    })
  })

  return app
}
