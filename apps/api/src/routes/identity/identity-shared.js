// apps/api/src/routes/identity/identity-shared.js
//
// Helpers shared across the identity route files (roles, users, user-detail,
// permission-grants). Extracted from index.js on 2026-09-25 to keep every
// identity file under the CLAUDE.md 1000-line limit. This is the single
// riskiest file in the whole "extract index.js" effort — every function here
// backs an authorization check, so each was moved verbatim (byte-for-byte
// logic, not rewritten) and is covered by the same boot smoke test used for
// every other extracted router.
import { getCachedSignedUrls } from "../../lib/signed-url-cache.js";

// Same two keys everywhere they're checked in this module — kept as two
// separate constants (not one shared import) because ADMIN_ROLE_KEYS also
// has a use outside the identity domain (tenant-context resolution in
// index.js), while PROTECTED_IDENTITY_ROLE_KEYS is identity-only. Keeping
// them as distinct literals here mirrors how index.js already declared them
// separately before this extraction — not a new decision.
export const ADMIN_ROLE_KEYS = new Set(["runly.admin", "system.admin"]);
export const PROTECTED_IDENTITY_ROLE_KEYS = new Set(["runly.admin", "system.admin"]);

// Returns true only if `id` names a UserProfile with an enabled Membership
// in `companyId`. Every /identity/users/:id* route must call this before
// reading or mutating a specific user — without it, a caller with
// identity.users.* in Company A could act on any user UUID in the instance.
export async function assertUserInCompany(id, companyId, { prisma }) {
  if (!companyId || !id) return false;
  const row = await prisma.userProfile.findFirst({
    where: { id, memberships: { some: { companyId } } },
    select: { id: true },
  });
  return Boolean(row);
}

export function hasProtectedIdentityAdminRole(user) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  return memberships.some((membership) => {
    if (!membership?.enabled) return false;
    const roleKey = String(membership?.role?.key ?? "")
      .trim()
      .toLowerCase();
    return PROTECTED_IDENTITY_ROLE_KEYS.has(roleKey);
  });
}

export function serializeIdentityUser(user, avatarUrlMap, includePersonal = false, companyLogoUrlMap = new Map()) {
  const personalFields = ['phone', 'birthDate', 'gender', 'country', 'state', 'city', 'colony', 'street', 'extNumber', 'intNumber', 'postalCode', 'bio'];
  return {
    ...(includePersonal ? Object.fromEntries(personalFields.map((key) => [key, user[key]])) : {}),
    id: user.id, displayName: user.displayName, firstName: user.firstName, lastName: user.lastName,
    email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt,
    enabled: user.enabled && (user.memberships ?? []).some((m) => m.enabled),
    avatarUrl: user.avatarFileId
      ? (avatarUrlMap.get(user.avatarFileId) ?? null)
      : null,
    memberships: (user.memberships ?? []).map((membership) => {
      const logoFileId = membership.company?.brandingConfig?.logoFileId;
      return {
        id: membership.id,
        companyId: membership.companyId,
        companyName: membership.company?.name ?? null,
        companyLogoUrl: logoFileId ? (companyLogoUrlMap.get(logoFileId) ?? null) : null,
        companyPrimaryColor: membership.company?.brandingConfig?.primaryColor ?? null,
        roleId: membership.roleId,
        roleKey: membership.role?.key ?? null,
        roleName: membership.role?.name ?? null,
        enabled: membership.enabled,
      };
    }),
  };
}

export async function buildCompanyLogoUrlMapByFileIds(fileIds, { prisma, supabaseAdmin }) {
  const logoUrlMap = new Map();
  if (!fileIds.length) return logoUrlMap;

  const fileAssets = await prisma.fileAsset.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, bucket: true, objectKey: true },
  });
  const byBucket = new Map();
  for (const asset of fileAssets) {
    if (!byBucket.has(asset.bucket)) byBucket.set(asset.bucket, []);
    byBucket.get(asset.bucket).push(asset);
  }
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, assets]) => {
      const paths = assets.map((asset) => asset.objectKey);
      const signedByPath = await getCachedSignedUrls(supabaseAdmin, bucket, paths, 3600);
      for (const asset of assets) {
        logoUrlMap.set(asset.id, signedByPath.get(asset.objectKey) ?? null);
      }
    }),
  );

  return logoUrlMap;
}

export function toPositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.floor(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

export function normalizeIdentityUsersQuery(query = {}) {
  const page = toPositiveInt(query.page, 1, { min: 1, max: 100000 });
  const pageSize = toPositiveInt(query.pageSize, 20, { min: 1, max: 200 });
  const search = String(query.search ?? "").trim();
  const enabledRaw = String(query.enabled ?? "")
    .trim()
    .toLowerCase();
  const enabled =
    enabledRaw === "true" ? true : enabledRaw === "false" ? false : null;
  const sortByRaw = String(query.sortBy ?? "").trim();
  const sortDirRaw = String(query.sortDir ?? "")
    .trim()
    .toLowerCase();
  const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

  return { page, pageSize, search, enabled, sortBy: sortByRaw, sortDir };
}

export function toIdentitySortOrder(sortBy, sortDir) {
  const dir = sortDir === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "firstName":
      return [{ firstName: dir }, { createdAt: "desc" }];
    case "lastName":
      return [{ lastName: dir }, { createdAt: "desc" }];
    case "displayName":
      return [{ displayName: dir }, { createdAt: "desc" }];
    case "email":
      return [{ email: dir }, { createdAt: "desc" }];
    case "enabled":
      return [{ enabled: dir }, { createdAt: "desc" }];
    case "createdAt":
      return [{ createdAt: dir }];
    default:
      return [{ createdAt: "desc" }];
  }
}

export function parseIdentityUserIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .filter((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ),
    );
}

export function buildIdentityUsersWhere({ search, enabled, companyId }) {
  // Bot profiles (e.g. the per-company MirAI assistant, is_bot = true) have no
  // login and are not administrable users — never list them in the users screen
  // or in any user picker that reads this endpoint (chat "Anadir miembros",
  // CreateChatModal, etc.).
  //
  // memberships.some({ companyId }) scopes every result to the caller's
  // active company — this is what actually enforces the tenant boundary.
  // When companyId is null (the zero-membership admin edge case) this can
  // never match any row (Membership.companyId is NOT NULL), so the query
  // safely returns zero users instead of every instance user.
  const where = {
    isBot: false,
    memberships: { some: { companyId } },
  };
  if (typeof enabled === "boolean") {
    where.memberships.some.enabled = enabled;
  }
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      {
        memberships: {
          some: {
            enabled: true,
            companyId,
            role: { name: { contains: search, mode: "insensitive" } },
          },
        },
      },
    ];
  }
  return where;
}
