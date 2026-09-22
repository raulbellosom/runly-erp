import { Hono } from 'hono'
import { z } from 'zod'
import { createSmtpConfigStore, encryptPassword, createSmtpService } from '../services/smtp-service.js'
import { createWebPushService } from '../services/web-push-service.js'
import { buildSmtpTestEmail } from '../services/email-templates.js'
import { createCompanyBrandService } from '../services/company-brand-service.js'

const smtpSchema = z.object({
  host:       z.string().min(1),
  port:       z.number().int().min(1).max(65535).default(587),
  user:       z.string().min(1),
  pass:       z.string().optional(),
  from_name:  z.string().optional(),
  from_email: z.string().email().optional(),
  tls:        z.boolean().default(false),
})

export function createSettingsRouter({ prisma, requirePermission, supabaseAdmin = null }) {
  const app = new Hono()
  const webPushService = createWebPushService({ prisma })
  const brandService = createCompanyBrandService({ prisma, supabaseAdmin })

  // VAPID keys belong to the installation/browser origin and are shared by
  // every company hosted on it. Company admins (isAdmin) are allowed to
  // manage them, same as system admins — on a single-company instance
  // that's the only admin role that ever gets assigned.
  const requireInstanceAdmin = async (c, next) => {
    const tenant = c.get('tenantContext')
    if (!tenant?.isSystemAdmin && !tenant?.isAdmin) {
      return c.json({ error: 'Solo la administración de plataforma puede configurar Web Push.' }, 403)
    }
    await next()
  }

  app.get('/settings/smtp', requirePermission('platform.settings.manage'), async (c) => {
    try {
      const rows = await createSmtpConfigStore({ prisma, companyId: c.get("companyId") }).findMany({
        where: {
          key: {
            in: ['smtp.host', 'smtp.port', 'smtp.user',
                 'smtp.from_name', 'smtp.from_email', 'smtp.tls'],
          },
        },
      })
      const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      // Real status: attempts to decrypt the stored password, so a saved-but-
      // undecryptable secret (JWT_SECRET rotated) reports configured:false with
      // a reason instead of a misleading green state.
      const status = await createSmtpService({ prisma, companyId: c.get("companyId") }).getStatus()
      return c.json({
        data: {
          host:       cfg['smtp.host']       ?? '',
          port:       Number(cfg['smtp.port'] ?? 587),
          user:       cfg['smtp.user']       ?? '',
          from_name:  cfg['smtp.from_name']  ?? '',
          from_email: cfg['smtp.from_email'] ?? '',
          tls:        cfg['smtp.tls'] === 'true',
          configured: status.configured,
          status_reason:  status.reason ?? null,
          status_message: status.message ?? null,
        },
      })
    } catch (err) {
      console.error('[GET /settings/smtp]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/settings/smtp', requirePermission('platform.settings.manage'), async (c) => {
    try {
      const body = await c.req.json()
      const parsed = smtpSchema.safeParse(body)
      if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
      const data = parsed.data

      const entries = [
        { key: 'smtp.host',       value: data.host },
        { key: 'smtp.port',       value: String(data.port) },
        { key: 'smtp.user',       value: data.user },
        { key: 'smtp.from_name',  value: data.from_name  ?? '' },
        { key: 'smtp.from_email', value: data.from_email ?? '' },
        { key: 'smtp.tls',        value: String(data.tls) },
      ]

      if (data.pass) {
        entries.push({ key: 'smtp.pass', value: encryptPassword(data.pass) })
      }

      await createSmtpConfigStore({ prisma, companyId: c.get('companyId') }).save(entries)

      return c.json({ ok: true })
    } catch (err) {
      console.error('[POST /settings/smtp]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/settings/smtp/test', requirePermission('platform.settings.manage'), async (c) => {
    try {
      const companyId = c.get("companyId")
      const smtpSvc = createSmtpService({ prisma, companyId })
      const userId  = c.get('userId') ?? c.get('user')?.id

      const userProfile = await prisma.userProfile.findFirst({
        where: { id: userId },
        select: { email: true },
      })

      const brand = await brandService.getBrandForCompany(companyId)
      const mail = buildSmtpTestEmail({ brand })
      await smtpSvc.sendEmail({
        to:       userProfile?.email ?? 'test@example.com',
        subject:  mail.subject,
        html:     mail.html,
        text:     mail.text,
        fromName: brandService.fromNameFor(brand),
      })
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }
  })

  app.get('/settings/notifications/webpush', requirePermission('platform.settings.manage'), requireInstanceAdmin, async (c) => {
    try {
      const data = await webPushService.getVapidConfig()
      return c.json({ data })
    } catch (err) {
      console.error('[GET /settings/notifications/webpush]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/settings/notifications/webpush', requirePermission('platform.settings.manage'), requireInstanceAdmin, async (c) => {
    try {
      const body = await c.req.json()
      const data = await webPushService.saveVapidConfig(body)
      return c.json({ data })
    } catch (err) {
      if (err?.name === 'ZodError') return c.json({ error: err.flatten() }, 400)
      console.error('[POST /settings/notifications/webpush]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/settings/notifications/webpush/generate', requirePermission('platform.settings.manage'), requireInstanceAdmin, async (c) => {
    try {
      const data = webPushService.generateVapidKeys()
      return c.json({ data })
    } catch (err) {
      console.error('[POST /settings/notifications/webpush/generate]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.delete('/settings/notifications/webpush', requirePermission('platform.settings.manage'), requireInstanceAdmin, async (c) => {
    try {
      const data = await webPushService.clearVapidConfig()
      return c.json({ data })
    } catch (err) {
      console.error('[DELETE /settings/notifications/webpush]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  return app
}
