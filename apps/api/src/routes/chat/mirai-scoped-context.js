// apps/api/src/routes/chat/mirai-scoped-context.js
//
// Resolves the MirAI caller's RBAC context SCOPED TO ctx.companyId (the
// caller's validated active company, sourced from c.get("companyId") upstream)
// — never resolveUserContext's raw union-across-every-company
// isAdmin/permissionSet, which would let an admin role in Company A leak into
// a MirAI call made while Company B is active. See
// docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §16.
// Shared by the read tools (mirai-tools.js) and the action registry.
import {
  resolveActiveMembership,
  computeScopedPermissions,
  isSystemAdminMembership,
  createPermissionKeysCache,
  COMPANY_ADMIN_ROLE_KEYS,
} from "../../lib/tenant-context.js";
import { get as cacheGet, set as cacheSet, TTL } from "../../lib/cache.js";

export function createScopedErpContextResolver({ prisma, resolveUserContext }) {
  const getAllActivePermissionKeys = createPermissionKeysCache({
    prisma,
    cacheGet,
    cacheSet,
    ttlSeconds: TTL.PERMISSIONS,
  });

  // Returns { uctx, companyId, userId, isAdmin, permissionSet } or { error }.
  return async function resolveScopedErpContext(ctx) {
    if (typeof resolveUserContext !== "function") return { error: "Esa consulta no esta disponible aqui." };
    let uctx;
    try { uctx = await resolveUserContext(ctx.actorAuthUserId); } catch { uctx = null; }
    if (!uctx?.profile) return { error: "No pude verificar tus permisos." };

    const membershipResult = resolveActiveMembership({
      memberships: uctx.memberships,
      requestedCompanyId: ctx.companyId ?? null,
      strict: false,
    });
    const activeMembership = membershipResult.ok ? membershipResult.membership : null;
    const companyId = activeMembership?.companyId ?? null;
    if (!companyId) return { error: "Sin empresa activa." };

    const isSystemAdmin = isSystemAdminMembership(uctx.memberships);
    const grantSet = uctx.grantsByCompany?.get?.(companyId);
    const roleKey = activeMembership?.role?.key ?? null;
    const isCompanyAdminRole = Boolean(roleKey && COMPANY_ADMIN_ROLE_KEYS.has(roleKey));
    const allPermissionKeys =
      isSystemAdmin || isCompanyAdminRole ? await getAllActivePermissionKeys() : [];
    const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
      activeMembership,
      grantKeysForCompany: grantSet ? [...grantSet] : [],
      allPermissionKeys,
      basePermissionKeys: [],
      isSystemAdmin,
    });

    return { uctx, companyId, userId: uctx.profile.id, isAdmin: isCompanyAdmin || isSystemAdmin, permissionSet };
  };
}

export function hasScopedPermission(scope, permissionKey) {
  return Boolean(scope?.isAdmin || scope?.permissionSet?.has(permissionKey));
}
