import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createSmtpConfigStore, encryptPassword, createWebsiteSmtpService } from '../../services/smtp-service.js'

const smtpSchema = z.object({
  host:       z.string().min(1),
  port:       z.number().int().min(1).max(65535).default(587),
  user:       z.string().min(1),
  pass:       z.string().optional(),
  from_name:  z.string().optional(),
  from_email: z.string().email().optional(),
  tls:        z.boolean().default(false),
})

export function createWebsiteSettingsRouter({ prisma, requirePermission }) {
  const app = new Hono()

  app.get('/website/settings/smtp', requirePermission('website.site.update'), async (c) => {
    const smtpSvc = createWebsiteSmtpService({ prisma, companyId: c.get("companyId") })
    const data = await smtpSvc.getWebsiteOnlyConfig()
    return c.json({ data })
  })

  app.post(
    '/website/settings/smtp',
    requirePermission('website.site.update'),
    zValidator('json', smtpSchema),
    async (c) => {
      const data = c.req.valid('json')

      const entries = [
        { key: 'website.smtp.host',       value: data.host },
        { key: 'website.smtp.port',       value: String(data.port) },
        { key: 'website.smtp.user',       value: data.user },
        { key: 'website.smtp.from_name',  value: data.from_name  ?? '' },
        { key: 'website.smtp.from_email', value: data.from_email ?? '' },
        { key: 'website.smtp.tls',        value: String(data.tls) },
      ]

      if (data.pass) {
        entries.push({ key: 'website.smtp.pass', value: encryptPassword(data.pass) })
      }

      await createSmtpConfigStore({ prisma, companyId: c.get('companyId') }).save(entries)

      return c.json({ ok: true })
    },
  )

  app.post('/website/settings/smtp/test', requirePermission('website.site.update'), async (c) => {
    const smtpSvc = createWebsiteSmtpService({ prisma, companyId: c.get("companyId") })
    const userId  = c.get('userId') ?? c.get('user')?.id

    const userProfile = await prisma.userProfile.findFirst({
      where:  { id: userId },
      select: { email: true },
    })

    try {
      const config = await smtpSvc.getConfig()
      if (!config) return c.json({ error: 'SMTP no configurado (website ni plataforma)' }, 400)

      await smtpSvc.sendEmail({
        to:      userProfile?.email ?? 'test@example.com',
        subject: 'Runly Website — Prueba de SMTP',
        html:    `<p>La configuracion SMTP del sitio web funciona correctamente.</p><p><small>Origen: ${config.source === 'website' ? 'SMTP propio del sitio' : 'SMTP de la empresa'}</small></p>`,
        text:    `La configuracion SMTP del sitio web funciona correctamente. Origen: ${config.source === 'website' ? 'SMTP propio del sitio' : 'SMTP de la empresa'}`,
      })
      return c.json({ ok: true, source: config.source })
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }
  })

  return app
}
