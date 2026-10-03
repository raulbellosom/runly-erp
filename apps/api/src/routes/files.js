import { Hono } from "hono";
import { createFilesWorkspaceRouter } from './files-workspace.js';
import { fileBulkDownloadSchema, fileRenameSchema, fileShareLinkCreateSchema } from "@runly/validators";
import { createFilePublicLinksService } from "../services/files/public-links.js";
import { FilesServiceError } from "../services/files-service.js";
import { FileAccessError } from "../services/files/access.js";
import { getActivityContext, publishActivityFromContext } from "../services/activity-publisher.js";
import { tenantActiveContext } from "../lib/active-context.js";
import { IMAGE_VARIANTS, publicUrlWithVariant, signedUrlWithVariant } from "../lib/image-variants.js";

export function createFilesRouter({ prisma, supabaseAdmin, filesService, authMiddleware, requirePermission }) {
  const app = new Hono();
  app.route('/', createFilesWorkspaceRouter({ prisma, supabaseAdmin, filesService, authMiddleware, requirePermission }));
  const WEBSITE_BUCKET_NAME = "runly-website";
  const linksService = createFilePublicLinksService({ prisma, filesService });
  const linkHandler = (fallback, run) => async (c) => {
    try {
      return await run(c, { authUserId: c.get("authUserId"), activeContext: tenantActiveContext(c), fileId: c.req.param("id") });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) return c.json({ error: err.message }, err.status);
      console.error("[runly.files] public link route error", err);
      return c.json({ error: fallback }, 500);
    }
  };
  app.get("/files/:id/links", authMiddleware, requirePermission("files.assets.read"),
    linkHandler("No se pudieron cargar los enlaces.", async (c, args) => c.json({ data: await linksService.list(args) })));
  app.post("/files/:id/links", authMiddleware, requirePermission("files.assets.read"),
    linkHandler("No se pudo crear el enlace.", async (c, args) => {
      const parsed = fileShareLinkCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: parsed.error.issues?.[0]?.message || "Solicitud inválida." }, 400);
      return c.json({ data: await linksService.create({ ...args, input: parsed.data }) }, 201);
    }));
  app.post("/files/:id/links/:linkId/revoke", authMiddleware, requirePermission("files.assets.read"),
    linkHandler("No se pudo revocar el enlace.", async (c, args) => c.json({ data: await linksService.revoke({ ...args, linkId: c.req.param("linkId") }) })));
// Records whose attachments go through these generic routes (no
// module-specific association endpoint): their audit trail gets an entry
// when a file is attached or removed (spec 2026-10-03-audit-trail-design).
const RECORD_FILE_ACTIVITY = { HrEmployee: "hr.employee", Contact: "contacts.contact" };

async function publishRecordFileActivity(c, { entityType, recordId, kind, fileName }) {
  const prefix = RECORD_FILE_ACTIVITY[entityType];
  if (!prefix || !recordId) return;
  const { actorName } = getActivityContext(c);
  const verb = kind === "add" ? "adjuntó un archivo" : "eliminó un archivo";
  await publishActivityFromContext(prisma, c, {
    type: `${prefix}.file.${kind}`,
    severity: "info",
    entityType,
    entityId: String(recordId),
    summary: `${actorName} ${verb}${fileName ? `: ${String(fileName).slice(0, 200)}` : ""}`,
  });
}

app.post(
  "/files/upload",
  authMiddleware,
  requirePermission("files.assets.create"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.parseBody();
      const file = body.file;
      const asset = await filesService.upload({
        authUserId,
        activeContext: tenantActiveContext(c),
        file,
        fields: {
          moduleKey: body.moduleKey,
          entityType: body.entityType,
          entityId: body.entityId,
          visibility: body.visibility,
          metadata: body.metadata,
          shareWithCompany: body.shareWithCompany,
        },
      });

      if (
        ["runly.hr", "atlas.hr"].includes(body.moduleKey) &&
        body.entityType === "HrEmployee" &&
        body.entityId
      ) {
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
              entityId: String(body.entityId),
              action: "hr.employee.file.attach",
              metadata: {
                fileId: asset.id,
                originalName: asset.originalName,
                mimeType: asset.mimeType,
              },
            },
          });
        }
      }

      const { actorName } = getActivityContext(c);
      await publishRecordFileActivity(c, { entityType: body.entityType, recordId: body.entityId, kind: "add", fileName: asset.originalName });

      if (
        body.moduleKey === "runly.identity" &&
        body.entityType === "UserProfile" &&
        body.entityId
      ) {
        const actor = await prisma.userProfile.findUnique({
          where: { authUserId },
          select: { id: true },
        });
        if (actor?.id) {
          await prisma.auditLog.create({
            data: {
              actorId: actor.id,
              moduleKey: "runly.identity",
              entityType: "UserProfile",
              entityId: String(body.entityId),
              action: "identity.user.file.attach",
              metadata: {
                fileId: asset.id,
                originalName: asset.originalName,
                mimeType: asset.mimeType,
              },
            },
          });
        }
        // Also publish to the Activity table (not just AuditLog above) so the
        // upload actually shows up in the user's own "Actividad" panel
        // (UserActivitySection.jsx queries Activity by entityType/entityId,
        // not AuditLog — the generic "files.assets.upload" publish below is
        // keyed to entityType: "FileAsset" and wouldn't appear there).
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.file.attach",
          severity: "success",
          entityType: "UserProfile",
          entityId: String(body.entityId),
          summary:
            `${actorName} subió "${asset.originalName ?? asset.id}"`.trim(),
        });
      }

      await publishActivityFromContext(prisma, c, {
        type: "files.assets.upload",
        severity: "success",
        entityType: "FileAsset",
        entityId: asset.id,
        summary:
          `${actorName} subió "${asset.originalName ?? asset.id}"`.trim(),
      });

      const responseAsset = { ...asset }
      if (asset.bucket === WEBSITE_BUCKET_NAME) {
        const { data: urlData } = supabaseAdmin.storage.from(asset.bucket).getPublicUrl(asset.objectKey)
        responseAsset.url = urlData?.publicUrl ?? null
      }
      return c.json({ data: responseAsset }, 201);
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo subir el archivo." }, 500);
    }
  },
);

app.get(
  "/files",
  authMiddleware,
  requirePermission("files.assets.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const result = await filesService.list({
        authUserId,
        activeContext: tenantActiveContext(c),
        query: {
          q: c.req.query("q"),
          kind: c.req.query("kind"),
          workspace: c.req.query("workspace"),
          moduleKey: c.req.query("moduleKey"),
          entityType: c.req.query("entityType"),
          entityId: c.req.query("entityId"),
          sourceEntityId: c.req.query("sourceEntityId"),
          mime: c.req.query("mime"),
          enabled: c.req.query("enabled"),
          page: c.req.query("page"),
          pageSize: c.req.query("pageSize"),
          sortBy: c.req.query("sortBy"),
          sortDir: c.req.query("sortDir"),
        },
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudieron cargar los archivos." }, 500);
    }
  },
);

app.get(
  "/files/:id",
  authMiddleware,
  requirePermission("files.assets.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const asset = await filesService.getById({ authUserId, activeContext: tenantActiveContext(c), id });
      return c.json({ data: asset });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo cargar el archivo." }, 500);
    }
  },
);

app.patch(
  "/files/:id",
  authMiddleware,
  requirePermission("files.assets.update"),
  async (c) => {
    // Intentional policy: renaming is a lifecycle mutation restricted to admin roles.
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      let body;

      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Nombre de archivo invalido." }, 400);
      }

      const parsed = fileRenameSchema.safeParse(body);
      if (!parsed.success) {
        const schemaMessage = parsed.error.issues?.[0]?.message;
        return c.json(
          { error: schemaMessage || "Nombre de archivo invalido." },
          400,
        );
      }

      const updated = await filesService.rename({
        authUserId,
        activeContext: tenantActiveContext(c),
        id,
        originalName: parsed.data.originalName,
      });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "files.assets.rename",
        severity: "info",
        entityType: "FileAsset",
        entityId: id,
        summary:
          `${actorName} renombró un archivo a "${updated.originalName ?? ""}"`.trim(),
      });
      return c.json({ data: updated });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo renombrar el archivo." }, 500);
    }
  },
);

app.post(
  "/files/bulk-download",
  authMiddleware,
  requirePermission("files.assets.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      let body;

      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Solicitud de descarga masiva invalida." }, 400);
      }

      const parsed = fileBulkDownloadSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Solicitud de descarga masiva invalida." }, 400);
      }

      const data = await filesService.bulkDownload({
        authUserId,
        activeContext: tenantActiveContext(c),
        fileIds: parsed.data.fileIds,
        mode: parsed.data.mode,
      });

      return c.json({ data });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo procesar la descarga masiva." }, 500);
    }
  },
);

app.get(
  "/files/:id/signed-url",
  authMiddleware,
  requirePermission("files.assets.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const variant = c.req.query("variant") || "full";
      const data = await filesService.getSignedUrl({ authUserId, activeContext: tenantActiveContext(c), id, variant });
      return c.json({ data });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudo generar el enlace del archivo." },
        500,
      );
    }
  },
);

app.post(
  "/files/batch-signed-urls",
  authMiddleware,
  requirePermission("files.assets.read"),
  async (c) => {
    try {
      const body = await c.req.json();
      const fileIds = Array.isArray(body?.fileIds)
        ? body.fileIds.slice(0, 50)
        : [];
      if (fileIds.length === 0) return c.json({ data: {} });
      // Optional resized copy for grids/cards ("card", "preview"...); applied
      // to images only — other files keep their original signed URL.
      const variant = typeof body?.variant === "string" && body.variant in IMAGE_VARIANTS && body.variant !== "full" ? body.variant : null;
      const isImage = (asset) => String(asset.mimeType ?? "").startsWith("image/");

      const assets = await filesService.getCompanyAssets({
        authUserId: c.get("authUserId"),
        activeContext: tenantActiveContext(c),
        fileIds,
      });

      const byBucket = new Map();
      for (const asset of assets) {
        if (!byBucket.has(asset.bucket)) byBucket.set(asset.bucket, []);
        byBucket.get(asset.bucket).push(asset);
      }

      const urlMap = {};
      await Promise.all(
        [...byBucket.entries()].map(async ([bucket, bucketAssets]) => {
          if (bucket === WEBSITE_BUCKET_NAME) {
            for (const a of bucketAssets) {
              urlMap[a.id] = publicUrlWithVariant(supabaseAdmin, bucket, a.objectKey, variant && isImage(a) ? variant : "full")
            }
            return
          }
          const resized = variant ? bucketAssets.filter(isImage) : [];
          const original = bucketAssets.filter((a) => !resized.includes(a));
          await Promise.all(resized.map(async (a) => {
            urlMap[a.id] = await signedUrlWithVariant(supabaseAdmin, bucket, a.objectKey, variant, 3600);
          }));
          if (original.length === 0) return;
          const { data: signedList } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrls(
              original.map((a) => a.objectKey),
              3600,
            );
          if (Array.isArray(signedList)) {
            for (let i = 0; i < original.length; i++) {
              urlMap[original[i].id] = signedList[i]?.signedUrl ?? null;
            }
          }
        }),
      );

      return c.json({ data: urlMap });
    } catch (err) {
      return c.json(
        { error: "No se pudieron generar los enlaces de archivos." },
        500,
      );
    }
  },
);

app.patch(
  "/files/:id/enabled",
  authMiddleware,
  requirePermission("files.assets.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const body = await c.req.json();
      const updated = await filesService.setEnabled({
        authUserId,
        activeContext: tenantActiveContext(c),
        id,
        enabled: Boolean(body.enabled),
      });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: updated.enabled ? "files.assets.enable" : "files.assets.disable",
        severity: updated.enabled ? "info" : "warning",
        entityType: "FileAsset",
        entityId: id,
        summary: `${actorName} ${updated.enabled ? "habilitó" : "deshabilitó"} un archivo`,
      });
      return c.json({ data: updated });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudo actualizar el estado del archivo." },
        500,
      );
    }
  },
);

app.delete(
  "/files/:id",
  authMiddleware,
  requirePermission("files.assets.delete"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const owner = await prisma.fileAsset.findUnique({ where: { id }, select: { entityType: true, metadata: true, originalName: true } }).catch(() => null);
      await filesService.delete({ authUserId, activeContext: tenantActiveContext(c), id });
      await publishRecordFileActivity(c, { entityType: owner?.entityType, recordId: owner?.metadata?.sourceEntityId, kind: "remove", fileName: owner?.originalName });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "files.assets.delete",
        severity: "warning",
        entityType: "FileAsset",
        entityId: id,
        summary: `${actorName} eliminó un archivo`,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo eliminar el archivo." }, 500);
    }
  },
);

app.patch(
  "/files/:id/cover",
  authMiddleware,
  requirePermission("files.assets.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const file = await filesService.setFileCover({
        authUserId,
        activeContext: tenantActiveContext(c),
        id,
      });
      return c.json({ data: file });
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo marcar la portada." }, 500);
    }
  },
);

app.patch(
  "/files/reorder",
  authMiddleware,
  requirePermission("files.assets.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const { items } = await c.req.json();
      const result = await filesService.reorderFiles({
        authUserId,
        activeContext: tenantActiveContext(c),
        items,
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof FilesServiceError || err instanceof FileAccessError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo reordenar." }, 500);
    }
  },
);

  return app;
}
