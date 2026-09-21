import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { buildCallSystemMessage } from "./call-system-messages.js";
import { createCallScreenShareService } from './call-screen-share-service.js';

const LIVE_CALL_STATUSES = ["RINGING", "ACTIVE"];
const RING_TIMEOUT_MS = 36_000;

function isLiveCallConflict(error) {
  return error?.code === "P2002"
    || error?.meta?.code === "23505"
    || String(error?.message ?? "").includes("call_one_live_per_conversation_idx");
}

export class CallServiceError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = "CallServiceError";
    this.status = status;
    this.details = details;
  }
}

export function readLiveKitConfig(env = process.env) {
  const requestedMode = String(env.LIVEKIT_MODE ?? "embedded").trim().toLowerCase();
  const mode = ["embedded", "external", "disabled"].includes(requestedMode)
    ? requestedMode
    : "disabled";
  const publicUrl = String(env.LIVEKIT_URL ?? "").trim();
  const internalUrl = String(env.LIVEKIT_INTERNAL_URL ?? publicUrl).trim();
  const apiKey = String(env.LIVEKIT_API_KEY ?? "").trim();
  const apiSecret = String(env.LIVEKIT_API_SECRET ?? "").trim();
  const enabled = mode !== "disabled" && Boolean(publicUrl && internalUrl && apiKey && apiSecret);

  return { mode, enabled, publicUrl, internalUrl, apiKey, apiSecret };
}

export function createCallService({
  prisma,
  env = process.env,
  AccessTokenImpl = AccessToken,
  RoomServiceClientImpl = RoomServiceClient,
  notificationService = null,
  broadcaster = null,
  deliveryWorker = null,
  now = () => new Date(),
}) {
  function getConfig() {
    return readLiveKitConfig(env);
  }

  function assertEnabled() {
    const config = getConfig();
    if (!config.enabled) {
      throw new CallServiceError("Las llamadas no estan configuradas en esta instancia.", 501);
    }
    return config;
  }

  async function resolveProfile(authUserId) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId, enabled: true },
      select: { id: true, displayName: true, avatarFileId: true },
    });
    if (!profile) throw new CallServiceError("Perfil de usuario no encontrado.", 404);
    return profile;
  }

  async function listConversationMembers(conversationId) {
    return prisma.$queryRaw`
      SELECT m.user_id AS "userId", up.display_name AS "displayName"
      FROM chat_conversation_members m
      JOIN user_profile up ON up.id = m.user_id
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId}
        AND m.user_id IS NOT NULL
        AND m.left_at IS NULL
        AND public.runly_chat_user_access(m.conversation_id, m.user_id)
        AND c.deleted_at IS NULL
    `;
  }

  async function postSystemMessage(conversationId, { body, metadata }) {
    try {
      const rows = await prisma.$queryRaw`
        INSERT INTO chat_messages (conversation_id, sender_type, body, message_type, metadata)
        VALUES (${conversationId}, 'system', ${body}, 'system', ${JSON.stringify(metadata)}::jsonb)
        RETURNING id, created_at
      `;
      const messageId = rows?.[0]?.id ?? null;
      const createdAt = rows?.[0]?.created_at ?? now();
      if (!messageId) return;
      await prisma.$executeRaw`
        UPDATE chat_conversations
        SET last_message_id = ${messageId}, last_message_at = ${createdAt}, updated_at = NOW()
        WHERE id = ${conversationId}
      `;
      const members = await listConversationMembers(conversationId);
      const memberIds = members.map((member) => member.userId).filter(Boolean);
      if (memberIds.length) {
        await broadcaster?.broadcastToUsers?.(memberIds, "chat.message.new", {
          conversationId,
          messageId,
          senderId: null,
          senderName: null,
          threadRootId: null,
          replyToMessageId: null,
        });
      }
    } catch (error) {
      console.warn(
        "[atlas.calls] No se pudo publicar el mensaje de sistema:",
        error?.message ?? error,
      );
    }
  }

  async function postCallSystemMessage(call, spec) {
    const { body, metadata } = buildCallSystemMessage(spec);
    await postSystemMessage(call.conversationId, { body, metadata: { call: { ...metadata.call, callId: call.id } } });
  }

  async function assertMembership(conversationId, userProfileId) {
    const rows = await prisma.$queryRaw`
      SELECT m.id
      FROM chat_conversation_members m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId}
        AND m.user_id = ${userProfileId}
        AND m.left_at IS NULL
        AND public.runly_chat_user_access(m.conversation_id, m.user_id)
        AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new CallServiceError("Conversacion no encontrada.", 404);
  }

  async function assertCalendarLink(calendarEventId, conversationId) {
    if (!calendarEventId) return;
    const event = await prisma.calendarEvent.findFirst({
      where: {
        id: calendarEventId,
        enabled: true,
        sourceModule: "runly.chat",
        sourceEntityId: conversationId,
      },
      select: { id: true },
    });
    if (!event) {
      throw new CallServiceError("La reunion no esta vinculada a esta conversacion.", 422);
    }
  }

  async function getCallRecord(callId) {
    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: {
        initiator: { select: { id: true, displayName: true } },
        calendarEvent: { select: { id: true, title: true } },
        participants: {
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { id: true, displayName: true, avatarFileId: true } },
          },
        },
      },
    });
    if (!call) throw new CallServiceError("Llamada no encontrada.", 404);
    return call;
  }

  async function assertCallAccess(call, profileId) {
    await assertMembership(call.conversationId, profileId);
    const participant = call.participants.find((entry) => entry.userId === profileId);
    if (!participant) throw new CallServiceError("No formas parte de esta llamada.", 403);
    return participant;
  }

  // Shared "may this user manage the call?" gate: the initiator, or a member
  // holding `channel.manage` (or a system role) on the conversation. Reused by
  // the guest-link and guest-moderation services.
  async function assertCanManageCall({ conversationId, initiatedByUserId, profileId, action = "gestionar esta llamada" }) {
    if (profileId && profileId === initiatedByUserId) return;
    const roleRows = await prisma.$queryRaw`
      SELECT r.is_system AS "isSystem", r.permissions
      FROM chat_conversation_members m
      JOIN chat_channel_roles r ON r.id = m.role_id
      WHERE m.conversation_id = ${conversationId}
        AND m.user_id = ${profileId}
        AND m.left_at IS NULL
        AND public.runly_chat_user_access(m.conversation_id, m.user_id)
      LIMIT 1
    `;
    const role = roleRows[0];
    if (!role?.isSystem && role?.permissions?.["channel.manage"] !== true) {
      throw new CallServiceError(`No tienes permiso para ${action}.`, 403);
    }
  }

  async function createToken(config, call, profile) {
    const token = new AccessTokenImpl(config.apiKey, config.apiSecret, {
      identity: profile.id,
      name: profile.displayName,
      metadata: JSON.stringify({ callId: call.id }),
      ttl: "1m",
    });
    token.addGrant({
      room: call.livekitRoomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return token.toJwt();
  }

  async function closeLiveKitRoom(call) {
    const config = getConfig();
    if (!config.enabled) return;
    try {
      const client = new RoomServiceClientImpl(
        config.internalUrl,
        config.apiKey,
        config.apiSecret,
      );
      await client.deleteRoom(call.livekitRoomName);
    } catch (error) {
      console.warn("[atlas.calls] No se pudo cerrar la sala LiveKit:", error?.message ?? error);
    }
  }

  async function expireStaleCalls() {
    const cutoff = new Date(now().getTime() - RING_TIMEOUT_MS);
    const stale = await prisma.call.findMany({
      where: { status: "RINGING", createdAt: { lte: cutoff } },
      select: { id: true, livekitRoomName: true, conversationId: true, kind: true, startedAt: true },
    });
    if (!stale.length) return 0;
    const ids = stale.map((call) => call.id);
    await prisma.$transaction([
      prisma.callParticipant.updateMany({
        where: { callId: { in: ids }, status: "RINGING" },
        data: { status: "MISSED", leftAt: now() },
      }),
      prisma.callParticipant.updateMany({
        where: { callId: { in: ids }, status: "JOINED" },
        data: { status: "LEFT", leftAt: now() },
      }),
      prisma.call.updateMany({
        where: { id: { in: ids }, status: "RINGING" },
        data: { status: "ENDED", endedAt: now(), endReason: "missed" },
      }),
    ]);
    await Promise.all(stale.map(closeLiveKitRoom));
    await Promise.all(stale.map((call) =>
      postCallSystemMessage(call, { event: "ended", kind: call.kind, endReason: "missed" }),
    ));
    return stale.length;
  }

  async function getConfigStatus() {
    const config = getConfig();
    return { enabled: config.enabled, mode: config.mode };
  }

  function queueBusyCallNotification({ profile, conversationId, kind, recipientIds }) {
    if (!notificationService?.publish || !recipientIds?.length) return;
    setImmediate(async () => {
      try {
        // The conversation's own company, not re-derived from profile's
        // memberships — see call-links-service.js's sendInvites for why.
        const [conversationRow] = await prisma.$queryRaw`
          SELECT company_id AS "companyId" FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
        `;
        const companyId = conversationRow?.companyId ?? null;
        if (!companyId) return;
        await notificationService.publish({
          companyId,
          actorId: profile.id,
          input: {
            eventType: "chat.call.busy_attempt",
            title: "Llamada mientras estabas ocupado",
            body: `${profile.displayName || "Alguien"} intento iniciar una ${kind === "VIDEO" ? "videollamada" : "llamada"}.`,
            link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
            recipients: { userIds: recipientIds },
            channels: ["in_app"],
            priority: "medium",
            sourceType: "chat_conversation",
            sourceId: conversationId,
            dedupeKey: `chat.call.busy_attempt:${conversationId}:${profile.id}`,
          },
        });
      } catch (error) {
        console.warn("[atlas.calls] No se pudo publicar el aviso de usuario ocupado:", error?.message ?? error);
      }
    });
  }

  async function createCall({ authUserId, conversationId, kind, calendarEventId = null }) {
    const config = assertEnabled();
    await expireStaleCalls();
    const profile = await resolveProfile(authUserId);
    const members = await listConversationMembers(conversationId);
    if (!members.some((member) => member.userId === profile.id)) {
      throw new CallServiceError("Conversacion no encontrada.", 404);
    }
    // A "meeting room" — a conversation with a live guest link — can start a
    // call with just the host; external guests join later via the link.
    const meetingLink = await prisma.callLink.findFirst({
      where: { conversationId, revokedAt: null },
      select: { id: true },
    });
    const isMeetingRoom = Boolean(meetingLink);
    if (members.length < 2 && !isMeetingRoom) {
      throw new CallServiceError("No hay otra persona disponible en esta conversacion.", 422);
    }
    const memberIds = [];
    const candidateRecipientIds = [];
    for (const member of members) {
      memberIds.push(member.userId);
      if (member.userId !== profile.id) candidateRecipientIds.push(member.userId);
    }
    const candidateRecipientSet = new Set(candidateRecipientIds);
    await assertCalendarLink(calendarEventId, conversationId);

    const existing = await prisma.call.findFirst({
      where: { conversationId, status: { in: LIVE_CALL_STATUSES } },
      select: { id: true },
    });
    if (existing) {
      throw new CallServiceError("Ya hay una llamada en curso en esta conversacion.", 409, {
        callId: existing.id,
      });
    }

    let created;
    let invitedMembers = members;
    let busyRecipientIds = [];
    try {
      created = await prisma.$transaction(async (tx) => {
        // Serialize call creation for the same users. Locking in UUID order
        // avoids deadlocks when two people call each other simultaneously.
        await tx.$queryRaw`
          SELECT id
          FROM user_profile
          WHERE id = ANY(${memberIds}::uuid[])
          ORDER BY id
          FOR UPDATE
        `;
        const busyRows = await tx.$queryRaw`
          SELECT DISTINCT ON (cp.user_id)
                 cp.user_id AS "userId", cp.call_id AS "callId"
          FROM call_participant cp
          JOIN "call" c ON c.id = cp.call_id
          WHERE cp.user_id = ANY(${memberIds}::uuid[])
            AND cp.status IN ('RINGING', 'JOINED')
            AND c.status IN ('RINGING', 'ACTIVE')
          ORDER BY cp.user_id, c.created_at DESC
        `;
        const callerBusy = busyRows.find((row) => row.userId === profile.id);
        if (callerBusy) {
          throw new CallServiceError("Ya tienes una llamada en curso.", 409, {
            code: "caller_busy",
            callId: callerBusy.callId,
          });
        }

        const busySet = new Set();
        for (const row of busyRows) {
          if (candidateRecipientSet.has(row.userId)) busySet.add(row.userId);
        }
        busyRecipientIds = [...busySet];
        invitedMembers = members.filter(
          (member) => member.userId === profile.id || !busySet.has(member.userId),
        );
        if (invitedMembers.length < 2 && !isMeetingRoom) {
          throw new CallServiceError("El usuario ya esta en otra llamada.", 409, {
            code: "recipient_busy",
            busyUserIds: busyRecipientIds,
          });
        }

        // A meeting-room call starts ACTIVE (host alone, guests join via link);
        // a normal call starts RINGING until someone answers.
        const soloRoom = isMeetingRoom && invitedMembers.length < 2;
        const initialStatus = soloRoom ? "ACTIVE" : "RINGING";
        const startedAt = soloRoom ? now() : null;
        const rows = await tx.$queryRaw`
          WITH generated AS (SELECT uuidv7() AS id)
          INSERT INTO "call" (
            id, conversation_id, calendar_event_id, kind, status,
            initiated_by_user_id, livekit_room_name, created_at, started_at
          )
          SELECT id, ${conversationId}, ${calendarEventId}, ${kind}::"CallKind", ${initialStatus}::"CallStatus",
                 ${profile.id}, 'call_' || id::text, NOW(), ${startedAt}
          FROM generated
          RETURNING id
        `;
        const callId = rows[0].id;
        await tx.callParticipant.createMany({
          data: invitedMembers.map((member) => ({
            callId,
            userId: member.userId,
            status: member.userId === profile.id ? "JOINED" : "RINGING",
            livekitIdentity: member.userId,
            joinedAt: member.userId === profile.id ? now() : null,
          })),
        });
        return tx.call.findUnique({ where: { id: callId } });
      });
    } catch (error) {
      if (isLiveCallConflict(error)) {
        const active = await prisma.call.findFirst({
          where: { conversationId, status: { in: LIVE_CALL_STATUSES } },
          select: { id: true },
        });
        throw new CallServiceError("Ya hay una llamada en curso en esta conversacion.", 409, {
          callId: active?.id ?? null,
        });
      }
      if (error instanceof CallServiceError && error.details?.code === "recipient_busy") {
        queueBusyCallNotification({
          profile,
          conversationId,
          kind,
          recipientIds: busyRecipientIds,
        });
      }
      throw error;
    }

    const call = await getCallRecord(created.id);
    // A solo meeting-room call starts ACTIVE, so joinCall never fires the
    // RINGING->ACTIVE "iniciada" system message — post it here.
    if (call.status === "ACTIVE") {
      await postCallSystemMessage(call, { event: "started", kind: call.kind });
    }
    const recipientIds = [];
    for (const member of invitedMembers) {
      if (member.userId !== profile.id) recipientIds.push(member.userId);
    }
    if (busyRecipientIds.length) {
      queueBusyCallNotification({
        profile,
        conversationId,
        kind,
        recipientIds: busyRecipientIds,
      });
    }
    const incomingPayload = {
      callId: call.id,
      conversationId,
      kind,
      initiatorId: profile.id,
      initiatorName: profile.displayName,
    };
    await broadcaster?.broadcastToUsers?.(
      recipientIds,
      "chat.call.incoming",
      incomingPayload,
    ).catch(() => {});

    if (notificationService?.publish) {
      setImmediate(async () => {
        try {
          // The conversation's own company, not re-derived from profile's
          // memberships — see call-links-service.js's sendInvites for why.
          const [conversationRow] = await prisma.$queryRaw`
            SELECT company_id AS "companyId" FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
          `;
          const companyId = conversationRow?.companyId ?? null;
          if (!companyId) return;
          const published = await notificationService.publish({
            companyId,
            actorId: profile.id,
            input: {
              eventType: "chat.call.incoming",
              title: profile.displayName || "Llamada entrante",
              body: kind === "VIDEO" ? "Videollamada entrante" : "Llamada entrante",
              link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
              recipients: { userIds: recipientIds },
              channels: ["in_app", "web_push"],
              priority: "critical",
              sourceType: "call",
              sourceId: call.id,
              metadata: incomingPayload,
              dedupeKey: `chat.call.incoming:${call.id}`,
              expiresAt: new Date(now().getTime() + RING_TIMEOUT_MS),
            },
          });

          // A ringing call can't wait for the background delivery worker's
          // ~30s poll — push THIS notification's web_push/fcm deliveries out
          // now, scoped by notificationId so we don't drain everyone else's queue.
          const notificationIds = (published?.data ?? [])
            .map((n) => n?.id)
            .filter(Boolean);
          if (deliveryWorker?.processPendingNotificationDeliveries && notificationIds.length) {
            for (const channel of ["web_push", "fcm"]) {
              deliveryWorker
                .processPendingNotificationDeliveries({ channel, notificationIds, limit: notificationIds.length })
                .catch((error) => {
                  console.warn("[atlas.calls] Entrega inmediata de push fallo; el worker lo reintentara:", error?.message ?? error);
                });
            }
          }
        } catch (error) {
          console.warn("[atlas.calls] No se pudo publicar el aviso de llamada:", error?.message ?? error);
        }
      });
    }
    return {
      callId: call.id,
      call,
      livekitUrl: config.publicUrl,
      token: await createToken(config, call, profile),
    };
  }

  async function getRecordingActiveStatus(callId) {
    const activeRecording = await prisma.$queryRaw`
      SELECT id FROM "call_recording" WHERE call_id = ${callId} AND status IN ('STARTING','ACTIVE') LIMIT 1
    `;
    return activeRecording.length > 0;
  }

  async function getCall({ authUserId, callId }) {
    assertEnabled();
    await expireStaleCalls();
    const profile = await resolveProfile(authUserId);
    const call = await getCallRecord(callId);
    await assertCallAccess(call, profile.id);
    return { ...call, recording: { active: await getRecordingActiveStatus(call.id) } };
  }

  async function getLiveCallOrThrow(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", status,
             livekit_room_name AS "livekitRoomName", initiated_by_user_id AS "initiatedByUserId"
      FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    const call = rows[0];
    if (!call || !["RINGING", "ACTIVE"].includes(call.status)) {
      throw new CallServiceError("La llamada no está activa.", 409);
    }
    return call;
  }

  async function getCurrentCall({ authUserId }) {
    assertEnabled();
    await expireStaleCalls();
    const profile = await resolveProfile(authUserId);
    const participant = await prisma.callParticipant.findFirst({
      where: {
        userId: profile.id,
        status: { in: ["RINGING", "JOINED"] },
        call: { status: { in: LIVE_CALL_STATUSES } },
      },
      orderBy: { createdAt: "desc" },
      select: { callId: true, status: true },
    });
    if (!participant) return null;
    const call = await getCallRecord(participant.callId);
    return {
      participantStatus: participant.status,
      call: { ...call, recording: { active: await getRecordingActiveStatus(call.id) } },
    };
  }

  async function joinCall({ authUserId, callId }) {
    const config = assertEnabled();
    await expireStaleCalls();
    const profile = await resolveProfile(authUserId);
    const before = await getCallRecord(callId);
    const participant = await assertCallAccess(before, profile.id);
    if (before.status === "ENDED") throw new CallServiceError("Esta llamada ya termino.", 409);
    if (["DECLINED", "MISSED", "LEFT"].includes(participant.status)) {
      throw new CallServiceError("Ya no puedes unirte a esta llamada.", 409);
    }

    const shouldActivate = profile.id !== before.initiatedByUserId || before.status === "ACTIVE";
    const operations = [
      prisma.callParticipant.update({
        where: { callId_userId: { callId, userId: profile.id } },
        data: { status: "JOINED", joinedAt: participant.joinedAt ?? now(), leftAt: null },
      }),
    ];
    if (shouldActivate) {
      operations.push(prisma.call.update({
        where: { id: callId },
        data: { status: "ACTIVE", startedAt: before.startedAt ?? now() },
      }));
    }
    await prisma.$transaction(operations);
    const call = await getCallRecord(callId);
    if (shouldActivate && before.status === "RINGING") {
      await postCallSystemMessage(call, { event: "started", kind: call.kind });
    }
    return {
      callId,
      call,
      livekitUrl: config.publicUrl,
      token: await createToken(config, call, profile),
    };
  }

  async function declineCall({ authUserId, callId }) {
    assertEnabled();
    await expireStaleCalls();
    const profile = await resolveProfile(authUserId);
    const call = await getCallRecord(callId);
    const participant = await assertCallAccess(call, profile.id);
    if (call.status === "ENDED") return call;
    if (participant.userId === call.initiatedByUserId) {
      throw new CallServiceError("El iniciador debe finalizar la llamada.", 409);
    }
    await prisma.callParticipant.update({
      where: { callId_userId: { callId, userId: profile.id } },
      data: { status: "DECLINED", leftAt: now() },
    });
    const remaining = await prisma.callParticipant.count({
      where: { callId, userId: { not: call.initiatedByUserId }, status: { in: ["RINGING", "JOINED"] } },
    });
    if (remaining === 0 && call.status === "RINGING") {
      await endCallRecord(call, "rejected");
    }
    return getCallRecord(callId);
  }

  async function endCallRecord(call, reason = "ended") {
    await prisma.$transaction([
      prisma.callParticipant.updateMany({
        where: { callId: call.id, status: "RINGING" },
        data: { status: reason === "missed" ? "MISSED" : "DECLINED", leftAt: now() },
      }),
      prisma.callParticipant.updateMany({
        where: { callId: call.id, status: "JOINED" },
        data: { status: "LEFT", leftAt: now() },
      }),
      prisma.call.update({
        where: { id: call.id },
        data: { status: "ENDED", endedAt: now(), endReason: reason },
      }),
    ]);
    await closeLiveKitRoom(call);
    await postCallSystemMessage(call, {
      event: "ended",
      kind: call.kind,
      endReason: reason === "missed" ? "missed" : reason === "rejected" ? "rejected" : "ended",
      startedAt: call.startedAt ?? null,
      endedAt: now(),
    });
    const participantIds = [];
    for (const participant of call.participants ?? []) {
      if (participant.userId && !participantIds.includes(participant.userId)) {
        participantIds.push(participant.userId);
      }
    }
    if (participantIds.length) {
      try {
        await broadcaster?.broadcastToUsers?.(
          participantIds,
          "chat.call.ended",
          { callId: call.id, reason },
        );
      } catch (error) {
        console.warn("[atlas.calls] No se pudo emitir el cierre de llamada:", error?.message ?? error);
      }
    }
  }

  async function leaveCall({ authUserId, callId }) {
    assertEnabled();
    const profile = await resolveProfile(authUserId);
    const call = await getCallRecord(callId);
    await assertCallAccess(call, profile.id);
    if (call.status === "ENDED") return call;
    await prisma.callParticipant.update({
      where: { callId_userId: { callId, userId: profile.id } },
      data: { status: "LEFT", leftAt: now() },
    });
    const remainingPeerCount = await prisma.callParticipant.count({
      where: {
        callId,
        userId: { not: call.initiatedByUserId },
        status: "JOINED",
      },
    });
    if (profile.id === call.initiatedByUserId || remainingPeerCount === 0) {
      await endCallRecord(call, "ended");
    }
    return getCallRecord(callId);
  }

  async function endCall({ authUserId, callId }) {
    assertEnabled();
    const profile = await resolveProfile(authUserId);
    const call = await getCallRecord(callId);
    await assertCallAccess(call, profile.id);
    if (call.status === "ENDED") return call;
    await assertCanManageCall({
      conversationId: call.conversationId,
      initiatedByUserId: call.initiatedByUserId,
      profileId: profile.id,
      action: "finalizar esta llamada",
    });
    await endCallRecord(call, "ended");
    return getCallRecord(callId);
  }

  // Bring already-registered platform users (matched by email in
  // call-links-service) straight into the meeting instead of emailing them a
  // guest link: add them to the conversation if needed, attach them to the live
  // call as RINGING participants, and fire the same in-app + web_push "incoming
  // call" alert a normally-rung member gets. Only for people who have an account
  // in the inviter's company — external addresses keep going out by email.
  async function inviteMembersToLiveCall({ conversationId, inviterProfileId, users }) {
    const targets = [
      ...new Map((users ?? []).filter((u) => u?.userId).map((u) => [u.userId, u])).values(),
    ];
    if (!targets.length) return { notified: [], addedMembers: [], addedParticipants: [] };
    const targetIds = targets.map((u) => u.userId);

    // The relevant company is the conversation's own company, not re-derived
    // from the inviter's memberships — see call-links-service.js's sendInvites
    // for why (a multi-company inviter's "most recent membership" is not
    // necessarily this call's company).
    const [conversationRow] = await prisma.$queryRaw`
      SELECT company_id AS "companyId" FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
    `;
    const companyId = conversationRow?.companyId ?? null;

    const [inviter] = await prisma.$queryRaw`
      SELECT display_name AS "displayName" FROM user_profile WHERE id = ${inviterProfileId} LIMIT 1
    `;
    const inviterName = inviter?.displayName ?? "Alguien";

    // 1. Add anyone who is not already an active member of the conversation.
    const memberRows = await prisma.$queryRaw`
      SELECT user_id AS "userId" FROM chat_conversation_members
      WHERE conversation_id = ${conversationId}
        AND user_id = ANY(${targetIds}::uuid[])
        AND left_at IS NULL
    `;
    const alreadyMembers = new Set(memberRows.map((r) => r.userId));
    const addedMembers = [];
    for (const uid of targetIds) {
      if (alreadyMembers.has(uid)) continue;
      // (conversation_id, user_id) is a PARTIAL unique index
      // (WHERE user_id IS NOT NULL AND left_at IS NULL); the ON CONFLICT clause
      // must repeat that predicate or Postgres raises 42P10 and this 500s.
      const inserted = await prisma.$executeRaw`
        INSERT INTO chat_conversation_members (conversation_id, user_id, role)
        VALUES (${conversationId}, ${uid}, 'member')
        ON CONFLICT (conversation_id, user_id) WHERE user_id IS NOT NULL AND left_at IS NULL
        DO UPDATE
          SET left_at = NULL, role = EXCLUDED.role, role_id = NULL
          WHERE chat_conversation_members.left_at IS NOT NULL
      `;
      if (inserted === 0) continue;
      await prisma.$executeRaw`
        UPDATE chat_conversation_members
        SET role_id = (SELECT id FROM chat_channel_roles WHERE conversation_id = ${conversationId} AND name = 'Member' LIMIT 1)
        WHERE conversation_id = ${conversationId} AND user_id = ${uid} AND role_id IS NULL
      `;
      addedMembers.push(uid);
    }

    // 2. Attach them to the live call (if any) so their client can fetch it and
    //    they can actually join.
    const liveCall = await prisma.call.findFirst({
      where: { conversationId, status: { in: LIVE_CALL_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, initiatedByUserId: true },
    });
    const addedParticipants = [];
    if (liveCall) {
      const existing = await prisma.callParticipant.findMany({
        where: { callId: liveCall.id, userId: { in: targetIds } },
        select: { userId: true },
      });
      const havePart = new Set(existing.map((r) => r.userId));
      const toAdd = targetIds.filter((id) => !havePart.has(id));
      if (toAdd.length) {
        await prisma.callParticipant.createMany({
          data: toAdd.map((uid) => ({
            callId: liveCall.id,
            userId: uid,
            status: "RINGING",
            livekitIdentity: uid,
          })),
          skipDuplicates: true,
        });
        addedParticipants.push(...toAdd);
      }
    }

    // 3. System line in the conversation for the freshly-added members.
    if (addedMembers.length) {
      const names = await prisma.$queryRaw`
        SELECT display_name AS "displayName" FROM user_profile
        WHERE id = ANY(${addedMembers}::uuid[])
      `;
      const label = names.map((n) => n.displayName).filter(Boolean).join(", ");
      if (label) {
        await prisma.$executeRaw`
          INSERT INTO chat_messages (conversation_id, sender_type, body, message_type, sender_user_id)
          VALUES (${conversationId}, 'system', ${`${inviterName} invito a ${label} a la reunion`}, 'system', ${inviterProfileId})
        `;
      }
    }

    // 4. In-app + web_push alert — the same event type a rung member gets, so it
    //    reaches the incoming-call UI and honours the recipient's call prefs.
    const kind = liveCall?.kind ?? "VIDEO";
    const incomingPayload = liveCall
      ? {
          callId: liveCall.id,
          conversationId,
          kind,
          initiatorId: inviterProfileId,
          initiatorName: inviterName,
        }
      : { conversationId };
    let publishedIds = [];
    if (companyId && notificationService?.publish) {
      try {
        const published = await notificationService.publish({
          companyId,
          actorId: inviterProfileId,
          input: {
            eventType: "chat.call.incoming",
            title: inviterName || (kind === "VIDEO" ? "Videollamada" : "Llamada"),
            body: kind === "VIDEO"
              ? "Te invitaron a una videollamada"
              : "Te invitaron a una llamada",
            link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
            recipients: { userIds: targetIds },
            channels: ["in_app", "web_push"],
            priority: "critical",
            sourceType: "call",
            sourceId: liveCall?.id ?? conversationId,
            metadata: incomingPayload,
            dedupeKey: liveCall
              ? `chat.call.incoming:${liveCall.id}`
              : `chat.call.invite:${conversationId}:${inviterProfileId}`,
            ...(liveCall
              ? { expiresAt: new Date(now().getTime() + RING_TIMEOUT_MS) }
              : {}),
          },
        });
        publishedIds = (published?.data ?? []).map((n) => n?.id).filter(Boolean);
      } catch (error) {
        console.warn(
          "[atlas.calls] No se pudo avisar a los invitados con cuenta:",
          error?.message ?? error,
        );
      }
    }

    // 5. Realtime nudges: ring the online ones now, refresh their channel list.
    await broadcaster
      ?.broadcastToUsers?.(targetIds, "chat.conversation.new", { conversationId })
      .catch(() => {});
    if (liveCall) {
      await broadcaster
        ?.broadcastToUsers?.(targetIds, "chat.call.incoming", incomingPayload)
        .catch(() => {});
    }

    // 6. Push out THIS alert's web_push/fcm deliveries now — don't wait for
    //    the ~30s worker poll — scoped by notificationId so we don't drain the queue.
    if (deliveryWorker?.processPendingNotificationDeliveries && publishedIds.length) {
      for (const channel of ["web_push", "fcm"]) {
        deliveryWorker
          .processPendingNotificationDeliveries({
            channel,
            notificationIds: publishedIds,
            limit: publishedIds.length,
          })
          .catch((error) => {
            console.warn(
              "[atlas.calls] Entrega inmediata de push a invitados fallo:",
              error?.message ?? error,
            );
          });
      }
    }

    return { notified: targetIds, addedMembers, addedParticipants };
  }

  async function revokeUnauthorizedParticipants() {
    const config = getConfig();
    if (!config.enabled) return;
    const rows = await prisma.$queryRaw`SELECT cp.id, cp.livekit_identity, c.livekit_room_name
      FROM call_participant cp JOIN call c ON c.id = cp.call_id
      WHERE c.status IN ('RINGING', 'ACTIVE')
        AND NOT public.runly_chat_user_access(c.conversation_id, cp.user_id)`;
    const rooms = new RoomServiceClientImpl(config.internalUrl, config.apiKey, config.apiSecret);
    // Keep checking LEFT participants: self-hosted LiveKit does not revoke old
    // tokens, so a reconnect must be removed again, including screen publishers.
    const failures = [];
    for (const row of rows) {
      for (const identity of row.livekit_identity ? [row.livekit_identity, `screen:${row.livekit_identity}`] : []) {
        try {
          await rooms.removeParticipant(row.livekit_room_name, identity);
        } catch (error) {
          if (error?.status !== 404 && error?.code !== 'not_found') failures.push(error);
        }
      }
      await prisma.callParticipant.updateMany({ where: { id: row.id, leftAt: null }, data: { leftAt: now(), status: 'LEFT' } });
    }
    if (failures.length) throw new AggregateError(failures, 'No se pudo revocar el acceso a todas las conexiones de llamada.');
  }

  function startExpirySweeper() {
    if (!getConfig().enabled) return () => {};
    const timer = setInterval(() => {
      Promise.all([expireStaleCalls(), revokeUnauthorizedParticipants()]).catch((error) => {
        console.error("[atlas.calls] Error expirando llamadas:", error?.message ?? error);
      });
    }, 15_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return {
    ...createCallScreenShareService({ assertEnabled, resolveProfile, getCallRecord, assertCallAccess, AccessTokenImpl, ErrorImpl: CallServiceError }),
    getConfigStatus,
    createCall,
    getCall,
    getLiveCallOrThrow,
    getCurrentCall,
    joinCall,
    declineCall,
    leaveCall,
    endCall,
    expireStaleCalls,
    startExpirySweeper,
    revokeUnauthorizedParticipants,
    assertCanManageCall,
    inviteMembersToLiveCall,
    postSystemMessage,
    getRecordingActiveStatus,
  };
}
