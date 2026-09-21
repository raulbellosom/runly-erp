import { Hono } from "hono";
import {
  createNotificationService,
  NotificationServiceError,
} from "../services/notification-service.js";
import { createWebPushService } from "../services/web-push-service.js";

export function createNotificationsRouter({ prisma, requirePermission }) {
  const app = new Hono();
  const service = createNotificationService({ prisma });
  const webPushService = createWebPushService({ prisma });

  function handleError(c, err, scope) {
    if (err instanceof NotificationServiceError) {
      return c.json({ error: err.message, code: err.code }, err.status);
    }
    if (err?.name === "ZodError") {
      return c.json({ error: "Datos invalidos", details: err.flatten() }, 400);
    }
    console.error(`[${scope}]`, err?.message ?? err);
    return c.json({ error: "Error interno" }, 500);
  }

  app.get(
    "/notifications",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const raw = Object.fromEntries(new URL(c.req.url).searchParams);
        const result = await service.list({ authUserId, companyId: c.get("companyId"), query: raw });
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "GET /notifications");
      }
    },
  );

  app.patch(
    "/notifications/read-all",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const result = await service.markAllRead({ authUserId, companyId: c.get("companyId") });
        return c.json({ data: result });
      } catch (err) {
        return handleError(c, err, "PATCH /notifications/read-all");
      }
    },
  );

  app.patch(
    "/notifications/:id/read",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const result = await service.markRead({ authUserId, companyId: c.get("companyId"), id });
        return c.json({ data: result });
      } catch (err) {
        return handleError(c, err, "PATCH /notifications/:id/read");
      }
    },
  );

  app.patch(
    "/notifications/read-by-source",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json();
        const { sourceType, sourceId } = body ?? {};
        if (!sourceType || !sourceId) {
          return c.json({ error: "sourceType y sourceId son requeridos" }, 400);
        }
        const result = await service.markReadBySource({ authUserId, companyId: c.get("companyId"), sourceType, sourceId });
        return c.json({ data: result });
      } catch (err) {
        return handleError(c, err, "PATCH /notifications/read-by-source");
      }
    },
  );

  app.post(
    "/notifications/publish",
    requirePermission("notifications.publish"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json();
        const result = await service.publishFromContext({
          authUserId,
          companyId: c.get("companyId"),
          input: body,
        });
        return c.json(
          {
            data: {
              created: result.created,
              deduped: result.deduped,
            },
          },
          201,
        );
      } catch (err) {
        return handleError(c, err, "POST /notifications/publish");
      }
    },
  );

  app.get(
    "/notifications/preferences",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const result = await service.listPreferences({ authUserId, companyId: c.get("companyId") });
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "GET /notifications/preferences");
      }
    },
  );

  app.put(
    "/notifications/preferences",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json();
        const result = await service.upsertPreference({
          authUserId,
          companyId: c.get("companyId"),
          input: body,
        });
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "PUT /notifications/preferences");
      }
    },
  );

  app.get(
    "/notifications/subscriptions/webpush/public-key",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const config = await webPushService.getVapidConfig();
        if (!config.configured || !config.publicKey) {
          return c.json(
            {
              error:
                "Push web no configurado. Solicita a un administrador configurar VAPID.",
              code: "web_push_not_configured",
            },
            409,
          );
        }
        return c.json({
          data: { publicKey: config.publicKey, subject: config.subject },
        });
      } catch (err) {
        return handleError(
          c,
          err,
          "GET /notifications/subscriptions/webpush/public-key",
        );
      }
    },
  );

  app.post(
    "/notifications/subscriptions/webpush",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const userAgent = c.req.header("user-agent") ?? null;
        const body = await c.req.json();
        const result = await service.subscribeWebPush({
          authUserId,
          companyId: c.get("companyId"),
          input: body,
          userAgent,
        });
        return c.json(result, 201);
      } catch (err) {
        return handleError(c, err, "POST /notifications/subscriptions/webpush");
      }
    },
  );

  app.delete(
    "/notifications/subscriptions/webpush/:id",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const result = await service.unsubscribeWebPush({ authUserId, companyId: c.get("companyId"), id });
        return c.json(result);
      } catch (err) {
        return handleError(
          c,
          err,
          "DELETE /notifications/subscriptions/webpush/:id",
        );
      }
    },
  );

  app.post(
    "/notifications/subscriptions/fcm",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json();
        const result = await service.subscribeFcm({
          authUserId,
          companyId: c.get("companyId"),
          input: body,
        });
        return c.json(result, 201);
      } catch (err) {
        return handleError(c, err, "POST /notifications/subscriptions/fcm");
      }
    },
  );

  app.delete(
    "/notifications/subscriptions/fcm/:id",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const result = await service.unsubscribeFcm({ authUserId, companyId: c.get("companyId"), id });
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "DELETE /notifications/subscriptions/fcm/:id");
      }
    },
  );

  return app;
}
