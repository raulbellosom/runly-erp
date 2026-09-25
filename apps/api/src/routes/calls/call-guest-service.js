import crypto from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { readLiveKitConfig } from "./call-service.js";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8;
const MAX_GUESTS_PER_CALL = 20;
const GUEST_TOKEN_TTL = "15m";
const ABANDON_MS = 2 * 60 * 1000;
const LIVE = ["RINGING", "ACTIVE"];
// Same allow-list and cap as the other unauthenticated-guest attachment path
// (apps/api/src/routes/chat/index.js's /public/chat/session/:token/attachments/presign)
// — see docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md §12.
const GUEST_ATTACHMENT_ALLOWED_MIME = [
  /^image\//, /^application\/pdf$/, /^text\/plain$/,
  /^application\/msword$/, /^application\/vnd\.openxmlformats/,
];
const GUEST_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export class CallGuestError extends Error {
  constructor(message, status = 400, reason = null) {
    super(message);
    this.name = "CallGuestError";
    this.status = status;
    this.reason = reason;
  }
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function createCallGuestService({
  prisma,
  supabaseAdmin = null,
  env = process.env,
  AccessTokenImpl = AccessToken,
  RoomServiceClientImpl = RoomServiceClient,
  linksService,
  callService = null,
  broadcaster = null,
  notificationService = null,
  now = () => new Date(),
}) {
  const brandingCache = new Map(); // conversationId -> { at, data }

  async function loadBranding(conversationId) {
    if (!conversationId) return null;
    const cached = brandingCache.get(conversationId);
    if (cached && now().getTime() - cached.at < 5 * 60 * 1000) return cached.data;
    let data = null;
    try {
      const rows = await prisma.$queryRaw`
        SELECT co.name, co.website, co.city, co.state, co.contact_email AS "contactEmail",
               co.phone, bc.logo_file_id AS "logoFileId", bc.primary_color AS "primaryColor"
        FROM chat_conversations cc
        JOIN company co ON co.id = cc.company_id
        LEFT JOIN branding_config bc ON bc.company_id = co.id
        WHERE cc.id = ${conversationId}
        LIMIT 1
      `;
      const row = rows[0];
      if (row) {
        let logoUrl = null;
        if (row.logoFileId && supabaseAdmin) {
          try {
            const fa = await prisma.fileAsset.findUnique({ where: { id: row.logoFileId } });
            if (fa) {
              const { data: signed } = await supabaseAdmin.storage
                .from(fa.bucket)
                .createSignedUrl(fa.objectKey, 3600);
              logoUrl = signed?.signedUrl ?? null;
            }
          } catch { /* ignore */ }
        }
        data = {
          companyName: row.name ?? null,
          website: row.website ?? null,
          location: [row.city, row.state].filter(Boolean).join(", ") || null,
          email: row.contactEmail ?? null,
          phone: row.phone ?? null,
          logoUrl,
          primaryColor: row.primaryColor ?? null,
        };
      }
    } catch { /* branding is best-effort */ }
    brandingCache.set(conversationId, { at: now().getTime(), data });
    return data;
  }

  function config() {
    return readLiveKitConfig(env);
  }
  function assertEnabled() {
    const c = config();
    if (!c.enabled) throw new CallGuestError("Las llamadas no están configuradas.", 501);
    return c;
  }

  async function liveCallForConversation(conversationId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", kind, status,
             livekit_room_name AS "livekitRoomName", initiated_by_user_id AS "initiatedByUserId"
      FROM "call"
      WHERE conversation_id = ${conversationId} AND status IN ('RINGING','ACTIVE')
      ORDER BY created_at DESC LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async function liveCallById(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", kind, status,
             livekit_room_name AS "livekitRoomName", initiated_by_user_id AS "initiatedByUserId"
      FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async function resolveGuest(guestToken) {
    if (!guestToken) throw new CallGuestError("Sesión de invitado no válida.", 401);
    const guest = await prisma.callGuest.findFirst({ where: { sessionTokenHash: hashToken(guestToken) } });
    if (!guest) throw new CallGuestError("Sesión de invitado no válida o expirada.", 401);
    return guest;
  }

  async function recordAttempt(ip, linkId, outcome) {
    try {
      await prisma.callGuestJoinAttempt.create({ data: { ip: ip ?? "unknown", linkId: linkId ?? null, outcome } });
    } catch { /* non-fatal */ }
  }

  async function notifyMembers(call, event, payload) {
    try {
      const parts = await prisma.callParticipant.findMany({
        where: { callId: call.id, status: { in: ["RINGING", "JOINED"] } },
        select: { userId: true },
      });
      const ids = [...new Set(parts.map((p) => p.userId).filter(Boolean))];
      if (ids.length) await broadcaster?.broadcastToUsers?.(ids, event, payload);
    } catch { /* non-fatal */ }
  }

  async function joinAsGuest({ token = null, code = null, inviteToken = null, displayName, email = null, ip = null, userAgent = null }) {
    assertEnabled();
    const name = String(displayName ?? "").trim();
    if (name.length < 2 || name.length > 40) throw new CallGuestError("El nombre debe tener entre 2 y 40 caracteres.", 422);

    const recent = await prisma.callGuestJoinAttempt.count({
      where: {
        ip: ip ?? "unknown",
        createdAt: { gte: new Date(now().getTime() - RATE_WINDOW_MS) },
        // "no_live_call" is the guest lobby auto-polling every few seconds
        // while it waits for the host to start the meeting — expected
        // traffic, not an abuse signal, so it must not count against the
        // join rate limit (it used to lock waiting guests out after ~30s).
        outcome: { not: "no_live_call" },
      },
    });
    if (recent >= RATE_MAX) {
      await recordAttempt(ip, null, "rate_limited");
      throw new CallGuestError("Demasiados intentos. Espera unos minutos.", 429, "rate_limited");
    }

    let link;
    try {
      link = await linksService.resolveLinkForJoin({ token, code });
    } catch (error) {
      await recordAttempt(ip, null, error.reason ?? "bad_token");
      throw new CallGuestError(error.message, error.status ?? 400, error.reason ?? "bad_token");
    }

    let invite = null;
    if (inviteToken) {
      invite = await linksService.resolveInvite({ inviteToken, linkId: link.id });
      if (invite?.acceptedAt) {
        const activePrev = await prisma.callGuest.findFirst({
          where: { inviteId: invite.id, status: { in: ["LOBBY", "ADMITTED"] } },
        });
        if (activePrev) throw new CallGuestError("Esta invitación ya está en uso.", 409, "invite_in_use");
      }
      if (invite?.email && !email) email = invite.email;
    }

    const branding = await loadBranding(link.conversationId);
    const call = await liveCallForConversation(link.conversationId);
    if (!call) {
      await recordAttempt(ip, link.id, "no_live_call");
      return { status: "waiting", branding };
    }

    const activeGuests = await prisma.callGuest.count({
      where: { callId: call.id, status: { in: ["LOBBY", "ADMITTED"] } },
    });
    if (activeGuests >= MAX_GUESTS_PER_CALL) {
      await recordAttempt(ip, link.id, "call_full");
      throw new CallGuestError("La llamada alcanzó el máximo de invitados.", 409, "call_full");
    }

    // A guest already denied or kicked from THIS call must go back through
    // host approval even on an "open access" link — otherwise a denied/kicked
    // guest can just resubmit the join form and moderation is a no-op.
    const priorRejection = await prisma.callGuest.findFirst({
      where: {
        callId: call.id,
        linkId: link.id,
        status: { in: ["DENIED", "KICKED"] },
        OR: [...(email ? [{ email }] : []), { joinIp: ip ?? "unknown" }],
      },
      select: { id: true },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const status = (link.requireLobby || priorRejection) ? "LOBBY" : "ADMITTED";
    const guest = await prisma.callGuest.create({
      data: {
        callId: call.id,
        linkId: link.id,
        inviteId: invite?.id ?? null,
        displayName: name,
        email: email ?? null,
        sessionTokenHash: hashToken(rawToken),
        livekitIdentity: `guest_${crypto.randomUUID()}`,
        status,
        admittedByUserId: null,
        admittedAt: status === "ADMITTED" ? now() : null,
        joinIp: ip ?? null,
        userAgent: userAgent ?? null,
        lastSeenAt: now(),
      },
    });

    await prisma.callLink.update({ where: { id: link.id }, data: { useCount: { increment: 1 } } }).catch(() => {});
    if (invite && !invite.acceptedAt) {
      await prisma.callInvite.update({ where: { id: invite.id }, data: { acceptedAt: now() } }).catch(() => {});
    }
    await recordAttempt(ip, link.id, "ok");

    await notifyMembers(call, status === "LOBBY" ? "chat.call.guest_waiting" : "chat.call.guest_joined", {
      callId: call.id, guestId: guest.id, name,
    });
    if (notificationService?.publish && status === "LOBBY") {
      setImmediate(async () => {
        try {
          // The conversation's own company, not re-derived from the
          // initiator's memberships — see call-links-service.js's
          // sendInvites for why.
          const [conversationRow] = await prisma.$queryRaw`
            SELECT company_id AS "companyId" FROM chat_conversations WHERE id = ${call.conversationId} LIMIT 1
          `;
          const companyId = conversationRow?.companyId ?? null;
          if (!companyId) return;
          await notificationService.publish({
            companyId,
            input: {
              eventType: "chat.call.guest_waiting",
              title: "Invitado esperando en la llamada",
              body: `${name} quiere unirse.`,
              link: `/app/m/runly.chat/chat/inbox/${call.conversationId}`,
              recipients: { userIds: [call.initiatedByUserId] },
              channels: ["in_app"],
              priority: "high",
              sourceType: "call",
              sourceId: call.id,
              dedupeKey: `chat.call.guest_waiting:${guest.id}`,
            },
          });
        } catch { /* non-fatal */ }
      });
    }

    return {
      guestToken: rawToken,
      guestId: guest.id,
      status,
      callId: call.id,
      requiresLobby: link.requireLobby,
      branding,
    };
  }

  async function getGuestState({ guestToken }) {
    assertEnabled();
    const guest = await resolveGuest(guestToken);
    await prisma.callGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now() } }).catch(() => {});
    const call = await liveCallById(guest.callId);
    const live = call && LIVE.includes(call.status);
    const branding = await loadBranding(call?.conversationId ?? null);

    let roster = [];
    let messages = [];
    if (live && guest.status === "ADMITTED") {
      const guests = await prisma.callGuest.findMany({
        where: { callId: guest.callId, status: { in: ["ADMITTED"] } },
        select: { id: true, displayName: true },
      });
      roster = guests.map((g) => ({ name: g.displayName, isYou: g.id === guest.id }));
      // Full history of the call's real conversation (not call-scoped) — see
      // docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.2.
      messages = await prisma.$queryRaw`
        SELECT
          m.id,
          m.sender_type AS "senderKind",
          COALESCE(up.display_name, cg.display_name) AS "senderName",
          m.body,
          m.created_at AS "createdAt",
          (
            SELECT json_agg(json_build_object(
              'id', a.id, 'fileName', a.file_name, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes
            ))
            FROM chat_attachments a WHERE a.message_id = m.id
          ) AS attachments
        FROM chat_messages m
        LEFT JOIN user_profile up ON up.id = m.sender_user_id
        LEFT JOIN call_guest cg ON cg.id = m.sender_call_guest_id
        WHERE m.conversation_id = ${call.conversationId} AND m.deleted_at IS NULL
        ORDER BY m.created_at ASC
        LIMIT 200
      `;
    }

    // Shared with call-service.js's getCall/getCurrentCall — one definition
    // of "is this call being recorded" so the member and guest banners can't
    // silently drift apart.
    const recordingActive = call && callService?.getRecordingActiveStatus
      ? await callService.getRecordingActiveStatus(call.id)
      : false;

    return {
      status: guest.status,
      callEnded: Boolean(call) && !live,
      call: call ? { id: call.id, kind: call.kind } : null,
      livekitUrl: config().publicUrl,
      guests: roster,
      messages,
      branding,
      recording: { active: recordingActive },
    };
  }

  async function getGuestLiveKitToken({ guestToken }) {
    const c = assertEnabled();
    const guest = await resolveGuest(guestToken);
    if (guest.status !== "ADMITTED") throw new CallGuestError("Aún no te han admitido.", 403, guest.status);
    const call = await liveCallById(guest.callId);
    if (!call || !LIVE.includes(call.status)) throw new CallGuestError("La llamada no está activa.", 409, "not_live");

    const at = new AccessTokenImpl(c.apiKey, c.apiSecret, {
      identity: guest.livekitIdentity,
      name: guest.displayName,
      metadata: JSON.stringify({ guest: true }),
      ttl: GUEST_TOKEN_TTL,
    });
    at.addGrant({ room: call.livekitRoomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    await prisma.callGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now() } }).catch(() => {});
    return { livekitUrl: c.publicUrl, token: await at.toJwt() };
  }

  async function heartbeatGuest({ guestToken }) {
    const guest = await resolveGuest(guestToken);
    await prisma.callGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now() } });
    return { ok: true };
  }

  async function leaveGuest({ guestToken }) {
    const guest = await resolveGuest(guestToken);
    await prisma.callGuest.update({ where: { id: guest.id }, data: { status: "LEFT", leftAt: now() } });
    // Only a lobby departure needs to notify the host — it's the only case
    // that affects their "N esperando" pending-guest count.
    if (guest.status === "LOBBY") {
      const call = await liveCallById(guest.callId);
      if (call) await notifyMembers(call, "chat.call.guest_left", { callId: call.id, guestId: guest.id, name: guest.displayName });
    }
    return { ok: true };
  }

  async function resolveAdmittedGuestForMessage({ guestToken }) {
    const guest = await resolveGuest(guestToken);
    if (guest.status !== "ADMITTED") throw new CallGuestError("Aún no te han admitido.", 403);
    const call = await liveCallById(guest.callId);
    if (!call || !LIVE.includes(call.status)) throw new CallGuestError("La llamada no está activa.", 409);
    return { guestId: guest.id, callId: guest.callId, displayName: guest.displayName };
  }

  // Presigns an upload straight into the call's real conversation, the same
  // way a call guest's chat messages already land there (postGuestMessage) —
  // see docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md.
  async function presignGuestAttachmentUpload({ guestToken, fileName, mimeType, sizeBytes }) {
    if (!supabaseAdmin) throw new CallGuestError("No disponible.", 500);
    const { callId } = await resolveAdmittedGuestForMessage({ guestToken });
    const call = await liveCallById(callId);
    if (!call) throw new CallGuestError("La llamada no está activa.", 409);

    if (!GUEST_ATTACHMENT_ALLOWED_MIME.some((re) => re.test(mimeType))) {
      throw new CallGuestError("Tipo de archivo no permitido.", 422);
    }
    if (sizeBytes > GUEST_ATTACHMENT_MAX_BYTES) {
      throw new CallGuestError("Archivo demasiado grande (máx. 20 MB).", 422);
    }

    const conversationId = call.conversationId;
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
    const objectKey = `conversations/${conversationId}/guest/${crypto.randomUUID()}.${ext}`;

    const { data, error } = await supabaseAdmin.storage
      .from("runly-chat")
      .createSignedUploadUrl(objectKey, { expiresIn: 300 });
    if (error) throw new CallGuestError("Error generando URL de subida.", 500);

    const attRows = await prisma.$queryRaw`
      INSERT INTO chat_attachments (conversation_id, bucket, object_key, file_name, mime_type, size_bytes)
      VALUES (${conversationId}, 'runly-chat', ${objectKey}, ${fileName}, ${mimeType}, ${sizeBytes})
      RETURNING id
    `;

    return { attachmentId: attRows[0].id, uploadUrl: data.signedUrl };
  }

  // Short-lived signed URL for an attachment the guest can see — scoped to
  // the conversation of the call they were admitted to.
  async function getGuestAttachmentUrl({ guestToken, attachmentId }) {
    if (!supabaseAdmin) throw new CallGuestError("No disponible.", 500);
    const { callId } = await resolveAdmittedGuestForMessage({ guestToken });
    const call = await liveCallById(callId);
    if (!call) throw new CallGuestError("La llamada no está activa.", 409);

    const rows = await prisma.$queryRaw`
      SELECT bucket, object_key FROM chat_attachments
      WHERE id = ${attachmentId}::uuid AND conversation_id = ${call.conversationId}::uuid
      LIMIT 1
    `;
    if (!rows.length) throw new CallGuestError("Adjunto no encontrado.", 404);

    const { bucket, object_key: objectKey } = rows[0];
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectKey, 300);
    if (error || !data?.signedUrl) throw new CallGuestError("Error generando URL del adjunto.", 500);
    return { url: data.signedUrl, expiresIn: 300 };
  }

  // ---- host moderation -------------------------------------------------------

  async function assertManage({ profileId, callId, action }) {
    const call = await liveCallById(callId);
    if (!call) throw new CallGuestError("Llamada no encontrada.", 404);
    if (!callService?.assertCanManageCall) throw new CallGuestError("No disponible.", 500);
    await callService.assertCanManageCall({
      conversationId: call.conversationId,
      initiatedByUserId: call.initiatedByUserId,
      profileId,
      action,
    });
    return call;
  }

  async function listCallGuests({ profileId, callId }) {
    await assertManage({ profileId, callId, action: "ver los invitados" });
    const guests = await prisma.callGuest.findMany({
      where: { callId, status: { in: ["LOBBY", "ADMITTED", "KICKED", "DENIED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, email: true, status: true, admittedAt: true, createdAt: true },
    });
    return { guests };
  }

  // Retries once — a transient LiveKit blip shouldn't leave a "kicked" guest
  // still holding a live media session. Returns whether the room actually
  // dropped the participant, so callers can tell the host the truth instead
  // of reporting success unconditionally.
  async function removeParticipantWithRetry(roomName, identity, attempts = 2) {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const rc = new RoomServiceClientImpl(config().internalUrl, config().apiKey, config().apiSecret);
        await rc.removeParticipant(roomName, identity);
        return true;
      } catch {
        if (i === attempts - 1) return false;
      }
    }
    return false;
  }

  async function setGuestStatus({ profileId, callId, guestId, status, action, event }) {
    const call = await assertManage({ profileId, callId, action });
    const guest = await prisma.callGuest.findFirst({ where: { id: guestId, callId } });
    if (!guest) throw new CallGuestError("Invitado no encontrado.", 404);
    const data = { status };
    if (status === "ADMITTED") { data.admittedByUserId = profileId; data.admittedAt = now(); }
    if (status === "LEFT" || status === "KICKED" || status === "DENIED") data.leftAt = now();
    await prisma.callGuest.update({ where: { id: guest.id }, data });
    let liveActionOk = true;
    if (status === "KICKED") {
      liveActionOk = await removeParticipantWithRetry(call.livekitRoomName, guest.livekitIdentity);
    }
    await notifyMembers(call, event, { callId, guestId, name: guest.displayName });
    return { ok: true, status, ...(status === "KICKED" ? { liveActionOk } : {}) };
  }

  const admitGuest = (a) => setGuestStatus({ ...a, status: "ADMITTED", action: "admitir invitados", event: "chat.call.guest_admitted" });
  const denyGuest = (a) => setGuestStatus({ ...a, status: "DENIED", action: "rechazar invitados", event: "chat.call.guest_denied" });
  const kickGuest = (a) => setGuestStatus({ ...a, status: "KICKED", action: "expulsar invitados", event: "chat.call.guest_kicked" });

  async function muteGuest({ profileId, callId, guestId, muted }) {
    const call = await assertManage({ profileId, callId, action: "silenciar invitados" });
    const guest = await prisma.callGuest.findFirst({ where: { id: guestId, callId } });
    if (!guest) throw new CallGuestError("Invitado no encontrado.", 404);
    let liveActionOk = false;
    for (let attempt = 0; attempt < 2 && !liveActionOk; attempt += 1) {
      try {
        const rc = new RoomServiceClientImpl(config().internalUrl, config().apiKey, config().apiSecret);
        const parts = await rc.listParticipants(call.livekitRoomName);
        const p = parts.find((x) => x.identity === guest.livekitIdentity);
        const audio = p?.tracks?.find((t) => t.type === 1 /* AUDIO */ || t.source === 2);
        if (!audio) { liveActionOk = true; break; } // nothing published yet — nothing to mute, not a failure
        await rc.mutePublishedTrack(call.livekitRoomName, guest.livekitIdentity, audio.sid, muted);
        liveActionOk = true;
      } catch { /* retry once, then report failure below */ }
    }
    return { ok: true, muted, liveActionOk };
  }

  async function kickGuestsForLink({ linkId }) {
    const guests = await prisma.callGuest.findMany({
      where: { linkId, status: { in: ["LOBBY", "ADMITTED"] } },
      select: { id: true, callId: true, livekitIdentity: true },
    });
    for (const g of guests) {
      await prisma.callGuest.update({ where: { id: g.id }, data: { status: "KICKED", leftAt: now() } }).catch(() => {});
      const call = await liveCallById(g.callId);
      if (call && LIVE.includes(call.status)) {
        try {
          const rc = new RoomServiceClientImpl(config().internalUrl, config().apiKey, config().apiSecret);
          await rc.removeParticipant(call.livekitRoomName, g.livekitIdentity);
        } catch { /* best effort */ }
      }
    }
    return { kicked: guests.length };
  }

  async function sweepAbandonedGuests() {
    const cutoff = new Date(now().getTime() - ABANDON_MS);
    // A per-row update (instead of updateMany) so each abandoned guest can be
    // broadcast individually — otherwise the host's "N esperando" badge
    // never decrements for a guest who silently times out.
    const abandoned = await prisma.callGuest.findMany({
      where: { status: "LOBBY", lastSeenAt: { lt: cutoff } },
      select: { id: true, callId: true, displayName: true },
    });
    for (const g of abandoned) {
      await prisma.callGuest.update({ where: { id: g.id }, data: { status: "DENIED", leftAt: now() } }).catch(() => {});
      const call = await liveCallById(g.callId);
      if (call) await notifyMembers(call, "chat.call.guest_left", { callId: call.id, guestId: g.id, name: g.displayName });
    }
    return abandoned.length;
  }

  return {
    joinAsGuest,
    getGuestState,
    getGuestLiveKitToken,
    heartbeatGuest,
    leaveGuest,
    resolveAdmittedGuestForMessage,
    presignGuestAttachmentUpload,
    getGuestAttachmentUrl,
    listCallGuests,
    admitGuest,
    denyGuest,
    kickGuest,
    muteGuest,
    kickGuestsForLink,
    sweepAbandonedGuests,
  };
}
