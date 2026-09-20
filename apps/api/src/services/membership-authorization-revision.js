import { createHash } from 'node:crypto';

// Realtime rotates globally, including changes to other users' private resources.
// UI authorization must instead change only with this member's effective access.
export function membershipAuthorizationRevision(membership, grants = []) {
  const role = membership.role;
  const permissions = new Set((role?.permissions ?? [])
    .filter(({ permission }) => permission.active).map(({ permission }) => permission.key));
  for (const grant of grants) {
    if (grant.companyId === membership.companyId && grant.permission.active) permissions.add(grant.permission.key);
  }
  return createHash('sha256').update(JSON.stringify({
    companyId: membership.companyId, userId: membership.userId,
    roleId: role?.id ?? null, roleKey: role?.key ?? null,
    permissions: [...permissions].sort(),
  })).digest('hex');
}
