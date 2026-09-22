import { Prisma } from "@prisma/client";
import { ChatServiceError } from "./chat-service-error.js";
import { resolveUserProfileId } from "./chat-service.js";

// Operator-facing "external support" inbox. Split out of chat-service.js
// (2026-08-28) to keep that file under the 1500-line ceiling before adding
// reply-to-message support — no behavior change from the pre-split version.
export function createChatExternalInboxService({ prisma, broadcaster = null }) {
  async function getUserProfileId(authUserId) {
    return resolveUserProfileId(prisma, authUserId);
  }

  async function listExternalInbox({ authUserId, companyId, status = "open", limit = 30, cursor = null, search = null }) {
    const profileId = await getUserProfileId(authUserId);

    // Build search filter dynamically to avoid untyped NULL parameter (42P18)
    const searchFilter = search
      ? Prisma.sql`AND (
          LOWER(c.tracking_code) LIKE ${"%" + search.toLowerCase() + "%"}
          OR LOWER(gs.email) LIKE ${"%" + search.toLowerCase() + "%"}
          OR LOWER(gs.name) LIKE ${"%" + search.toLowerCase() + "%"}
        )`
      : Prisma.empty;

    const rows = await prisma.$queryRaw`
      SELECT
        c.*,
        gs.email AS guest_email,
        gs.name AS guest_name,
        gs.page_url AS guest_page_url,
        gs.idle_expires_at,
        gs.absolute_expires_at,
        gs.guest_last_read_at,
        (
          SELECT COUNT(*)::int FROM chat_messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
        ) AS message_count,
        (
          SELECT COUNT(*)::int FROM chat_messages m
          WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
            AND m.sender_type = 'guest'
            AND m.created_at > COALESCE(
              (SELECT last_read_at FROM chat_conversation_members
               WHERE conversation_id = c.id AND user_id = ${profileId}),
              '1970-01-01'::timestamptz
            )
        ) AS unread_count,
        (
          SELECT json_build_object(
            'id', m.id, 'body', m.body, 'senderType', m.sender_type, 'createdAt', m.created_at
          )
          FROM chat_messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC LIMIT 1
        ) AS last_message
      FROM chat_conversations c
      LEFT JOIN chat_guest_sessions gs ON gs.id = c.created_by_guest_id
      WHERE c.type = 'external_support'
        AND c.deleted_at IS NULL
        AND c.company_id = ${companyId}::uuid
        AND c.status = ${status}
        ${searchFilter}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT ${limit}
    `;
    return { data: rows };
  }

  async function markExternalRead({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    // Ensure a member row exists for this operator (partial index — DO NOTHING on any conflict)
    await prisma.$executeRaw`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, last_read_at)
      VALUES (${conversationId}, ${profileId}, 'operator', NOW())
      ON CONFLICT DO NOTHING
    `;
    // Then update last_read_at on the existing row
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET last_read_at = NOW()
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId} AND left_at IS NULL
    `;
    broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "operator_read", {
      conversationId,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  async function broadcastOperatorTyping({ conversationId }) {
    broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "operator_typing", {
      conversationId,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  async function assignOperator({ conversationId, authUserId, operatorUserId }) {
    const profileId = await getUserProfileId(authUserId);

    await prisma.$executeRaw`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role)
      VALUES (${conversationId}, ${operatorUserId}, 'operator')
      ON CONFLICT DO NOTHING
    `;

    const [op] = await prisma.$queryRaw`
      SELECT display_name FROM user_profile WHERE id = ${operatorUserId} LIMIT 1
    `;
    if (op) {
      await prisma.$executeRaw`
        INSERT INTO chat_messages (conversation_id, sender_type, body, message_type, sender_user_id)
        VALUES (${conversationId}, 'system', ${`${op.display_name} fue asignado como operador`}, 'system', ${profileId})
      `;
    }

    return { ok: true };
  }

  async function closeExternalConversation({ conversationId, authUserId }) {
    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET status = 'closed', updated_at = NOW()
      WHERE id = ${conversationId} AND type = 'external_support'
    `;
    broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "conversation_closed", { conversationId });
    return { ok: true };
  }

  return {
    listExternalInbox,
    markExternalRead,
    assignOperator,
    closeExternalConversation,
    broadcastOperatorTyping,
  };
}

export { ChatServiceError };
