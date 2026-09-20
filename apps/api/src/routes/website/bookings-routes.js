// apps/api/src/routes/website/bookings-routes.js
import { Hono } from 'hono'

export function createPublicBookingsRouter({ prisma }) {
  const app = new Hono()

  function bookingBlock(value, calendarId) {
    if (!value || typeof value !== 'object') return null
    if (value.type === 'BookingFormBlock' && value.props?.calendarId === calendarId) return value.props
    for (const child of Object.values(value)) {
      const match = bookingBlock(child, calendarId)
      if (match) return match
    }
    return null
  }

  app.post('/bookings', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const { name, email, phone, date, time, notes, calendarId } = body
    const siteId = c.req.header('X-Site-Id')

    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
    if (!uuid.test(siteId ?? '') || !uuid.test(calendarId ?? '') || !name || !email || !date || !time) {
      return c.json({ error: 'Faltan campos requeridos' }, 400)
    }

    try {
      // A public booking capability exists only for a calendar published by its
      // own company on this site. Knowing an arbitrary calendar UUID is not one.
      const pages = await prisma.$queryRaw`
        SELECT wp.published_builder_data, ws.company_id
        FROM website_site ws
        JOIN company co ON co.id = ws.company_id AND co.enabled = true
        JOIN calendar_calendar cal ON cal.company_id = ws.company_id AND cal.enabled = true
        JOIN website_page wp ON wp.site_id = ws.id AND wp.company_id = ws.company_id
        WHERE ws.id = ${siteId}::uuid AND ws.enabled = true
          AND cal.id = ${calendarId}::uuid AND wp.enabled = true AND wp.status = 'published' AND wp.visibility = 'public'
      `
      const page = pages.find(row => bookingBlock(row.published_builder_data, calendarId))
      if (!page) return c.json({ error: 'Calendario no disponible para este sitio' }, 404)
      const block = bookingBlock(page.published_builder_data, calendarId)
      const serviceDuration = Math.min(1440, Math.max(1, Number(block.serviceDuration) || 60))
      const startAt = new Date(`${date}T${time}:00.000Z`)
      if (!Number.isFinite(startAt.getTime())) return c.json({ error: 'Fecha invalida' }, 400)
      const endAt   = new Date(startAt.getTime() + (Number(serviceDuration) || 60) * 60_000)

      const title = `Reservacion: ${name}`
      const desc  = [
        `Email: ${email}`,
        phone ? `Tel: ${phone}` : null,
        notes ? `Notas: ${notes}` : null,
      ].filter(Boolean).join('\n')

      // calendar_event columns: id, calendar_id, title, description,
      // start_at, end_at, all_day, location, video_url, color,
      // recurrence_rule, source_module, source_entity_id, enabled,
      // created_at, updated_at
      const created = await prisma.$queryRaw`
        INSERT INTO calendar_event (id, calendar_id, title, description, start_at, end_at, source_module, updated_at)
        SELECT uuidv7(), cal.id, ${title}, ${desc},
          ${startAt}, ${endAt}, 'website', NOW()
        FROM calendar_calendar cal
        WHERE cal.id = ${calendarId}::uuid AND cal.company_id = ${page.company_id}::uuid AND cal.enabled = true
        RETURNING id
      `
      if (!created.length) return c.json({ error: 'Calendario no disponible' }, 404)

      return c.json({ ok: true })
    } catch (err) {
      if (err?.message?.includes('does not exist') || err?.code === '42P01') {
        return c.json({ error: 'Calendario no disponible' }, 503)
      }
      console.error('[public/website/bookings]', err?.message)
      return c.json({ error: 'Error interno' }, 500)
    }
  })

  return app
}
