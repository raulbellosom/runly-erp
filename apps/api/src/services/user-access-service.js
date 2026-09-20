import { COMPANY_ADMIN_ROLE_KEYS, SYSTEM_ADMIN_ROLE_KEYS } from '../lib/tenant-context.js';

export class UserAccessError extends Error {
  constructor() {
    super('Recurso no encontrado o no disponible.');
    this.status = 404;
    this.code = 'resource_unavailable';
  }
}

// Discovery is deliberately separate from administrative profile access.
export const DIRECTORY_USER_SELECT = {
  id: true, displayName: true, firstName: true, lastName: true, avatarFileId: true,
};

export function createUserAccessService({ prisma }) {
  function membershipWhere(companyId) {
    if (!companyId) throw new UserAccessError();
    return { companyId, enabled: true, company: { enabled: true }, user: { enabled: true }, OR: [{ roleId: null }, { role: { enabled: true, OR: [{ companyId: null }, { companyId }] } }] };
  }

  async function assertCompanyMember(companyId, userId, permission = null) {
    if (!userId) throw new UserAccessError();
    const member = await prisma.membership.findFirst({
      where: { ...membershipWhere(companyId), userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!member) throw new UserAccessError();
    const systemAdmin = SYSTEM_ADMIN_ROLE_KEYS.has(member.role?.key) && member.role.companyId == null;
    if (permission && !COMPANY_ADMIN_ROLE_KEYS.has(member.role?.key) && !systemAdmin) {
      const allowed = member.role?.permissions?.some(({ permission: p }) => p.active && p.key === permission);
      if (!allowed) {
        const grant = await prisma.userPermissionGrant.findFirst({
          where: { companyId, userId, permission: { key: permission, active: true } }, select: { id: true },
        });
        if (!grant) throw new UserAccessError();
      }
    }
    return member;
  }

  async function assertCandidates({ companyId, userIds, permission = null, projectId = null }) {
    const ids = [...new Set((userIds ?? []).filter(Boolean))];
    for (const userId of ids) {
      await assertCompanyMember(companyId, userId, permission);
      if (projectId) {
        const member = await prisma.projectMember.findFirst({ where: { projectId, userId }, select: { id: true } });
        if (!member && !(await prisma.project.findFirst({ where: { id: projectId, companyId, ownerId: userId }, select: { id: true } }))) throw new UserAccessError();
      }
    }
    return ids;
  }

  async function listCandidates({ companyId, actorId, search = '', limit = 50, permission = null, projectId = null }) {
    await assertCompanyMember(companyId, actorId, permission);
    if (projectId) await assertCandidates({ companyId, userIds: [actorId], projectId });
    const project = projectId ? await prisma.project.findFirst({ where: { id: projectId, companyId }, select: { ownerId: true } }) : null;
    if (projectId && !project) throw new UserAccessError();
    const q = String(search).trim().slice(0, 100);
    const eligible = permission ? await prisma.$queryRaw`SELECT user_id FROM membership WHERE company_id = ${companyId}::uuid AND public.runly_member_active(company_id, user_id, ${permission})` : null;
    const projectMembers = projectId ? await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } }) : null;
    if (projectMembers && project?.ownerId) projectMembers.push({ userId: project.ownerId });
    const rows = await prisma.membership.findMany({
      where: {
        ...membershipWhere(companyId),
        ...(eligible ? { userId: { in: eligible.map((m) => m.user_id).filter((id) => !projectMembers || projectMembers.some((m) => m.userId === id)) } } : projectMembers ? { userId: { in: projectMembers.map((m) => m.userId) } } : {}),
        user: { enabled: true, isBot: false, ...(q ? { OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ] } : {}) },
      },
      select: { user: { select: DIRECTORY_USER_SELECT } },
      orderBy: { user: { displayName: 'asc' } }, take: Math.min(100, Math.max(1, Number(limit) || 50)),
    });
    return rows.map(({ user }) => user);
  }

  return { assertCompanyMember, assertCandidates, listCandidates, membershipWhere };
}
