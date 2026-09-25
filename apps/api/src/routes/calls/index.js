import { Hono } from "hono";
import { z } from "zod";
import {
  callCreateSchema,
  callLinkPatchSchema,
  callInviteSchema,
} from "@runly/validators";
import { createCallService, CallServiceError } from "./call-service.js";
import { createCallLinksService, CallLinkError } from "./call-links-service.js";
import { createCallGuestService, CallGuestError } from "./call-guest-service.js";
import { createCallMessagesService, CallMessageError } from "./call-messages-service.js";
import { createCallRecordingService, CallRecordingError } from "./call-recording-service.js";
import { createCallTranscriptService, CallTranscriptError } from "./call-transcript-service.js";
import { createCallTranscriptAnalysisService, CallTranscriptAnalysisError } from "./call-transcript-analysis-service.js";
import { createTasksService } from "../projects/tasks-service.js";
import { createCalendarEventService } from "../calendar/calendar-event-service.js";
import { callTranscriptCommitProposalsSchema } from "@runly/validators";
import { buildRecordingReadyMessage, buildTranscriptReadyMessage } from "./call-system-messages.js";
import { createGuestCallRouter } from "./guest-routes.js";

const callIdSchema = z.string().uuid();
const conversationIdSchema = z.string().uuid();
const recordingIdSchema = z.string().uuid();
const transcriptIdSchema = z.string().uuid();

function handleError(c, error, fallback) {
  if (
    error instanceof CallServiceError
    || error instanceof CallLinkError
    || error instanceof CallGuestError
    || error instanceof CallMessageError
    || error instanceof CallRecordingError
    || error instanceof CallTranscriptError
    || error instanceof CallTranscriptAnalysisError
  ) {
    return c.json(
      {
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(error.reason ? { reason: error.reason } : {}),
      },
      error.status,
    );
  }
  if (error?.name === "ZodError") {
    return c.json({ error: (error.errors ?? error.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
  }
  console.error("[runly.calls]", error?.stack ?? error);
  return c.json({ error: fallback }, 500);
}

export function createCallsRouter({
  prisma,
  supabaseAdmin = null,
  authMiddleware,
  requirePermission,
  notificationService = null,
  broadcaster = null,
  deliveryWorker = null,
  smtpService = null,
  service = null,
  recordingService: recordingServiceOverride = null,
  transcriptService: transcriptServiceOverride = null,
}) {
  const app = new Hono();
  const internal = new Hono();

  const calls = service ?? createCallService({ prisma, notificationService, broadcaster, deliveryWorker });
  const linksService = createCallLinksService({ prisma, smtpService, callService: calls, supabaseAdmin });
  const guestService = createCallGuestService({
    prisma, supabaseAdmin, linksService, callService: calls, broadcaster, notificationService,
  });
  const messagesService = createCallMessagesService({ prisma, guestService, broadcaster });
  // Test-only escape hatch, mirroring `service` above: lets call-routes.test.js
  // inject a fake recording service instead of exercising the real Prisma
  // model + LiveKit Egress client through the router's HTTP layer.
  const recordingService = recordingServiceOverride ?? createCallRecordingService({
    prisma, callService: calls, supabaseAdmin,
    onRecordingReady: async (rec) => {
      const msg = buildRecordingReadyMessage({ recordingId: rec.id, durationMs: rec.durationMs });
      await calls.postSystemMessage(rec.conversationId, msg);
    },
  });
  async function logAudit({ companyId, actorId, entityType, entityId, action, before = null, after = null }) {
    await prisma.auditLog.create({ data: { companyId, actorId, entityType, entityId, action, before, after } });
  }
  const transcriptService = transcriptServiceOverride ?? createCallTranscriptService({
    prisma, supabaseAdmin, logAudit,
    onTranscriptReady: async (t) => {
      const msg = buildTranscriptReadyMessage({ transcriptId: t.id, durationMs: t.durationMs });
      await calls.postSystemMessage(t.conversationId, msg);
    },
  });
  const analysisService = createCallTranscriptAnalysisService({
    prisma,
    tasksService: createTasksService({ prisma }),
    calendarService: createCalendarEventService({ prisma }),
    logAudit,
  });

  if (!service) {
    calls.startExpirySweeper();
    const t = setInterval(() => { guestService.sweepAbandonedGuests().catch(() => {}); }, 30_000);
    t.unref?.();
    const rt = setInterval(() => { recordingService.reconcileActiveRecordings().catch(() => {}); }, 30_000);
    rt.unref?.();
    const ct = setInterval(() => { recordingService.cleanupExpiredRecordings().catch(() => {}); }, 60 * 60 * 1000);
    ct.unref?.();
    const trt = setInterval(() => { transcriptService.reconcileReadyTranscripts().catch(() => {}); }, 20_000);
    trt.unref?.();
    const tct = setInterval(() => { transcriptService.cleanupExpiredTranscripts().catch(() => {}); }, 60 * 60 * 1000);
    tct.unref?.();
  }

  // ---- unauthenticated guest routes (no authMiddleware) ----
  app.route("/calls/guest", createGuestCallRouter({ guestService, messagesService }));

  internal.use("*", authMiddleware);

  async function profileId(c) {
    const rows = await prisma.$queryRaw`SELECT id FROM user_profile WHERE auth_user_id = ${c.get("authUserId")} LIMIT 1`;
    if (!rows.length) throw new CallServiceError("Perfil no encontrado.", 404);
    return rows[0].id;
  }

  internal.get("/config", async (c) => c.json({ data: await calls.getConfigStatus() }));

  internal.get("/current", async (c) => {
    try { return c.json({ data: await calls.getCurrentCall({ authUserId: c.get("authUserId") }) }); }
    catch (error) { return handleError(c, error, "Error obteniendo la llamada actual."); }
  });

  internal.post("/", async (c) => {
    try {
      const payload = callCreateSchema.parse(await c.req.json());
      const data = await calls.createCall({ authUserId: c.get("authUserId"), ...payload });
      return c.json({ data }, 201);
    } catch (error) { return handleError(c, error, "Error iniciando la llamada."); }
  });

  // ---- guest link (by conversation) ----
  internal.get("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      return c.json({ data: { link: await linksService.getLink({ conversationId, profileId: await profileId(c) }) } });
    } catch (error) { return handleError(c, error, "Error obteniendo el enlace."); }
  });
  internal.post("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      return c.json({ data: { link: await linksService.getOrCreateLink({ conversationId, profileId: await profileId(c) }) } });
    } catch (error) { return handleError(c, error, "Error creando el enlace."); }
  });
  internal.patch("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const patch = callLinkPatchSchema.parse(await c.req.json());
      return c.json({ data: { link: await linksService.updateLink({ conversationId, profileId: await profileId(c), patch }) } });
    } catch (error) { return handleError(c, error, "Error actualizando el enlace."); }
  });
  internal.delete("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      return c.json({ data: await linksService.revokeLink({ conversationId, profileId: await profileId(c), guestService }) });
    } catch (error) { return handleError(c, error, "Error revocando el enlace."); }
  });
  internal.post("/conversations/:conversationId/link/invites", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const { emails, scheduledAt, scheduledEndAt } = callInviteSchema.parse(await c.req.json());
      return c.json({ data: await linksService.sendInvites({ conversationId, profileId: await profileId(c), emails, scheduledAt, scheduledEndAt }) });
    } catch (error) { return handleError(c, error, "Error enviando invitaciones."); }
  });

  // ---- guest moderation (by call) ----
  internal.get("/:callId/guests", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      return c.json({ data: await guestService.listCallGuests({ profileId: await profileId(c), callId }) });
    } catch (error) { return handleError(c, error, "Error obteniendo invitados."); }
  });
  for (const action of ["admit", "deny", "kick"]) {
    internal.post(`/:callId/guests/:guestId/${action}`, async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        const guestId = z.string().uuid().parse(c.req.param("guestId"));
        const fn = { admit: "admitGuest", deny: "denyGuest", kick: "kickGuest" }[action];
        return c.json({ data: await guestService[fn]({ profileId: await profileId(c), callId, guestId }) });
      } catch (error) { return handleError(c, error, `Error al ${action}.`); }
    });
  }
  internal.post("/:callId/guests/:guestId/mute", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      const guestId = z.string().uuid().parse(c.req.param("guestId"));
      const { muted } = z.object({ muted: z.boolean() }).parse(await c.req.json());
      return c.json({ data: await guestService.muteGuest({ profileId: await profileId(c), callId, guestId, muted }) });
    } catch (error) { return handleError(c, error, "Error al silenciar."); }
  });

  internal.post(
    "/:callId/recording/start",
    requirePermission("chat.calls.record"),
    async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        // requirePermission's middleware already resolved and set this —
        // it is user_profile.id, the same identifier space profileId(c)
        // resolves via raw SQL on unguarded routes below. The recording
        // service still enforces "is THIS user a member of THIS call's
        // conversation" (assertMember) — chat.calls.record alone only
        // proves the caller's role carries the permission somewhere.
        const profileId = c.get("userId");
        const data = await recordingService.startRecording({ callId, startedByUserId: profileId, profileId });
        return c.json({ data }, 201);
      } catch (error) { return handleError(c, error, "Error iniciando la grabación."); }
    },
  );
  internal.post(
    "/:callId/recording/stop",
    requirePermission("chat.calls.record"),
    async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        const data = await recordingService.stopRecording({ callId, profileId: c.get("userId") });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error deteniendo la grabación."); }
    },
  );
  internal.get("/conversations/:conversationId/recordings", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const data = await recordingService.listRecordings({ conversationId, profileId: await profileId(c) });
      return c.json({ data });
    } catch (error) { return handleError(c, error, "Error obteniendo grabaciones."); }
  });
  internal.patch(
    "/recordings/:recordingId",
    requirePermission("chat.calls.record"),
    async (c) => {
      try {
        const recordingId = recordingIdSchema.parse(c.req.param("recordingId"));
        const body = await c.req.json().catch(() => ({}));
        const data = await recordingService.renameRecording({ recordingId, profileId: c.get("userId"), title: body?.title });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error renombrando la grabación."); }
    },
  );
  internal.delete(
    "/recordings/:recordingId",
    requirePermission("chat.calls.record"),
    async (c) => {
      try {
        const recordingId = recordingIdSchema.parse(c.req.param("recordingId"));
        await recordingService.deleteRecording({ recordingId, profileId: c.get("userId") });
        return c.json({ data: { id: recordingId } });
      } catch (error) { return handleError(c, error, "Error eliminando la grabación."); }
    },
  );

  // ---- transcripts (V1 — audio mezclado de una grabación existente) ----
  internal.post(
    "/:callId/transcript/request",
    requirePermission("chat.calls.transcript.request"),
    async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        const profileId = c.get("userId");
        const data = await transcriptService.requestTranscript({ callId, requestedByUserId: profileId, profileId });
        return c.json({ data }, 201);
      } catch (error) { return handleError(c, error, "Error solicitando la transcripción."); }
    },
  );
  internal.post(
    "/transcripts/:transcriptId/retry",
    requirePermission("chat.calls.transcript.request"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        const data = await transcriptService.retryTranscript({ transcriptId, profileId: c.get("userId") });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error reintentando la transcripción."); }
    },
  );
  internal.post(
    "/transcripts/:transcriptId/regenerate",
    requirePermission("chat.calls.transcript.request"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        const data = await transcriptService.regenerateTranscript({ transcriptId, profileId: c.get("userId") });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error regenerando la transcripción."); }
    },
  );
  internal.get("/conversations/:conversationId/transcripts", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const data = await transcriptService.listTranscripts({ conversationId, profileId: await profileId(c) });
      return c.json({ data });
    } catch (error) { return handleError(c, error, "Error obteniendo transcripciones."); }
  });
  internal.get("/transcripts/:transcriptId", async (c) => {
    try {
      const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
      const data = await transcriptService.getTranscript({ transcriptId, profileId: await profileId(c) });
      return c.json({ data });
    } catch (error) { return handleError(c, error, "Error obteniendo la transcripción."); }
  });
  internal.delete(
    "/transcripts/:transcriptId",
    requirePermission("chat.calls.transcript.manage"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        await transcriptService.deleteTranscript({ transcriptId, profileId: c.get("userId") });
        return c.json({ data: { id: transcriptId } });
      } catch (error) { return handleError(c, error, "Error eliminando la transcripción."); }
    },
  );
  internal.post(
    "/transcripts/:transcriptId/analyze",
    requirePermission("chat.calls.transcript.analyze"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        const profileId = c.get("userId");
        // Same access bar as reading the transcript itself (spec §7.3): must
        // have participated in the call, requested it, or hold
        // chat.calls.transcript.manage — reuse getTranscript's own check by
        // calling it first and discarding the result, rather than
        // duplicating wasParticipantOrRequester here.
        await transcriptService.getTranscript({ transcriptId, profileId });
        const data = await analysisService.analyzeTranscript({ transcriptId, profileId });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error analizando la transcripción."); }
    },
  );
  internal.post(
    "/transcripts/:transcriptId/commit-proposals",
    requirePermission("chat.calls.transcript.analyze"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        const profileId = c.get("userId");
        await transcriptService.getTranscript({ transcriptId, profileId });
        const body = callTranscriptCommitProposalsSchema.parse(await c.req.json());
        const data = await analysisService.commitProposals({ transcriptId, profileId, ...body });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error confirmando las propuestas."); }
    },
  );

  internal.get("/:id", async (c) => {
    try {
      const id = callIdSchema.parse(c.req.param("id"));
      return c.json({ data: await calls.getCall({ authUserId: c.get("authUserId"), callId: id }) });
    } catch (error) { return handleError(c, error, "Error obteniendo la llamada."); }
  });

  internal.post('/:callId/screen-token', async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param('callId'));
      return c.json({ data: await calls.getScreenShareToken({ authUserId: c.get('authUserId'), callId }) });
    } catch (error) { return handleError(c, error, 'No se pudo autorizar compartir pantalla.'); }
  });

  for (const [action, method] of [
    ["join", "joinCall"],
    ["decline", "declineCall"],
    ["leave", "leaveCall"],
    ["end", "endCall"],
  ]) {
    internal.post(`/:id/${action}`, async (c) => {
      try {
        const id = callIdSchema.parse(c.req.param("id"));
        const data = await calls[method]({ authUserId: c.get("authUserId"), callId: id });
        return c.json({ data });
      } catch (error) { return handleError(c, error, `Error procesando la accion ${action}.`); }
    });
  }

  app.route("/calls", internal);
  return app;
}
