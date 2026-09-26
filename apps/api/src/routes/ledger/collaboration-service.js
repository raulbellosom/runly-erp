import { createUserAccessService } from '../../services/user-access-service.js';
// apps/api/src/routes/ledger/collaboration-service.js
import { createNotificationService } from '../../services/notification-service.js'
import { firstRow } from './service-helpers.js'

export class CollaborationServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'CollaborationServiceError'
    this.status = status
  }
}

function logNotificationError(err) {
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/collab] notification publish failed', err)
}

export function createCollaborationService({ prisma }) {
  const notifService = createNotificationService({ prisma })

  // ── Internal helpers ──────────────────────────────────────────────────────

  async function getAccountOwned({ companyId, accountId, actorId }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM ledger_account
      WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid AND owner_id = ${actorId}::uuid
        AND enabled = true
    `
    const row = firstRow(rows)
    if (!row) throw new CollaborationServiceError('Cuenta no encontrada o no eres el propietario.', 404)
    return row
  }

  // ── Account members (personal accounts only) ──────────────────────────────
  // NOTE: moving an account into/out of a group is handled exclusively by
  // ledger-service.js's setAccountGroup (owner OR editor/admin), wired to
  // PATCH /ledger/accounts/:id/group in accounts-routes.js. This file used to
  // carry its own moveAccountToGroup/moveAccountFromGroup with a stricter,
  // divergent (owner-only) authorization rule; they were unreachable dead
  // code and a landmine if ever wired up by mistake, so they were removed.

  async function listAccountMembers({ companyId, accountId, actorId }) {
    // Verify the actor has access to this account before listing members
    const accRows = await prisma.$queryRaw`
      SELECT id FROM ledger_account
      WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid AND enabled = true
        AND (owner_id = ${actorId}::uuid
          OR EXISTS (
            SELECT 1 FROM ledger_account_member m
            WHERE m.account_id = ledger_account.id AND m.user_id = ${actorId}::uuid AND m.status = 'active'
          )
        )
    `
    if (!firstRow(accRows)) throw new CollaborationServiceError('Cuenta no encontrada.', 404)

    const rows = await prisma.$queryRaw`
      SELECT am.id, am.user_id, am.role, am.status, am.invited_at,
        p.display_name, p.email
      FROM ledger_account_member am
      JOIN user_profile p ON p.id = am.user_id
      WHERE am.account_id = ${accountId}::uuid AND am.status = 'active'
      ORDER BY p.display_name
    `
    return { data: rows }
  }

  async function inviteAccountMember({ companyId, accountId, actorId, actorName, data }) {
    const account = await getAccountOwned({ companyId, accountId, actorId })
    if (account.group_id) {
      throw new CollaborationServiceError('Esta cuenta pertenece a un grupo. Gestiona el acceso desde el grupo.', 400)
    }
    const { user_id: targetUserId, role } = data
    await createUserAccessService({ prisma }).assertCandidates({ companyId, userIds: [targetUserId] });
    if (targetUserId === actorId) {
      throw new CollaborationServiceError('No puedes invitarte a ti mismo.', 400)
    }

    try {
      await prisma.$queryRaw`
        INSERT INTO ledger_account_member (account_id, user_id, role, invited_by, status)
        VALUES (${accountId}::uuid, ${targetUserId}::uuid, ${role}, ${actorId}::uuid, 'pending')
        ON CONFLICT (account_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, invited_at = NOW(),
              status = CASE WHEN ledger_account_member.status = 'active' THEN 'active' ELSE 'pending' END
      `
    } catch (err) {
      if (err.message?.includes('violates foreign key')) {
        throw new CollaborationServiceError('Usuario no encontrado.', 404)
      }
      throw err
    }

    await notifService.publish({
      companyId,
      actorId,
      input: {
        eventType: 'ledger.account_invite',
        link: `/app/m/runly.ledger/accounts/${accountId}`,
        title: `Te compartieron la cuenta "${account.name}"`,
        body: `Rol asignado: ${role}`,
        recipients: { userIds: [targetUserId] },
        channels: ['in_app', 'email', 'web_push'],
        priority: 'medium',
        sourceType: 'ledger_account',
        sourceId: accountId,
        metadata: {
          resource_type: 'account',
          resource_id: accountId,
          resource_name: account.name,
          role,
          invited_by_name: actorName,
        },
      },
    }).catch(logNotificationError)

    return { ok: true }
  }

  async function updateAccountMemberRole({ companyId, accountId, actorId, targetUserId, data }) {
    await getAccountOwned({ companyId, accountId, actorId })
    const rows = await prisma.$queryRaw`
      UPDATE ledger_account_member
      SET role = ${data.role}
      WHERE account_id = ${accountId}::uuid AND user_id = ${targetUserId}::uuid AND status = 'active'
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new CollaborationServiceError('Colaborador no encontrado.', 404)
    return row
  }

  async function removeAccountMember({ companyId, accountId, actorId, targetUserId, actorName }) {
    const account = await getAccountOwned({ companyId, accountId, actorId })
    const rows = await prisma.$queryRaw`
      DELETE FROM ledger_account_member
      WHERE account_id = ${accountId}::uuid AND user_id = ${targetUserId}::uuid
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new CollaborationServiceError('Colaborador no encontrado.', 404)

    if (targetUserId !== actorId) {
      await notifService.publish({
        companyId,
        actorId,
        input: {
          eventType: 'ledger.access_revoked',
          link: '/app/m/runly.ledger/memberships',
          title: 'Se revocó tu acceso',
          body: `Ya no tienes acceso a la cuenta "${account.name}"`,
          recipients: { userIds: [targetUserId] },
          channels: ['in_app', 'email', 'web_push'],
          priority: 'low',
          metadata: { resource_type: 'account', resource_name: account.name },
        },
      }).catch(logNotificationError)
    }
    return row
  }

  // ── Memberships (actor's own view) ────────────────────────────────────────

  async function listMemberships({ companyId, actorId }) {
    const [groups, accounts] = await Promise.all([
      prisma.$queryRaw`
        SELECT g.id, g.name, gm.role, gm.invited_at,
          COUNT(DISTINCT gm2.user_id) FILTER (WHERE gm2.status = 'active')::int4 AS member_count
        FROM ledger_group_member gm
        JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
        LEFT JOIN ledger_group_member gm2 ON gm2.group_id = g.id
        WHERE gm.user_id = ${actorId}::uuid AND gm.status = 'active'
          AND g.company_id = ${companyId}::uuid
          AND g.created_by != ${actorId}::uuid
        GROUP BY g.id, gm.role, gm.invited_at
        ORDER BY g.name
      `,
      prisma.$queryRaw`
        SELECT a.id, a.name, a.bank, a.currency, am.role, am.invited_at,
          p.display_name AS owner_name
        FROM ledger_account_member am
        JOIN ledger_account a ON a.id = am.account_id AND a.enabled = true
        JOIN user_profile p ON p.id = a.owner_id
        WHERE am.user_id = ${actorId}::uuid AND am.status = 'active'
          AND a.company_id = ${companyId}::uuid
        ORDER BY a.name
      `,
    ])
    return { data: { groups, accounts } }
  }

  async function leaveGroup({ companyId, actorId, groupId }) {
    const rows = await prisma.$queryRaw`
      DELETE FROM ledger_group_member
      WHERE group_id = ${groupId}::uuid AND user_id = ${actorId}::uuid
        AND EXISTS (
          SELECT 1 FROM ledger_group WHERE id = ${groupId}::uuid AND company_id = ${companyId}::uuid
        )
      RETURNING *
    `
    if (!firstRow(rows)) throw new CollaborationServiceError('No eres miembro de este grupo.', 404)
    return { ok: true }
  }

  async function leaveAccount({ companyId, actorId, accountId }) {
    const rows = await prisma.$queryRaw`
      DELETE FROM ledger_account_member
      WHERE account_id = ${accountId}::uuid AND user_id = ${actorId}::uuid
        AND EXISTS (
          SELECT 1 FROM ledger_account WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
        )
      RETURNING *
    `
    if (!firstRow(rows)) throw new CollaborationServiceError('No eres colaborador de esta cuenta.', 404)
    return { ok: true }
  }

  async function rejectGroupInvitation({ companyId, actorId, groupId }) {
    const rows = await prisma.$queryRaw`
      UPDATE ledger_group_member
      SET status = 'rejected'
      WHERE group_id = ${groupId}::uuid AND user_id = ${actorId}::uuid
        AND EXISTS (
          SELECT 1 FROM ledger_group WHERE id = ${groupId}::uuid AND company_id = ${companyId}::uuid
        )
      RETURNING *
    `
    if (!firstRow(rows)) throw new CollaborationServiceError('Invitación no encontrada.', 404)
    return { ok: true }
  }

  async function rejectAccountInvitation({ companyId, actorId, accountId }) {
    const rows = await prisma.$queryRaw`
      UPDATE ledger_account_member
      SET status = 'rejected'
      WHERE account_id = ${accountId}::uuid AND user_id = ${actorId}::uuid
        AND EXISTS (
          SELECT 1 FROM ledger_account WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
        )
      RETURNING *
    `
    if (!firstRow(rows)) throw new CollaborationServiceError('Invitación no encontrada.', 404)
    return { ok: true }
  }

  return {
    listAccountMembers,
    inviteAccountMember,
    updateAccountMemberRole,
    removeAccountMember,
    listMemberships,
    leaveGroup,
    leaveAccount,
    rejectGroupInvitation,
    rejectAccountInvitation,
  }
}
