import { Prisma } from "@prisma/client";
import { ChatServiceError } from "./chat-service-error.js";
import { assertNotMirai } from "./mirai-conversation-guard.js";

// Extracted from chat-service.js to keep that file under its documented
// 1500-line hard ceiling. Receives getUserProfileId/assertMember/
// batchSignAvatarUrls as already-constructed closures from the caller
// (chat-service.js) rather than rebuilding its own copies — this file
// shares the SAME prisma-backed helpers and signed-url cache as the rest
// of chat-service.js, not a duplicate set, since createChatService
// instantiates this internally (see chat-service.js) using its own
// existing closures.
export function createChatConversationReadsService({ prisma, getUserProfileId, assertMember, batchSignAvatarUrls }) {
  // assertNotMirai(prisma, conversationId, action) is shared from
  // ./mirai-conversation-guard.js — the 'mirai' chat cannot be archived
  // or hidden from the list.

  async function listConversations({ authUserId, limit = 50, cursor = null, archived = false }) {
    const profileId = await getUserProfileId(authUserId);

    const cursorClause = cursor ? Prisma.sql`AND c.last_message_at < ${new Date(cursor)}` : Prisma.empty;
    const archiveClause = archived
      ? Prisma.sql`AND ccm.archived_at IS NOT NULL`
      : Prisma.sql`AND ccm.archived_at IS NULL`;
    // "Deleted" (hidden) direct chats drop out of the active list until a new
    // message resurfaces them (see updateConversationLastMessage). The archived
    // view is unaffected — hidden only ever applies to unarchived direct chats,
    // but the guard is cheap and correct in both branches.
    const hiddenClause = archived ? Prisma.empty : Prisma.sql`AND ccm.hidden_at IS NULL`;

    const rows = await prisma.$queryRaw`
      SELECT
        c.id,
        c.type,
        c.title,
        c.avatar_url,
        c.avatar_file_id,
        c.avatar_emoji,
        c.status,
        c.last_message_at,
        c.last_message_id,
        c.website_id,
        c.company_id,
        c.metadata,
        c.created_at,
        -- unread count
        -- IS DISTINCT FROM handles NULL sender_user_id (guest messages) correctly
        -- != would evaluate NULL != profileId as NULL (falsy), missing guest messages
        (
          SELECT COUNT(*)::int FROM chat_messages m
          WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
            AND m.thread_root_id IS NULL
            AND m.sender_type != 'system'
            AND m.sender_user_id IS DISTINCT FROM ${profileId}
            AND m.created_at > COALESCE(
              (SELECT last_read_at FROM chat_conversation_members
               WHERE conversation_id = c.id AND user_id = ${profileId}),
              '1970-01-01'::timestamptz
            )
        ) AS unread_count,
        -- unread messages that mention the caller directly, via their role in
        -- this conversation, or an @everyone/@here broadcast — mirrors the
        -- isMentioned() check ChatMessageBubble.jsx uses to highlight a message,
        -- so the sidebar badge and the in-chat highlight never disagree.
        (
          SELECT COUNT(*)::int FROM chat_messages m
          WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
            AND m.thread_root_id IS NULL
            AND m.sender_type != 'system'
            AND m.sender_user_id IS DISTINCT FROM ${profileId}
            AND m.created_at > COALESCE(
              (SELECT last_read_at FROM chat_conversation_members
               WHERE conversation_id = c.id AND user_id = ${profileId}),
              '1970-01-01'::timestamptz
            )
            AND (
              (m.metadata->'mentions'->>'everyone')::boolean IS TRUE
              OR (m.metadata->'mentions'->>'here')::boolean IS TRUE
              OR m.metadata->'mentions'->'userIds' ? ${profileId}::text
              OR (ccm.role_id IS NOT NULL AND m.metadata->'mentions'->'roleIds' ? ccm.role_id::text)
            )
        ) AS unread_mention_count,
        -- last message preview
        (
          SELECT json_build_object(
            'id', m.id,
            'body', m.body,
            'senderType', m.sender_type,
            'messageType', m.message_type,
            'createdAt', m.created_at,
            'senderUserId', m.sender_user_id
          )
          FROM chat_messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.thread_root_id IS NULL
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message,
        -- members preview (up to 5)
        (
          SELECT json_agg(json_build_object(
            'userId', cm.user_id,
            'role', cm.role,
            'displayName', up.display_name,
            'avatarFileId', up.avatar_file_id::text,
            'authAvatarUrl', au.raw_user_meta_data->>'avatar_url',
            'lastReadAt', cm.last_read_at
          ) ORDER BY cm.joined_at)
          FROM (
            SELECT * FROM chat_conversation_members
            WHERE conversation_id = c.id AND user_id IS NOT NULL AND left_at IS NULL
            LIMIT 5
          ) cm
          LEFT JOIN user_profile up ON up.id = cm.user_id
          LEFT JOIN auth.users au ON au.id = up.auth_user_id
        ) AS members,
        ccm.archived_at IS NOT NULL AS is_archived,
        ccm.muted_at IS NOT NULL AS is_muted,
        ccm.pinned_at,
        ccm.pinned_at IS NOT NULL AS is_pinned,
        -- legacy role enum for the caller's own membership (owner/admin/member);
        -- coarse UI gate for "Eliminar canal" vs "Salir del canal" in the
        -- conversation-list row menu without a per-row detail fetch.
        ccm.role AS my_role
      FROM chat_conversations c
      INNER JOIN chat_conversation_members ccm
        ON ccm.conversation_id = c.id
        AND ccm.user_id = ${profileId}
        AND ccm.left_at IS NULL
      WHERE c.deleted_at IS NULL
        AND c.type != 'external_support'
        ${archiveClause}
        ${hiddenClause}
        ${cursorClause}
      ORDER BY (ccm.pinned_at IS NOT NULL) DESC, ccm.pinned_at DESC,
               COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const allFileIds = [
      ...new Set([
        ...data.flatMap((c) => (c.members ?? []).map((m) => m.avatarFileId).filter(Boolean)),
        ...data.map((c) => c.avatar_file_id).filter(Boolean),
      ]),
    ];
    const avatarUrlMap = allFileIds.length ? await batchSignAvatarUrls(allFileIds) : {};
    for (const conv of data) {
      if (conv.members) {
        conv.members = conv.members.map((m) => ({
          ...m,
          avatarUrl: m.avatarFileId ? (avatarUrlMap[m.avatarFileId] ?? m.authAvatarUrl ?? null) : (m.authAvatarUrl ?? null),
          authAvatarUrl: undefined,
        }));
      }
      conv.avatarUrl = conv.avatar_file_id ? (avatarUrlMap[conv.avatar_file_id] ?? null) : null;
      conv.avatar_url = undefined; // dead raw column (never written) — avatarUrl (camelCase, resolved above) is the live field
    }

    return {
      data,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1].last_message_at?.toISOString() : null,
    };
  }

  async function archiveConversation({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertNotMirai(prisma, conversationId, "archivar");
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET archived_at = NOW()
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId} AND left_at IS NULL
    `;
    return { ok: true };
  }

  async function unarchiveConversation({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET archived_at = NULL
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId} AND left_at IS NULL
    `;
    return { ok: true };
  }

  async function pinConversation({ conversationId, authUserId, pinned }) {
    const profileId = await getUserProfileId(authUserId);
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET pinned_at = ${pinned ? new Date() : null}
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId} AND left_at IS NULL
    `;
    return { ok: true, pinned: Boolean(pinned) };
  }

  async function hideConversation({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertNotMirai(prisma, conversationId, "eliminar de la lista");
    const [conv] = await prisma.$queryRaw`
      SELECT type FROM chat_conversations WHERE id = ${conversationId} AND deleted_at IS NULL LIMIT 1
    `;
    if (!conv) throw new ChatServiceError("Conversacion no encontrada.", 404);
    if (conv.type !== "direct") {
      throw new ChatServiceError("Solo los chats directos se pueden eliminar de la lista.", 400);
    }
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET hidden_at = NOW()
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId} AND left_at IS NULL
    `;
    return { ok: true };
  }

  async function getConversation({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);

    const rows = await prisma.$queryRaw`
      SELECT
        c.*,
        (
          SELECT json_agg(json_build_object(
            'id', cm.id,
            'userId', cm.user_id,
            'role', cm.role,
            'joinedAt', cm.joined_at,
            'leftAt', cm.left_at,
            'lastReadAt', cm.last_read_at,
            'displayName', up.display_name,
            'avatarFileId', up.avatar_file_id::text,
            'authAvatarUrl', au.raw_user_meta_data->>'avatar_url',
            'email', up.email,
            'phone', up.phone,
            'bio', up.bio,
            'roleId', cm.role_id,
            'roleName', ccr.name,
            'roleColor', ccr.color,
            'rolePosition', ccr.position,
            'roleIsSystem', ccr.is_system,
            'rolePermissions', ccr.permissions
          ) ORDER BY cm.joined_at)
          FROM chat_conversation_members cm
          LEFT JOIN user_profile up ON up.id = cm.user_id
          LEFT JOIN auth.users au ON au.id = up.auth_user_id
          LEFT JOIN chat_channel_roles ccr ON ccr.id = cm.role_id
          WHERE cm.conversation_id = c.id AND cm.left_at IS NULL
        ) AS members
      FROM chat_conversations c
      WHERE c.id = ${conversationId} AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new ChatServiceError("Conversacion no encontrada.", 404);
    const conv = rows[0];
    const memberFileIds = conv.members ? conv.members.map((m) => m.avatarFileId).filter(Boolean) : [];
    const fileIds = [...new Set([...memberFileIds, conv.avatar_file_id].filter(Boolean))];
    const avatarUrlMap = fileIds.length ? await batchSignAvatarUrls(fileIds) : {};
    if (conv.members) {
      conv.members = conv.members.map((m) => ({
        ...m,
        avatarUrl: m.avatarFileId ? (avatarUrlMap[m.avatarFileId] ?? m.authAvatarUrl ?? null) : (m.authAvatarUrl ?? null),
        authAvatarUrl: undefined,
      }));
    }
    conv.avatarUrl = conv.avatar_file_id ? (avatarUrlMap[conv.avatar_file_id] ?? null) : null;
    conv.avatar_url = undefined; // dead raw column (never written) — avatarUrl (camelCase, resolved above) is the live field
    return conv;
  }

  // "Enviado" / "Visto por" info for one message (the WhatsApp-style "Info del
  // mensaje" panel). There is no per-message delivery/receipt tracking in this
  // system — messages are written straight to Postgres and pushed instantly to
  // connected clients over Supabase Realtime, so "entregado" would just repeat
  // "enviado" with fabricated meaning. Instead this reuses the SAME per-member
  // last_read_at watermark the unread-count/sidebar logic already relies on
  // (chat_conversation_members.last_read_at): a member has "seen" the message
  // once their watermark passes its created_at, and that watermark IS the
  // "visto" timestamp shown — an approximation (it moves when they mark the
  // whole conversation read, not when this exact message scrolled into view)
  // but the only one backed by real data without adding a new write path.
  async function getMessageReceipt({ messageId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);

    const rows = await prisma.$queryRaw`
      SELECT m.id, m.conversation_id, m.created_at, m.sender_user_id,
             c.type AS conversation_type
      FROM chat_messages m
      INNER JOIN chat_conversation_members ccm
        ON ccm.conversation_id = m.conversation_id
       AND ccm.user_id = ${profileId}
       AND ccm.left_at IS NULL
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.id = ${messageId} AND m.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new ChatServiceError("Mensaje no encontrado.", 404);
    const msg = rows[0];

    const memberRows = await prisma.$queryRaw`
      SELECT cm.user_id, cm.last_read_at,
             up.display_name, up.avatar_file_id::text AS avatar_file_id,
             au.raw_user_meta_data->>'avatar_url' AS auth_avatar_url
      FROM chat_conversation_members cm
      LEFT JOIN user_profile up ON up.id = cm.user_id
      LEFT JOIN auth.users au ON au.id = up.auth_user_id
      WHERE cm.conversation_id = ${msg.conversation_id}
        AND cm.left_at IS NULL
        AND cm.user_id IS NOT NULL
        AND cm.user_id IS DISTINCT FROM ${msg.sender_user_id}
      ORDER BY cm.joined_at ASC
    `;

    const fileIds = [...new Set(memberRows.map((m) => m.avatar_file_id).filter(Boolean))];
    const avatarUrlMap = fileIds.length ? await batchSignAvatarUrls(fileIds) : {};

    const seenBy = memberRows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name ?? null,
      avatarUrl: m.avatar_file_id
        ? (avatarUrlMap[m.avatar_file_id] ?? m.auth_avatar_url ?? null)
        : (m.auth_avatar_url ?? null),
      seenAt: m.last_read_at && m.last_read_at >= msg.created_at ? m.last_read_at : null,
    }));

    return {
      messageId: msg.id,
      conversationId: msg.conversation_id,
      conversationType: msg.conversation_type,
      createdAt: msg.created_at,
      seenBy,
    };
  }

  return {
    listConversations,
    archiveConversation,
    unarchiveConversation,
    pinConversation,
    hideConversation,
    getConversation,
    getMessageReceipt,
  };
}
