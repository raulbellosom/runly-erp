// Pure decision-logic helpers for the membership-management endpoints in
// apps/api/src/index.js. Kept side-effect-free and unit-tested directly —
// see apps/api/src/services/__tests__/identity-memberships.test.js.
// Spec: docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md

export function checkMembershipRoleScope({ roleCompanyId, membershipCompanyId }) {
  if (roleCompanyId === undefined) return { ok: true };
  if (roleCompanyId === null) return { ok: true };
  if (roleCompanyId === membershipCompanyId) return { ok: true };
  return {
    ok: false,
    status: 400,
    error: "El rol seleccionado no pertenece a esta empresa.",
  };
}

export function checkProtectedRoleAssignment({ roleKey, protectedKeys, actorCanManageRoles }) {
  const normalizedKey = String(roleKey ?? "").trim().toLowerCase();
  const isProtected = protectedKeys instanceof Set && protectedKeys.has(normalizedKey);
  if (!isProtected || actorCanManageRoles) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: "Asignar el rol Runly Admin o System Admin requiere permisos de gestion de roles.",
  };
}

export function checkSelfLockout({ isActingOnSelf, enabledMembershipIds, membershipId, disabling }) {
  if (!isActingOnSelf || !disabling) return { ok: true };
  const ids = Array.isArray(enabledMembershipIds) ? enabledMembershipIds : [];
  const isOnlyEnabledMembership = ids.length === 1 && ids[0] === membershipId;
  if (!isOnlyEnabledMembership) return { ok: true };
  return {
    ok: false,
    status: 400,
    error: "No puedes deshabilitar el acceso a tu única empresa habilitada.",
  };
}

export function findExistingMembership({ memberships, companyId }) {
  const list = Array.isArray(memberships) ? memberships : [];
  return list.find((m) => m?.companyId === companyId) ?? null;
}
