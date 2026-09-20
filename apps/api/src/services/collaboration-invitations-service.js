import { createHash, randomBytes } from 'node:crypto';
import { createUserAccessService, UserAccessError } from './user-access-service.js';

// Resource invitations are capabilities, not a global user/email directory.
export function createCollaborationInvitationsService({ prisma }) {
  const digest = (value) => createHash('sha256').update(String(value)).digest('hex');

  async function assertOwner(tx, { resourceType, resourceId, actorId, companyId }) {
    if (!companyId) throw new UserAccessError();
    if (resourceType === 'company') {
      if (resourceId !== companyId) throw new UserAccessError();
      await createUserAccessService({ prisma: tx }).assertCompanyMember(companyId, actorId, 'identity.users.create');
      return;
    }
    const rows = resourceType === 'chat' 
      ? await tx.$queryRaw`SELECT c.id FROM chat_conversations c
          JOIN chat_conversation_members m ON m.conversation_id = c.id
          WHERE c.id = ${resourceId}::uuid AND c.company_id = ${companyId}::uuid
            AND c.type IN ('channel', 'group') AND m.user_id = ${actorId}::uuid AND m.role = 'owner'
            AND public.runly_chat_user_access(c.id, m.user_id)
            AND public.runly_member_active(c.company_id, m.user_id)`
      : resourceType === 'note'
        ? await tx.$queryRaw`SELECT id FROM notes WHERE id = ${resourceId}::uuid
            AND company_id = ${companyId}::uuid AND owner_user_id = ${actorId}::uuid
            AND public.runly_note_user_access(id, ${actorId}::uuid, true)`
        : [];
    if (!rows.length) throw new UserAccessError();
  }

  async function create({ resourceType, resourceId, actorId, companyId, permission = 'read', email = null, roleId = null }) {
    await assertOwner(prisma, { resourceType, resourceId, actorId, companyId });
    if (!['read', 'edit'].includes(permission)) throw new UserAccessError();
    if (resourceType === 'company') {
      if (typeof email !== 'string' || !email.includes('@')) throw new UserAccessError();
      if (roleId) {
        const role = await prisma.role.findFirst({ where: { id: roleId, enabled: true, OR: [{ companyId: null }, { companyId }] } });
        if (!role) throw new UserAccessError();
        if (['runly.admin', 'atlas.admin', 'system.admin'].includes(role.key)) {
          const actor = await createUserAccessService({ prisma }).assertCompanyMember(companyId, actorId, 'identity.roles.update');
          if (role.key === 'system.admin' && (actor.role?.key !== 'system.admin' || actor.role?.companyId !== null)) throw new UserAccessError();
        }
      }
    }
    const token = randomBytes(32).toString('base64url');
    const [invite] = await prisma.$queryRaw`INSERT INTO collaboration_invitation
      (token_hash, resource_type, resource_id, company_id, created_by, permission, email_hash, role_id)
      VALUES (${digest(token)}, ${resourceType}, ${resourceId}::uuid, ${companyId}::uuid, ${actorId}::uuid, ${permission}, ${resourceType === 'company' ? digest(email.trim().toLowerCase()) : null}, ${roleId}::uuid)
      RETURNING id, expires_at`;
    return { id: invite.id, token, expiresAt: invite.expires_at };
  }

  async function accept({ token, actorId }) {
    if (typeof token !== 'string' || token.length > 200 || !actorId) throw new UserAccessError();
    return prisma.$transaction(async (tx) => {
      const [invite] = await tx.$queryRaw`SELECT * FROM collaboration_invitation
        WHERE token_hash = ${digest(token)} AND expires_at > now() AND accepted_by IS NULL AND revoked_at IS NULL FOR UPDATE`;
      if (!invite) throw new UserAccessError();
      await assertOwner(tx, { resourceType: invite.resource_type, resourceId: invite.resource_id, actorId: invite.created_by, companyId: invite.company_id });
      const user = await tx.userProfile.findFirst({ where: { id: actorId, enabled: true, isBot: false }, select: { id: true, email: true } });
      if (!user || actorId === invite.created_by) throw new UserAccessError();
      if (invite.resource_type === 'company') {
        if (digest(user.email.trim().toLowerCase()) !== invite.email_hash) throw new UserAccessError();
        if (invite.role_id) {
          const role = await tx.role.findFirst({ where: { id: invite.role_id, enabled: true, OR: [{ companyId: null }, { companyId: invite.company_id }] } });
          if (!role) throw new UserAccessError();
          if (['runly.admin', 'atlas.admin', 'system.admin'].includes(role.key)) {
            const inviter = await createUserAccessService({ prisma: tx }).assertCompanyMember(invite.company_id, invite.created_by, 'identity.roles.update');
            if (role.key === 'system.admin' && (inviter.role?.key !== 'system.admin' || inviter.role?.companyId !== null)) throw new UserAccessError();
          }
        }
        const existing = await tx.membership.findUnique({ where: { companyId_userId: { companyId: invite.company_id, userId: actorId } } });
        if (!existing) await tx.membership.create({ data: { companyId: invite.company_id, userId: actorId, roleId: invite.role_id } });
        else if (!existing.enabled) await tx.membership.update({ where: { id: existing.id }, data: { enabled: true, roleId: invite.role_id } });
      } else if (invite.resource_type === 'chat') {
        const [memberRole] = await tx.$queryRaw`SELECT id FROM chat_channel_roles WHERE conversation_id = ${invite.resource_id}::uuid AND name = 'Member' LIMIT 1`;
        // A normal invite never grants channel administration or directory access.
        await tx.$executeRaw`INSERT INTO chat_conversation_members (conversation_id, user_id, role, external_access, role_id)
          VALUES (${invite.resource_id}::uuid, ${actorId}::uuid, 'member', true, ${memberRole?.id ?? null}::uuid)
          ON CONFLICT (conversation_id, user_id) WHERE user_id IS NOT NULL AND left_at IS NULL
          DO UPDATE SET external_access = true`;
      } else {
        await tx.$executeRaw`INSERT INTO note_shares (note_id, shared_with_user_id, shared_by_user_id, permission, external_access)
          VALUES (${invite.resource_id}::uuid, ${actorId}::uuid, ${invite.created_by}::uuid, ${invite.permission}, true)
          ON CONFLICT (note_id, shared_with_user_id) DO UPDATE SET permission = EXCLUDED.permission, external_access = true`;
      }
      await tx.$executeRaw`UPDATE collaboration_invitation SET accepted_by = ${actorId}::uuid, accepted_at = now() WHERE id = ${invite.id}::uuid`;
      return { resourceType: invite.resource_type, resourceId: invite.resource_id };
    });
  }

  async function revoke({ invitationId, actorId, companyId }) {
    await prisma.$transaction(async (tx) => {
    const [invite] = await tx.$queryRaw`SELECT * FROM collaboration_invitation
      WHERE id = ${invitationId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!invite) throw new UserAccessError();
    await assertOwner(tx, { resourceType: invite.resource_type, resourceId: invite.resource_id, actorId, companyId });
    if (invite.resource_type === 'company') {
      if (invite.accepted_by === actorId) throw new UserAccessError();
      await createUserAccessService({ prisma: tx }).assertCompanyMember(companyId, actorId, 'identity.users.update');
    }
      await tx.$executeRaw`UPDATE collaboration_invitation SET revoked_at = now() WHERE id = ${invitationId}::uuid`;
      if (!invite.accepted_by) return;
      if (invite.resource_type === 'company') {
        await tx.membership.updateMany({ where: { companyId: invite.company_id, userId: invite.accepted_by }, data: { enabled: false } });
      } else if (invite.resource_type === 'chat') {
        await tx.$executeRaw`UPDATE chat_conversation_members SET left_at = now(), external_access = false
          WHERE conversation_id = ${invite.resource_id}::uuid AND user_id = ${invite.accepted_by}::uuid AND external_access`;
      } else {
        await tx.$executeRaw`DELETE FROM note_shares WHERE note_id = ${invite.resource_id}::uuid
          AND shared_with_user_id = ${invite.accepted_by}::uuid AND external_access`;
      }
    });
    return { ok: true };
  }

  async function list({ resourceType, resourceId, actorId, companyId }) {
    await assertOwner(prisma, { resourceType, resourceId, actorId, companyId });
    return prisma.$queryRaw`SELECT id, permission, expires_at AS "expiresAt", accepted_at AS "acceptedAt"
      FROM collaboration_invitation WHERE resource_type = ${resourceType} AND resource_id = ${resourceId}::uuid
        AND company_id = ${companyId}::uuid AND revoked_at IS NULL
        AND (expires_at > now() OR accepted_at IS NOT NULL) ORDER BY created_at DESC LIMIT 100`;
  }
  return { create, accept, revoke, list };
}
