import { EgressClient, SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from "livekit-server-sdk";
import { readLiveKitConfig } from "./call-service.js";

const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // hard cap — spec §24 risk 3
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // spec §5 goal 4
const RECORDING_BUCKET = "runly-chat";
const SEGMENT_SIGN_TTL_SECONDS = 3600;
const ACTIVE_STATUSES = ["STARTING", "ACTIVE", "PROCESSING"];
const STORAGE_LIST_PAGE_SIZE = 1000;
const LOG_PREFIX = "[runly.calls/recording]";

export class CallRecordingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallRecordingError";
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

export function createCallRecordingService({
  prisma,
  env = process.env,
  EgressClientImpl = EgressClient,
  callService = null,
  supabaseAdmin = null,
  onRecordingReady = null,
  now = () => new Date(),
}) {
  function liveKit() {
    return readLiveKitConfig(env);
  }

  function egressClient() {
    const c = liveKit();
    // EgressClientImpl may be a class (constructed here, like the real
    // livekit-server-sdk EgressClient) or an already-constructed fake
    // instance handed in directly by a test — support both.
    return typeof EgressClientImpl === "function"
      ? new EgressClientImpl(c.internalUrl, c.apiKey, c.apiSecret)
      : EgressClientImpl;
  }

  // LiveKit's SegmentedFileOutput treats `filenamePrefix` as a literal
  // filename stem, not a directory: segments are named
  // `<filenamePrefix>_NNNNNN.ts` and the playlist is written to
  // `dirname(filenamePrefix)/<playlistName>`. A prefix of just
  // "recordings/<conversationId>/<recordingId>" therefore places the
  // playlist one level too shallow, at "recordings/<conversationId>/index.m3u8"
  // — shared by every recording of that conversation, so a later recording
  // silently overwrites an earlier one's playlist. The trailing "/segment"
  // stem makes recordingId a real directory segment so each recording gets
  // its own playlist path (verified against production egress output).
  function objectDir(conversationId, recordingId) {
    return `recordings/${conversationId}/${recordingId}`;
  }

  function objectPrefix(conversationId, recordingId) {
    return `${objectDir(conversationId, recordingId)}/segment`;
  }

  // The playlist's final key is derived from what we asked LiveKit to write,
  // not from the EgressInfo it echoes back in segmentResults[].playlistLocation:
  // depending on how SUPABASE_S3_ENDPOINT is configured, that field can come
  // back as an absolute URL rather than a bucket-relative key, and
  // supabaseAdmin.storage.createSignedUrl() (listRecordings, below) requires
  // a bucket-relative key — an absolute URL there always fails to resolve.
  function buildPlaylistObjectKey(conversationId, recordingId) {
    return `${objectDir(conversationId, recordingId)}/index.m3u8`;
  }

  // IDOR gate shared by all three recording routes: the caller must be an
  // active member of the conversation. `chat.calls.record` (requirePermission,
  // in calls/index.js) is the role-level gate proving the caller's role is
  // allowed to record AT ALL; this is the per-call scoping check on top of
  // it. Deliberately NOT callService.assertCanManageCall (initiator or
  // channel.manage) — chat.calls.record was created specifically so
  // recording rights would not be coupled to call-moderation rights. Same
  // shape as call-links-service.js's assertMember.
  async function assertMember(conversationId, profileId) {
    const rows = await prisma.$queryRaw`
      SELECT m.id FROM chat_conversation_members m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND m.user_id = ${profileId}
        AND m.left_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new CallRecordingError("Conversación no encontrada.", 404);
  }

  // startedByUserId (persisted on the row, for the "started by" audit trail)
  // and profileId (the authorization actor checked against the call) are the
  // same identifier in every real call path today — c.get("userId") from
  // requirePermission's middleware, which is user_profile.id — but are kept
  // as distinct params: the DB column is about provenance, this param is
  // about the access-control decision, and they need not always coincide.
  async function startRecording({ callId, startedByUserId, profileId }) {
    const existing = await prisma.callRecording.findFirst({
      where: { callId, status: { in: ["STARTING", "ACTIVE"] } },
    });
    if (existing) throw new CallRecordingError("Ya hay una grabación en curso para esta llamada.", 409);

    if (!callService?.getLiveCallOrThrow) throw new CallRecordingError("No disponible.", 500);
    const call = await callService.getLiveCallOrThrow(callId);
    await assertMember(call.conversationId, profileId);

    const s3 = s3Config(env);
    const record = await prisma.callRecording.create({
      data: { callId, conversationId: call.conversationId, status: "STARTING", startedByUserId },
    });

    const output = new SegmentedFileOutput({
      protocol: SegmentedFileProtocol.HLS_PROTOCOL,
      filenamePrefix: objectPrefix(call.conversationId, record.id),
      playlistName: "index.m3u8",
      segmentDuration: 6,
      output: {
        case: "s3",
        value: new S3Upload({ ...s3, bucket: RECORDING_BUCKET, forcePathStyle: true }),
      },
    });

    let info;
    try {
      // "grid-dark" (rather than an omitted/empty layout) matters: LiveKit's
      // own default composite template auto-upgrades grid->speaker the
      // moment it sees a screen-share track (giving it the big tile + a
      // camera carousel), but only when the layout string it receives starts
      // with "grid" — an empty layout skips that upgrade entirely and every
      // track renders as an equal-size grid cell, screen-share included.
      info = await egressClient().startRoomCompositeEgress(
        call.livekitRoomName,
        { segments: output },
        { layout: "grid-dark" },
      );
    } catch (error) {
      console.warn(`${LOG_PREFIX} No se pudo iniciar el egress de grabación:`, record.id, error?.message ?? error);
      await prisma.callRecording
        .update({ where: { id: record.id }, data: { status: "FAILED", failureReason: error?.message ?? "No se pudo iniciar." } })
        .catch((updateError) => console.warn(`${LOG_PREFIX} No se pudo marcar el intento de grabación como FAILED:`, record.id, updateError?.message ?? updateError));
      throw new CallRecordingError("No se pudo iniciar la grabación.", 500);
    }

    await prisma.callRecording.update({
      where: { id: record.id },
      data: { egressId: info.egressId, status: "ACTIVE" },
    });
    // Report the pre-egress-confirmation state: the caller gets an immediate
    // "STARTING" acknowledgement, and the row settles to ACTIVE in the
    // background (findFirst in stopRecording/reconcile matches either).
    return { id: record.id, status: record.status };
  }

  async function stopRecording({ callId, profileId }) {
    const record = await prisma.callRecording.findFirst({
      where: { callId, status: { in: ["STARTING", "ACTIVE"] } },
    });
    if (!record) throw new CallRecordingError("No hay una grabación activa para esta llamada.", 404);

    // The recording row already carries its own conversationId (stamped at
    // startRecording time) — no need to re-resolve the call via
    // callService.getLiveCallOrThrow just to check membership, and doing so
    // would wrongly block a legitimate stop if the call itself just ended.
    await assertMember(record.conversationId, profileId);

    try {
      await egressClient().stopEgress(record.egressId);
    } catch (error) {
      console.warn(`${LOG_PREFIX} No se pudo detener el egress ahora; el sweep lo reintentará:`, record.id, error?.message ?? error);
    }

    const updated = await prisma.callRecording.update({
      where: { id: record.id },
      data: { status: "PROCESSING" },
    });
    return { id: updated.id, status: updated.status };
  }

  // A signed URL from Supabase Storage authorizes exactly the one object it
  // was created for. LiveKit's HLS output references each segment from the
  // .m3u8 by bare relative filename (standard HLS), so handing the client a
  // signed URL for the *playlist* alone doesn't help: hls.js/native HLS
  // resolves "segment_00000.ts" relative to that URL and drops the playlist's
  // own signing token in the process (confirmed against production — those
  // requests come back 400). The fix is to never hand the raw .m3u8 to the
  // client at all: read it here with admin storage access, sign every
  // segment it references individually, and rewrite each line to its own
  // absolute signed URL (valid HLS: an absolute URI line is used as-is, not
  // resolved against the manifest's own location).
  async function signManifestSegments(manifestText, dir) {
    const lines = manifestText.split("\n");
    const segmentNames = [...new Set(
      lines.map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
    )];
    if (!segmentNames.length) return manifestText;

    const { data: signedList, error } = await supabaseAdmin.storage
      .from(RECORDING_BUCKET)
      .createSignedUrls(segmentNames.map((name) => `${dir}/${name}`), SEGMENT_SIGN_TTL_SECONDS);
    if (error || !Array.isArray(signedList)) {
      throw new Error(error?.message || "No se pudieron firmar los segmentos de la grabación.");
    }
    const urlByName = new Map(signedList.map((item) => [item.path.slice(dir.length + 1), item.signedUrl]));
    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        return urlByName.get(trimmed) || line; // unresolved segment: leave as-is, player surfaces the resulting fetch failure
      })
      .join("\n");
  }

  async function listRecordings({ conversationId, profileId }) {
    await assertMember(conversationId, profileId);
    const rows = await prisma.callRecording.findMany({
      where: { conversationId },
      orderBy: { startedAt: "desc" },
      include: { startedBy: { select: { displayName: true } } },
    });
    const withSignedUrls = !supabaseAdmin
      ? rows
      : await Promise.all(rows.map(async (row) => {
        if (row.status !== "READY" || !row.playlistObjectKey) return row;
        try {
          const { data, error } = await supabaseAdmin.storage.from(RECORDING_BUCKET).download(row.playlistObjectKey);
          if (error || !data) {
            console.warn(`${LOG_PREFIX} No se pudo leer el manifest de reproducción:`, row.id, row.playlistObjectKey, error?.message ?? error);
            // playlistUrlError is computed live on every listRecordings call
            // (never persisted) so the UI can show the actual reason instead
            // of a bare "no disponible" — see ChatRecordingsGallery.jsx.
            return { ...row, playlistUrlError: error?.message || "No se pudo leer el manifest de reproducción." };
          }
          const dir = row.playlistObjectKey.split("/").slice(0, -1).join("/");
          const playlistManifest = await signManifestSegments(await data.text(), dir);
          return { ...row, playlistManifest };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error inesperado preparando la reproducción:`, row.id, row.playlistObjectKey, err?.message ?? err);
          return { ...row, playlistUrlError: err?.message || "No se pudo preparar la reproducción." };
        }
      }));

    // sizeBytes is a Prisma BigInt column — JSON.stringify (which Hono's
    // c.json() uses) throws on a raw BigInt, so serialize it before it can
    // leave this service.
    return withSignedUrls.map((row) => (
      row.sizeBytes != null ? { ...row, sizeBytes: Number(row.sizeBytes) } : row
    ));
  }

  function nsToMs(ns) {
    // ASSUMPTION: LiveKit's EgressInfo segmentResults[].duration is reported
    // in nanoseconds. This has not been independently verified in this repo
    // against a real LiveKit response — confirm during manual/E2E testing
    // before "fixing" the divisor in the other direction.
    if (ns == null) return null;
    return Math.round(Number(ns) / 1_000_000);
  }

  // Periodic sweep (called every 30s alongside guestService.sweepAbandonedGuests
  // — see apps/api/src/routes/calls/index.js, wired in a later task). Reconciles
  // STARTING/ACTIVE/PROCESSING rows against LiveKit's actual Egress state;
  // nothing here relies on a webhook. Spec §23 edge cases 1, 2, 4, 5.
  async function reconcileActiveRecordings() {
    const rows = await prisma.callRecording.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
    });
    if (!rows.length) return;

    const client = egressClient();

    for (const row of rows) {
      try {
        // Edge case 4: the call ended — force-stop an orphaned egress even if
        // LiveKit still reports it active.
        let callStillLive = true;
        if (callService?.getLiveCallOrThrow) {
          try { await callService.getLiveCallOrThrow(row.callId); }
          catch { callStillLive = false; }
        }
        // Edge case 2: hard duration cap.
        const overCap = now().getTime() - new Date(row.startedAt).getTime() > MAX_DURATION_MS;

        if ((!callStillLive || overCap) && row.status !== "PROCESSING" && row.egressId) {
          try {
            await client.stopEgress(row.egressId);
          } catch (error) {
            console.warn(`${LOG_PREFIX} No se pudo forzar el detenimiento del egress (se reintentará):`, row.id, error?.message ?? error);
          }
          try {
            await prisma.callRecording.update({ where: { id: row.id }, data: { status: "PROCESSING" } });
          } catch (error) {
            console.warn(`${LOG_PREFIX} No se pudo marcar la grabación como PROCESSING:`, row.id, error?.message ?? error);
          }
          continue;
        }

        if (!row.egressId) continue; // still starting, no egress to check yet

        // Query per-row by egressId rather than a single batched
        // `listEgress({ active: true })` call: LiveKit's `active: true` filter
        // structurally EXCLUDES terminal states (COMPLETE/FAILED/ABORTED),
        // which are exactly the states this sweep needs to see in order to
        // promote a row to READY or mark it FAILED. The row set here is
        // already small/bounded (only STARTING/ACTIVE/PROCESSING rows), so
        // one lookup per row is cheap.
        let infos;
        try {
          infos = await client.listEgress({ egressId: row.egressId });
        } catch (error) {
          console.warn(`${LOG_PREFIX} No se pudo consultar el estado del egress (se reintentará):`, row.id, error?.message ?? error);
          continue;
        }
        const info = (infos ?? [])[0];
        if (!info) continue; // LiveKit hasn't reported it in this poll yet

        if (info.status === 3 /* EGRESS_COMPLETE */) {
          const seg = info.segmentResults?.[0];
          const data = {
            status: "READY",
            playlistObjectKey: buildPlaylistObjectKey(row.conversationId, row.id),
            durationMs: nsToMs(seg?.duration),
            sizeBytes: seg?.size != null ? BigInt(seg.size) : null,
            endedAt: now(),
            expiresAt: new Date(now().getTime() + RETENTION_MS),
          };
          await prisma.callRecording.update({ where: { id: row.id }, data });
          if (onRecordingReady) {
            try { await onRecordingReady({ ...row, ...data }); }
            catch (error) { console.warn(`${LOG_PREFIX} onRecordingReady falló:`, row.id, error?.message ?? error); }
          }
        } else if (info.status === 4 /* EGRESS_FAILED */ || info.status === 5 /* EGRESS_ABORTED */) {
          await prisma.callRecording.update({
            where: { id: row.id },
            data: { status: "FAILED", failureReason: info.error || "La grabación no se pudo completar.", endedAt: now() },
          });
        } else if (row.status === "PROCESSING") {
          // We already asked LiveKit to stop this egress (force-stop branch,
          // a previous tick) but it's still STARTING/ACTIVE/ENDING — the
          // original stopEgress call may have failed silently. Retry it
          // (idempotent on LiveKit's side) instead of leaving this row stuck
          // in PROCESSING forever with no automatic remediation.
          try {
            await client.stopEgress(row.egressId);
          } catch (error) {
            console.warn(`${LOG_PREFIX} Reintento de detener un egress atascado en PROCESSING falló:`, row.id, error?.message ?? error);
          }
        }
        // EGRESS_STARTING/ACTIVE/ENDING while not yet PROCESSING: nothing to
        // do yet, check again next tick.
      } catch (error) {
        // One row's unexpected failure must not abort the rest of the sweep.
        console.error(`${LOG_PREFIX} Error reconciliando una grabación:`, row.id, error?.stack ?? error);
      }
    }
  }

  // Lists every object under `prefix`, paginating past Supabase Storage's
  // per-call page cap (100 by default) — a long recording can have well over
  // a thousand HLS segments. Throws on a real listing failure; the caller
  // decides what "we couldn't confirm what's in storage" should do.
  async function listAllStorageObjects(prefix) {
    const all = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin.storage
        .from(RECORDING_BUCKET)
        .list(prefix, { limit: STORAGE_LIST_PAGE_SIZE, offset });
      if (error) throw new Error(error.message || "No se pudo listar el almacenamiento.");
      const page = data ?? [];
      all.push(...page);
      if (page.length < STORAGE_LIST_PAGE_SIZE) break;
      offset += STORAGE_LIST_PAGE_SIZE;
    }
    return all;
  }

  // Same access level as delete (conversation member, chat.calls.record at
  // the route level) — renaming is a much lower-stakes action, so no reason
  // to require anything stricter. Empty/whitespace-only title clears it back
  // to null, which the UI then renders as the auto-generated date/time label
  // (ChatRecordingsGallery.jsx) instead of an empty string.
  const MAX_TITLE_LENGTH = 120;
  async function renameRecording({ recordingId, profileId, title }) {
    const rec = await prisma.callRecording.findUnique({ where: { id: recordingId } });
    if (!rec) throw new CallRecordingError("Grabación no encontrada.", 404);
    await assertMember(rec.conversationId, profileId);
    const trimmed = String(title ?? "").trim();
    if (trimmed.length > MAX_TITLE_LENGTH) {
      throw new CallRecordingError(`El nombre no puede superar ${MAX_TITLE_LENGTH} caracteres.`, 400);
    }
    const updated = await prisma.callRecording.update({
      where: { id: recordingId },
      data: { title: trimmed || null },
    });
    return { id: updated.id, title: updated.title };
  }

  // Manual delete (conversation member, any terminal status) — distinct from
  // cleanupExpiredRecordings' automatic 90-day sweep, which only ever
  // touches READY rows past their own expiresAt. FAILED rows (a bad egress
  // attempt, no video ever produced) never expire on their own otherwise,
  // so without this they'd sit in the UI forever with no way to clear them.
  async function deleteRecording({ recordingId, profileId }) {
    const rec = await prisma.callRecording.findUnique({ where: { id: recordingId } });
    if (!rec) throw new CallRecordingError("Grabación no encontrada.", 404);
    await assertMember(rec.conversationId, profileId);
    if (ACTIVE_STATUSES.includes(rec.status)) {
      throw new CallRecordingError("Detén la grabación antes de eliminarla.", 409);
    }

    if (rec.playlistObjectKey && supabaseAdmin) {
      const prefix = rec.playlistObjectKey.split("/").slice(0, -1).join("/");
      let files;
      try {
        files = await listAllStorageObjects(prefix);
      } catch {
        throw new CallRecordingError("No se pudo borrar el archivo de la grabación.", 500);
      }
      const keys = files.length ? files.map((f) => `${prefix}/${f.name}`) : [rec.playlistObjectKey];
      const { error: removeError } = await supabaseAdmin.storage.from(RECORDING_BUCKET).remove(keys);
      if (removeError) {
        throw new CallRecordingError("No se pudo borrar el archivo de la grabación.", 500);
      }
    }

    await prisma.callRecording.delete({ where: { id: recordingId } });
  }

  // Spec §5 goal 4 / §23 edge case: delete storage objects + rows past retention.
  async function cleanupExpiredRecordings() {
    const expired = await prisma.callRecording.findMany({
      where: { status: "READY", expiresAt: { lt: now() } },
    });
    let cleaned = 0;
    for (const rec of expired) {
      try {
        if (rec.playlistObjectKey && supabaseAdmin) {
          const prefix = rec.playlistObjectKey.split("/").slice(0, -1).join("/");
          let files;
          try {
            files = await listAllStorageObjects(prefix);
          } catch (error) {
            // A listing failure must NOT fall through to deleting just the
            // single known playlist key and calling it done — that would
            // silently orphan every other segment file. Skip this record
            // entirely this run; the DB row (and its storage) is retried on
            // the next sweep.
            console.warn(`${LOG_PREFIX} No se pudo listar los objetos de una grabación expirada; se reintentará:`, rec.id, error?.message ?? error);
            continue;
          }
          const keys = files.length
            ? files.map((f) => `${prefix}/${f.name}`)
            : [rec.playlistObjectKey]; // genuinely empty listing (not a failure) — fall back to the one key we know about from the DB row
          const { error: removeError } = await supabaseAdmin.storage.from(RECORDING_BUCKET).remove(keys);
          if (removeError) {
            console.warn(`${LOG_PREFIX} No se pudo borrar los objetos de una grabación expirada; se reintentará:`, rec.id, removeError.message ?? removeError);
            continue;
          }
        }
        await prisma.callRecording.delete({ where: { id: rec.id } });
        cleaned += 1;
      } catch (error) {
        console.warn(`${LOG_PREFIX} No se pudo limpiar una grabación expirada; se reintentará:`, rec.id, error?.message ?? error);
      }
    }
    return cleaned;
  }

  return { startRecording, stopRecording, listRecordings, renameRecording, deleteRecording, reconcileActiveRecordings, cleanupExpiredRecordings };
}
