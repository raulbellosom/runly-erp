// Resolves a user's real, company-scoped RBAC permission set OUTSIDE the
// normal HTTP request/response cycle — for services that need to answer
// "does this user have permission X in company Y" without a Hono context
// (e.g. a background job, or a module descriptor invoked from
// transcript-proposal-registry.js). Uses the exact same primitives as the
// tenant-context middleware (apps/api/src/index.js) so this is never a
// second, drifting implementation of auth — just a direct lookup.
import { computeScopedPermissions, isSystemAdminMembership } from "./tenant-context.js";

// Deliberately resolves membership for ONE specific company (never "all of
// the caller's memberships, then filter") — the caller already knows which
// company matters (e.g. from a transcript row), and that company id must
// never be re-derived from the request/token here.
export async function resolveCompanyPermissions({ prisma, profileId, companyId }) {
  const [activeMembership, allMemberships, grants] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId: profileId, companyId, enabled: true },
      include: {
        role: {
          include: {
            permissions: {
              where: { permission: { active: true } },
              include: { permission: { select: { key: true } } },
            },
          },
        },
      },
    }),
    prisma.membership.findMany({
      where: { userId: profileId, enabled: true },
      select: { role: { select: { key: true, companyId: true } } },
    }),
    prisma.userPermissionGrant.findMany({
      where: { userId: profileId, companyId, permission: { active: true } },
      select: { permission: { select: { key: true } } },
    }),
  ]);
  const isSystemAdmin = isSystemAdminMembership(allMemberships);
  const grantKeysForCompany = grants.map((g) => g.permission.key);
  // allPermissionKeys intentionally left empty: the admin-wildcard expansion
  // computeScopedPermissions would otherwise do requires the cached full
  // permission catalog (createPermissionKeysCache), extra plumbing not
  // needed here. isCompanyAdmin/isSystemAdmin are returned directly instead
  // — callers OR them with a specific permission check rather than relying
  // on the function's own wildcard expansion.
  const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
    activeMembership,
    grantKeysForCompany,
    allPermissionKeys: [],
    basePermissionKeys: [],
    isSystemAdmin,
  });
  return { permissionSet, isCompanyAdmin, isSystemAdmin };
}

export function hasCompanyPermission({ permissionSet, isCompanyAdmin, isSystemAdmin }, key) {
  return Boolean(isCompanyAdmin || isSystemAdmin || permissionSet.has(key));
}
