import { EgressClient, RoomServiceClient, DirectFileOutput, S3Upload, TrackType } from "livekit-server-sdk";
import { readLiveKitConfig } from "./call-service.js";

// Transcripcion de llamadas. Ver docs/TRANSCRIPTION_SPEC.md para el diseno
// completo.
//
// V1 (Alternativa A, audio mezclado): este servicio NO habla con LiveKit ni
// Egress — el trabajo pesado (faster-whisper) corre en un contenedor Python
// separado (runly-transcriber) que sondea Postgres directamente con su
// propia credencial de minimo privilegio y escribe los resultados. Este
// servicio (lado Node/API) es responsable de:
//   - crear la fila PENDING cuando un usuario autorizado lo solicita,
//   - controlar el acceso de lectura/borrado,
//   - la logica de negocio que el worker Python no debe conocer: la
//     retencion configurada (InstanceConfig) y el mensaje de sistema en el
//     chat cuando la transcripcion queda lista (mismo principio que el resto
//     de runly.calls: Hono es la unica autoridad de negocio).
//
// El propio contenedor Python transiciona PENDING -> PROCESSING -> READY|FAILED
// directamente en la tabla call_transcript (arrendamiento/lease, ver spec
// §5.6) — este servicio nunca escribe esos tres estados intermedios para una
// transcripcion V1, solo crea la fila PENDING inicial y hace el trabajo de
// "finalizacion" una vez que ve un READY (fijar expires_at + publicar el
// mensaje de sistema).
//
// V2 (Alternativa B, pistas por participante — spec §0.2/§2.2): a diferencia
// de V1, aqui este servicio SI habla con LiveKit Egress directamente, igual
// que call-recording-service.js — captura audio por participante via
// EgressClient.startTrackEgress mientras la llamada sigue en curso (no
// depende de ninguna CallRecording). Estado nuevo a nivel de CallTranscript,
// 'CAPTURING', anterior a 'PENDING': mientras las pistas siguen grabandose o
// terminando de subirse, la fila no es reclamable por el worker Python. Solo
// cuando CADA CallTranscriptTrack asociado llega a un estado terminal
// (READY|FAILED) este servicio promueve la fila a 'PENDING' (si al menos una
// pista quedo READY) o directamente a 'FAILED' (si ninguna lo logro) —
// exactamente el mismo tipo de reconciliacion por sondeo que ya usa
// call-recording-service.js contra LiveKit, nunca un webhook.

const DEFAULT_RETENTION_DAYS = 365; // decisión de producto confirmada 2026-09-24 — ver docs/TRANSCRIPTION_OPEN_QUESTIONS.md §6
const RETENTION_CONFIG_KEY = "transcription.retentionDays";
const LOG_PREFIX = "[runly.calls/transcript]";
const RECORDING_BUCKET = "runly-chat"; // mismo bucket que grabaciones/adjuntos — call-recording-service.js
const TRACK_ACTIVE_STATUSES = ["STARTING", "ACTIVE", "PROCESSING"];

export class CallTranscriptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallTranscriptError";
    this.status = status;
  }
}

function s3Config(env) {
  return {
    endpoint: String(env.SUPABASE_S3_ENDPOINT ?? "").trim(),
    accessKey: String(env.SUPABASE_S3_ACCESS_KEY_ID ?? "").trim(),
    secret: String(env.SUPABASE_S3_SECRET_ACCESS_KEY ?? "").trim(),
    region: String(env.SUPABASE_S3_REGION ?? "us-east-1").trim(),
  };
}

// LiveKit reports egress durations in nanoseconds (same convention already
// confirmed against production for room-composite recordings, see
// call-recording-service.js's nsToMs — not independently re-verified here for
// track egress specifically, since that verification requires a real call,
// spec §9 risk 4).
function nsToMs(ns) {
  if (ns == null) return null;
  return Math.round(Number(ns) / 1_000_000);
}

export function createCallTranscriptService({
  prisma,
  supabaseAdmin = null, // unused today (no Storage objects for V1 text-only transcripts), kept for parity/future use
  onTranscriptReady = null,
  logAudit = null, // async ({ companyId, actorId, entityType, entityId, action, after }) => void
  now = () => new Date(),
  env = process.env,
  EgressClientImpl = EgressClient,
  RoomServiceClientImpl = RoomServiceClient,
  callService = null, // needed for V2 only: getLiveCallOrThrow (a live call, not just any call row)
}) {
  function liveKit() {
    return readLiveKitConfig(env);
  }

  // Same "class or already-constructed fake" duality as
  // call-recording-service.js's egressClient(), so tests can inject a fake
  // client without this service constructing a real one against it.
  function egressClient() {
    const c = liveKit();
    return typeof EgressClientImpl === "function"
      ? new EgressClientImpl(c.internalUrl, c.apiKey, c.apiSecret)
      : EgressClientImpl;
  }

  function roomServiceClient() {
    const c = liveKit();
    return typeof RoomServiceClientImpl === "function"
      ? new RoomServiceClientImpl(c.internalUrl, c.apiKey, c.apiSecret)
      : RoomServiceClientImpl;
  }

  // recordings/transcripts/... (not recordings/...) keeps V2 track audio in
  // its own namespace, never colliding with a CallRecording's HLS segments
  // even though both live in the same bucket.
  function trackObjectKey(conversationId, callId, livekitIdentity) {
    return `recordings/transcripts/${conversationId}/${callId}/track_${livekitIdentity}.ogg`;
  }
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
      where: { callId, status: { in: ["CAPTURING", "PENDING", "PROCESSING"] } },
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

  // V2 (Alternativa B) — captura audio por participante mientras la llamada
  // SIGUE en curso (a diferencia de requestTranscript, que exige que la
  // llamada ya haya terminado y tenga una CallRecording READY). Analogo a
  // call-recording-service.js's startRecording, pero disparando N trabajos de
  // egress (uno por participante con microfono publicado) en vez de uno solo.
  async function requestTrackTranscription({ callId, requestedByUserId, profileId }) {
    if (!callService?.getLiveCallOrThrow) throw new CallTranscriptError("No disponible.", 500);
    const call = await callService.getLiveCallOrThrow(callId); // 409 si la llamada no esta RINGING/ACTIVE
    await assertMember(call.conversationId, profileId);

    const existing = await prisma.callTranscript.findFirst({
      where: { callId, status: { in: ["CAPTURING", "PENDING", "PROCESSING"] } },
    });
    if (existing) throw new CallTranscriptError("Ya hay una transcripción en curso para esta llamada.", 409);

    const convRows = await prisma.$queryRaw`
      SELECT company_id FROM chat_conversations WHERE id = ${call.conversationId} LIMIT 1
    `;
    const companyId = convRows[0]?.company_id;
    if (!companyId) throw new CallTranscriptError("Conversación no encontrada.", 404);

    let participants;
    try {
      participants = await roomServiceClient().listParticipants(call.livekitRoomName);
    } catch (error) {
      console.warn(`${LOG_PREFIX} No se pudo listar los participantes de la sala:`, callId, error?.message ?? error);
      throw new CallTranscriptError("No se pudo iniciar la captura por pista.", 500);
    }
    const speakers = (participants ?? [])
      .map((p) => ({ identity: p.identity, audioTrack: p.tracks?.find((t) => t.type === TrackType.AUDIO) }))
      .filter((p) => p.audioTrack);
    if (!speakers.length) {
      throw new CallTranscriptError("No hay participantes con micrófono activo en esta llamada.", 422);
    }

    // Resolve each LiveKit identity to a real person (CallParticipant.userId
    // or CallGuest.id) BEFORE starting any egress — spec §1.2 goal 8, no
    // segment is ever attributed via voice recognition, only via this known
    // identity mapping.
    const identities = speakers.map((p) => p.identity);
    const [callParticipants, callGuests] = await Promise.all([
      prisma.callParticipant.findMany({ where: { callId, livekitIdentity: { in: identities } } }),
      prisma.callGuest.findMany({ where: { callId, livekitIdentity: { in: identities } } }),
    ]);
    const userIdByIdentity = new Map(callParticipants.map((p) => [p.livekitIdentity, p.userId]));
    const guestIdByIdentity = new Map(callGuests.map((g) => [g.livekitIdentity, g.id]));

    const record = await prisma.callTranscript.create({
      data: {
        callId,
        conversationId: call.conversationId,
        companyId,
        sourceKind: "PER_TRACK",
        status: "CAPTURING",
        requestedByUserId,
      },
    });

    const client = egressClient();
    const s3 = s3Config(env);
    let started = 0;
    for (const speaker of speakers) {
      const speakerUserId = userIdByIdentity.get(speaker.identity) ?? null;
      const speakerGuestId = guestIdByIdentity.get(speaker.identity) ?? null;
      if (!speakerUserId && !speakerGuestId) {
        // A LiveKit identity with no matching CallParticipant/CallGuest row
        // (e.g. a screen-share pseudo-identity) — skip it rather than
        // capturing an audio track no one could ever attribute to a person.
        console.warn(`${LOG_PREFIX} Identidad de LiveKit sin participante/invitado conocido, se omite:`, callId, speaker.identity);
        continue;
      }
      try {
        const info = await client.startTrackEgress(
          call.livekitRoomName,
          new DirectFileOutput({
            filepath: trackObjectKey(call.conversationId, callId, speaker.identity),
            output: { case: "s3", value: new S3Upload({ ...s3, bucket: RECORDING_BUCKET, forcePathStyle: true }) },
          }),
          speaker.audioTrack.sid,
        );
        await prisma.callTranscriptTrack.create({
          data: {
            transcriptId: record.id,
            egressId: info.egressId,
            livekitIdentity: speaker.identity,
            speakerUserId,
            speakerGuestId,
            status: "ACTIVE",
          },
        });
        started += 1;
      } catch (error) {
        // One participant's egress failing to start must not abort capture
        // for the rest — their speech may still be picked up as bleed on
        // another open mic (spec §0.2 accepted edge case), and there is
        // nothing useful to persist for a track that never got an egressId.
        console.warn(`${LOG_PREFIX} No se pudo iniciar egress de pista:`, callId, speaker.identity, error?.message ?? error);
      }
    }

    if (!started) {
      await prisma.callTranscript.update({
        where: { id: record.id },
        data: { status: "FAILED", failureReason: "No se pudo iniciar ninguna captura de pista.", completedAt: now() },
      });
      throw new CallTranscriptError("No se pudo iniciar la captura por pista.", 500);
    }

    if (logAudit) {
      await logAudit({
        companyId,
        actorId: requestedByUserId,
        entityType: "CallTranscript",
        entityId: record.id,
        action: "chat.call_transcript.request",
        after: { id: record.id, callId, sourceKind: "PER_TRACK", tracksStarted: started },
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }

    return { id: record.id, status: record.status, tracksStarted: started };
  }

  // Explicit stop (host clicks "Detener" — same shape as
  // call-recording-service.js's stopRecording). Also reachable implicitly via
  // reconcileActiveTranscriptTracks() if the call ends before anyone stops it
  // manually. Does not itself mark anything READY/FAILED — that only happens
  // once LiveKit actually reports each egress as complete, which this
  // function does not wait for.
  async function stopTrackTranscription({ callId, profileId }) {
    const transcript = await prisma.callTranscript.findFirst({
      where: { callId, sourceKind: "PER_TRACK", status: "CAPTURING" },
    });
    if (!transcript) throw new CallTranscriptError("No hay una captura de pistas en curso para esta llamada.", 404);
    await assertMember(transcript.conversationId, profileId);

    const activeTracks = await prisma.callTranscriptTrack.findMany({
      where: { transcriptId: transcript.id, status: { in: ["STARTING", "ACTIVE"] } },
    });
    const client = egressClient();
    for (const track of activeTracks) {
      try {
        await client.stopEgress(track.egressId);
      } catch (error) {
        console.warn(`${LOG_PREFIX} No se pudo detener el egress de una pista (se reintentará):`, track.id, error?.message ?? error);
      }
    }
    if (activeTracks.length) {
      await prisma.callTranscriptTrack.updateMany({
        where: { id: { in: activeTracks.map((t) => t.id) } },
        data: { status: "PROCESSING" },
      });
    }
    return { id: transcript.id, status: transcript.status };
  }

  // Periodic sweep (wired alongside reconcileActiveRecordings) — reconciles
  // every CAPTURING transcript's tracks against LiveKit's actual Egress
  // state, and promotes the transcript itself to PENDING (handing it to the
  // Python worker) once every one of its tracks reaches a terminal state.
  // Same "poll, never trust a webhook" pattern as reconcileActiveRecordings.
  async function reconcileActiveTranscriptTracks() {
    const capturing = await prisma.callTranscript.findMany({
      where: { status: "CAPTURING", sourceKind: "PER_TRACK" },
      include: { tracks: true },
    });
    if (!capturing.length) return;

    const client = egressClient();

    for (const transcript of capturing) {
      try {
        // The call ended without anyone explicitly stopping capture (e.g.
        // everyone just hung up) — force-stop any still-active track, same
        // principle as reconcileActiveRecordings' orphan handling.
        let callStillLive = true;
        if (callService?.getLiveCallOrThrow) {
          try { await callService.getLiveCallOrThrow(transcript.callId); }
          catch { callStillLive = false; }
        }
        if (!callStillLive) {
          const stillActive = transcript.tracks.filter((t) => ["STARTING", "ACTIVE"].includes(t.status));
          for (const track of stillActive) {
            try { await client.stopEgress(track.egressId); }
            catch (error) { console.warn(`${LOG_PREFIX} No se pudo forzar el detenimiento del egress de una pista (se reintentará):`, track.id, error?.message ?? error); }
          }
          if (stillActive.length) {
            await prisma.callTranscriptTrack.updateMany({
              where: { id: { in: stillActive.map((t) => t.id) } },
              data: { status: "PROCESSING" },
            });
          }
        }

        const pending = transcript.tracks.filter((t) => TRACK_ACTIVE_STATUSES.includes(t.status));
        for (const track of pending) {
          if (!track.egressId) continue;
          let infos;
          try {
            infos = await client.listEgress({ egressId: track.egressId });
          } catch (error) {
            console.warn(`${LOG_PREFIX} No se pudo consultar el estado del egress de una pista (se reintentará):`, track.id, error?.message ?? error);
            continue;
          }
          const info = (infos ?? [])[0];
          if (!info) continue; // LiveKit no lo ha reportado todavia en este sondeo

          if (info.status === 3 /* EGRESS_COMPLETE */) {
            const file = info.fileResults?.[0];
            await prisma.callTranscriptTrack.update({
              where: { id: track.id },
              data: {
                status: "READY",
                objectKey: trackObjectKey(transcript.conversationId, transcript.callId, track.livekitIdentity),
                durationMs: nsToMs(file?.duration),
                completedAt: now(),
              },
            });
          } else if (info.status === 4 /* EGRESS_FAILED */ || info.status === 5 /* EGRESS_ABORTED */) {
            await prisma.callTranscriptTrack.update({
              where: { id: track.id },
              data: { status: "FAILED", failureReason: info.error || "La captura de esta pista no se pudo completar.", completedAt: now() },
            });
          } else if (track.status === "PROCESSING") {
            try { await client.stopEgress(track.egressId); }
            catch (error) { console.warn(`${LOG_PREFIX} Reintento de detener una pista atascada en PROCESSING falló:`, track.id, error?.message ?? error); }
          }
        }

        // Hand off to the Python worker only once EVERY track is terminal —
        // a transcript with some tracks still ACTIVE/PROCESSING must never
        // become PENDING, or the worker would transcribe a partial capture.
        const refreshed = await prisma.callTranscriptTrack.findMany({ where: { transcriptId: transcript.id } });
        const allTerminal = refreshed.length > 0 && refreshed.every((t) => t.status === "READY" || t.status === "FAILED");
        if (allTerminal) {
          const anyReady = refreshed.some((t) => t.status === "READY");
          await prisma.callTranscript.update({
            where: { id: transcript.id },
            data: anyReady
              ? { status: "PENDING" }
              : { status: "FAILED", failureReason: "Ninguna pista de audio se pudo capturar.", completedAt: now() },
          });
        }
      } catch (error) {
        // One transcript's unexpected failure must not abort the rest of the sweep.
        console.error(`${LOG_PREFIX} Error reconciliando captura por pista:`, transcript.id, error?.stack ?? error);
      }
    }
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
      include: {
        segments: {
          orderBy: { startMs: "asc" },
          // V2 (PER_TRACK) only — a MIXED (V1) segment never has either FK
          // set, so speakerUser/speakerGuest both come back null and the
          // frontend falls back to its current unattributed rendering.
          include: {
            speakerUser: { select: { displayName: true } },
            speakerGuest: { select: { displayName: true } },
          },
        },
      },
    });
    if (!row) throw new CallTranscriptError("Transcripción no encontrada.", 404);
    await assertMember(row.conversationId, profileId);
    // Non-leaking 404 for "member of the conversation but not entitled to
    // read THIS transcript" — same convention as pinMessage/listThreadReplies
    // in chat-service.js (never a distinguishable 403 here).
    if (!(await wasParticipantOrRequester(row, profileId))) {
      throw new CallTranscriptError("Transcripción no encontrada.", 404);
    }
    // Flatten the resolved name onto speakerLabel — TranscriptViewerDialog.jsx
    // already renders segment.speakerLabel as a plain string (anticipated
    // ahead of V2 landing); it never reads speakerUser/speakerGuest directly.
    return {
      ...row,
      segments: row.segments.map((segment) => ({
        ...segment,
        speakerLabel: segment.speakerUser?.displayName ?? segment.speakerGuest?.displayName ?? segment.speakerLabel ?? null,
      })),
    };
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
    if (row.status === "PROCESSING" || row.status === "CAPTURING") {
      throw new CallTranscriptError("Espera a que termine de procesarse antes de eliminarla.", 409);
    }
    await prisma.callTranscript.delete({ where: { id: transcriptId } }); // cascades call_transcript_segment, call_transcript_track

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
  // cleanup. Hard delete. For V1 (MIXED) there is nothing in Storage to
  // remove — segments live only in Postgres, cascaded via the FK. For V2
  // (PER_TRACK) each track's audio file DOES live in Storage (trackObjectKey)
  // and must be removed explicitly, same "skip and retry on failure, never
  // half-delete" principle as call-recording-service.js's own cleanup.
  async function cleanupExpiredTranscripts() {
    const expired = await prisma.callTranscript.findMany({
      where: { status: "READY", expiresAt: { lt: now() } },
      include: { tracks: { select: { objectKey: true } } },
    });
    if (!expired.length) return 0;

    if (supabaseAdmin) {
      const keys = expired.flatMap((t) => t.tracks.map((tr) => tr.objectKey).filter(Boolean));
      if (keys.length) {
        const { error } = await supabaseAdmin.storage.from(RECORDING_BUCKET).remove(keys);
        if (error) {
          console.warn(`${LOG_PREFIX} No se pudieron borrar los archivos de pistas expiradas (se reintentará):`, error.message ?? error);
          return 0; // never delete the DB rows if their storage objects might still be orphaned
        }
      }
    }

    const { count } = await prisma.callTranscript.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
    return count;
  }

  return {
    requestTranscript,
    requestTrackTranscription,
    stopTrackTranscription,
    retryTranscript,
    regenerateTranscript,
    listTranscripts,
    getTranscript,
    deleteTranscript,
    reconcileReadyTranscripts,
    reconcileActiveTranscriptTracks,
    cleanupExpiredTranscripts,
  };
}
