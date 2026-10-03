import { IMAGE_VARIANTS, publicUrlWithVariant, signedUrlWithVariant } from "../lib/image-variants.js";
import { tenantActiveContext } from "../lib/active-context.js";
import { publishActivityFromContext, getActivityContext } from "./activity-publisher.js";

// `moduleContext.files` for RME3 modules (see
// docs/superpowers/specs/2026-09-27-rme3-builder-layout-media-design.md §5).
// Each capability is bound to one module key: every read/write is scoped to
// that module, the requested entityType and the request's active company.
// Like HR employee documents, FileAsset.entityId holds the companyId and the
// owning record id lives in metadata.sourceEntityId.

const SIGNED_URL_SECONDS = 3600;
const WEBSITE_BUCKET_NAME = "runly-website";

export class ModuleFilesError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ModuleFilesError";
    this.status = status;
  }
}

function sourceOf(asset) {
  const value = asset?.metadata?.sourceEntityId;
  return value ? String(value) : null;
}

export function createModuleFilesCapability({ prisma, filesService, supabaseAdmin }) {
  return function forModule(moduleKey) {
    function companyOf(c) {
      const companyId = c.get("companyId");
      if (!companyId) throw new ModuleFilesError("No hay una empresa activa.", 403);
      return companyId;
    }

    async function findOwned(c, fileId, entityType) {
      const asset = await prisma.fileAsset.findFirst({
        where: { id: String(fileId ?? ""), moduleKey, entityType, entityId: companyOf(c), enabled: true },
      });
      if (!asset) throw new ModuleFilesError("Archivo no encontrado.", 404);
      return asset;
    }

    // Audit-trail entry on the owning record (entityType is the qualified
    // `<slug>.<entity>` the generated service also publishes under).
    async function fileActivity(c, { entityType, sourceEntityId, verb, kind, name }) {
      if (!sourceEntityId) return;
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: `${entityType}.file.${kind}`,
        severity: "info",
        entityType,
        entityId: String(sourceEntityId),
        summary: `${actorName} ${verb}${name ? `: ${String(name).slice(0, 200)}` : ""}`,
      });
    }

    return {
      // `field` tags uploads that belong to a file field, so the record's
      // attachments list (list()) does not show them a second time.
      async upload(c, { file, entityType, sourceEntityId = null, field = null }) {
        const asset = await filesService.upload({
          authUserId: c.get("authUserId"),
          activeContext: tenantActiveContext(c),
          file,
          fields: {
            moduleKey,
            entityType,
            entityId: sourceEntityId ?? undefined,
            ...(field ? { metadata: { field } } : {}),
          },
        });
        // File-field uploads show up as the field's change on save instead.
        if (!field) await fileActivity(c, { entityType, sourceEntityId, verb: "adjuntó un archivo", kind: "add", name: asset?.originalName ?? file?.name });
        return asset;
      },

      // Attachments only: files uploaded through a file field are excluded.
      async list(c, { entityType, sourceEntityId }) {
        const assets = await prisma.fileAsset.findMany({
          where: {
            moduleKey,
            entityType,
            entityId: companyOf(c),
            enabled: true,
            metadata: { path: ["sourceEntityId"], equals: String(sourceEntityId) },
          },
          orderBy: { createdAt: "asc" },
        });
        return assets.filter((asset) => !asset.metadata?.field);
      },

      async link(c, { fileId, entityType, sourceEntityId }) {
        const asset = await findOwned(c, fileId, entityType);
        const current = sourceOf(asset);
        if (current === String(sourceEntityId)) return asset;
        if (current) throw new ModuleFilesError("El archivo pertenece a otro registro.", 409);
        return prisma.fileAsset.update({
          where: { id: asset.id },
          data: { metadata: { ...(asset.metadata ?? {}), sourceEntityId: String(sourceEntityId) } },
        });
      },

      async remove(c, { fileId, entityType, sourceEntityId }) {
        const asset = await findOwned(c, fileId, entityType);
        if (sourceOf(asset) !== String(sourceEntityId)) throw new ModuleFilesError("Archivo no encontrado.", 404);
        await prisma.fileAsset.update({ where: { id: asset.id }, data: { enabled: false } });
        await fileActivity(c, { entityType, sourceEntityId, verb: "eliminó un archivo", kind: "remove", name: asset.originalName });
        return { ok: true };
      },

      async signedUrl(c, { fileId, entityType, variant }) {
        const asset = await findOwned(c, fileId, entityType);
        const safeVariant = variant && variant in IMAGE_VARIANTS ? variant : "full";
        if (asset.visibility === "PUBLIC" || asset.bucket === WEBSITE_BUCKET_NAME) {
          return { signedUrl: publicUrlWithVariant(supabaseAdmin, asset.bucket, asset.objectKey, safeVariant), expiresIn: null };
        }
        const signedUrl = await signedUrlWithVariant(supabaseAdmin, asset.bucket, asset.objectKey, safeVariant, SIGNED_URL_SECONDS);
        if (!signedUrl) throw new ModuleFilesError("No se pudo generar el enlace del archivo.", 500);
        return { signedUrl, expiresIn: SIGNED_URL_SECONDS };
      },
    };
  };
}
