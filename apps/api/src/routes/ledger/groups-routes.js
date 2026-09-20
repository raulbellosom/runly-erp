import { UserAccessError } from '../../services/user-access-service.js'
// apps/api/src/routes/ledger/groups-routes.js
import { Hono } from 'hono'
import {
  createGroupSchema, updateGroupSchema,
  inviteGroupMemberSchema, updateGroupMemberRoleSchema,
} from './validators.js'
import { createGroupService, GroupServiceError } from './group-service.js'
import { getCompanyId, getActorId, getValidationErrorMessage } from './service-helpers.js'
import { getActivityContext } from '../../services/activity-publisher.js'

function handleError(c, err, fallback) {
  if (err instanceof GroupServiceError) return c.json({ error: err.message }, err.status)
  if (err instanceof UserAccessError) return c.json({ error: err.message }, err.status)
  if (err instanceof SyntaxError) return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/groups]', err)
  return c.json({ error: fallback }, 500)
}

export function createGroupsRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createGroupService({ prisma })

  app.post('/ledger/groups', requirePermission('ledger.groups.write'), async (c) => {
    try {
      const parsed = createGroupSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const group = await service.createGroup({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        data: parsed.data,
      })
      return c.json({ data: group }, 201)
    } catch (err) {
      return handleError(c, err, 'No se pudo crear el grupo.')
    }
  })

  app.get('/ledger/groups', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.listGroups({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudieron listar los grupos.')
    }
  })

  app.get('/ledger/groups/:id', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.getGroup({
        companyId: getCompanyId(c),
        groupId: c.req.param('id'),
        actorId: getActorId(c),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo obtener el grupo.')
    }
  })

  app.patch('/ledger/groups/:id', requirePermission('ledger.groups.write'), async (c) => {
    try {
      const parsed = updateGroupSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      return c.json({ data: await service.updateGroup({
        companyId: getCompanyId(c),
        groupId: c.req.param('id'),
        actorId: getActorId(c),
        data: parsed.data,
      })})
    } catch (err) {
      return handleError(c, err, 'No se pudo actualizar el grupo.')
    }
  })

  app.delete('/ledger/groups/:id', requirePermission('ledger.groups.write'), async (c) => {
    try {
      return c.json({ data: await service.deleteGroup({
        companyId: getCompanyId(c),
        groupId: c.req.param('id'),
        actorId: getActorId(c),
      })})
    } catch (err) {
      return handleError(c, err, 'No se pudo eliminar el grupo.')
    }
  })

  // ── Members ──────────────────────────────────────────────────────────────

  app.post('/ledger/groups/:id/members', requirePermission('ledger.members.write'), async (c) => {
    try {
      const parsed = inviteGroupMemberSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const { actorName } = getActivityContext(c)
      return c.json({ data: await service.inviteMember({
        companyId: getCompanyId(c),
        groupId: c.req.param('id'),
        actorId: getActorId(c),
        actorName,
        data: parsed.data,
      })}, 201)
    } catch (err) {
      return handleError(c, err, 'No se pudo invitar al miembro.')
    }
  })

  app.patch('/ledger/groups/:id/members/:uid', requirePermission('ledger.members.write'), async (c) => {
    try {
      const parsed = updateGroupMemberRoleSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      return c.json({ data: await service.updateMemberRole({
        companyId: getCompanyId(c),
        groupId: c.req.param('id'),
        actorId: getActorId(c),
        targetUserId: c.req.param('uid'),
        data: parsed.data,
      })})
    } catch (err) {
      return handleError(c, err, 'No se pudo actualizar el rol.')
    }
  })

  app.delete('/ledger/groups/:id/members/:uid', requirePermission('ledger.members.write'), async (c) => {
    try {
      const { actorName } = getActivityContext(c)
      return c.json({ data: await service.removeMember({
        companyId: getCompanyId(c),
        groupId: c.req.param('id'),
        actorId: getActorId(c),
        targetUserId: c.req.param('uid'),
        actorName,
      })})
    } catch (err) {
      return handleError(c, err, 'No se pudo remover al miembro.')
    }
  })

  return app
}
