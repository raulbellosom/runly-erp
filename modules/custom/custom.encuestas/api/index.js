import { Hono } from 'hono'
import { z } from 'zod'
import {
  createEncuestaSchema, updateEncuestaSchema, changeEstadoSchema,
  createPreguntaSchema, updatePreguntaSchema, createRespuestaSchema,
} from '../validators/index.js'
import { createEncuestasService } from './encuestas-service.js'
import { EncuestasServiceError } from './service-helpers.js'

const appError = (c, error, fallback) => {
  if (error instanceof EncuestasServiceError) return c.json({ error: error.message }, error.status)
  if (process.env.NODE_ENV !== 'production') console.error('[custom.encuestas]', error)
  return c.json({ error: fallback }, 500)
}

function contextIds(c) {
  const ctx = c.get('userContext')
  return {
    companyId: c.get('companyId') ?? ctx?.memberships?.[0]?.companyId ?? null,
    actorId: c.get('userId') ?? ctx?.profile?.id ?? null,
  }
}

export default function createEncuestasRouter({ prisma, requirePermission, moduleContext }) {
  const app = new Hono()
  const service = createEncuestasService({ prisma })

  async function enforcePermission(c, permissionKey) {
    let allowed = false
    const response = await requirePermission(permissionKey)(c, async () => { allowed = true })
    return allowed ? null : response
  }

  app.get('/encuestas/dashboard', requirePermission('encuestas.encuestas.read'), async (c) => {
    try { return c.json({ data: await service.getDashboard(contextIds(c)) }) }
    catch (e) { return appError(c, e, 'No se pudo cargar el resumen.') }
  })

  app.get('/encuestas/respondent-context', requirePermission('encuestas.respuestas.create'), requirePermission('hr.employee.read'), requirePermission('inventory.assignment.read'), requirePermission('inventory.item.read'), async (c) => {
    try {
      const data = await service.getRespondentContext(contextIds(c))
      if ((data.employeeId || data.assignedItemIds?.length) && !moduleContext?.relations?.resolve) {
        return c.json({ error: 'La capacidad de relaciones entre módulos no está disponible.' }, 503)
      }
      if (data.employeeId) await moduleContext.relations.resolve(c, 'hr_employee', [data.employeeId])
      if (data.assignedItemIds?.length) await moduleContext.relations.resolve(c, 'inventory_item', data.assignedItemIds)
      return c.json({ data })
    } catch (e) { return appError(c, e, 'No se pudo cargar la identidad y el inventario asignado.') }
  })

  app.get('/encuestas/surveys', requirePermission('encuestas.encuestas.read'), async (c) => {
    try {
      return c.json(await service.listEncuestas({
        ...contextIds(c), page: c.req.query('page'), pageSize: c.req.query('pageSize'),
        search: c.req.query('search'), estado: c.req.query('estado'),
      }))
    } catch (e) { return appError(c, e, 'No se pudieron cargar las encuestas.') }
  })

  app.get('/encuestas/surveys/:id', requirePermission('encuestas.encuestas.read'), async (c) => {
    try { return c.json({ data: await service.getEncuesta({ ...contextIds(c), id: c.req.param('id') }) }) }
    catch (e) { return appError(c, e, 'No se pudo cargar la encuesta.') }
  })

  app.post('/encuestas/surveys', requirePermission('encuestas.encuestas.create'), async (c) => {
    try {
      const parsed = createEncuestaSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.issues?.[0]?.message ?? 'Datos inválidos.' }, 400)
      return c.json({ data: await service.createEncuesta({ ...contextIds(c), data: parsed.data }) }, 201)
    } catch (e) { return appError(c, e, 'No se pudo crear la encuesta.') }
  })

  app.patch('/encuestas/surveys/:id', requirePermission('encuestas.encuestas.update'), async (c) => {
    try {
      const parsed = updateEncuestaSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.issues?.[0]?.message ?? 'Datos inválidos.' }, 400)
      return c.json({ data: await service.updateEncuesta({ ...contextIds(c), id: c.req.param('id'), data: parsed.data }) })
    } catch (e) { return appError(c, e, 'No se pudo actualizar la encuesta.') }
  })

  app.patch('/encuestas/surveys/:id/status', requirePermission('encuestas.encuestas.publish'), async (c) => {
    try {
      const parsed = changeEstadoSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: 'Estado inválido.' }, 400)
      return c.json({ data: await service.setEncuestaEstado({ ...contextIds(c), id: c.req.param('id'), estado: parsed.data.estado }) })
    } catch (e) { return appError(c, e, 'No se pudo cambiar el estado.') }
  })

  app.delete('/encuestas/surveys/:id', requirePermission('encuestas.encuestas.delete'), async (c) => {
    try { return c.json({ data: await service.disableEncuesta({ ...contextIds(c), id: c.req.param('id') }) }) }
    catch (e) { return appError(c, e, 'No se pudo eliminar la encuesta.') }
  })

  app.get('/encuestas/surveys/:id/questions', requirePermission('encuestas.encuestas.read'), async (c) => {
    try { return c.json({ data: await service.listPreguntas({ ...contextIds(c), encuestaId: c.req.param('id') }) }) }
    catch (e) { return appError(c, e, 'No se pudieron cargar las preguntas.') }
  })

  app.post('/encuestas/surveys/:id/questions', requirePermission('encuestas.encuestas.update'), async (c) => {
    try {
      const parsed = createPreguntaSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.issues?.[0]?.message ?? 'Datos inválidos.' }, 400)
      return c.json({ data: await service.createPregunta({ ...contextIds(c), encuestaId: c.req.param('id'), data: parsed.data }) }, 201)
    } catch (e) { return appError(c, e, 'No se pudo crear la pregunta.') }
  })

  app.patch('/encuestas/surveys/:id/questions/:questionId', requirePermission('encuestas.encuestas.update'), async (c) => {
    try {
      const parsed = updatePreguntaSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.issues?.[0]?.message ?? 'Datos inválidos.' }, 400)
      return c.json({ data: await service.updatePregunta({
        ...contextIds(c), encuestaId: c.req.param('id'), preguntaId: c.req.param('questionId'), data: parsed.data,
      }) })
    } catch (e) { return appError(c, e, 'No se pudo actualizar la pregunta.') }
  })

  app.delete('/encuestas/surveys/:id/questions/:questionId', requirePermission('encuestas.encuestas.update'), async (c) => {
    try { return c.json({ data: await service.disablePregunta({ ...contextIds(c), encuestaId: c.req.param('id'), preguntaId: c.req.param('questionId') }) }) }
    catch (e) { return appError(c, e, 'No se pudo eliminar la pregunta.') }
  })

  app.post('/encuestas/surveys/:id/responses', requirePermission('encuestas.respuestas.create'), async (c) => {
    try {
      const parsed = createRespuestaSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.issues?.[0]?.message ?? 'Datos inválidos.' }, 400)
      const ids = contextIds(c)
      const survey = await service.getEncuesta({ ...ids, id: c.req.param('id') })
      if (survey.capturar_contexto_inventario) {
        for (const permissionKey of ['hr.employee.read', 'inventory.assignment.read', 'inventory.item.read']) {
          const denied = await enforcePermission(c, permissionKey)
          if (denied) return denied
        }
        const respondent = await service.getRespondentContext(ids)
        if ((respondent.employeeId || respondent.assignedItemIds?.length) && !moduleContext?.relations?.resolve) {
          return c.json({ error: 'La capacidad de relaciones entre módulos no está disponible.' }, 503)
        }
        if (respondent.employeeId) await moduleContext.relations.resolve(c, 'hr_employee', [respondent.employeeId])
        if (respondent.assignedItemIds?.length) await moduleContext.relations.resolve(c, 'inventory_item', respondent.assignedItemIds)
      }
      return c.json({ data: await service.submitRespuesta({ ...ids, encuestaId: c.req.param('id'), data: parsed.data }) }, 201)
    } catch (e) { return appError(c, e, 'No se pudo guardar la respuesta.') }
  })

  app.get('/encuestas/surveys/:id/responses', requirePermission('encuestas.respuestas.read'), async (c) => {
    try {
      return c.json(await service.listRespuestas({
        ...contextIds(c), encuestaId: c.req.param('id'), page: c.req.query('page'), pageSize: c.req.query('pageSize'),
      }))
    } catch (e) { return appError(c, e, 'No se pudieron cargar las respuestas.') }
  })

  return app
}
