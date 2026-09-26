import { UserAccessError } from '../../services/user-access-service.js'
// apps/api/src/routes/ledger/collaboration-routes.js
import { Hono } from 'hono'
import {
  inviteAccountMemberSchema, updateAccountMemberRoleSchema,
} from './validators.js'
import { createCollaborationService, CollaborationServiceError } from './collaboration-service.js'
import { getCompanyId, getActorId, getValidationErrorMessage } from './service-helpers.js'
import { getActivityContext } from '../../services/activity-publisher.js'

function handleError(c, err, fallback) {
  if (err instanceof CollaborationServiceError) return c.json({ error: err.message }, err.status)
  if (err instanceof UserAccessError) return c.json({ error: err.message }, err.status)
  if (err instanceof SyntaxError) return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/collab]', err)
  return c.json({ error: fallback }, 500)
}

export function createCollaborationRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createCollaborationService({ prisma })

  // NOTE: PATCH /ledger/accounts/:id/group is served by accounts-routes.js
  // (mounted first), backed by ledger-service.js's setAccountGroup. It was
  // previously also declared here with divergent, weaker authorization —
  // that dead duplicate (and its moveAccountToGroup/moveAccountFromGroup
  // helpers) has been removed.

  // ── Account members ───────────────────────────────────────────────────────

  app.get('/ledger/accounts/:id/members', requirePermission('ledger.accounts.read'), async (c) => {
    try {
      return c.json(await service.listAccountMembers({
        companyId: getCompanyId(c),
        accountId: c.req.param('id'),
        actorId: getActorId(c),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudieron listar los colaboradores.')
    }
  })

  app.post('/ledger/accounts/:id/members', requirePermission('ledger.members.write'), async (c) => {
    try {
      const parsed = inviteAccountMemberSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const { actorName } = getActivityContext(c)
      return c.json({ data: await service.inviteAccountMember({
        companyId: getCompanyId(c),
        accountId: c.req.param('id'),
        actorId: getActorId(c),
        actorName,
        data: parsed.data,
      })}, 201)
    } catch (err) {
      return handleError(c, err, 'No se pudo invitar al colaborador.')
    }
  })

  app.patch('/ledger/accounts/:id/members/:uid', requirePermission('ledger.members.write'), async (c) => {
    try {
      const parsed = updateAccountMemberRoleSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      return c.json({ data: await service.updateAccountMemberRole({
        companyId: getCompanyId(c),
        accountId: c.req.param('id'),
        actorId: getActorId(c),
        targetUserId: c.req.param('uid'),
        data: parsed.data,
      })})
    } catch (err) {
      return handleError(c, err, 'No se pudo actualizar el rol.')
    }
  })

  app.delete('/ledger/accounts/:id/members/:uid', requirePermission('ledger.members.write'), async (c) => {
    try {
      const { actorName } = getActivityContext(c)
      return c.json({ data: await service.removeAccountMember({
        companyId: getCompanyId(c),
        accountId: c.req.param('id'),
        actorId: getActorId(c),
        targetUserId: c.req.param('uid'),
        actorName,
      })})
    } catch (err) {
      return handleError(c, err, 'No se pudo remover al colaborador.')
    }
  })

  // ── Memberships (own) ─────────────────────────────────────────────────────

  app.get('/ledger/memberships', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.listMemberships({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudieron obtener las membresias.')
    }
  })

  app.delete('/ledger/memberships/groups/:id', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.leaveGroup({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        groupId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo salir del grupo.')
    }
  })

  app.delete('/ledger/memberships/accounts/:id', requirePermission('ledger.accounts.read'), async (c) => {
    try {
      return c.json(await service.leaveAccount({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        accountId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo salir de la cuenta compartida.')
    }
  })

  // ── Reject invitations ────────────────────────────────────────────────────

  app.post('/ledger/invitations/groups/:id/reject', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.rejectGroupInvitation({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        groupId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo rechazar la invitacion.')
    }
  })

  app.post('/ledger/invitations/accounts/:id/reject', requirePermission('ledger.accounts.read'), async (c) => {
    try {
      return c.json(await service.rejectAccountInvitation({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        accountId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo rechazar la invitacion.')
    }
  })

  // ── Accept invitations ────────────────────────────────────────────────────

  app.post('/ledger/invitations/groups/:id/accept', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.acceptGroupInvitation({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        groupId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo aceptar la invitacion.')
    }
  })

  app.post('/ledger/invitations/accounts/:id/accept', requirePermission('ledger.accounts.read'), async (c) => {
    try {
      return c.json(await service.acceptAccountInvitation({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        accountId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo aceptar la invitacion.')
    }
  })

  return app
}
