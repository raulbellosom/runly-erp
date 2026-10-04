// /trash — Desactivados (spec 2026-10-03-records-trash-design §8).
// requireActiveCompany only establishes the active company/user; each handler
// checks the provider's permission (and core.records.purge for purges).
import { Hono } from "hono";
import { tenantActiveContext } from "../lib/active-context.js";
import { createTrashRegistry, can, PURGE_PERMISSION } from "../services/trash/trash-registry.js";
import { TrashError } from "../services/trash/trash-errors.js";

function fail(c, error, fallback) {
  if (error instanceof TrashError) return c.json({ error: error.message, code: error.code }, error.status);
  // Module service errors (files-service access, not found...) keep their status.
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) return c.json({ error: error.message }, error.status);
  console.error("[trash]", error?.message ?? error);
  return c.json({ error: fallback }, 500);
}

export function createTrashRouter({ prisma, requireActiveCompany, filesService = null }) {
  const app = new Hono();
  const registry = createTrashRegistry({ prisma, filesService });
  const ctx = (c) => ({
    prisma, companyId: c.get("companyId"), user: c.get("userContext"), actorId: c.get("userId") ?? null,
    // For providers that delegate to a module service (Archivos).
    authUserId: c.get("authUserId") ?? null, activeContext: tenantActiveContext(c),
  });
  // Purge = core.records.purge plus the provider's own delete permission, when it declares one.
  const canPurge = (user, provider) => can(user, PURGE_PERMISSION) && (!provider.permissions.purge || can(user, provider.permissions.purge));

  async function audit(c, provider, action, record) {
    await prisma.auditLog.create({
      data: {
        companyId: c.get("companyId"), actorId: c.get("userId") ?? null, moduleKey: provider.moduleKey,
        entityType: provider.id, entityId: record.id, action,
        before: null, after: { label: record.label ?? null }, metadata: { provider: provider.id },
      },
    }).catch((error) => console.error("[trash] audit failed:", error?.message));
  }

  app.get("/trash/providers", requireActiveCompany, async (c) => {
    try {
      const { companyId, user } = ctx(c);
      const providers = await registry.providersFor({ companyId, user, moduleKey: c.req.query("moduleKey") || null });
      const data = await Promise.all(providers.map(async (provider) => ({
        id: provider.id, moduleKey: provider.moduleKey, moduleName: provider.moduleName,
        label: provider.label, pluralLabel: provider.pluralLabel, count: await provider.count(ctx(c)), canPurge: canPurge(user, provider),
      })));
      return c.json({ data });
    } catch (error) {
      return fail(c, error, "No se pudieron cargar los registros desactivados.");
    }
  });

  app.get("/trash/:providerId/items", requireActiveCompany, async (c) => {
    try {
      const { companyId, user } = ctx(c);
      const provider = await registry.providerFor({ companyId, user, providerId: c.req.param("providerId") });
      return c.json({ data: await provider.list(ctx(c), { search: c.req.query("search") ?? "", page: c.req.query("page") ?? 1 }) });
    } catch (error) {
      return fail(c, error, "No se pudieron cargar los registros desactivados.");
    }
  });

  app.post("/trash/:providerId/items/:id/restore", requireActiveCompany, async (c) => {
    try {
      const { companyId, user } = ctx(c);
      const provider = await registry.providerFor({ companyId, user, providerId: c.req.param("providerId") });
      const record = await provider.restore(ctx(c), c.req.param("id"));
      await audit(c, provider, "core.records.restored", record);
      return c.json({ data: record });
    } catch (error) {
      return fail(c, error, "No se pudo reactivar el registro.");
    }
  });

  app.delete("/trash/:providerId/items/:id", requireActiveCompany, async (c) => {
    try {
      const { companyId, user } = ctx(c);
      const body = await c.req.json().catch(() => ({}));
      if (body?.confirmation !== "ELIMINAR") return c.json({ error: "Confirmación requerida." }, 422);
      const provider = await registry.providerFor({ companyId, user, providerId: c.req.param("providerId") });
      if (!canPurge(user, provider)) return c.json({ error: "No tienes permiso para eliminar registros definitivamente." }, 403);
      const record = await provider.purge(ctx(c), c.req.param("id"));
      await audit(c, provider, "core.records.purged", record);
      return c.json({ data: record });
    } catch (error) {
      return fail(c, error, "No se pudo eliminar el registro.");
    }
  });

  return app;
}
