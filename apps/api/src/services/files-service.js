import { createFileAccess } from "./files/access.js";
import JSZip from "jszip";
import { fileKindWhere } from "./files/query.js";
import { toLocalIso, getOfficeFormat, OFFICE_FORMATS } from "@runly/core";
import { signedUrlWithVariant, publicUrlWithVariant } from "../lib/image-variants.js";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 3600;
const BULK_DOWNLOAD_MAX_FILE_IDS = 50;
const BULK_DOWNLOAD_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const STORAGE_BUCKET_NAME = "runly-files";
const WEBSITE_BUCKET_NAME = "runly-website";
const BULK_ZIP_FOLDER = "system/bulk-downloads";
const ALLOWED_FILE_ENTITY_TYPES = [
  "AtlasFile",
  "BrandingConfig",
  "Company",
  "HrEmployee",
  "Contact",
  "FleetVehicle",
  "FleetDriver",
  "FleetMaintenance",
  "FleetReport",
  "Task",
  "InvItem",
  "GrowthLead",
  "GeneratedDocument",
  "PfmReceipt",
  "UserProfile",
];
const ALLOWED_EXACT_MIME_TYPES = new Set([
  ...Object.values(OFFICE_FORMATS).map(format => format.mimeType),
  "application/pdf",
  "application/json",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_MIME_PREFIXES = ["image/", "text/"];

class FilesServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "FilesServiceError";
    this.status = status;
  }
}

function sanitizeSegment(value, fallback = "file") {
  return (
    String(value ?? fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

function getExtension(fileName = "", mimeType = "") {
  const fromName = String(fileName).split(".").pop();
  if (fromName && fromName !== fileName)
    return sanitizeSegment(fromName, "bin");
  if (mimeType.startsWith("image/")) return mimeType.split("/")[1];
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/")) return "txt";
  return "bin";
}

function buildModuleObjectKey({
  moduleKey,
  entityType,
  entityId,
  fileName,
  mimeType,
}) {
  const moduleSegment = sanitizeSegment(moduleKey, "runly-files");
  const entityTypeSegment = sanitizeSegment(entityType, "atlasfile");
  const entityIdSegment = sanitizeSegment(entityId, "company");
  const ext = getExtension(fileName, mimeType);
  const random = Math.random().toString(36).slice(2, 10);
  return `modules/${moduleSegment}/${entityTypeSegment}/${entityIdSegment}/${Date.now()}-${random}.${ext}`;
}

function normalizePagination({ page, pageSize }) {
  const safePage = Math.max(1, Math.min(100000, Number.parseInt(String(page ?? "1"), 10) || 1));
  const safePageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(String(pageSize ?? "20"), 10) || 20),
  );

  return {
    page: safePage,
    pageSize: safePageSize,
    skip: (safePage - 1) * safePageSize,
    take: safePageSize,
  };
}

function parseEnabled(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "si"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  return undefined;
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;

  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function isAllowedSort(sortBy) {
  return ["createdAt", "updatedAt", "sizeBytes", "originalName"].includes(sortBy);
}

function isAllowedMimeType(mimeType) {
  if (!mimeType) return false;
  if (ALLOWED_EXACT_MIME_TYPES.has(mimeType)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function emptyListResponse(page, pageSize) {
  return {
    data: [],
    pagination: {
      page,
      pageSize,
      total: 0,
      totalPages: 1,
    },
  };
}

function getUniqueZipEntryName(originalName, usedNames) {
  const trimmedName = String(originalName ?? "").trim();
  const fallbackName = `archivo-${Date.now()}`;
  const baseName = trimmedName || fallbackName;

  const lastDot = baseName.lastIndexOf(".");
  const hasExtension = lastDot > 0 && lastDot < baseName.length - 1;
  const stem = hasExtension ? baseName.slice(0, lastDot) : baseName;
  const extension = hasExtension ? baseName.slice(lastDot) : "";

  const currentCount = usedNames.get(baseName) ?? 0;
  usedNames.set(baseName, currentCount + 1);
  if (currentCount === 0) return baseName;

  return `${stem} (${currentCount + 1})${extension}`;
}

export function createFilesService({ prisma, supabaseAdmin }) {
  const access = createFileAccess({ prisma });
  async function mutateUnlockedFile(id, data) {
    return prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM file_asset WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await db.fileAsset.findUnique({ where: { id } });
      if (current?.officeLock && new Date(current.officeLockExpiresAt).getTime() > Date.now()) {
        throw new FilesServiceError("El documento está abierto en Office. Cierra el editor antes de modificarlo.", 409);
      }
      return db.fileAsset.update({ where: { id }, data });
    });
  }

  async function getCompanyAssets({ authUserId, activeContext, fileIds }) {
    const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
    return prisma.fileAsset.findMany({ where: { id: { in: fileIds }, entityId: companyId, enabled: true, entityType: { in: ALLOWED_FILE_ENTITY_TYPES }, AND: [access.readWhere(context)] }, select: { id: true, bucket: true, objectKey: true } });
  }
  // activeContext: { profileId, companyId, isAdmin, permissionSet } already
  // resolved by the API's tenant middleware (c.get("userId") /
  // c.get("companyId") / c.get("tenantContext"), see
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md
  // §5) and threaded down from each route handler. When provided, this is
  // used directly — no extra DB round-trip, and critically, no re-deriving
  // (and potentially mis-deriving, for a multi-company user) which company
  // or which admin/permission set applies. Falls back to the old
  // self-derived behavior only for a caller that doesn't pass one yet.
  async function getUserCompanyContext(authUserId, activeContext) {
    if (activeContext?.companyId && activeContext?.profileId) {
      return {
        profileId: activeContext.profileId,
        companyId: activeContext.companyId,
        admin: Boolean(activeContext.isAdmin),
        permissions:
          activeContext.permissionSet instanceof Set
            ? activeContext.permissionSet
            : new Set(activeContext.permissionSet ?? []),
      };
    }

    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      select: { id: true, enabled: true },
    });

    if (!profile?.enabled) {
      throw new FilesServiceError("Perfil de usuario no encontrado.", 404);
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: profile.id, enabled: true },
      orderBy: { createdAt: "desc" },
      include: { role: { include: { permissions: { include: { permission: true } } } }, company: true },
    });

    if (!membership?.companyId || !membership.company.enabled || !membership.role?.enabled) {
      throw new FilesServiceError(
        "No tienes una empresa activa para gestionar archivos.",
        403,
      );
    }

    return {
      profileId: profile.id,
      companyId: membership.companyId,
      admin: ["runly.admin", "atlas.admin", "system.admin"].includes(membership.role.key),
      permissions: new Set(membership.role.permissions.filter(p => p.permission.active).map(p => p.permission.key)),
    };
  }

  async function ensureFileBelongsToCompany({
    fileId,
    companyId,
    includeDisabled = true,
    context,
    operation = "read",
  }) {
    const where = {
      id: fileId,
      entityId: companyId,
      entityType: { in: ALLOWED_FILE_ENTITY_TYPES },
    };

    if (!includeDisabled) {
      where.enabled = true;
    }

    const file = await prisma.fileAsset.findFirst({ where });
    if (!file) {
      throw new FilesServiceError("Archivo no encontrado.", 404);
    }

    if (!context) throw new FilesServiceError("No tienes acceso al archivo.", 403);
    await access.assertAccess(file, context, operation);
    return file;
  }

  async function batchEnrichFileAssets(fileAssets, storage) {
    if (!Array.isArray(fileAssets) || fileAssets.length === 0) return fileAssets;
    const previewable = fileAssets.filter(
      (fa) =>
        String(fa.mimeType ?? "").startsWith("image/") ||
        fa.mimeType === "application/pdf",
    );
    if (previewable.length === 0) return fileAssets;

    const byBucket = new Map();
    for (const fa of previewable) {
      const bucket = fa.bucket ?? STORAGE_BUCKET_NAME;
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(fa);
    }

    const urlMap = new Map();
    await Promise.all(
      [...byBucket.entries()].map(async ([bucket, assets]) => {
        if (bucket === WEBSITE_BUCKET_NAME) {
          for (const fa of assets) {
            const { data } = storage.from(bucket).getPublicUrl(fa.objectKey);
            urlMap.set(fa.id, { signedUrl: data?.publicUrl ?? null, expiresAt: null });
          }
          return;
        }
        const paths = assets.map((fa) => fa.objectKey);
        const { data: signedList } = await storage
          .from(bucket)
          .createSignedUrls(paths, SIGNED_URL_SECONDS);
        if (Array.isArray(signedList)) {
          const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
          // Match by path to avoid positional mismatch if Supabase returns a short list
          for (const item of signedList) {
            const fa = assets.find((a) => a.objectKey === item.path);
            if (fa) {
              urlMap.set(fa.id, {
                signedUrl: item.signedUrl ?? null,
                expiresAt: item.signedUrl ? expiresAt : null,
              });
            }
          }
        }
      }),
    );

    return fileAssets.map((fa) => {
      const entry = urlMap.get(fa.id);
      return entry
        ? { ...fa, signedUrl: entry.signedUrl, signedUrlExpiresAt: entry.expiresAt }
        : fa;
    });
  }

  async function enrichModuleAssets(fileAssets) {
    // Module attachment routes have no document-sharing context. Never issue
    // capabilities for restricted workspace files through these legacy paths.
    if (!fileAssets?.length) return fileAssets;
    const restricted = await prisma.fileAsset.findMany({ where: { id: { in: fileAssets.map(f => f.id) }, accessScope: 'RESTRICTED' }, select: { id: true } });
    const blocked = new Set(restricted.map(f => f.id));
    return batchEnrichFileAssets(fileAssets.filter(f => !blocked.has(f.id)), supabaseAdmin.storage);
  }

  return {
    async upload({ authUserId, activeContext, file, fields = {} }) {
      const context = await getUserCompanyContext(authUserId, activeContext);

      if (!(file instanceof File) || file.size <= 0) {
        throw new FilesServiceError("Selecciona un archivo válido.", 400);
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new FilesServiceError(
          "El archivo supera el límite de 10 MB.",
          400,
        );
      }

      if (!isAllowedMimeType(file.type)) {
        throw new FilesServiceError(
          "Tipo de archivo no permitido. Usa imagen, PDF, texto u oficina.",
          400,
        );
      }

      const moduleKey =
        String(fields.moduleKey ?? "runly.files").trim() || "runly.files";
      const entityType =
        String(fields.entityType ?? "AtlasFile").trim() || "AtlasFile";
      const entityId = context.companyId;
      const sourceEntityId = String(fields.entityId ?? "").trim() || null;
      const visibility = String(fields.visibility ?? "PRIVATE")
        .trim()
        .toUpperCase();
      const metadata = parseMetadata(fields.metadata);

      const objectKey = buildModuleObjectKey({
        moduleKey,
        entityType,
        entityId,
        fileName: file.name,
        mimeType: file.type,
      });

      const targetBucket = visibility === "PUBLIC" ? WEBSITE_BUCKET_NAME : STORAGE_BUCKET_NAME;
      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabaseAdmin.storage
        .from(targetBucket)
        .upload(objectKey, arrayBuffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        throw new FilesServiceError("No se pudo subir el archivo.", 500);
      }

      const asset = await prisma.fileAsset.create({
        data: {
          bucket: targetBucket,
          objectKey,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          visibility: ["PUBLIC", "INTERNAL", "PRIVATE"].includes(visibility)
            ? visibility
            : "PRIVATE",
          moduleKey,
          entityType,
          entityId,
          uploadedById: context.profileId,
          metadata: {
            ...metadata,
            companyId: context.companyId,
            sourceEntityId,
          },
        },
      });

      return asset;
    },

    async list({ authUserId, activeContext, query = {} }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const { page, pageSize, skip, take } = normalizePagination(query);

      const q = String(query.q ?? "").trim();
      const moduleKey = String(query.moduleKey ?? "").trim();
      const entityType = String(query.entityType ?? "").trim();
      const requestedEntityId = String(query.entityId ?? "").trim();
      const sourceEntityId = String(query.sourceEntityId ?? "").trim();
      const mime = String(query.mime ?? "")
        .trim()
        .toLowerCase();
      const enabled = parseEnabled(query.enabled);
      const sortBy = isAllowedSort(query.sortBy) ? query.sortBy : "createdAt";
      const sortDir =
        String(query.sortDir ?? "desc").toLowerCase() === "asc"
          ? "asc"
          : "desc";

      // If a plain entityId is given and it doesn't match the company, bail early
      // unless caller is using sourceEntityId (metadata-based filter).
      if (
        requestedEntityId &&
        requestedEntityId !== companyId &&
        !sourceEntityId
      ) {
        return emptyListResponse(page, pageSize);
      }

      const where = {
        entityId: companyId,
        entityType: { in: ALLOWED_FILE_ENTITY_TYPES },
      };

      where.AND = [access.readWhere(context)];
      if (query.workspace === "documents") where.AND.push({ entityType: "AtlasFile", moduleKey: { in: ["runly.files", "atlas.files"] } });
      if (query.workspace === "attachments") where.AND.push({ NOT: { entityType: "AtlasFile", moduleKey: { in: ["runly.files", "atlas.files"] } } });
      if (query.workspace === "shared") where.AND.push({ shares: { some: { userId: context.profileId, status: "ACCEPTED" } } });
      if (query.kind) where.AND.push(fileKindWhere(query.kind));
      if (enabled !== undefined) where.enabled = enabled;
      if (moduleKey) where.moduleKey = moduleKey;
      if (entityType) where.entityType = entityType;
      if (mime) {
        where.mimeType = { startsWith: mime };
      }
      // Filter by the originating entity stored in metadata (e.g. HrEmployee ID)
      if (sourceEntityId) {
        where.metadata = {
          path: ["sourceEntityId"],
          equals: sourceEntityId,
        };
      }

      if (q) {
        where.OR = [
          { originalName: { contains: q, mode: "insensitive" } },
          { objectKey: { contains: q, mode: "insensitive" } },
          { moduleKey: { contains: q, mode: "insensitive" } },
          { entityType: { contains: q, mode: "insensitive" } },
        ];
      }

      const [total, rows] = await prisma.$transaction([
        prisma.fileAsset.count({ where }),
        prisma.fileAsset.findMany({
          where,
          orderBy: [{ [sortBy]: sortDir }, { id: sortDir }],
          skip,
          take,
        }),
      ]);

      const enrichedRows = await batchEnrichFileAssets(rows, supabaseAdmin.storage);
      return {
        data: enrichedRows,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      };
    },

    async getById({ authUserId, activeContext, id }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      return ensureFileBelongsToCompany({ fileId: id, companyId, context });
    },

    async rename({ authUserId, activeContext, id, originalName }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const file = await ensureFileBelongsToCompany({ fileId: id, companyId, context });
      if (file.accessScope === "RESTRICTED") await access.assertAccess(file, context, "manage");
      return mutateUnlockedFile(id, { originalName: String(originalName).trim() });
    },

    async bulkDownload({ authUserId, activeContext, fileIds, mode }) {
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        throw new FilesServiceError(
          "Solicitud de descarga masiva invalida.",
          400,
        );
      }
      if (fileIds.length > BULK_DOWNLOAD_MAX_FILE_IDS) {
        throw new FilesServiceError(
          "No puedes seleccionar mas de 50 archivos por solicitud.",
          400,
        );
      }
      if (!["direct", "zip"].includes(mode)) {
        throw new FilesServiceError(
          "Solicitud de descarga masiva invalida.",
          400,
        );
      }

      const requestedFileIds = fileIds.map((fileId) =>
        String(fileId ?? "").trim(),
      );
      if (requestedFileIds.some((fileId) => !fileId)) {
        throw new FilesServiceError(
          "Solicitud de descarga masiva invalida.",
          400,
        );
      }

      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const uniqueRequestedFileIds = [...new Set(requestedFileIds)];

      const files = await prisma.fileAsset.findMany({
        where: {
          id: { in: uniqueRequestedFileIds },
          AND: [access.readWhere(context)],
          entityId: companyId,
          enabled: true,
          entityType: { in: ALLOWED_FILE_ENTITY_TYPES },
        },
      });

      if (files.length !== uniqueRequestedFileIds.length) {
        throw new FilesServiceError(
          "Uno o mas archivos no existen, no pertenecen a tu empresa o estan deshabilitados.",
          403,
        );
      }

      const totalBytes = files.reduce(
        (sum, file) => sum + Math.max(0, Number(file.sizeBytes ?? 0)),
        0,
      );
      if (totalBytes > BULK_DOWNLOAD_MAX_TOTAL_BYTES) {
        throw new FilesServiceError(
          "La descarga supera el limite de 250 MB por solicitud.",
          400,
        );
      }

      const fileById = new Map(files.map((file) => [file.id, file]));

      if (mode === "direct") {
        const directFiles = await Promise.all(
          requestedFileIds.map(async (fileId) => {
            const file = fileById.get(fileId);
            const { data, error } = await supabaseAdmin.storage
              .from(file.bucket)
              .createSignedUrl(file.objectKey, SIGNED_URL_SECONDS);

            if (error || !data?.signedUrl) {
              throw new FilesServiceError(
                "No se pudo generar el enlace de descarga.",
                500,
              );
            }

            return {
              id: file.id,
              originalName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              signedUrl: data.signedUrl,
              expiresIn: SIGNED_URL_SECONDS,
            };
          }),
        );

        return {
          mode: "direct",
          expiresIn: SIGNED_URL_SECONDS,
          files: directFiles,
        };
      }

      const zip = new JSZip();
      const usedNames = new Map();

      for (const fileId of requestedFileIds) {
        const file = fileById.get(fileId);
        const { data, error } = await supabaseAdmin.storage
          .from(file.bucket)
          .download(file.objectKey);

        if (error || !data) {
          throw new FilesServiceError(
            "No se pudo preparar la descarga masiva.",
            500,
          );
        }

        const entryName = getUniqueZipEntryName(file.originalName, usedNames);
        const fileBuffer = Buffer.from(await data.arrayBuffer());
        zip.file(entryName, fileBuffer);
      }

      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const zipFileName = `atlas-archivos-${toLocalIso()}.zip`;
      const zipObjectKey = `${BULK_ZIP_FOLDER}/${sanitizeSegment(companyId, "company")}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}.zip`;

      const { error: uploadZipError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET_NAME)
        .upload(zipObjectKey, zipBuffer, {
          contentType: "application/zip",
          upsert: false,
        });

      if (uploadZipError) {
        throw new FilesServiceError(
          "No se pudo preparar la descarga masiva.",
          500,
        );
      }

      const { data: signedZipData, error: signedZipError } =
        await supabaseAdmin.storage
          .from(STORAGE_BUCKET_NAME)
          .createSignedUrl(zipObjectKey, SIGNED_URL_SECONDS, {
            download: zipFileName,
          });

      if (signedZipError || !signedZipData?.signedUrl) {
        throw new FilesServiceError(
          "No se pudo generar el enlace de descarga.",
          500,
        );
      }

      return {
        mode: "zip",
        signedUrl: signedZipData.signedUrl,
        expiresIn: SIGNED_URL_SECONDS,
        fileName: zipFileName,
      };
    },

    async getSignedUrl({ authUserId, activeContext, id, variant = "full" }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const file = await ensureFileBelongsToCompany({
        fileId: id,
        companyId,
        context,
        includeDisabled: false,
      });

      if (file.visibility === "PUBLIC" || file.bucket === WEBSITE_BUCKET_NAME) {
        const publicUrl = publicUrlWithVariant(supabaseAdmin, file.bucket, file.objectKey, variant)
        return { signedUrl: publicUrl, expiresIn: null, permanent: true }
      }

      const signedUrl = await signedUrlWithVariant(
        supabaseAdmin,
        file.bucket,
        file.objectKey,
        variant,
        SIGNED_URL_SECONDS,
      );

      if (!signedUrl) {
        throw new FilesServiceError(
          "No se pudo generar el enlace de descarga.",
          500,
        );
      }

      return {
        signedUrl,
        expiresIn: SIGNED_URL_SECONDS,
      };
    },

    async setEnabled({ authUserId, activeContext, id, enabled }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const file = await ensureFileBelongsToCompany({ fileId: id, companyId, context });
      if (file.accessScope === "RESTRICTED") await access.assertAccess(file, context, "manage");
      return mutateUnlockedFile(id, { enabled: Boolean(enabled) });
    },

    async delete({ authUserId, activeContext, id }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const file = await ensureFileBelongsToCompany({
        fileId: id,
        companyId,
        context,
        includeDisabled: true,
      });

      if (file.accessScope === "RESTRICTED") await access.assertAccess(file, context, "manage");
      // Keep Office recovery objects; serializes with WOPI before disabling.
      if (getOfficeFormat(file) || file.contentRevision > 1) {
        await mutateUnlockedFile(id, { enabled: false });
        return { ok: true };
      }

      const { error: storageError } = await supabaseAdmin.storage
        .from(file.bucket)
        .remove([file.objectKey]);

      if (storageError) {
        console.error(
          `[files-service] Storage delete failed for ${file.objectKey}:`,
          storageError.message,
        );
      }

      await prisma.fileAsset.delete({ where: { id: file.id } });

      // Audit log for HR employee file deletions
      if (["runly.hr", "atlas.hr"].includes(file.moduleKey) && file.entityType === "HrEmployee") {
        const sourceEntityId = file.metadata?.sourceEntityId ?? null;
        if (sourceEntityId) {
          const actor = await prisma.userProfile.findUnique({
            where: { authUserId },
            select: { id: true },
          });
          if (actor?.id) {
            await prisma.auditLog.create({
              data: {
                actorId: actor.id,
                moduleKey: "runly.hr",
                entityType: "HrEmployee",
                entityId: String(sourceEntityId),
                action: "hr.employee.file.delete",
                metadata: {
                  fileId: file.id,
                  originalName: file.originalName,
                  mimeType: file.mimeType,
                },
              },
            });
          }
        }
      }

      return { ok: true };
    },

    async setFileCover({ authUserId, activeContext, id }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const file = await ensureFileBelongsToCompany({
        fileId: id,
        companyId,
        context,
        includeDisabled: false,
      });
      const sourceEntityId = file.metadata?.sourceEntityId ?? null;
      if (!file.moduleKey || !file.entityType || !sourceEntityId) {
        throw new FilesServiceError(
          "Este archivo no pertenece a un grupo con portada.",
          400,
        );
      }
      await prisma.fileAsset.updateMany({
        where: {
          entityId: companyId,
          moduleKey: file.moduleKey,
          entityType: file.entityType,
          metadata: { path: ["sourceEntityId"], equals: sourceEntityId },
        },
        data: { isCover: false },
      });
      return prisma.fileAsset.update({
        where: { id: file.id },
        data: { isCover: true },
      });
    },

    // Mirrors useAttachmentsController.js's reorderItems/AttachmentsPanel's
    // handleMoveImage exactly: the client sends a small set of {id,
    // sortOrder} pairs to swap (not a full ordered list), the same shape
    // Inventory's reorderItemFiles already accepts. Each id is verified via
    // ensureFileBelongsToCompany (real access control, not just an
    // entityId === companyId filter) before its sortOrder is written.
    async reorderFiles({ authUserId, activeContext, items }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      if (!Array.isArray(items) || items.length === 0) return { ok: true };
      const validated = [];
      for (const entry of items) {
        if (!entry || typeof entry.id !== "string") continue;
        const file = await ensureFileBelongsToCompany({
          fileId: entry.id,
          companyId,
          context,
          includeDisabled: false,
        });
        validated.push({ id: file.id, sortOrder: Number(entry.sortOrder) || 0 });
      }
      await prisma.$transaction(
        validated.map(({ id, sortOrder }) =>
          prisma.fileAsset.update({ where: { id }, data: { sortOrder } }),
        ),
      );
      return { ok: true };
    },

    async enrichFileAssets(fileAssets) {
      return enrichModuleAssets(fileAssets);
    },
    getCompanyAssets,
    getUserCompanyContext,

    async enrichFilesWithSignedUrls(associations) {
      if (!Array.isArray(associations) || associations.length === 0) return associations;
      const fileAssets = associations
        .map((a) => a.file_asset)
        .filter((fa) => fa?.id);
      if (fileAssets.length === 0) return associations;

      const enrichedAssets = await enrichModuleAssets(fileAssets);
      const enrichedMap = new Map(enrichedAssets.map((fa) => [fa.id, fa]));
      return associations.map((assoc) => ({
        ...assoc,
        file_asset: assoc.file_asset
          ? (enrichedMap.get(assoc.file_asset.id) ?? null)
          : null,
      }));
    },
  };
}

export { FilesServiceError };
