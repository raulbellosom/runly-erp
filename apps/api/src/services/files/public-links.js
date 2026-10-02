// Public view/download links to a single file. Spec:
// docs/superpowers/specs/2026-10-01-files-access-model-design.md
// Links live in the core `module_public_link` table (moduleKey runly.files,
// resourceKey file.share, recordId = FileAsset.id) so token, expiry,
// revocation and use counting follow every other public link
// (linkStatus from module-public-links-service). Only the uploader or an
// admin manages a file's links.
import crypto from "node:crypto";
import { linkStatus } from "../module-public-links-service.js";
import { FilesServiceError } from "../files-service.js";

export const FILES_LINK_MODULE = "runly.files";
export const FILE_LINK_RESOURCE = "file.share";
export const FILE_LINK_MODES = ["view", "download"];
const MAX_LINKS_PER_FILE = 50;

export function serializeFileLink(link) {
  return {
    id: link.id, label: link.label, token: link.token, mode: link.mode,
    expiresAt: link.expiresAt, maxUses: link.maxUses, useCount: link.useCount, lastUsedAt: link.lastUsedAt,
    revokedAt: link.revokedAt, status: linkStatus(link), createdAt: link.createdAt,
  };
}

export function createFilePublicLinksService({ prisma, filesService }) {
  const scope = (companyId, fileId) => ({ companyId, moduleKey: FILES_LINK_MODULE, resourceKey: FILE_LINK_RESOURCE, recordId: fileId });

  async function ownedFile({ authUserId, activeContext, fileId }) {
    const context = await filesService.getUserCompanyContext(authUserId, activeContext);
    const file = await filesService.getById({ authUserId, activeContext, id: fileId });
    if (!context.admin && file.uploadedById !== context.profileId) {
      throw new FilesServiceError("Solo el propietario o un administrador puede gestionar los enlaces públicos.", 403);
    }
    return { context, file };
  }

  async function audit(context, fileId, action, metadata) {
    await prisma.auditLog.create({
      data: { companyId: context.companyId, actorId: context.profileId, moduleKey: FILES_LINK_MODULE, entityType: "FileAsset", entityId: fileId, action, metadata },
    });
  }

  async function list(args) {
    const { context, file } = await ownedFile(args);
    const rows = await prisma.modulePublicLink.findMany({ where: scope(context.companyId, file.id), orderBy: { createdAt: "desc" }, take: MAX_LINKS_PER_FILE });
    return rows.map(serializeFileLink);
  }

  async function create({ input = {}, ...args }) {
    const { context, file } = await ownedFile(args);
    if (!file.enabled) throw new FilesServiceError("El archivo está deshabilitado.", 409);
    const mode = input.mode ?? "view";
    if (!FILE_LINK_MODES.includes(mode)) throw new FilesServiceError("El modo del enlace no es válido.", 400);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) throw new FilesServiceError("La fecha de vencimiento debe ser futura.", 400);
    const maxUses = input.maxUses == null || input.maxUses === "" ? null : Number(input.maxUses);
    if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new FilesServiceError("El máximo de usos no es válido.", 400);
    const count = await prisma.modulePublicLink.count({ where: { ...scope(context.companyId, file.id), revokedAt: null } });
    if (count >= MAX_LINKS_PER_FILE) throw new FilesServiceError("Este archivo alcanzó el máximo de enlaces activos.", 409);
    const link = await prisma.modulePublicLink.create({
      data: {
        ...scope(context.companyId, file.id), token: crypto.randomBytes(32).toString("base64url"), mode,
        label: input.label ? String(input.label).trim().slice(0, 120) || null : null, expiresAt, maxUses, createdByUserId: context.profileId,
      },
    });
    await audit(context, file.id, "files.link.create", { linkId: link.id, mode, expiresAt, maxUses });
    return serializeFileLink(link);
  }

  async function revoke({ linkId, ...args }) {
    const { context, file } = await ownedFile(args);
    const link = await prisma.modulePublicLink.findFirst({ where: { ...scope(context.companyId, file.id), id: linkId } });
    if (!link) throw new FilesServiceError("Enlace no encontrado.", 404);
    if (link.revokedAt) return serializeFileLink(link);
    const updated = await prisma.modulePublicLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    await audit(context, file.id, "files.link.revoke", { linkId: link.id });
    return serializeFileLink(updated);
  }

  return { list, create, revoke };
}
