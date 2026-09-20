/**
 * company-service.js
 * Business logic for Company profile, address, branding configuration, and
 * company membership management.
 */

import { getCachedSignedUrls } from "../lib/signed-url-cache.js";
import {
  checkMembershipRoleScope,
  checkProtectedRoleAssignment,
  checkSelfLockout,
  findExistingMembership,
} from "../lib/identity-memberships.js";

// Same protected-role set /identity/users/:id/memberships* guards against —
// kept local rather than imported since it's a one-line literal, not worth a
// shared constant module for.
const PROTECTED_MEMBER_ROLE_KEYS = new Set(["runly.admin", "atlas.admin", "system.admin"]);

export class CompanyServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

const COMPANY_TYPE_VALUES = [
  "sa_de_cv",
  "srl_de_cv",
  "sa",
  "srl",
  "sc",
  "ac",
  "sapi_de_cv",
  "otro",
];

const COMPANY_SIZE_VALUES = ["micro", "small", "medium", "large", "corporate"];

const INDUSTRY_VALUES = [
  "tecnologia",
  "software",
  "manufactura",
  "retail",
  "salud",
  "educacion",
  "logistica",
  "construccion",
  "servicios_profesionales",
  "contabilidad",
  "financiero",
  "agroindustria",
  "hospitalidad",
  "marketing",
  "inmobiliario",
  "mineria",
  "ong",
  "otro",
];

const COMPANY_TYPE_ALIASES = {
  "sa de cv": "sa_de_cv",
  "sociedad anonima de capital variable": "sa_de_cv",
  "srl de cv": "srl_de_cv",
  "sociedad de responsabilidad limitada de capital variable": "srl_de_cv",
  "sociedad anonima": "sa",
  "sociedad de responsabilidad limitada": "srl",
  "sociedad cooperativa": "sc",
  "asociacion civil": "ac",
  "sapi de cv": "sapi_de_cv",
};

const COMPANY_SIZE_ALIASES = {
  "micro 1 a 10 empleados": "micro",
  "micro 1 10": "micro",
  "pequena 11 a 50 empleados": "small",
  "small 11 a 50 empleados": "small",
  "mediana 51 a 200 empleados": "medium",
  "medium 51 a 200 empleados": "medium",
  "grande 201 a 500 empleados": "large",
  "large 201 a 500 empleados": "large",
  "corporativo mas de 500 empleados": "corporate",
  "corporativo 500": "corporate",
};

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEnumValue(value, validValues, aliases = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (validValues.includes(raw)) return raw;
  const normalized = normalizeText(raw);
  if (!normalized) return "";
  if (Object.prototype.hasOwnProperty.call(aliases, normalized)) {
    return aliases[normalized];
  }
  const exact = validValues.find((v) => normalizeText(v) === normalized);
  return exact ?? raw;
}

export function createCompanyService({ prisma, supabaseAdmin }) {
  // companyId: the requester's server-resolved active company (from
  // requirePermission's tenant middleware, never client-supplied). Every
  // caller now passes this explicitly — a user who switches their active
  // company must see and edit THAT company's profile/address/branding, not
  // whichever company instance_config.company_id happens to point to
  // (a single-tenant-era leftover). Falls back to that legacy singleton only
  // when no companyId is given, for backward compatibility.
  async function resolveCompanyId(companyId) {
    if (companyId) return companyId;
    const record = await prisma.instanceConfig.findUnique({
      where: { key: "company_id" },
    });
    if (!record?.value) {
      throw new CompanyServiceError("No hay empresa activa configurada.", 404);
    }
    return record.value;
  }

  async function getSignedLogoUrl(logoFileId) {
    if (!logoFileId) return null;
    const fileAsset = await prisma.fileAsset.findUnique({
      where: { id: logoFileId },
    });
    if (!fileAsset) return null;
    const { data } = await supabaseAdmin.storage
      .from(fileAsset.bucket)
      .createSignedUrl(fileAsset.objectKey, 3600);
    return data?.signedUrl ?? null;
  }

  // Batch avatar signing for member/candidate lists — same cached-signing
  // helper the /memberships/me logo fix uses, so repeatedly refetching this
  // list (e.g. after adding a member) doesn't churn a fresh signature per
  // avatar per poll.
  async function buildAvatarUrlMap(fileIds) {
    const map = new Map();
    const ids = [...new Set(fileIds.filter(Boolean))];
    if (!ids.length) return map;
    const assets = await prisma.fileAsset.findMany({
      where: { id: { in: ids } },
      select: { id: true, bucket: true, objectKey: true },
    });
    const byBucket = new Map();
    for (const asset of assets) {
      if (!byBucket.has(asset.bucket)) byBucket.set(asset.bucket, []);
      byBucket.get(asset.bucket).push(asset);
    }
    await Promise.all(
      [...byBucket.entries()].map(async ([bucket, bucketAssets]) => {
        const paths = bucketAssets.map((a) => a.objectKey);
        const signedByPath = await getCachedSignedUrls(supabaseAdmin, bucket, paths, 3600);
        for (const asset of bucketAssets) {
          map.set(asset.id, signedByPath.get(asset.objectKey) ?? null);
        }
      }),
    );
    return map;
  }

  function serializeMember(membership, avatarUrl) {
    return {
      membershipId: membership.id,
      userId: membership.userId,
      displayName: membership.user?.displayName ?? "",
      email: membership.user?.email ?? "",
      avatarUrl,
      roleId: membership.roleId,
      roleName: membership.role?.name ?? null,
      enabled: membership.enabled,
    };
  }

  function assertRoleAssignable({ targetRole, companyId, actorContext }) {
    const scopeCheck = checkMembershipRoleScope({
      roleCompanyId: targetRole.companyId,
      membershipCompanyId: companyId,
    });
    if (!scopeCheck.ok) throw new CompanyServiceError(scopeCheck.error, scopeCheck.status);

    const protectedCheck = checkProtectedRoleAssignment({
      roleKey: targetRole.key,
      protectedKeys: PROTECTED_MEMBER_ROLE_KEYS,
      isSystemAdmin: actorContext.isSystemAdmin,
      actorCanManageRoles: actorContext.canManageRoles,
    });
    if (!protectedCheck.ok) throw new CompanyServiceError(protectedCheck.error, protectedCheck.status);
  }

  return {
    // ── Profile ──────────────────────────────────────────────────────────────

    async getProfile(activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const company = await prisma.company.findUnique({
        where: { id: companyId },
      });
      return {
        companyId,
        slug: company?.slug ?? "",
        name: company?.name ?? "",
        legalName: company?.legalName ?? "",
        rfc: company?.rfc ?? "",
        companyType: normalizeEnumValue(
          company?.companyType,
          COMPANY_TYPE_VALUES,
          COMPANY_TYPE_ALIASES,
        ),
        companyTypeName: company?.companyTypeName ?? "",
        industryKey: normalizeEnumValue(
          company?.industryKey,
          INDUSTRY_VALUES,
        ),
        industryName: company?.industryName ?? "",
        companySize: normalizeEnumValue(
          company?.companySize,
          COMPANY_SIZE_VALUES,
          COMPANY_SIZE_ALIASES,
        ),
        contactEmail: company?.contactEmail ?? "",
        phone: company?.phone ?? "",
        website: company?.website ?? "",
      };
    },

    async updateProfile(fields, activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const companyType = normalizeEnumValue(
        fields.companyType,
        COMPANY_TYPE_VALUES,
        COMPANY_TYPE_ALIASES,
      );
      const industryKey = normalizeEnumValue(
        fields.industryKey,
        INDUSTRY_VALUES,
      );
      const companySize = normalizeEnumValue(
        fields.companySize,
        COMPANY_SIZE_VALUES,
        COMPANY_SIZE_ALIASES,
      );
      await prisma.company.update({
        where: { id: companyId },
        data: {
          name: fields.name,
          legalName: fields.legalName || null,
          rfc: fields.rfc || null,
          companyType: companyType || null,
          companyTypeName: fields.companyTypeName || null,
          industryKey: industryKey || null,
          industryName: fields.industryName || null,
          companySize: companySize || null,
          contactEmail: fields.contactEmail || null,
          phone: fields.phone || null,
          website: fields.website || null,
        },
      });
      return {
        companyId,
        ...fields,
        companyType,
        industryKey,
        companySize,
      };
    },

    // ── Address ──────────────────────────────────────────────────────────────

    async getAddress(activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const company = await prisma.company.findUnique({
        where: { id: companyId },
      });
      return {
        companyId,
        country: company?.country ?? "",
        state: company?.state ?? "",
        city: company?.city ?? "",
        colony: company?.colony ?? "",
        street: company?.street ?? "",
        extNumber: company?.extNumber ?? "",
        intNumber: company?.intNumber ?? "",
        postalCode: company?.postalCode ?? "",
      };
    },

    async updateAddress(fields, activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      await prisma.company.update({
        where: { id: companyId },
        data: {
          country: fields.country || null,
          state: fields.state || null,
          city: fields.city || null,
          colony: fields.colony || null,
          street: fields.street || null,
          extNumber: fields.extNumber || null,
          intNumber: fields.intNumber || null,
          postalCode: fields.postalCode || null,
        },
      });
      return { companyId, ...fields };
    },

    // ── Branding ─────────────────────────────────────────────────────────────

    async getBranding(activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const branding = await prisma.brandingConfig.findFirst({
        where: { companyId },
      });
      const logoUrl = await getSignedLogoUrl(branding?.logoFileId ?? null);
      return {
        companyId,
        primaryColor: branding?.primaryColor ?? "#0A7BFF",
        logoFileId: branding?.logoFileId ?? null,
        logoUrl,
      };
    },

    async updateBranding({ primaryColor, logoFileId }, activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      // Validate logo ownership if provided
      if (logoFileId) {
        const logoAsset = await prisma.fileAsset.findFirst({
          where: {
            id: logoFileId,
            enabled: true,
            OR: [
              { entityId: companyId },
              { moduleKey: { in: ["runly.company", "atlas.company"] }, entityType: "BrandingConfig" },
            ],
          },
        });
        if (!logoAsset) {
          throw new CompanyServiceError(
            "El archivo de logotipo no es válido para esta empresa.",
            400,
          );
        }
      }

      await prisma.brandingConfig.upsert({
        where: { companyId },
        update: { primaryColor, logoFileId },
        create: { companyId, primaryColor, logoFileId },
      });

      const logoUrl = await getSignedLogoUrl(logoFileId);
      return { companyId, primaryColor, logoFileId, logoUrl };
    },

    // ── Members ──────────────────────────────────────────────────────────────
    // Lightweight membership management scoped to a single company — the
    // company-centric counterpart to /identity/users/:id/memberships*, which
    // manages one user's companies from the other direction. Reuses the same
    // pure role-scope/self-lockout helpers so both entry points enforce
    // identical rules. See docs/superpowers/specs/2026-09-20-company-members-design.md.

    async listMembers(activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const memberships = await prisma.membership.findMany({
        where: { companyId },
        include: {
          user: { select: { id: true, displayName: true, email: true, avatarFileId: true } },
          role: { select: { id: true, name: true } },
        },
        orderBy: { user: { displayName: "asc" } },
      });
      const avatarUrlMap = await buildAvatarUrlMap(memberships.map((m) => m.user?.avatarFileId));
      return memberships.map((m) =>
        serializeMember(m, m.user?.avatarFileId ? (avatarUrlMap.get(m.user.avatarFileId) ?? null) : null),
      );
    },

    async searchMemberCandidates(query, activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const q = String(query ?? "").trim();
      if (q.length < 2) {
        throw new CompanyServiceError("Escribe al menos 2 caracteres para buscar.", 400);
      }
      const candidates = await prisma.userProfile.findMany({
        where: {
          enabled: true,
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
          NOT: { memberships: { some: { companyId, enabled: true } } },
        },
        select: { id: true, displayName: true, email: true, avatarFileId: true },
        orderBy: { displayName: "asc" },
        take: 20,
      });
      const avatarUrlMap = await buildAvatarUrlMap(candidates.map((u) => u.avatarFileId));
      return candidates.map((u) => ({
        userId: u.id,
        displayName: u.displayName ?? "",
        email: u.email ?? "",
        avatarUrl: u.avatarFileId ? (avatarUrlMap.get(u.avatarFileId) ?? null) : null,
      }));
    },

    async listMemberRoles(activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      return prisma.role.findMany({
        where: { enabled: true, OR: [{ companyId: null }, { companyId }] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    },

    async addMember({ userId, roleId, actorContext }, activeCompanyId) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, email: true, avatarFileId: true },
      });
      if (!user) throw new CompanyServiceError("Usuario no encontrado.", 404);

      if (roleId) {
        const targetRole = await prisma.role.findUnique({
          where: { id: roleId },
          select: { key: true, companyId: true },
        });
        if (!targetRole) throw new CompanyServiceError("Rol no encontrado.", 404);
        assertRoleAssignable({ targetRole, companyId, actorContext });
      }

      const existingMemberships = await prisma.membership.findMany({ where: { userId, companyId } });
      const existing = findExistingMembership({ memberships: existingMemberships, companyId });
      if (existing?.enabled) {
        throw new CompanyServiceError("El usuario ya es miembro de esta empresa.", 400);
      }

      const membership = existing
        ? await prisma.membership.update({
            where: { id: existing.id },
            data: { enabled: true, roleId: roleId !== undefined ? roleId : existing.roleId },
            include: { role: { select: { id: true, name: true } } },
          })
        : await prisma.membership.create({
            data: { userId, companyId, roleId: roleId ?? null },
            include: { role: { select: { id: true, name: true } } },
          });

      const avatarUrl = await getSignedLogoUrl(user.avatarFileId);
      return serializeMember({ ...membership, user }, avatarUrl);
    },

    async updateMember(membershipId, patch, activeCompanyId, actorContext) {
      const companyId = await resolveCompanyId(activeCompanyId);
      const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
      if (!membership || membership.companyId !== companyId) {
        throw new CompanyServiceError("Membresia no encontrada.", 404);
      }

      if (patch.roleId !== undefined && patch.roleId !== null) {
        const targetRole = await prisma.role.findUnique({
          where: { id: patch.roleId },
          select: { key: true, companyId: true },
        });
        if (!targetRole) throw new CompanyServiceError("Rol no encontrado.", 404);
        assertRoleAssignable({ targetRole, companyId, actorContext });
      }

      if (patch.enabled === false) {
        const enabledMemberships = await prisma.membership.findMany({
          where: { userId: membership.userId, enabled: true },
          select: { id: true },
        });
        const lockoutCheck = checkSelfLockout({
          isActingOnSelf: membership.userId === actorContext.actingUserId,
          enabledMembershipIds: enabledMemberships.map((m) => m.id),
          membershipId,
          disabling: true,
        });
        if (!lockoutCheck.ok) throw new CompanyServiceError(lockoutCheck.error, lockoutCheck.status);
      }

      const updated = await prisma.membership.update({
        where: { id: membershipId },
        data: {
          ...(patch.roleId !== undefined ? { roleId: patch.roleId } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        },
        include: {
          role: { select: { id: true, name: true } },
          user: { select: { id: true, displayName: true, email: true, avatarFileId: true } },
        },
      });

      const avatarUrl = await getSignedLogoUrl(updated.user?.avatarFileId ?? null);
      return serializeMember(updated, avatarUrl);
    },
  };
}
