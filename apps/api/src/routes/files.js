import { Hono } from "hono";
import { createFilesWorkspaceRouter } from './files-workspace.js';
import { fileBulkDownloadSchema, fileRenameSchema } from "@runly/validators";
import { FilesServiceError } from "../services/files-service.js";
import { FileAccessError } from "../services/files/access.js";
import { getActivityContext, publishActivityFromContext } from "../services/activity-publisher.js";
import { tenantActiveContext } from "../lib/active-context.js";

export function createFilesRouter({ prisma, supabaseAdmin, filesService, authMiddleware, requirePermission }) {
  const app = new Hono();
  app.route('/', createFilesWorkspaceRouter({ prisma, supabaseAdmin, filesService, authMiddleware, requirePermission }));
  const WEBSITE_BUCKET_NAME = "runly-website";
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
              const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(a.objectKey)
              urlMap[a.id] = data?.publicUrl ?? null
            }
            return
          }
          const { data: signedList } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrls(
              bucketAssets.map((a) => a.objectKey),
              3600,
            );
          if (Array.isArray(signedList)) {
            for (let i = 0; i < bucketAssets.length; i++) {
              urlMap[bucketAssets[i].id] = signedList[i]?.signedUrl ?? null;
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
      await filesService.delete({ authUserId, activeContext: tenantActiveContext(c), id });
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
