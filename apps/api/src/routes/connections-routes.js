// /connections — Connections between custom modules and core entities (spec
// 2026-10-03-rme3-module-platform-v2 §12.2). requireAnyPermission only
// establishes the active company/user; each handler checks the permission of
// the target type (manage for config, read for records).
import { Hono } from "hono";
import {
  EXTERNAL_RELATION_TARGETS,
  connectionTarget,
  connectionsManagePermission,
} from "@runly/module-compiler";
import { ConnectionAdminError, createConnectionAdminService } from "../services/connections/connection-admin-service.js";
import { createConnectionReadService } from "../services/connections/connection-read-service.js";
import { createConnectionLifecycle } from "../services/connections/connection-lifecycle.js";
import { can } from "../services/connections/connection-catalog.js";

const TYPES = Object.keys(EXTERNAL_RELATION_TARGETS);
const ANY_CONNECTIONS_PERMISSION = [...new Set(TYPES.flatMap((type) => [EXTERNAL_RELATION_TARGETS[type].permission, connectionsManagePermission(type)]))];
const UUID_RE = /^[0-9a-f-]{36}$/i;

function fail(c, error, fallback) {
  if (error instanceof ConnectionAdminError) return c.json({ error: error.message }, error.status);
  console.error("[connections]", error?.message ?? error);
  return c.json({ error: fallback }, 500);
}

export function createConnectionsRouter({ prisma, requirePermission, requireAnyPermission }) {
  const app = new Hono();
  const admin = createConnectionAdminService({ prisma });
  const reads = createConnectionReadService({ prisma });
  const lifecycle = createConnectionLifecycle({ prisma });
  const anyConnections = requireAnyPermission(ANY_CONNECTIONS_PERMISSION);

  const userOf = (c) => c.get("userContext");
  const targetOrNull = (type) => (TYPES.includes(type) && connectionTarget(type) ? connectionTarget(type) : null);

  // Conexiones screen: every connection to the target type for this company.
  app.get("/connections", anyConnections, async (c) => {
    const targetType = c.req.query("targetType");
    if (!targetOrNull(targetType)) return c.json({ error: "Tipo de destino desconocido." }, 400);
    if (!can(userOf(c), connectionsManagePermission(targetType))) return c.json({ error: "No tienes permiso para administrar conexiones." }, 403);
    try {
      return c.json({ data: await admin.listForAdmin({ companyId: c.get("companyId"), targetType }) });
    } catch (error) {
      return fail(c, error, "No se pudieron cargar las conexiones.");
    }
  });

  app.patch("/connections/:id", anyConnections, async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "Conexión no encontrada." }, 404);
    const companyId = c.get("companyId");
    const row = await prisma.moduleConnection.findFirst({ where: { id, companyId }, select: { targetType: true } });
    if (!row) return c.json({ error: "Conexión no encontrada." }, 404);
    if (!can(userOf(c), connectionsManagePermission(row.targetType))) return c.json({ error: "No tienes permiso para administrar conexiones." }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const updated = await admin.updateConfig({ companyId, id, patch: body ?? {} });
      await prisma.auditLog.create({
        data: {
          actorId: c.get("userId") ?? null,
          moduleKey: "runly.core",
          entityType: "ModuleConnection",
          entityId: id,
          action: body?.status === "active" ? "core.connection.activated" : body?.status === "disabled" ? "core.connection.disabled" : "core.connection.updated",
          before: null,
          after: body ?? {},
        },
      }).catch(() => {});
      return c.json({ data: updated });
    } catch (error) {
      return fail(c, error, "No se pudo actualizar la conexión.");
    }
  });

  // Sections of one core record. surface: detail | form.
  app.get("/connections/records", anyConnections, async (c) => {
    const targetType = c.req.query("targetType");
    const targetId = c.req.query("targetId");
    const surface = c.req.query("surface") === "form" ? "form" : "detail";
    const target = targetOrNull(targetType);
    if (!target || !UUID_RE.test(String(targetId ?? ""))) return c.json({ error: "Parámetros inválidos." }, 400);
    if (!can(userOf(c), target.permission)) return c.json({ error: "Sin acceso." }, 403);
    try {
      return c.json({ data: await reads.recordsFor({ companyId: c.get("companyId"), targetType, targetId, surface, user: userOf(c) }) });
    } catch (error) {
      return fail(c, error, "No se pudieron cargar los datos conectados.");
    }
  });

  // Values of connected list columns for up to 200 core records.
  app.post("/connections/records/batch", anyConnections, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const target = targetOrNull(body?.targetType);
    if (!target || !Array.isArray(body?.targetIds)) return c.json({ error: "Parámetros inválidos." }, 400);
    if (!can(userOf(c), target.permission)) return c.json({ error: "Sin acceso." }, 403);
    const targetIds = body.targetIds.filter((id) => UUID_RE.test(String(id))).slice(0, 200);
    try {
      return c.json({ data: await reads.columnsFor({ companyId: c.get("companyId"), targetType: body.targetType, targetIds, user: userOf(c) }) });
    } catch (error) {
      return fail(c, error, "No se pudieron cargar las columnas conectadas.");
    }
  });

  app.post("/connections/rebuild", requirePermission("core.modules.manage"), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json({ data: await lifecycle.rebuildIndex({ moduleKey: typeof body?.moduleKey === "string" ? body.moduleKey : null }) });
    } catch (error) {
      return fail(c, error, "No se pudo reconstruir el índice de conexiones.");
    }
  });

  return app;
}
