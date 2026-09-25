export class CallMessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallMessageError";
    this.status = status;
  }
}

const MAX_BODY = 4000;

// An empty body is valid here (an attachment-only message) — the "body or
// attachment" invariant is enforced by callRoomMessageSchema before this
// service ever runs (see docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md).
function cleanBody(body) {
  const b = String(body ?? "").trim();
  if (b.length > MAX_BODY) throw new CallMessageError("El mensaje es demasiado largo.", 422);
  return b;
}

export function createCallMessagesService({ prisma, guestService = null, broadcaster = null }) {
  async function loadCall(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", status FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    if (!rows.length) throw new CallMessageError("Llamada no encontrada.", 404);
    return rows[0];
  }

  function shape(m) {
    return {
      id: m.id,
      senderKind: m.senderKind,
      senderName: m.senderName,
      senderUserId: m.senderUserId ?? null,
      body: m.body,
      createdAt: m.createdAt,
      attachments: m.attachments ?? [],
    };
  }

  // Posts a call guest's chat message into the call's real conversation
  // (chat_messages) — the same conversation members see in runly.chat. See
  // docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md
  // §8.2. Mirrors the insert+bump+broadcast pattern already used for call
  // system messages in call-service.js's postSystemMessage.
  async function postGuestMessage({ guestToken, body, metadata = {} }) {
    const clean = cleanBody(body);
    // Redundant with callRoomMessageSchema's own refine (defense in depth for
    // any other caller of this service) — a message needs a body or an
    // attachment, never neither.
    if (!clean && !metadata?.attachmentId) throw new CallMessageError("El mensaje no puede estar vacío.", 422);
    if (!guestService?.resolveAdmittedGuestForMessage) throw new CallMessageError("No disponible.", 500);
    const { guestId, callId, displayName: name } = await guestService.resolveAdmittedGuestForMessage({ guestToken });
    const call = await loadCall(callId);

    const rows = await prisma.$queryRaw`
      INSERT INTO chat_messages (conversation_id, sender_type, sender_call_guest_id, body)
      VALUES (${call.conversationId}, 'guest', ${guestId}, ${clean})
      RETURNING id, created_at
    `;
    const messageId = rows[0].id;
    const createdAt = rows[0].created_at;

    // Link a guest-presigned attachment (created by
    // POST /calls/guest/attachments/presign) to this message. Scoped to the
    // conversation and to rows not yet linked so a stale or foreign
    // attachmentId is a silent no-op — mirrors chat/guest-service.js's
    // sendGuestMessage for the website-guest path.
    let attachments = [];
    if (metadata?.attachmentId) {
      const linked = await prisma.$executeRaw`
        UPDATE chat_attachments
        SET message_id = ${messageId}
        WHERE id = ${metadata.attachmentId}::uuid
          AND conversation_id = ${call.conversationId}::uuid
          AND message_id IS NULL
      `;
      if (linked > 0) {
        await prisma.$executeRaw`
          UPDATE chat_messages SET attachment_count = attachment_count + ${linked} WHERE id = ${messageId}
        `;
        attachments = await prisma.$queryRaw`
          SELECT id, file_name AS "fileName", mime_type AS "mimeType", size_bytes AS "sizeBytes"
          FROM chat_attachments WHERE id = ${metadata.attachmentId}::uuid
        `;
      }
    }

    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET last_message_id = ${messageId}, last_message_at = ${createdAt}, updated_at = NOW()
      WHERE id = ${call.conversationId}
    `;

    if (broadcaster) {
      const members = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members
        WHERE conversation_id = ${call.conversationId} AND left_at IS NULL AND user_id IS NOT NULL
      `;
      const memberIds = members.map((r) => r.user_id).filter(Boolean);
      if (memberIds.length) {
        await broadcaster.broadcastToUsers(memberIds, "chat.message.new", {
          conversationId: call.conversationId,
          messageId,
          senderId: null,
          senderName: name,
          threadRootId: null,
          replyToMessageId: null,
        }).catch(() => {});
      }
    }

    return { message: shape({ id: messageId, senderKind: "guest", senderName: name, senderUserId: null, body: clean, createdAt, attachments }) };
  }

  return { postGuestMessage };
}
