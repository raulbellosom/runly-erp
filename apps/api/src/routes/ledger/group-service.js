import { createUserAccessService } from '../../services/user-access-service.js';
// apps/api/src/routes/ledger/group-service.js
import { createNotificationService } from '../../services/notification-service.js'
import { firstRow, isUniqueViolation } from './service-helpers.js'

export class GroupServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'GroupServiceError'
    this.status = status
  }
}

function logNotificationError(err) {
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/groups] notification publish failed', err)
}

export function createGroupService({ prisma }) {
  const notifService = createNotificationService({ prisma })

  // ── Internal helpers ──────────────────────────────────────────────────────

  async function requireGroupAccess({ companyId, groupId, actorId, minRole = null }) {
    const rows = await prisma.$queryRaw`
      SELECT g.id, g.name, g.created_by, gm.role, gm.status
      FROM ledger_group g
      LEFT JOIN ledger_group_member gm ON gm.group_id = g.id AND gm.user_id = ${actorId}::uuid
      WHERE g.id = ${groupId}::uuid AND g.company_id = ${companyId}::uuid AND g.enabled = true
    `
    const row = firstRow(rows)
    if (!row) throw new GroupServiceError('Grupo no encontrado.', 404)

    const isMemberActive = row.status === 'active'
    const isCreator = row.created_by === actorId
    const hasAccess = isCreator || isMemberActive
    if (!hasAccess) throw new GroupServiceError('No tienes acceso a este grupo.', 403)

    if (minRole) {
      const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 }
      const actorRank = isCreator ? 3 : (ROLE_RANK[row.role] ?? 0)
      if (actorRank < ROLE_RANK[minRole]) {
        throw new GroupServiceError('No tienes permisos suficientes en este grupo.', 403)
      }
    }
    return row
  }

  async function getActorDisplayName(actorId) {
    const rows = await prisma.$queryRaw`
      SELECT display_name FROM user_profile WHERE id = ${actorId}::uuid
    `
    return firstRow(rows)?.display_name ?? 'Un usuario'
  }

  // ── Group CRUD ────────────────────────────────────────────────────────────

  async function createGroup({ companyId, actorId, data }) {
    const name = String(data.name).trim()
    try {
      const rows = await prisma.$queryRaw`
        WITH new_group AS (
          INSERT INTO ledger_group (company_id, name, created_by)
          VALUES (${companyId}::uuid, ${name}, ${actorId}::uuid)
          RETURNING *
        ),
        _member AS (
          INSERT INTO ledger_group_member (group_id, user_id, role, invited_by, status)
          SELECT id, ${actorId}::uuid, 'admin', ${actorId}::uuid, 'active'
          FROM new_group
        )
        SELECT * FROM new_group
      `
      return firstRow(rows)
    } catch (err) {
      if (isUniqueViolation(err)) throw new GroupServiceError(`Ya existe un grupo con el nombre "${name}".`, 409)
      throw err
    }
  }

  async function listGroups({ companyId, actorId }) {
    const rows = await prisma.$queryRaw`
      SELECT g.*,
        gm.role AS my_role,
        COUNT(DISTINCT gm2.user_id) FILTER (WHERE gm2.status = 'active')::int4 AS member_count,
        COUNT(DISTINCT a.id) FILTER (WHERE a.enabled = true)::int4 AS account_count
      FROM ledger_group g
      LEFT JOIN ledger_group_member gm
        ON gm.group_id = g.id AND gm.user_id = ${actorId}::uuid AND gm.status = 'active'
      LEFT JOIN ledger_group_member gm2 ON gm2.group_id = g.id
      LEFT JOIN ledger_account a ON a.group_id = g.id
      WHERE g.company_id = ${companyId}::uuid
        AND g.enabled = true
        AND (
          g.created_by = ${actorId}::uuid
          OR (gm.user_id IS NOT NULL AND gm.status = 'active')
        )
      GROUP BY g.id, gm.role
      ORDER BY g.name
    `
    return { data: rows }
  }

  async function getGroup({ companyId, groupId, actorId }) {
    const group = await requireGroupAccess({ companyId, groupId, actorId })

    const [memberRows, accountRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT gm.*, p.display_name, p.email
        FROM ledger_group_member gm
        JOIN user_profile p ON p.id = gm.user_id
        WHERE gm.group_id = ${groupId}::uuid AND gm.status = 'active'
        ORDER BY p.display_name
      `,
      prisma.$queryRaw`
        SELECT a.id, a.name, a.bank, a.currency,
          a.opening_balance + COALESCE(
            SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0)) FILTER (WHERE t.enabled = true),
            0
          ) AS current_balance,
          a.owner_id, a.enabled
        FROM ledger_account a
        LEFT JOIN ledger_transaction t ON t.account_id = a.id
        WHERE a.group_id = ${groupId}::uuid AND a.enabled = true
        GROUP BY a.id
        ORDER BY a.name
      `,
    ])

    return {
      data: {
        ...group,
        members: memberRows,
        accounts: accountRows,
      },
    }
  }

  async function updateGroup({ companyId, groupId, actorId, data }) {
    await requireGroupAccess({ companyId, groupId, actorId, minRole: 'admin' })
    const name = String(data.name).trim()
    try {
      const rows = await prisma.$queryRaw`
        UPDATE ledger_group
        SET name = ${name}, updated_at = NOW()
        WHERE id = ${groupId}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const row = firstRow(rows)
      if (!row) throw new GroupServiceError('Grupo no encontrado.', 404)
      return row
    } catch (err) {
      if (isUniqueViolation(err)) throw new GroupServiceError(`Ya existe un grupo con el nombre "${name}".`, 409)
      throw err
    }
  }

  async function deleteGroup({ companyId, groupId, actorId }) {
    const group = await requireGroupAccess({ companyId, groupId, actorId })
    if (group.created_by !== actorId) {
      throw new GroupServiceError('Solo el creador del grupo puede eliminarlo.', 403)
    }
    const rows = await prisma.$queryRaw`
      UPDATE ledger_group
      SET enabled = false, updated_at = NOW()
      WHERE id = ${groupId}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    return firstRow(rows)
  }

  // ── Member management ─────────────────────────────────────────────────────

  async function inviteMember({ companyId, groupId, actorId, actorName, data }) {
    const group = await requireGroupAccess({ companyId, groupId, actorId, minRole: 'admin' })
    const { user_id: targetUserId, role } = data
    await createUserAccessService({ prisma }).assertCandidates({ companyId, userIds: [targetUserId] });

    if (targetUserId === actorId) {
      throw new GroupServiceError('No puedes invitarte a ti mismo.', 400)
    }

    try {
      await prisma.$queryRaw`
        INSERT INTO ledger_group_member (group_id, user_id, role, invited_by, status)
        VALUES (${groupId}::uuid, ${targetUserId}::uuid, ${role}, ${actorId}::uuid, 'pending')
        ON CONFLICT (group_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, invited_at = NOW(),
              status = CASE WHEN ledger_group_member.status = 'active' THEN 'active' ELSE 'pending' END
      `
    } catch (err) {
      if (err.message?.includes('violates foreign key')) {
        throw new GroupServiceError('Usuario no encontrado.', 404)
      }
      throw err
    }

    await notifService.publish({
      companyId,
      actorId,
      input: {
        eventType: 'ledger.group_invite',
        link: `/app/m/runly.ledger/groups/${groupId}`,
        title: `Te invitaron al grupo "${group.name}"`,
        body: `Rol asignado: ${role}`,
        recipients: { userIds: [targetUserId] },
        channels: ['in_app', 'email', 'web_push'],
        priority: 'medium',
        sourceType: 'ledger_group',
        sourceId: groupId,
        metadata: {
          resource_type: 'group',
          resource_id: groupId,
          resource_name: group.name,
          role,
          invited_by_name: actorName,
        },
      },
    }).catch(logNotificationError)

    return { ok: true }
  }

  async function updateMemberRole({ companyId, groupId, actorId, targetUserId, data }) {
    await requireGroupAccess({ companyId, groupId, actorId, minRole: 'admin' })
    const rows = await prisma.$queryRaw`
      UPDATE ledger_group_member
      SET role = ${data.role}
      WHERE group_id = ${groupId}::uuid AND user_id = ${targetUserId}::uuid AND status = 'active'
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new GroupServiceError('Miembro no encontrado.', 404)
    return row
  }

  async function removeMember({ companyId, groupId, actorId, targetUserId, actorName }) {
    const group = await requireGroupAccess({ companyId, groupId, actorId, minRole: 'admin' })
    const rows = await prisma.$queryRaw`
      DELETE FROM ledger_group_member
      WHERE group_id = ${groupId}::uuid AND user_id = ${targetUserId}::uuid
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new GroupServiceError('Miembro no encontrado.', 404)

    if (targetUserId !== actorId) {
      await notifService.publish({
        companyId,
        actorId,
        input: {
          eventType: 'ledger.access_revoked',
          link: '/app/m/runly.ledger/memberships',
          title: 'Se revocó tu acceso',
          body: `Ya no tienes acceso al grupo "${group.name}"`,
          recipients: { userIds: [targetUserId] },
          channels: ['in_app', 'email', 'web_push'],
          priority: 'low',
          metadata: { resource_type: 'group', resource_name: group.name },
        },
      }).catch(logNotificationError)
    }
    return row
  }

  return {
    createGroup,
    listGroups,
    getGroup,
    updateGroup,
    deleteGroup,
    inviteMember,
    updateMemberRole,
    removeMember,
  }
}
