// Public links to RME3 module resources (spec:
// docs/superpowers/specs/2026-09-28-module-public-links-design.md).
// The core owns token, expiry, revocation and use accounting; modules only
// declare `publicResources` and implement api/public.js.
import crypto from "node:crypto";
import { findPublicResource } from "@runly/module-engine";

export class ModulePublicLinkError extends Error {
  constructor(message, status = 400, reason = null) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export function linkStatus(link, now = new Date()) {
  if (link.revokedAt) return "revocado";
  if (link.expiresAt && new Date(link.expiresAt) <= now) return "vencido";
  if (link.maxUses != null && link.useCount >= link.maxUses) return "agotado";
  return "activo";
}

export function createModulePublicLinksService({ prisma }) {
  async function loadActiveModule(moduleKey) {
    const row = await prisma.runlyModule.findUnique({
      where: { key: moduleKey },
      select: { key: true, status: true, enabled: true, manifest: true },
    });
    if (!row || row.status !== "INSTALLED" || !row.enabled) return null;
    return row;
  }

  // Returns { module, resource, view } or throws 404.
  async function resolveResource(moduleKey, resourceKey) {
    const moduleRow = await loadActiveModule(moduleKey);
    const resource = moduleRow ? findPublicResource(moduleRow.manifest, resourceKey) : null;
    if (!resource) throw new ModulePublicLinkError("Recurso público no encontrado.", 404);
    const view = await prisma.runlyView.findFirst({
      where: { moduleKey, key: resource.view, type: "CUSTOM", enabled: true },
      select: { key: true, schema: true },
    });
    if (!view || view.schema?.public !== true || typeof view.schema?.path !== "string") {
      throw new ModulePublicLinkError("La vista pública del recurso no está disponible.", 409);
    }
    return { module: moduleRow, resource, view };
  }

  function serialize(link, viewPath) {
    return {
      id: link.id,
      resourceKey: link.resourceKey,
      recordId: link.recordId,
      mode: link.mode,
      label: link.label,
      path: viewPath ? `${viewPath.replace(/\/+$/, "")}/${link.token}` : null,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      useCount: link.useCount,
      lastUsedAt: link.lastUsedAt,
      revokedAt: link.revokedAt,
      status: linkStatus(link),
      createdAt: link.createdAt,
    };
  }

  async function list({ companyId, moduleKey, resourceKey, recordId = null }) {
    const { view } = await resolveResource(moduleKey, resourceKey);
    const rows = await prisma.modulePublicLink.findMany({
      where: { companyId, moduleKey, resourceKey, ...(recordId ? { recordId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => serialize(row, view.schema.path));
  }

  async function create({ companyId, moduleKey, userId, input }) {
    const { resource, view } = await resolveResource(moduleKey, input.resource);
    if (resource.entity && !input.recordId) {
      throw new ModulePublicLinkError("Este enlace necesita un registro.", 422);
    }
    const link = await prisma.modulePublicLink.create({
      data: {
        companyId,
        moduleKey,
        resourceKey: resource.key,
        recordId: input.recordId ?? null,
        token: crypto.randomBytes(32).toString("base64url"),
        mode: resource.mode,
        label: input.label || null,
        expiresAt: input.expiresAt ?? null,
        maxUses: input.maxUses ?? null,
        createdByUserId: userId,
      },
    });
    return serialize(link, view.schema.path);
  }

  async function revoke({ companyId, moduleKey, linkId }) {
    const link = await prisma.modulePublicLink.findFirst({ where: { id: linkId, companyId, moduleKey } });
    if (!link) throw new ModulePublicLinkError("Enlace no encontrado.", 404);
    const updated = link.revokedAt
      ? link
      : await prisma.modulePublicLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    return updated;
  }

  // Public side. Returns { link, resource } or throws 404/410.
  async function resolveByToken(moduleKey, token) {
    const unavailable = new ModulePublicLinkError("Enlace no disponible", 404);
    if (typeof token !== "string" || token.length < 20 || token.length > 100) throw unavailable;
    const link = await prisma.modulePublicLink.findUnique({ where: { token } });
    if (!link || link.moduleKey !== moduleKey) throw unavailable;
    const moduleRow = await loadActiveModule(moduleKey);
    const resource = moduleRow ? findPublicResource(moduleRow.manifest, link.resourceKey) : null;
    if (!resource) throw unavailable;
    const status = linkStatus(link);
    if (status !== "activo") throw new ModulePublicLinkError("Enlace no disponible", 410, status);
    return { link, resource };
  }

  // Atomic use reservation for writes on capped links. false = exhausted/revoked.
  async function reserveUse(linkId) {
    const rows = await prisma.$queryRaw`
      UPDATE module_public_link
         SET use_count = use_count + 1, last_used_at = now(), updated_at = now()
       WHERE id = ${linkId}::uuid AND revoked_at IS NULL
         AND (max_uses IS NULL OR use_count < max_uses)
      RETURNING id`;
    return rows.length > 0;
  }

  async function releaseUse(linkId) {
    await prisma.$executeRaw`
      UPDATE module_public_link SET use_count = GREATEST(use_count - 1, 0), updated_at = now()
       WHERE id = ${linkId}::uuid`;
  }

  async function loadCompanyBranding(companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, brandingConfig: { select: { logoFileId: true } } },
    });
    return { name: company?.name ?? "", logoFileId: company?.brandingConfig?.logoFileId ?? null };
  }

  return {
    resolveResource,
    list,
    create,
    revoke,
    resolveByToken,
    reserveUse,
    releaseUse,
    loadCompanyBranding,
  };
}
