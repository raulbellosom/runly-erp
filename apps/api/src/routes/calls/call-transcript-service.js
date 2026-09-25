// Transcripcion de llamadas (V1: audio mezclado de una CallRecording ya
// existente). Ver docs/TRANSCRIPTION_SPEC.md para el diseno completo.
//
// A diferencia de call-recording-service.js, este servicio NO habla con
// LiveKit ni Egress — el trabajo pesado (faster-whisper) corre en un
// contenedor Python separado (runly-transcriber) que sondea Postgres
// directamente con su propia credencial de minimo privilegio y escribe los
// resultados. Este servicio (lado Node/API) es responsable de:
//   - crear la fila PENDING cuando un usuario autorizado lo solicita,
//   - controlar el acceso de lectura/borrado,
//   - la logica de negocio que el worker Python no debe conocer: la
//     retencion configurada (InstanceConfig) y el mensaje de sistema en el
//     chat cuando la transcripcion queda lista (mismo principio que el resto
//     de runly.calls: Hono es la unica autoridad de negocio).
//
// El propio contenedor Python transiciona PENDING -> PROCESSING -> READY|FAILED
// directamente en la tabla call_transcript (arrendamiento/lease, ver spec
// §5.6) — este servicio nunca escribe esos tres estados intermedios, solo
// crea la fila PENDING inicial y hace el trabajo de "finalizacion" una vez
// que ve un READY (fijar expires_at + publicar el mensaje de sistema).

const DEFAULT_RETENTION_DAYS = 365; // decisión de producto confirmada 2026-09-24 — ver docs/TRANSCRIPTION_OPEN_QUESTIONS.md §6
const RETENTION_CONFIG_KEY = "transcription.retentionDays";
const LOG_PREFIX = "[runly.calls/transcript]";

export class CallTranscriptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallTranscriptError";
    this.status = status;
  }
}

export function createCallTranscriptService({
  prisma,
  supabaseAdmin = null, // unused today (no Storage objects for V1 text-only transcripts), kept for parity/future use
  onTranscriptReady = null,
  logAudit = null, // async ({ companyId, actorId, entityType, entityId, action, after }) => void
  now = () => new Date(),
}) {
  // Same shape as call-recording-service.js's assertMember — the caller must
  // be an active member of the conversation. Deliberately raw SQL against
  // chat_conversation_members/chat_conversations (raw-SQL-managed tables),
  // same convention as the rest of runly.calls.
  async function assertMember(conversationId, profileId) {
    const rows = await prisma.$queryRaw`
      SELECT m.id FROM chat_conversation_members m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND m.user_id = ${profileId}
        AND m.left_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new CallTranscriptError("Conversación no encontrada.", 404);
  }

  // Stricter than assertMember: proves the caller either requested this
  // specific transcript or was an actual CallParticipant of that specific
  // call — not just a current member of the conversation. This is the
  // decision documented in docs/TRANSCRIPTION_SPEC.md §5.1 (transcripts are
  // more sensitive than recordings — searchable text, not a video you must
  // watch in full — so a member who joined the conversation after the
  // meeting happened does not automatically inherit read access to it).
  async function wasParticipantOrRequester(transcript, profileId) {
    if (transcript.requestedByUserId === profileId) return true;
    const rows = await prisma.$queryRaw`
      SELECT 1 FROM call_participant WHERE call_id = ${transcript.callId} AND user_id = ${profileId} LIMIT 1
    `;
    return rows.length > 0;
  }

  async function requestTranscript({ callId, requestedByUserId, profileId }) {
    const call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new CallTranscriptError("Llamada no encontrada.", 404);
    await assertMember(call.conversationId, profileId);

    const existing = await prisma.callTranscript.findFirst({
      where: { callId, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (existing) throw new CallTranscriptError("Ya hay una transcripción en curso para esta llamada.", 409);

    // V1 (Alternativa A): depende de que exista una grabacion ya lista. Esta
    // es una limitacion conocida y documentada (spec §0.1), resuelta en V2
    // con captura por pista independiente de la grabacion de video.
    const recording = await prisma.callRecording.findFirst({
      where: { callId, status: "READY" },
      orderBy: { startedAt: "desc" },
    });
    if (!recording) {
      throw new CallTranscriptError(
        "Esta llamada no tiene una grabación lista para transcribir. Graba la llamada primero.",
        422,
      );
    }

    // chat_conversations is a raw-SQL-managed table — company_id lives there,
    // not on Call itself (Call.conversationId carries no Prisma FK, same
    // pattern as every other runly.calls model).
    const convRows = await prisma.$queryRaw`
      SELECT company_id FROM chat_conversations WHERE id = ${call.conversationId} LIMIT 1
    `;
    const companyId = convRows[0]?.company_id;
    if (!companyId) throw new CallTranscriptError("Conversación no encontrada.", 404);

    const record = await prisma.callTranscript.create({
      data: {
        callId,
        conversationId: call.conversationId,
        companyId,
        recordingId: recording.id,
        sourceKind: "MIXED",
        status: "PENDING",
        requestedByUserId,
      },
    });

    if (logAudit) {
      await logAudit({
        companyId,
        actorId: requestedByUserId,
        entityType: "CallTranscript",
        entityId: record.id,
        action: "chat.call_transcript.request",
        after: { id: record.id, callId, recordingId: recording.id },
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }

    return { id: record.id, status: record.status };
  }

  async function retryTranscript({ transcriptId, profileId }) {
    const transcript = await prisma.callTranscript.findUnique({ where: { id: transcriptId } });
    if (!transcript) throw new CallTranscriptError("Transcripción no encontrada.", 404);
    await assertMember(transcript.conversationId, profileId);
    if (transcript.status !== "FAILED") {
      throw new CallTranscriptError("Solo se puede reintentar una transcripción fallida.", 409);
    }

    // A manual retry is a deliberate new attempt by a human — reset the
    // automatic-retry budget rather than counting it against MAX_ATTEMPTS,
    // same spirit as pfm_receipt's retryReceipt() resetting FAILED -> PROCESSING.
    const updated = await prisma.callTranscript.update({
      where: { id: transcriptId },
      data: {
        status: "PENDING",
        attempts: 0,
        failureReason: null,
        leaseExpiresAt: null,
        workerInstanceId: null,
        startedAt: null,
      },
    });

    if (logAudit) {
      await logAudit({
        companyId: transcript.companyId,
        actorId: profileId,
        entityType: "CallTranscript",
        entityId: transcriptId,
        action: "chat.call_transcript.retry",
        after: { id: transcriptId, status: "PENDING" },
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }

    return { id: updated.id, status: updated.status };
  }

  // Explicit "generar de nuevo" over an already-READY transcript — reuses
  // the same row instead of creating a second one, so there is never more
  // than one transcript per call to disambiguate between (spec §5.1 access
  // checks and the UI both assume that 1:1 shape). The Python worker's
  // write_result() already does an idempotent DELETE+INSERT of segments
  // keyed by transcript_id (see apps/transcriber/main.py), so resetting this
  // row back to PENDING and letting it get claimed again is enough to
  // "replace the previous version" — no separate supersede/versioning model.
  async function regenerateTranscript({ transcriptId, profileId }) {
    const transcript = await prisma.callTranscript.findUnique({ where: { id: transcriptId } });
    if (!transcript) throw new CallTranscriptError("Transcripción no encontrada.", 404);
    await assertMember(transcript.conversationId, profileId);
    if (transcript.status !== "READY") {
      throw new CallTranscriptError("Solo se puede regenerar una transcripción lista.", 409);
    }

    // Deleted up front (rather than left for the worker to clear once it
    // claims the job) so a client polling getTranscript() during the brief
    // PENDING window never sees the outgoing segments next to a status that
    // says they're stale.
    await prisma.callTranscriptSegment.deleteMany({ where: { transcriptId } });
    const updated = await prisma.callTranscript.update({
      where: { id: transcriptId },
      data: {
        status: "PENDING",
        attempts: 0,
        failureReason: null,
        leaseExpiresAt: null,
        workerInstanceId: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        model: null,
        language: null,
        finalizedAt: null,
        expiresAt: null,
      },
    });

    if (logAudit) {
      await logAudit({
        companyId: transcript.companyId,
        actorId: profileId,
        entityType: "CallTranscript",
        entityId: transcriptId,
        action: "chat.call_transcript.regenerate",
        after: { id: transcriptId, status: "PENDING" },
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }

    return { id: updated.id, status: updated.status };
  }

  async function listTranscripts({ conversationId, profileId }) {
    await assertMember(conversationId, profileId);
    const rows = await prisma.callTranscript.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });
    const allowed = [];
    for (const row of rows) {
      if (await wasParticipantOrRequester(row, profileId)) allowed.push(row);
    }
    return allowed;
  }

  async function getTranscript({ transcriptId, profileId }) {
    const row = await prisma.callTranscript.findUnique({
      where: { id: transcriptId },
      include: { segments: { orderBy: { startMs: "asc" } } },
    });
    if (!row) throw new CallTranscriptError("Transcripción no encontrada.", 404);
    await assertMember(row.conversationId, profileId);
    // Non-leaking 404 for "member of the conversation but not entitled to
    // read THIS transcript" — same convention as pinMessage/listThreadReplies
    // in chat-service.js (never a distinguishable 403 here).
    if (!(await wasParticipantOrRequester(row, profileId))) {
      throw new CallTranscriptError("Transcripción no encontrada.", 404);
    }
    return row;
  }

  // Admin-style action: requires chat.calls.transcript.manage at the route
  // level (role gate) plus conversation membership here (IDOR gate) — NOT
  // the stricter wasParticipantOrRequester check, since the permission
  // itself is the elevated-trust signal (mirrors how chat.calls.record
  // gates recording deletion without an extra per-call participant check).
  async function deleteTranscript({ transcriptId, profileId }) {
    const row = await prisma.callTranscript.findUnique({ where: { id: transcriptId } });
    if (!row) throw new CallTranscriptError("Transcripción no encontrada.", 404);
    await assertMember(row.conversationId, profileId);
    if (row.status === "PROCESSING") {
      throw new CallTranscriptError("Espera a que termine de procesarse antes de eliminarla.", 409);
    }
    await prisma.callTranscript.delete({ where: { id: transcriptId } }); // cascades call_transcript_segment

    if (logAudit) {
      await logAudit({
        companyId: row.companyId,
        actorId: profileId,
        entityType: "CallTranscript",
        entityId: transcriptId,
        action: "chat.call_transcript.delete",
        after: null,
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }
  }

  async function retentionDays() {
    try {
      const row = await prisma.instanceConfig.findUnique({ where: { key: RETENTION_CONFIG_KEY } });
      const parsed = row?.value != null ? Number(row.value) : null;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
    } catch (error) {
      console.warn(`${LOG_PREFIX} No se pudo leer la retención configurada, usando el valor por defecto:`, error?.message ?? error);
      return DEFAULT_RETENTION_DAYS;
    }
  }

  // Periodic sweep (wired alongside the recording sweeps in
  // apps/api/src/routes/calls/index.js). The Python worker never talks to
  // Hono or Supabase — this is how the API notices a transcript went READY:
  // polling Postgres, same "no webhooks, only polling" pattern the rest of
  // runly.calls already uses for LiveKit/Egress state.
  async function reconcileReadyTranscripts() {
    const rows = await prisma.callTranscript.findMany({
      where: { status: "READY", finalizedAt: null },
    });
    if (!rows.length) return;

    const days = await retentionDays();
    for (const row of rows) {
      try {
        if (onTranscriptReady) {
          await onTranscriptReady({ ...row });
        }
        await prisma.callTranscript.update({
          where: { id: row.id },
          data: {
            finalizedAt: now(),
            expiresAt: new Date(now().getTime() + days * 24 * 60 * 60 * 1000),
          },
        });
      } catch (error) {
        // Left unfinalized on purpose — retried next tick. A transient chat
        // broadcast failure must not silently skip setting expiresAt forever.
        console.warn(`${LOG_PREFIX} No se pudo finalizar una transcripción lista (se reintentará):`, row.id, error?.message ?? error);
      }
    }
  }

  // Spec §5.7 — retention is independent of CallRecording's own 90-day
  // cleanup. Hard delete (no Storage objects to remove for V1 — segments
  // live only in Postgres, cascaded via the FK).
  async function cleanupExpiredTranscripts() {
    const expired = await prisma.callTranscript.findMany({
      where: { status: "READY", expiresAt: { lt: now() } },
      select: { id: true },
    });
    if (!expired.length) return 0;
    const { count } = await prisma.callTranscript.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
    return count;
  }

  return {
    requestTranscript,
    retryTranscript,
    regenerateTranscript,
    listTranscripts,
    getTranscript,
    deleteTranscript,
    reconcileReadyTranscripts,
    cleanupExpiredTranscripts,
  };
}
