// /relation-targets: system entities Builder modules can relate to — catalog
// (Builder), search (relation pickers) and resolve (labels). The per-type
// permission is enforced by relation-targets-service.js; requireAnyPermission
// only establishes the active company.
import { Hono } from "hono";
import { EXTERNAL_RELATION_TARGETS } from "@runly/module-compiler";
import { RelationTargetError } from "../services/relation-targets-service.js";

const ANY_TARGET_PERMISSION = [...new Set(Object.values(EXTERNAL_RELATION_TARGETS).map((target) => target.permission))];

function fail(c, error, fallback) {
  if (error instanceof RelationTargetError) return c.json({ error: error.message }, error.status);
  console.error("[relation-targets]", error?.message);
  return c.json({ error: fallback }, 500);
}

export function createRelationTargetsRouter({ relationTargets, requirePermission, requireAnyPermission }) {
  const app = new Hono();

  app.get("/relation-targets", requirePermission("core.modules.builder"), async (c) => {
    try {
      return c.json({ data: await relationTargets.catalog() });
    } catch (error) {
      return fail(c, error, "No se pudo cargar el catálogo de relaciones.");
    }
  });

  // Same shape as a module list (data[]) so RunlyForm relation pickers can
  // use it directly (searchParam "search").
  app.get("/relation-targets/:type/search", requireAnyPermission(ANY_TARGET_PERMISSION), async (c) => {
    try {
      const data = await relationTargets.search({
        authUserId: c.get("authUserId"),
        companyId: c.get("companyId"),
        type: c.req.param("type"),
        q: c.req.query("search") ?? c.req.query("q") ?? "",
        limit: c.req.query("pageSize"),
      });
      return c.json({ data });
    } catch (error) {
      return fail(c, error, "No se pudo buscar.");
    }
  });

  app.post("/relation-targets/:type/resolve", requireAnyPermission(ANY_TARGET_PERMISSION), async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const found = await relationTargets.resolve({
        authUserId: c.get("authUserId"),
        companyId: c.get("companyId"),
        type: c.req.param("type"),
        ids: Array.isArray(body?.ids) ? body.ids.slice(0, 100) : [],
      });
      return c.json({ data: [...found].map(([id, value]) => ({ id, ...value })) });
    } catch (error) {
      return fail(c, error, "No se pudieron resolver los registros.");
    }
  });

  return app;
}
