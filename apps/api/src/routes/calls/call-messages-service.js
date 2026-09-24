export class CallMessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallMessageError";
    this.status = status;
  }
}

const MAX_BODY = 4000;

function cleanBody(body) {
  const b = String(body ?? "").trim();
  if (!b) throw new CallMessageError("El mensaje no puede estar vacío.", 422);
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
    };
  }

  // Posts a call guest's chat message into the call's real conversation
  // (chat_messages) — the same conversation members see in runly.chat. See
  // docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md
  // §8.2. Mirrors the insert+bump+broadcast pattern already used for call
  // system messages in call-service.js's postSystemMessage.
  async function postGuestMessage({ guestToken, body }) {
    const clean = cleanBody(body);
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

    return { message: shape({ id: messageId, senderKind: "guest", senderName: name, senderUserId: null, body: clean, createdAt }) };
  }

  return { postGuestMessage };
}
