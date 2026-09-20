import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createWebsiteService } from './website-service.js'
import { createPagesRouter } from './pages-routes.js'
import { createThemesRouter } from './themes-routes.js'
import { createMenusRouter } from './menus-routes.js'
import { createBlogRouter } from './blog-routes.js'
import { createFormsRouter } from './forms-routes.js'
import { createWebsiteSettingsRouter } from './website-settings-routes.js'
import { createDistRoutes } from './dist-routes.js'
import { createSiteSchema, updateSiteSchema } from './validators.js'
import { WebsiteServiceError } from './service-helpers.js'

export function createWebsiteRouter({ prisma, requirePermission, supabaseAdmin }) {
  const app = new Hono()
  const websiteSvc = createWebsiteService({ prisma })

  app.route('/website', createPagesRouter({ websiteSvc, requirePermission }))
  app.route('/website', createThemesRouter({ websiteSvc, requirePermission }))
  app.route('/website', createMenusRouter({ websiteSvc, requirePermission }))
  app.route('/website', createBlogRouter({ websiteSvc, requirePermission }))
  app.route('/website', createFormsRouter({ websiteSvc, requirePermission }))
  app.route('/', createWebsiteSettingsRouter({ prisma, requirePermission, supabaseAdmin }))
  app.route('/', createDistRoutes({ prisma, supabaseAdmin, requirePermission }))

  app.get('/website/site', requirePermission('website.site.read'), async (c) => {
    const companyId = c.get('companyId')
    const site = await websiteSvc.getSite({ companyId })
    return c.json({ data: site })
  })

  app.post(
    '/website/site',
    requirePermission('website.site.update'),
    zValidator('json', createSiteSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const actorId   = c.get('userId') ?? c.get('user')?.id ?? null
      const data      = c.req.valid('json')
      try {
        const site = await websiteSvc.createSite({ companyId, data, actorId })
        return c.json(site, 201)
      } catch (err) {
        if (err instanceof WebsiteServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  app.patch(
    '/website/site/:id',
    requirePermission('website.site.update'),
    zValidator('json', updateSiteSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const actorId   = c.get('userId') ?? c.get('user')?.id ?? null
      const siteId    = c.req.param('id')
      const data      = c.req.valid('json')
      try {
        const site = await websiteSvc.updateSite({ companyId, siteId, data, actorId })
        return c.json(site)
      } catch (err) {
        if (err instanceof WebsiteServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  app.delete(
    '/website/site/:id',
    requirePermission('website.site.update'),
    async (c) => {
      const companyId = c.get('companyId')
      const actorId   = c.get('userId') ?? c.get('user')?.id ?? null
      const siteId    = c.req.param('id')
      try {
        await websiteSvc.deleteSite({ companyId, siteId, actorId })
        return c.body(null, 204)
      } catch (err) {
        if (err instanceof WebsiteServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  return app
}
