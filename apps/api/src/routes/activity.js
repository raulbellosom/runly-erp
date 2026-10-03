import { Hono } from "hono";
import ExcelJS from "exceljs";
import { toLocalIso, formatLocalDateTime } from "@runly/core";
import {
  createActivityService,
  ActivityServiceError,
} from "../services/activity-service.js";
import {
  activityPublishSchema,
  activityListQuerySchema,
} from "@runly/validators";
import { attachUserAvatarUrls } from "../lib/attach-user-avatars.js";

export function createActivityRouter({ prisma, requirePermission, supabaseAdmin = null }) {
  const app = new Hono();
  const service = createActivityService({ prisma });
  // Actor photos for every timeline (initials fallback in the UI).
  const withActorAvatars = async (result) => {
    await attachUserAvatarUrls((result?.data ?? []).map((item) => item.actor), { prisma, supabaseAdmin });
    return result;
  };

  function handleError(c, err, scope) {
    if (err instanceof ActivityServiceError) {
      return c.json({ error: err.message, code: err.code }, err.status);
    }
    if (err?.name === "ZodError") {
      return c.json({ error: "Datos inválidos", details: err.flatten() }, 400);
    }
    console.error(`[${scope}] ${err?.name ?? "Error"}: ${err?.message ?? err}`);
    if (err?.stack) console.error(err.stack);
    return c.json({ error: "Error interno" }, 500);
  }

  app.get("/activity", requirePermission("activity.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const raw = Object.fromEntries(new URL(c.req.url).searchParams);
      const query = activityListQuerySchema.parse(raw);
      const result = await withActorAvatars(await service.list({ authUserId, companyId: c.get("companyId"), query }));
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "GET /activity");
    }
  });

  app.get("/activity/recent", requirePermission("activity.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const limit = Number(c.req.query("limit") ?? 20);
      const result = await withActorAvatars(await service.recent({ authUserId, companyId: c.get("companyId"), limit }));
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "GET /activity/recent");
    }
  });

  app.get(
    "/activity/entity/:entityType/:entityId",
    requirePermission("activity.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const entityType = c.req.param("entityType");
        const entityId = c.req.param("entityId");
        const limit = Number(c.req.query("limit") ?? 50);
        const result = await withActorAvatars(await service.listForEntity({
          authUserId,
          companyId: c.get("companyId"),
          entityType,
          entityId,
          limit,
          before: c.req.query("before") || null,
          category: c.req.query("category") || null,
          actorId: c.req.query("actorId") || null,
        }));
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "GET /activity/entity");
      }
    },
  );

  app.post("/activity", requirePermission("activity.publish"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json();
      activityPublishSchema.parse(body);
      const activity = await service.publishFromContext({
        authUserId,
        companyId: c.get("companyId"),
        input: body,
      });
      if (!activity) {
        return c.json({ data: null, deduped: true }, 200);
      }
      return c.json({ data: activity }, 201);
    } catch (err) {
      return handleError(c, err, "POST /activity");
    }
  });

  app.post(
    "/activity/subscribe-token",
    requirePermission("activity.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const { companyId } = await service.resolveCompanyContext(authUserId, c.get("companyId"));
        const auth =
          c.req.header("authorization") ?? c.req.header("Authorization");
        const token =
          typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "") : null;
        return c.json({
          data: {
            channel: `activity:company:${companyId}`,
            token,
          },
        });
      } catch (err) {
        return handleError(c, err, "POST /activity/subscribe-token");
      }
    },
  );

  app.post(
    "/activity/export/excel",
    requirePermission("activity.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json().catch(() => ({}));
        const rawQuery = body?.query ?? {};
        const ids = Array.isArray(body?.ids)
          ? body.ids.filter((v) => typeof v === "string")
          : undefined;
        const query = activityListQuerySchema.parse({
          ...rawQuery,
          ...(ids && ids.length > 0 ? { ids } : {}),
          page: 1,
          pageSize: Math.min(
            Number(rawQuery.pageSize) || (ids ? ids.length : 1000),
            5000,
          ),
        });
        const result = await withActorAvatars(await service.list({ authUserId, companyId: c.get("companyId"), query }));
        const rows = result?.data ?? [];

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Actividad");
        sheet.columns = [
          { header: "Fecha", key: "createdAt", width: 22 },
          { header: "Severidad", key: "severity", width: 14 },
          { header: "Tipo", key: "type", width: 28 },
          { header: "Actor", key: "actor", width: 28 },
          { header: "Resumen", key: "summary", width: 60 },
          { header: "Entidad", key: "entityType", width: 20 },
          { header: "ID Entidad", key: "entityId", width: 40 },
          { header: "Enlace", key: "link", width: 40 },
          { header: "Origen", key: "source", width: 16 },
          { header: "Payload", key: "payload", width: 50 },
        ];
        sheet.getRow(1).font = { bold: true };

        for (const a of rows) {
          const actor = a.actor;
          const actorName = actor
            ? actor.displayName ||
              [actor.firstName, actor.lastName]
                .filter(Boolean)
                .join(" ")
                .trim() ||
              "Sistema"
            : "Sistema";
          sheet.addRow({
            createdAt: a.createdAt ? formatLocalDateTime(a.createdAt) : "",
            severity: a.severity ?? "",
            type: a.type ?? "",
            actor: actorName,
            summary: a.summary ?? "",
            entityType: a.entityType ?? "",
            entityId: a.entityId ?? "",
            link: a.link ?? "",
            source: a.source ?? "",
            payload: a.payload ? JSON.stringify(a.payload) : "",
          });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `actividad-${toLocalIso()}.xlsx`;
        c.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        c.header("X-Atlas-Export-Count", String(rows.length));
        return c.body(buffer);
      } catch (err) {
        return handleError(c, err, "POST /activity/export/excel");
      }
    },
  );

  return app;
}
