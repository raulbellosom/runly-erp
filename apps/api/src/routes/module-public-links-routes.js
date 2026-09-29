// Admin endpoints for module public links (spec 4.1 of
// docs/superpowers/specs/2026-09-28-module-public-links-design.md).
// Mounted inside the /modules router; the permission is the resource's
// `managePermission`, resolved per request.
import { Hono } from "hono";
import { modulePublicLinkCreateSchema } from "@runly/validators";
import { ModulePublicLinkError } from "../services/module-public-links-service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createModulePublicLinksRoutes({ prisma, authMiddleware, requirePermission, linksService }) {
  const app = new Hono();
  app.use("/:key/public-links", authMiddleware);
  app.use("/:key/public-links/*", authMiddleware);

  async function guard(c, moduleKey, resourceKey) {
    const { resource } = await linksService.resolveResource(moduleKey, resourceKey);
    let allowed = false;
    const denial = await requirePermission(resource.managePermission)(c, async () => { allowed = true; });
    return allowed ? null : denial;
  }

  function audit(c, moduleKey, action, link) {
    return prisma.auditLog.create({
      data: {
        companyId: c.get("companyId"),
        actorId: c.get("userId") ?? null,
        moduleKey,
        entityType: "module_public_link",
        entityId: link.id,
        action,
        metadata: { resourceKey: link.resourceKey, recordId: link.recordId ?? null },
      },
    }).catch((err) => console.error("[public-links] audit failed:", err.message));
  }

  function fail(c, err) {
    if (err instanceof ModulePublicLinkError) return c.json({ error: err.message }, err.status);
    console.error("[public-links]", err?.message);
    return c.json({ error: "No se pudo procesar el enlace." }, 500);
  }

  // Resources of one entity the caller can share (drives the "Compartir"
  // action on generated record details). Never errors on a missing permission.
  app.use("/:key/public-resources", authMiddleware);
  app.get("/:key/public-resources", async (c) => {
    try {
      const moduleKey = c.req.param("key");
      const entity = c.req.query("entity") ?? "";
      const resources = await linksService.listResources(moduleKey, entity);
      const data = [];
      for (const resource of resources) {
        let allowed = false;
        await requirePermission(resource.managePermission)(c, async () => { allowed = true; });
        if (allowed) data.push({ key: resource.key, title: resource.title, mode: resource.mode, entity: resource.entity ?? null });
      }
      return c.json({ data });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/:key/public-links", async (c) => {
    try {
      const moduleKey = c.req.param("key");
      const resourceKey = c.req.query("resource") ?? "";
      const denial = await guard(c, moduleKey, resourceKey);
      if (denial) return denial;
      const data = await linksService.list({
        companyId: c.get("companyId"),
        moduleKey,
        resourceKey,
        recordId: c.req.query("recordId") || null,
      });
      return c.json({ data });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/:key/public-links", async (c) => {
    try {
      const moduleKey = c.req.param("key");
      const parsed = modulePublicLinkCreateSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, 422);
      }
      const denial = await guard(c, moduleKey, parsed.data.resource);
      if (denial) return denial;
      const data = await linksService.create({
        companyId: c.get("companyId"),
        moduleKey,
        userId: c.get("userId"),
        input: parsed.data,
      });
      await audit(c, moduleKey, "module_public_link.create", data);
      return c.json({ data }, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/:key/public-links/:id/revoke", async (c) => {
    try {
      const moduleKey = c.req.param("key");
      // Tenant is only known after requirePermission; resolve the link's resource
      // with a tenant-agnostic lookup first, then re-check ownership by company.
      if (!UUID_RE.test(c.req.param("id"))) return c.json({ error: "Enlace no encontrado." }, 404);
      const probe = await prisma.modulePublicLink.findUnique({
        where: { id: c.req.param("id") },
        select: { resourceKey: true, moduleKey: true },
      });
      if (!probe || probe.moduleKey !== moduleKey) return c.json({ error: "Enlace no encontrado." }, 404);
      const denial = await guard(c, moduleKey, probe.resourceKey);
      if (denial) return denial;
      const link = await linksService.revoke({ companyId: c.get("companyId"), moduleKey, linkId: c.req.param("id") });
      await audit(c, moduleKey, "module_public_link.revoke", link);
      return c.json({ data: { id: link.id, revokedAt: link.revokedAt } });
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}
