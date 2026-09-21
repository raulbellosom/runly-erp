import { Hono } from 'hono'
import { createCatalogPublicService } from './catalog/catalog-public-service.js'
import { createDistServeService } from '../services/dist-serve-service.js'
import { resolvePublicSupabaseUrl } from '../lib/supabase-public-url.js'

const ERP_PREFIXES = ['runly.', 'atlas.', 'website.', 'contacts.', 'hr.', 'finance.', 'fleet.']

export function createPublicWebsiteRouter({ prisma, supabaseAdmin }) {
  const app = new Hono()
  const siteResolver = createDistServeService({ prisma, supabaseAdmin })

  app.get('/desktop/config', async (c) => {
    return c.json({
      data: {
        // Browser-facing — must be the public Supabase domain, never the
        // internal Docker hostname the API/worker use to reach Kong.
        supabaseUrl: resolvePublicSupabaseUrl(process.env) || null,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null,
      },
    })
  })

  app.get('/resolve', async (c) => {
    try {
      const instanceConfig = await prisma.instanceConfig.findUnique({
        where: { key: 'initialized' },
      })
      if (!instanceConfig || instanceConfig.value !== 'true') {
        return c.json({ initialized: false })
      }

      const routePath = c.req.query('path') || '/'

      const resolvedSite = await siteResolver.resolveSiteForRequest(c)
      const company = resolvedSite ? { id: resolvedSite.company_id, slug: resolvedSite.company_slug } : null
      if (!company) {
        return c.json({ initialized: true, site: null, page: null, theme: null, menus: [] })
      }

      const sites = await prisma.$queryRaw`
        SELECT id, name, domain, status, theme_id, source_type,
               analytics_mode, turnstile_site_key
        FROM website_site
        WHERE company_id = ${company.id}
          AND id = ${resolvedSite.id}::uuid
          AND enabled = true
        ORDER BY created_at ASC
        LIMIT 1
      `
      const site = sites[0] ?? null
      if (!site) {
        return c.json({ initialized: true, site: null, page: null, theme: null, menus: [] })
      }

      const pages = await prisma.$queryRaw`
        SELECT id, title, slug, route_path, status, published_builder_data, seo
        FROM website_page
        WHERE company_id = ${company.id}
          AND site_id = ${site.id}
          AND route_path = ${routePath}
          AND status = 'published'
          AND visibility = 'public'
          AND enabled = true
        LIMIT 1
      `
      const page = pages[0] ?? null

      let theme = null
      if (site.theme_id) {
        const themes = await prisma.$queryRaw`
          SELECT tokens, typography, layout, custom_css
          FROM website_theme
          WHERE id = ${site.theme_id} AND company_id = ${company.id} AND enabled = true
          LIMIT 1
        `
        theme = themes[0] ?? null
      }

      const menus = await prisma.$queryRaw`
        SELECT
          m.id, m.name, m.location,
          COALESCE(
            json_agg(
              json_build_object(
                'id',         mi.id,
                'label',      mi.label,
                'url',        mi.url,
                'page_id',    mi.page_id,
                'target',     mi.target,
                'sort_order', mi.sort_order,
                'parent_id',  mi.parent_id
              ) ORDER BY mi.sort_order
            ) FILTER (WHERE mi.id IS NOT NULL),
            '[]'::json
          ) AS items
        FROM website_menu m
        LEFT JOIN website_menu_item mi
          ON mi.menu_id = m.id AND mi.company_id = m.company_id AND mi.enabled = true
        WHERE m.company_id = ${company.id}
          AND m.site_id = ${site.id}
          AND m.enabled = true
        GROUP BY m.id, m.name, m.location
      `

      return c.json({
        initialized: true,
        site: {
          id: site.id,
          name: site.name,
          domain: site.domain,
          sourceType: site.source_type ?? 'builder',
          company: company.slug,
          analyticsMode: site.analytics_mode ?? 'off',
          turnstileSiteKey: site.turnstile_site_key ?? null,
        },
        page: page
          ? {
              id:                   page.id,
              title:                page.title,
              slug:                 page.slug,
              routePath:            page.route_path,
              status:               page.status,
              publishedBuilderData: page.published_builder_data ?? {},
              seo:                  page.seo ?? {},
            }
          : null,
        theme,
        menus,
      })
    } catch (err) {
      if (err?.message?.includes('does not exist') || err?.code === '42P01') {
        return c.json({ initialized: true, site: null, page: null, theme: null, menus: [] })
      }
      console.error('[public/website/resolve]', err?.message)
      return c.json({ initialized: true, site: null, page: null, theme: null, menus: [] }, 500)
    }
  })

  app.get('/blog', async (c) => {
    try {
      const { siteId, limit = '10', offset = '0' } = c.req.query()
      if (!siteId) return c.json({ data: [] })
      const limitNum  = Math.min(parseInt(limit)  || 10, 50)
      const offsetNum = Math.max(parseInt(offset) || 0, 0)
      const rows = await prisma.$queryRaw`
        SELECT id, title, slug, excerpt, cover_asset_id, updated_at
        FROM website_page
        WHERE site_id   = ${siteId}::uuid
          AND visibility = 'public'
          AND EXISTS (SELECT 1 FROM website_site ws JOIN company co ON co.id = ws.company_id
                      WHERE ws.id = website_page.site_id AND ws.company_id = website_page.company_id
                        AND ws.enabled = true AND co.enabled = true)
          AND page_type = 'blog_post'
          AND status    = 'published'
          AND enabled   = true
        ORDER BY updated_at DESC
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `
      return c.json({ data: rows })
    } catch (err) {
      if (err?.message?.includes('does not exist') || err?.code === '42P01') return c.json({ data: [] })
      return c.json({ data: [] }, 500)
    }
  })

  app.get('/auth-check', async (c) => {
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return c.json({ error: 'Token requerido' }, 401)

    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data?.user) return c.json({ error: 'Token invalido o expirado' }, 401)

      const authUserId = data.user.id
      const profile = await prisma.userProfile.findUnique({ where: { authUserId } })
      if (!profile) return c.json({ canAccessErp: false })

      const memberships = await prisma.membership.findMany({
        where: { userId: profile.id, enabled: true },
        include: {
          role: {
            include: {
              permissions: {
                where: { permission: { active: true } },
                include: { permission: { select: { key: true } } },
              },
            },
          },
        },
      })

      const hasErpAccess = memberships.some((m) =>
        m.role?.permissions?.some((rp) =>
          ERP_PREFIXES.some((prefix) => rp.permission?.key?.startsWith(prefix))
        )
      )

      return c.json({ canAccessErp: hasErpAccess })
    } catch (err) {
      console.error('[public/website/auth-check]', err?.message)
      return c.json({ error: 'Error interno' }, 500)
    }
  })

  return app
}

export function createPublicCatalogRouter({ prisma }) {
  const app = new Hono()
  const publicSvc = createCatalogPublicService({ prisma })
  const siteResolver = createDistServeService({ prisma })

  async function getActiveCompanyId(c) {
    const site = await siteResolver.resolveSiteForRequest(c)
    return site?.company_id ?? null
  }

  app.get('/categories', async (c) => {
    try {
      const companyId = await getActiveCompanyId(c)
      if (!companyId) return c.json({ data: [] })
      const data = await publicSvc.listPublicCategories({ companyId })
      return c.json({ data })
    } catch (err) {
      console.error('[public/catalog/categories]', err?.message)
      return c.json({ data: [] }, 500)
    }
  })

  app.get('/products', async (c) => {
    try {
      const companyId = await getActiveCompanyId(c)
      if (!companyId) return c.json({ data: [], total: 0 })
      const { categorySlug, search, limit, offset } = c.req.query()
      const result = await publicSvc.listPublicProducts({
        companyId,
        categorySlug: categorySlug || undefined,
        search:       search       || undefined,
        limit:        limit  ? Number(limit)  : 20,
        offset:       offset ? Number(offset) : 0,
      })
      return c.json(result)
    } catch (err) {
      console.error('[public/catalog/products]', err?.message)
      return c.json({ data: [], total: 0 }, 500)
    }
  })

  app.get('/products/:slug', async (c) => {
    try {
      const companyId = await getActiveCompanyId(c)
      if (!companyId) return c.json({ error: 'Not found' }, 404)
      const data = await publicSvc.getPublicProductBySlug({ companyId, slug: c.req.param('slug') })
      if (!data) return c.json({ error: 'Not found' }, 404)
      return c.json({ data })
    } catch (err) {
      console.error('[public/catalog/products/:slug]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  return app
}
