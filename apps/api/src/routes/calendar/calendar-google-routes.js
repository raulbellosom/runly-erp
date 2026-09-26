// apps/api/src/routes/calendar/calendar-google-routes.js
//
// Google Calendar integration: connection status, OAuth connect/callback,
// listing Google calendars, selecting/importing sources, and disconnecting.
// Extracted from calendar-routes.js on 2026-09-25 to keep that file under
// the CLAUDE.md 1000-line limit, following the chat module's
// channel-routes.js / moderation-routes.js extraction pattern.
import { Hono } from "hono";
import { CalendarServiceError } from "./calendar-service.js";
import { resolveGoogleCalendarConfig } from "./google/google-config.js";
import { createGoogleTokenCrypto } from "./google/google-token-crypto.js";
import { createGoogleCalendarConnectionService } from "./google/google-connection-service.js";
import { createGoogleOAuthService } from "./google/google-oauth-service.js";
import { createGoogleCalendarDiscoveryService } from "./google/google-calendar-discovery-service.js";
import { createGoogleCalendarSourceService } from "./google/google-source-service.js";
import { createGoogleCalendarEventsService } from "./google/google-calendar-events-service.js";
import { createGoogleCalendarEventLinkService } from "./google/google-calendar-event-link-service.js";
import { createGoogleCalendarInitialImportService } from "./google/google-calendar-initial-import-service.js";
import { createGoogleAccessTokenResolver } from "./google/google-access-token-resolver.js";

function getUserId(c) {
  return c.get("userContext")?.profile?.id ?? null;
}

function handleError(c, err, fallback) {
  if (err instanceof CalendarServiceError)
    return c.json({ error: err.message }, err.status);
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
    return c.json({ error: err.message || fallback }, err.status);
  }
  if (process.env.NODE_ENV !== "production")
    console.error("[runly.calendar]", err);
  return c.json({ error: fallback }, 500);
}

export function createGoogleRouteDependencies({ prisma, google = {} }) {
  function getConfig() {
    const resolveConfig = google.resolveConfig ?? resolveGoogleCalendarConfig;
    return resolveConfig(process.env);
  }

  function requireConfig() {
    const config = getConfig();
    if (!config?.configured) {
      throw new CalendarServiceError(
        "Google Calendar no esta configurado en esta instancia.",
        503,
      );
    }
    return config;
  }

  function getTokenCrypto() {
    return (
      google.tokenCrypto ??
      createGoogleTokenCrypto({ key: requireConfig().encryptionKey })
    );
  }

  function getConnectionService() {
    return (
      google.connectionService ??
      createGoogleCalendarConnectionService({
        prisma,
        tokenCrypto: getTokenCrypto(),
      })
    );
  }

  function getOAuthService() {
    return (
      google.oauthService ??
      createGoogleOAuthService({
        config: requireConfig(),
      })
    );
  }

  function getDiscoveryService() {
    return google.discoveryService ?? createGoogleCalendarDiscoveryService();
  }

  function getSourceService() {
    return (
      google.sourceService ??
      createGoogleCalendarSourceService({
        prisma,
      })
    );
  }

  function getEventsService() {
    return google.eventsService ?? createGoogleCalendarEventsService();
  }

  function getEventLinkService() {
    return (
      google.eventLinkService ??
      createGoogleCalendarEventLinkService({
        prisma,
      })
    );
  }

  function getInitialImportService() {
    return (
      google.initialImportService ??
      createGoogleCalendarInitialImportService({
        prisma,
        eventsService: getEventsService(),
        linkService: getEventLinkService(),
      })
    );
  }

  function getAccessTokenResolver() {
    return (
      google.accessTokenResolver ??
      createGoogleAccessTokenResolver({
        tokenCrypto: getTokenCrypto(),
        oauthService: getOAuthService(),
        connectionService: getConnectionService(),
      })
    );
  }

  return {
    getConfig,
    requireConfig,
    getTokenCrypto,
    getConnectionService,
    getOAuthService,
    getDiscoveryService,
    getSourceService,
    getEventsService,
    getEventLinkService,
    getInitialImportService,
    getAccessTokenResolver,
  };
}

export function createCalendarGoogleRoutes({ prisma, requirePermission, google }) {
  const app = new Hono();
  const googleDeps = createGoogleRouteDependencies({ prisma, google });

  async function requireActiveGoogleConnection(userId) {
    const connection = await googleDeps
      .getConnectionService()
      .getConnectionByUserId(userId);

    if (!connection || connection.status !== "ACTIVE") {
      throw new CalendarServiceError(
        "No hay una cuenta Google conectada.",
        409,
      );
    }

    return connection;
  }

  app.get(
    "/calendar/google/status",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const config = googleDeps.getConfig();
        const connection =
          config?.configured && userId
            ? await googleDeps
                .getConnectionService()
                .getConnectionByUserId(userId)
            : null;

        return c.json({
          configured: Boolean(config?.configured),
          missing: Array.isArray(config?.missing) ? config.missing : [],
          redirectUri: config?.configured ? config.redirectUri : null,
          connection: connection
            ? {
                googleEmail: connection.googleEmail ?? null,
                status: connection.status ?? null,
                connectedAt: connection.connectedAt ?? null,
              }
            : null,
        });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo obtener el estado de Google Calendar.",
        );
      }
    },
  );

  app.post(
    "/calendar/google/connect/start",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const state = googleDeps
          .getOAuthService()
          .createAuthorizationState({ userId });
        const authUrl = googleDeps
          .getOAuthService()
          .buildAuthorizationUrl({ state });
        return c.json({ authUrl });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo iniciar la conexion con Google Calendar.",
        );
      }
    },
  );

  app.get(
    "/calendar/google/connect/callback",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const code = c.req.query("code");
        const state = c.req.query("state");

        if (!String(code ?? "").trim()) {
          throw new CalendarServiceError("code es requerido.", 400);
        }
        if (!String(state ?? "").trim()) {
          throw new CalendarServiceError("state es requerido.", 400);
        }

        googleDeps
          .getOAuthService()
          .verifyAuthorizationState({ state, userId });

        const tokenPayload = await googleDeps
          .getOAuthService()
          .exchangeCodeForTokens({ code });
        const connection = await googleDeps
          .getConnectionService()
          .saveConnection({
            userId,
            ...tokenPayload,
          });

        return c.json({
          ok: true,
          connection: {
            googleEmail: connection.googleEmail ?? null,
            status: connection.status ?? null,
          },
        });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo completar la conexion con Google Calendar.",
        );
      }
    },
  );

  app.get(
    "/calendar/google/calendars",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await requireActiveGoogleConnection(userId);
        const { accessToken } = await googleDeps
          .getAccessTokenResolver()
          .resolveAccessToken(userId, connection);
        const items = await googleDeps
          .getDiscoveryService()
          .listCalendars({ accessToken });

        return c.json({ items });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron obtener los calendarios de Google.",
        );
      }
    },
  );

  app.get(
    "/calendar/google/sources",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await requireActiveGoogleConnection(userId);
        const items = await googleDeps
          .getSourceService()
          .listSourcesForConnection(connection.id);

        return c.json({ items });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron obtener los calendarios sincronizados de Google.",
        );
      }
    },
  );

  app.post(
    "/calendar/google/sources",
    requirePermission("calendar.calendars.create"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await requireActiveGoogleConnection(userId);
        const body = await c.req.json();
        const result = await googleDeps.getSourceService().saveSelectedSources({
          connectionId: connection.id,
          ownerId: userId,
          calendars: body?.calendars,
        });

        if (
          Array.isArray(result.importTargets) &&
          result.importTargets.length > 0
        ) {
          const importTargets = result.importTargets;

          queueMicrotask(async () => {
            try {
              const { accessToken } = await googleDeps
                .getAccessTokenResolver()
                .resolveAccessToken(userId, connection);

              await Promise.allSettled(
                importTargets.map((source) =>
                  googleDeps
                    .getInitialImportService()
                    .importSource({ source, accessToken }),
                ),
              );
            } catch (error) {
              // Token could not be resolved/refreshed (e.g. the refresh
              // token was revoked) — mark the pending sources as errored
              // instead of leaving them stuck at SYNCING forever.
              await Promise.allSettled(
                importTargets.map((source) =>
                  googleDeps
                    .getInitialImportService()
                    .markSourceError(source.id, error),
                ),
              ).catch(() => {});

              if (process.env.NODE_ENV !== "production") {
                console.error(
                  "[runly.calendar] google initial import dispatch failed",
                  error,
                );
              }
            }
          });
        }

        return c.json({ items: result.items }, 201);
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron guardar los calendarios seleccionados de Google.",
        );
      }
    },
  );

  app.post(
    "/calendar/google/disconnect",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await googleDeps
          .getConnectionService()
          .getConnectionByUserId(userId);

        if (!connection || connection.status !== "ACTIVE") {
          return c.json({ ok: true });
        }

        // Optionally delete all imported Google calendars and their events
        const body = await c.req.json().catch(() => ({}));
        if (body.deleteEvents === true) {
          const sources = await prisma.googleCalendarSource.findMany({
            where: { connectionId: connection.id },
            select: { id: true, atlasCalendarId: true },
          });
          if (sources.length > 0) {
            const sourceIds = sources.map((s) => s.id);
            const atlasCalendarIds = sources.map((s) => s.atlasCalendarId);

            // 1. Delete sources first — they hold a Restrict FK to CalendarCalendar
            //    Cascade removes GoogleCalendarEventLink rows as well
            await prisma.googleCalendarSource.deleteMany({
              where: { id: { in: sourceIds } },
            });

            // 2. Delete the Atlas calendars — cascade removes CalendarEvent rows
            await prisma.calendarCalendar.deleteMany({
              where: { id: { in: atlasCalendarIds } },
            });
          }
        }

        await googleDeps
          .getSourceService()
          .disableSourcesForConnection(connection.id);
        await googleDeps.getConnectionService().disconnect(userId);

        return c.json({ ok: true });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo desconectar la cuenta de Google Calendar.",
        );
      }
    },
  );

  return app;
}
