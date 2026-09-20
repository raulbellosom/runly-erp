// Resolves which single company a request operates on (the "active tenant"),
// and computes permissions scoped to ONLY that company's membership — never a
// union across every company the user belongs to.
//
// Kept side-effect-free (resolveActiveMembership / computeScopedPermissions /
// isSystemAdminMembership take already-loaded data) so it can be unit-tested
// with node --test without a database, matching the pattern already used by
// apps/api/src/lib/permission-grants.js.
//
// Spec: docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md

// Both spellings are accepted: fresh installs seed "runly.admin"; existing
// installs seeded before the Runly rebrand still have "atlas.admin" persisted.
export const COMPANY_ADMIN_ROLE_KEYS = new Set(["runly.admin", "atlas.admin"]);
export const SYSTEM_ADMIN_ROLE_KEYS = new Set(["system.admin"]);

export const TENANT_ERROR = {
  NOT_MEMBER: "company_not_member",
  COMPANY_REQUIRED: "company_required",
};

// memberships: the ACTIVE (role.enabled) memberships already loaded by
// _loadUserContext, each shaped like
//   { companyId, company: { id, enabled }, role: { key, permissions: [{ permission: { key } }] } }
// requestedCompanyId: value of the X-Runly-Company-Id header (X-Atlas-Company-Id fallback), or null.
// strict: when true (the default — used for actual business-data routes),
//   multiple memberships with no header is a 400. When false (used for
//   bootstrap endpoints called before the frontend may have chosen a company
//   yet — /user/me, /runtime/modules, /blueprints, requireModuleAccess),
//   the same situation resolves to membership: null instead of erroring.
//
// Returns { ok: true, membership } or { ok: false, status, code, message }.
export function resolveActiveMembership({ memberships, requestedCompanyId, strict = true }) {
  const list = Array.isArray(memberships) ? memberships : [];

  if (requestedCompanyId) {
    const match = list.find(
      (m) => m.companyId === requestedCompanyId && m.company?.enabled !== false,
    );
    if (!match) {
      return {
        ok: false,
        status: 403,
        code: TENANT_ERROR.NOT_MEMBER,
        message: "No perteneces a esta empresa o no está activa.",
      };
    }
    return { ok: true, membership: match };
  }

  if (list.length === 1) {
    return { ok: true, membership: list[0] };
  }

  if (list.length === 0) {
    return { ok: true, membership: null };
  }

  if (strict) {
    return {
      ok: false,
      status: 400,
      code: TENANT_ERROR.COMPANY_REQUIRED,
      message: "Selecciona una empresa activa.",
    };
  }

  return { ok: true, membership: null };
}

// activeMembership: result of resolveActiveMembership (or null).
// grantKeysForCompany: string[] of UserPermissionGrant keys already scoped to
//   activeMembership.companyId (never mix in another company's grants).
// allPermissionKeys: string[] of every active Permission.key in the instance —
//   only actually merged in when the active membership is a company admin, or
//   isSystemAdmin is true.
export function computeScopedPermissions({
  activeMembership,
  grantKeysForCompany = [],
  allPermissionKeys = [],
  basePermissionKeys = [],
  isSystemAdmin = false,
}) {
  const permissionSet = new Set(basePermissionKeys);
  const roleKey = activeMembership?.role?.key ?? null;
  const isCompanyAdmin = Boolean(roleKey && COMPANY_ADMIN_ROLE_KEYS.has(roleKey));

  if (activeMembership) {
    for (const rolePermission of activeMembership.role?.permissions ?? []) {
      const key = rolePermission?.permission?.key;
      if (key && rolePermission?.permission?.active !== false) permissionSet.add(key);
    }
    for (const key of grantKeysForCompany) {
      if (key) permissionSet.add(key);
    }
  }

  if (isCompanyAdmin || isSystemAdmin) {
    for (const key of allPermissionKeys) permissionSet.add(key);
  }

  return { permissionSet, isCompanyAdmin, roleKey };
}

// True if ANY of the user's memberships (not just the active one) carries
// system.admin — deliberately NOT scoped to activeCompanyId, since system
// admin is an instance-wide platform role by design (spec §5.3/§9).
export function isSystemAdminMembership(memberships) {
  return (memberships ?? []).some((m) => SYSTEM_ADMIN_ROLE_KEYS.has(m?.role?.key) && m.role.companyId == null);
}

// The one function here that touches Prisma/cache: a cached lookup of every
// active Permission.key, needed only when expanding a company/system admin's
// permissionSet. Returns an async getter closed over the given deps so
// callers don't need to pass prisma/cache on every call.
export function createPermissionKeysCache({ prisma, cacheGet, cacheSet, ttlSeconds }) {
  const CACHE_KEY = "permissions:all-active";
  return async function getAllActivePermissionKeys() {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return cached;
    const rows = await prisma.permission.findMany({
      where: { active: true },
      select: { key: true },
      take: 1000,
    });
    const keys = rows.map((row) => row.key);
    cacheSet(CACHE_KEY, keys, ttlSeconds);
    return keys;
  };
}
