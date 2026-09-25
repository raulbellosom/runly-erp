import { createUserAccessService } from '../../services/user-access-service.js';
import { Prisma } from "@prisma/client";
import { signedUrlWithVariant } from "../../lib/image-variants.js";
import { ChatServiceError } from "./chat-service-error.js";
import { createChatConversationReadsService } from "./chat-conversation-reads-service.js";
import { createChatAttachmentsService } from "./chat-attachments-service.js";
import { buildReplyPreview } from "./chat-reply-preview.js";
import { assertNotMirai } from "./mirai-conversation-guard.js";
import { createChatConversationsWriteService } from "./chat-conversations-write-service.js";
import { createChatMessageSendService } from "./chat-message-send-service.js";

export { ChatServiceError };

// Supabase Storage signed URLs are valid for 3600s; cache them for 55 min so we
// never hit the VPS more than once per file per hour regardless of poll frequency.
const _signedUrlCache = new Map();
const SIGNED_URL_TTL_MS = 55 * 60 * 1000; // 55 minutes

function getCachedSignedUrl(bucket, objectKey, variant) {
  const key = `${bucket}:${objectKey}:${variant}`;
  const entry = _signedUrlCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.url;
  _signedUrlCache.delete(key);
  return null;
}

function setCachedSignedUrl(bucket, objectKey, variant, url) {
  _signedUrlCache.set(`${bucket}:${objectKey}:${variant}`, {
    url,
    expiresAt: Date.now() + SIGNED_URL_TTL_MS,
  });
}

// Exported so sibling chat services (chat-permissions-service.js,
// channel-directory-service.js) can resolve auth_user_id -> user_profile.id
// while rechecking enabled status on every request.
export async function resolveUserProfileId(prisma, authUserId) {


  const rows = await prisma.$queryRaw`
    SELECT id FROM user_profile WHERE auth_user_id = ${authUserId} AND enabled = true LIMIT 1
  `;
  if (!rows.length) throw new ChatServiceError("Usuario no encontrado.", 404);

  const profileId = rows[0].id;
  return profileId;
}

// Retained for older test fixtures; identity authorization is no longer cached.
export function _resetProfileIdCacheForTests() {}

export function createChatService({ prisma, supabaseAdmin, notificationService = null, broadcaster = null, permissionsService = null, mentionsService = null, entityReferencesService = null, channelLinksService = null }) {
  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  async function getUserProfileId(authUserId) {
    return resolveUserProfileId(prisma, authUserId);
  }

  async function notifyMembersAdded(conversation, actorId, userIds) {
    const recipients = [...new Set(userIds)].filter((id) => id !== actorId);
    if (!notificationService || !conversation?.company_id || !recipients.length ||
        !['channel', 'group'].includes(conversation.type)) return;
    try {
      await notificationService.publish({
        companyId: conversation.company_id,
        actorId,
        input: {
          eventType: 'chat.member.added',
          title: conversation.type === 'channel' ? 'Te agregaron a un canal' : 'Te agregaron a un grupo',
          body: `Ahora eres miembro de "${conversation.title || 'Chat'}"`.slice(0, 1000),
          link: `/app/m/runly.chat/chat/inbox/${conversation.id}`,
          recipients: { userIds: recipients },
          channels: ['in_app', 'email', 'web_push'],
          sourceType: 'chat_conversation',
          sourceId: conversation.id,
          metadata: {
            kind: 'chat_member_added',
            conversationId: conversation.id,
            conversationTitle: conversation.title ?? null,
            conversationType: conversation.type ?? null,
          },
        },
      });
    } catch (err) {
      console.error('[chat.member.added]', err?.message ?? err);
    }
  }

  async function assertMember(conversationId, userProfileId) {
    const rows = await prisma.$queryRaw`
      SELECT id FROM chat_conversation_members
      WHERE conversation_id = ${conversationId}
        AND user_id = ${userProfileId}
        AND left_at IS NULL
        AND public.runly_chat_user_access(conversation_id, user_id)
      LIMIT 1
    `;
    if (!rows.length) {
      throw new ChatServiceError("No eres miembro de esta conversacion.", 403);
    }
  }

  // assertNotMirai(prisma, conversationId, action) is shared from
  // ./mirai-conversation-guard.js — the 'mirai' chat cannot be renamed,
  // have its membership changed, or be deleted.

  // Only direct conversations can be blocked (spec Non-goal 2 — a block never
  // affects shared groups/channels). Checks both directions: either party
  // blocking the other stops messages both ways. `conversationType` is passed
  // in by the caller (sendMessage already needs it for the messages.send
  // permission check too) rather than queried here a second time.
  async function assertNotBlocked(conversationId, profileId, conversationType) {
    if (conversationType !== "direct") return;

    // The validator does not currently constrain type: "direct" conversations
    // to exactly one other member (pre-existing gap, out of scope here), so a
    // raw API call could in theory create one with 2+ other members. Fetch
    // ALL active other members (no LIMIT 1) and check the block relationship
    // against every one of them — checking only an arbitrarily-picked single
    // member would let a real block silently go unenforced depending on
    // Postgres's (unordered) row return order.
    const otherRows = await prisma.$queryRaw`
      SELECT user_id FROM chat_conversation_members
      WHERE conversation_id = ${conversationId} AND user_id != ${profileId} AND user_id IS NOT NULL AND left_at IS NULL
    `;
    if (!otherRows.length) return;

    const otherIds = otherRows.map((r) => r.user_id);
    const blocks = await prisma.$queryRaw`
      SELECT blocker_user_id, blocked_user_id FROM chat_blocks
      WHERE (blocker_user_id = ${profileId} AND blocked_user_id IN (${Prisma.join(otherIds)}))
         OR (blocked_user_id = ${profileId} AND blocker_user_id IN (${Prisma.join(otherIds)}))
      LIMIT 1
    `;
    if (blocks.length) {
      throw new ChatServiceError("No puedes enviar mensajes a este usuario.", 403);
    }
  }

  async function assertNotBlockedByTarget(profileId, targetUserId) {
    const blocks = await prisma.$queryRaw`
      SELECT blocker_user_id, blocked_user_id FROM chat_blocks
      WHERE (blocker_user_id = ${profileId} AND blocked_user_id = ${targetUserId})
         OR (blocker_user_id = ${targetUserId} AND blocked_user_id = ${profileId})
      LIMIT 1
    `;
    if (blocks.length) {
      throw new ChatServiceError("No puedes iniciar una conversacion con este usuario.", 403);
    }
  }

  // Restricts a set of candidate user_profile ids to those sharing at least one
  // enabled company Membership with actingProfileId — same cross-tenant guard
  // pattern as calendar-event-service.js's filterCompanyPeers. Without this,
  // createConversation/addMembers would trust a client-supplied user id as-is
  // and could add a user from a different company into a private conversation.
  // companyId: when passed (the conversation's/action's actual active
  // company, resolved by the caller), scopes strictly to that one company
  // instead of the union of every company actingProfileId belongs to — a
  // multi-company actor adding members to a conversation being created in
  // Company A must not be able to add a peer who only shares Company B with
  // them. Omitted, this keeps the old union-of-all-companies behavior for
  // any caller not yet passing it. See
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
  async function filterCompanyPeers(actingProfileId, candidateIds, companyId) {
    const ids = [...new Set((candidateIds ?? []).filter(Boolean))];
    if (ids.length === 0) return [];
    if (!companyId) throw new ChatServiceError("Recurso no encontrado o no disponible.", 404);
    const access = createUserAccessService({ prisma });
    await access.assertCompanyMember(companyId, actingProfileId.toString(), 'chat.conversations.read');
    return access.assertCandidates({ companyId, userIds: ids, permission: 'chat.conversations.read' });
  }

  // fileAsset rows for avatar files never change; cache them to avoid DB queries per poll
  const _fileAssetCache = new Map(); // fileId → { bucket, objectKey, expiresAt }
  const FILE_ASSET_TTL_MS = 30 * 60 * 1000; // 30 minutes

  async function batchSignAvatarUrls(fileIds) {
    if (!fileIds.length) return {};

    // Split into cache hits and misses
    const now = Date.now();
    const missIds = [];
    const assetMap = {};
    for (const id of fileIds) {
      const entry = _fileAssetCache.get(id);
      if (entry && entry.expiresAt > now) {
        assetMap[id] = entry;
      } else {
        missIds.push(id);
      }
    }

    if (missIds.length) {
      const rows = await prisma.fileAsset.findMany({
        where: { id: { in: missIds } },
        select: { id: true, bucket: true, objectKey: true },
      });
      for (const row of rows) {
        const entry = { bucket: row.bucket, objectKey: row.objectKey, expiresAt: now + FILE_ASSET_TTL_MS };
        _fileAssetCache.set(row.id, entry);
        assetMap[row.id] = entry;
      }
    }

    const result = {};
    await Promise.all(
      Object.entries(assetMap).map(async ([id, fa]) => {
        try {
          const cached = getCachedSignedUrl(fa.bucket, fa.objectKey, "thumb");
          if (cached) { result[id] = cached; return; }
          const signedUrl = await signedUrlWithVariant(supabaseAdmin, fa.bucket, fa.objectKey, "thumb");
          if (signedUrl) {
            setCachedSignedUrl(fa.bucket, fa.objectKey, "thumb", signedUrl);
            result[id] = signedUrl;
          }
        } catch {}
      }),
    );
    return result;
  }

  // Returns { "bucket:objectKey": signedUrl } for a list of { bucket, objectKey } pairs.
  async function batchSignAttachmentUrls(pairs) {
    if (!pairs.length) return {};
    const result = {};
    await Promise.all(
      pairs.map(async ({ bucket, objectKey }) => {
        const cacheKey = `${bucket}:${objectKey}`;
        try {
          const cached = getCachedSignedUrl(bucket, objectKey, "card");
          if (cached) { result[cacheKey] = cached; return; }
          const signedUrl = await signedUrlWithVariant(supabaseAdmin, bucket, objectKey, "card");
          if (signedUrl) {
            setCachedSignedUrl(bucket, objectKey, "card", signedUrl);
            result[cacheKey] = signedUrl;
          }
        } catch {}
      }),
    );
    return result;
  }

  // ------------------------------------------------------------------
  // Conversations
  // ------------------------------------------------------------------

  const conversationReadsService = createChatConversationReadsService({ prisma, getUserProfileId, assertMember, batchSignAvatarUrls });
  const { listConversations, archiveConversation, unarchiveConversation, pinConversation, hideConversation, getConversation, getMessageReceipt } = conversationReadsService;

  const conversationsWriteService = createChatConversationsWriteService({
    prisma,
    channelLinksService,
    permissionsService,
    notificationService,
    broadcaster,
    getUserProfileId,
    assertMember,
    filterCompanyPeers,
    assertNotBlockedByTarget,
    notifyMembersAdded,
    getConversation,
  });
  const { createConversation, updateConversation, deleteConversation, addMembers, removeMember } = conversationsWriteService;

  // ------------------------------------------------------------------
  // Internal: fetch a single message with sender + attachments joins
  // ------------------------------------------------------------------

  async function getMessageFull(messageId) {
    const rows = await prisma.$queryRaw`
      SELECT
        m.id, m.conversation_id, m.sender_user_id, m.sender_guest_id,
        m.sender_type, m.body, m.message_type, m.attachment_count,
        m.metadata, m.created_at, m.edited_at, m.deleted_at,
        m.pinned_at,
        m.pinned_by_user_id,
        m.thread_root_id,
        m.thread_reply_count,
        m.thread_last_reply_at,
        m.reply_to_message_id,
        json_build_object(
          'id', COALESCE(up.id, cg.id),
          'displayName', COALESCE(up.display_name, cg.display_name),
          'avatarFileId', up.avatar_file_id::text
        ) AS sender,
        (
          SELECT json_agg(json_build_object(
            'id', a.id,
            'fileName', a.file_name,
            'mimeType', a.mime_type,
            'sizeBytes', a.size_bytes,
            'durationMs', a.duration_ms,
            'width', a.width,
            'height', a.height,
            'objectKey', a.object_key,
            'bucket', a.bucket,
            'reactions', (
              SELECT json_agg(json_build_object('emoji', ar.emoji, 'userIds', ar.user_ids))
              FROM (
                SELECT emoji, json_agg(user_id) AS user_ids
                FROM chat_message_reactions
                WHERE attachment_id = a.id
                GROUP BY emoji
              ) ar
            )
          ) ORDER BY a.created_at)
          FROM chat_attachments a WHERE a.message_id = m.id
        ) AS attachments,
        -- reactions, grouped by emoji — message-level ONLY. Attachment-scoped
        -- reactions are nested inside each attachment object above instead,
        -- so a single reaction never shows up in both places.
        (
          SELECT json_agg(json_build_object('emoji', r.emoji, 'userIds', r.user_ids))
          FROM (
            SELECT emoji, json_agg(user_id) AS user_ids
            FROM chat_message_reactions
            WHERE message_id = m.id AND attachment_id IS NULL
            GROUP BY emoji
          ) r
        ) AS reactions
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      LEFT JOIN call_guest cg ON cg.id = m.sender_call_guest_id
      WHERE m.id = ${messageId}
      LIMIT 1
    `;
    if (!rows.length) return null;
    const m = rows[0];
    const avatarFileIds = m.sender?.avatarFileId ? [m.sender.avatarFileId] : [];
    const urlMap = avatarFileIds.length ? await batchSignAvatarUrls(avatarFileIds) : {};
    const replyMap = m.reply_to_message_id ? await fetchReplyPreviewRows([m]) : null;
    return {
      ...m,
      reply_to: m.reply_to_message_id
        ? buildReplyPreview(replyMap?.get(m.reply_to_message_id) ?? null)
        : null,
      sender: m.sender
        ? {
            ...m.sender,
            avatarUrl: m.sender.avatarFileId ? (urlMap[m.sender.avatarFileId] ?? null) : null,
            avatarFileId: undefined,
          }
        : m.sender,
    };
  }

  // Given message rows that may carry `reply_to_message_id`, fetch every
  // referenced original once and return a Map<id, previewRow> ready for
  // buildReplyPreview. One query regardless of page size.
  async function fetchReplyPreviewRows(rows) {
    const ids = [...new Set(rows.map((r) => r.reply_to_message_id).filter(Boolean))];
    if (!ids.length) return new Map();
    const previewRows = await prisma.$queryRaw`
      SELECT
        m.id,
        m.sender_user_id,
        m.body,
        m.message_type,
        m.deleted_at,
        up.display_name AS sender_name,
        (SELECT a.mime_type FROM chat_attachments a
           WHERE a.message_id = m.id ORDER BY a.created_at LIMIT 1) AS attachment_mime,
        (m.metadata ? 'entityRefs') AS has_entity_refs
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      WHERE m.id IN (${Prisma.join(ids)})
    `;
    const map = new Map();
    for (const pr of previewRows) map.set(pr.id, pr);
    return map;
  }

  // Attach `reply_to` (built preview or null) to each row and return the new
  // array. A deleted original still yields a preview object (isDeleted:true)
  // so the client can render "Mensaje eliminado".
  async function attachReplyPreviews(rows) {
    const map = await fetchReplyPreviewRows(rows);
    return rows.map((r) => ({
      ...r,
      reply_to: r.reply_to_message_id ? buildReplyPreview(map.get(r.reply_to_message_id) ?? null) : null,
    }));
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async function listMessages({ conversationId, authUserId, limit = 40, before = null, companyId = undefined }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);
    if (companyId !== undefined) {
      const [scope] = await prisma.$queryRaw`SELECT id FROM chat_conversations WHERE id = ${conversationId}::uuid AND company_id = ${companyId}::uuid`;
      if (!scope) throw new ChatServiceError('Recurso no disponible.', 404);
    }

    const rows = await prisma.$queryRaw`
      SELECT
        m.id,
        m.conversation_id,
        m.sender_user_id,
        m.sender_guest_id,
        m.sender_type,
        m.body,
        m.message_type,
        m.attachment_count,
        m.metadata,
        m.created_at,
        m.edited_at,
        m.deleted_at,
        m.pinned_at,
        m.pinned_by_user_id,
        m.thread_root_id,
        m.thread_reply_count,
        m.thread_last_reply_at,
        m.reply_to_message_id,
        -- sender info
        json_build_object(
          'id', COALESCE(up.id, cg.id),
          'displayName', COALESCE(up.display_name, cg.display_name),
          'avatarFileId', up.avatar_file_id::text
        ) AS sender,
        -- attachments
        (
          SELECT json_agg(json_build_object(
            'id', a.id,
            'fileName', a.file_name,
            'mimeType', a.mime_type,
            'sizeBytes', a.size_bytes,
            'durationMs', a.duration_ms,
            'width', a.width,
            'height', a.height,
            'objectKey', a.object_key,
            'bucket', a.bucket,
            'reactions', (
              SELECT json_agg(json_build_object('emoji', ar.emoji, 'userIds', ar.user_ids))
              FROM (
                SELECT emoji, json_agg(user_id) AS user_ids
                FROM chat_message_reactions
                WHERE attachment_id = a.id
                GROUP BY emoji
              ) ar
            )
          ) ORDER BY a.created_at)
          FROM chat_attachments a WHERE a.message_id = m.id
        ) AS attachments,
        -- reactions, grouped by emoji — message-level ONLY. Attachment-scoped
        -- reactions are nested inside each attachment object above instead,
        -- so a single reaction never shows up in both places.
        (
          SELECT json_agg(json_build_object('emoji', r.emoji, 'userIds', r.user_ids))
          FROM (
            SELECT emoji, json_agg(user_id) AS user_ids
            FROM chat_message_reactions
            WHERE message_id = m.id AND attachment_id IS NULL
            GROUP BY emoji
          ) r
        ) AS reactions
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      LEFT JOIN call_guest cg ON cg.id = m.sender_call_guest_id
      WHERE m.conversation_id = ${conversationId}
        AND m.thread_root_id IS NULL
        ${before ? Prisma.sql`AND m.created_at < ${new Date(before)}` : Prisma.empty}
      ORDER BY m.created_at DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const senderFileIds = [
      ...new Set(data.map((m) => m.sender?.avatarFileId).filter(Boolean)),
    ];

    // Collect unique attachment (bucket, objectKey) pairs across all messages
    const attachmentPairs = [];
    const seenAttachmentKeys = new Set();
    for (const m of data) {
      for (const a of m.attachments ?? []) {
        if (a.bucket && a.objectKey) {
          const k = `${a.bucket}:${a.objectKey}`;
          if (!seenAttachmentKeys.has(k)) {
            seenAttachmentKeys.add(k);
            attachmentPairs.push({ bucket: a.bucket, objectKey: a.objectKey });
          }
        }
      }
    }

    const [avatarUrlMap, attachmentUrlMap] = await Promise.all([
      senderFileIds.length ? batchSignAvatarUrls(senderFileIds) : Promise.resolve({}),
      attachmentPairs.length ? batchSignAttachmentUrls(attachmentPairs) : Promise.resolve({}),
    ]);

    const mapped = data.reverse().map((m) => ({
      ...m,
      attachments: (m.attachments ?? []).map((a) => ({
        ...a,
        url: attachmentUrlMap[`${a.bucket}:${a.objectKey}`] ?? null,
        objectKey: undefined,
        bucket: undefined,
      })),
      sender: m.sender
        ? {
            ...m.sender,
            avatarUrl: m.sender.avatarFileId
              ? (avatarUrlMap[m.sender.avatarFileId] ?? null)
              : null,
            avatarFileId: undefined,
          }
        : m.sender,
    }));

    const withReplies = await attachReplyPreviews(mapped);

    return {
      data: withReplies,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1]?.created_at?.toISOString() : null,
    };
  }

  const messageSendService = createChatMessageSendService({
    prisma,
    notificationService,
    broadcaster,
    permissionsService,
    mentionsService,
    entityReferencesService,
    getUserProfileId,
    assertMember,
    assertNotBlocked,
    getMessageFull,
  });
  const { sendMessage } = messageSendService;

  // Re-send the given messages (body + a copy of their attachments) into each
  // target conversation as fresh messages tagged metadata.forwardedFrom.
  // Delegates each (target, source) pair to sendMessage so notifications,
  // broadcast, last-message bump and the full-message shape all come for free.
  async function forwardMessages({ authUserId, messageIds, targetConversationIds }) {
    const profileId = await getUserProfileId(authUserId);

    const wantedIds = [...new Set(messageIds)];
    const sources = await prisma.$queryRaw`
      SELECT m.id, m.conversation_id, m.body, m.message_type, m.created_at,
             up.display_name AS sender_name
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      WHERE m.id = ANY(${wantedIds}::uuid[])
        AND m.deleted_at IS NULL
        AND m.message_type <> 'system'
        AND m.sender_type <> 'system'
    `;
    if (sources.length !== wantedIds.length) {
      throw new ChatServiceError("Mensaje no encontrado.", 404);
    }

    // Caller must belong to every source conversation (blocks forwarding a
    // message whose id was simply guessed) and — enforced by sendMessage's
    // own assertMember — to every target.
    const sourceConvIds = [...new Set(sources.map((s) => s.conversation_id))];
    for (const convId of sourceConvIds) {
      await assertMember(convId, profileId);
    }

    const ordered = [...sources].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    let forwarded = 0;
    for (const targetId of targetConversationIds) {
      for (const src of ordered) {
        await sendMessage({
          conversationId: targetId,
          authUserId,
          body: src.body ?? "",
          messageType: src.message_type ?? "text",
          metadata: {
            forwardedFrom: {
              conversationId: src.conversation_id,
              messageId: src.id,
              senderName: src.sender_name ?? null,
              at: new Date(src.created_at).toISOString(),
            },
          },
          cloneAttachmentsFrom: src.id,
        });
        forwarded += 1;
      }
    }

    return { forwarded };
  }

  async function editMessage({ messageId, authUserId, body }) {
    const profileId = await getUserProfileId(authUserId);

    const rows = await prisma.$queryRaw`
      SELECT m.*, ccm.user_id AS member_user_id
      FROM chat_messages m
      INNER JOIN chat_conversation_members ccm
        ON ccm.conversation_id = m.conversation_id AND ccm.user_id = ${profileId} AND ccm.left_at IS NULL
      WHERE m.id = ${messageId} AND m.deleted_at IS NULL AND m.sender_user_id = ${profileId}
      LIMIT 1
    `;
    if (!rows.length) throw new ChatServiceError("Mensaje no encontrado o sin permiso.", 403);

    const updated = await prisma.$queryRaw`
      UPDATE chat_messages
      SET body = ${body}, edited_at = NOW()
      WHERE id = ${messageId}
      RETURNING *
    `;
    return updated[0];
  }

  async function deleteMessage({ messageId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);

    const rows = await prisma.$queryRaw`
      SELECT id, thread_root_id FROM chat_messages
      WHERE id = ${messageId}
        AND sender_user_id = ${profileId}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new ChatServiceError("Mensaje no encontrado o sin permiso.", 403);

    await prisma.$executeRaw`
      UPDATE chat_messages SET deleted_at = NOW(), body = '' WHERE id = ${messageId}
    `;

    // Only a reply (thread_root_id set on its OWN row) decrements its root's
    // counter. A thread root's own row always has thread_root_id = NULL, even
    // when other messages point at it, so deleting a root never decrements
    // anything here — matches the data model in spec Section 10.
    if (rows[0].thread_root_id) {
      await prisma.$executeRaw`
        UPDATE chat_messages
        SET thread_reply_count = GREATEST(thread_reply_count - 1, 0)
        WHERE id = ${rows[0].thread_root_id}
      `;
    }

    return { ok: true };
  }

  // Removes ONE attachment from a message without touching the rest of it —
  // the message and its other attachments (if any) stay intact. If this was
  // the message's only attachment and there's nothing else left to show
  // (no body text, no entity refs), the whole message is soft-deleted
  // instead, matching what deleteMessage already does for a single-
  // attachment message (spec Section 12/Goal 5).
  async function pinMessage({ messageId, authUserId, pinned }) {
    const profileId = await getUserProfileId(authUserId);

    const rows = await prisma.$queryRaw`
      SELECT m.id, m.conversation_id, c.type AS conversation_type
      FROM chat_messages m
      INNER JOIN chat_conversation_members ccm
        ON ccm.conversation_id = m.conversation_id AND ccm.user_id = ${profileId} AND ccm.left_at IS NULL
      INNER JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.id = ${messageId} AND m.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new ChatServiceError("Mensaje no encontrado.", 404);
    const { conversation_id: conversationId, conversation_type: conversationType } = rows[0];

    if (permissionsService && (conversationType === "channel" || conversationType === "group")) {
      await permissionsService.assertChannelPermission(conversationId, profileId, "messages.pin");
    }

    await prisma.$executeRaw`
      UPDATE chat_messages
      SET pinned_at = ${pinned ? new Date() : null},
          pinned_by_user_id = ${pinned ? profileId : null}
      WHERE id = ${messageId}
    `;

    return getMessageFull(messageId);
  }

  async function listPinnedMessages({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);

    const rows = await prisma.$queryRaw`
      SELECT m.id FROM chat_messages m
      WHERE m.conversation_id = ${conversationId} AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL
      ORDER BY m.pinned_at DESC
    `;
    const messages = await Promise.all(rows.map((r) => getMessageFull(r.id)));
    return { data: messages.filter(Boolean) };
  }

  // Looks up messageId, resolves it to its thread root (auto-flattening a
  // reply-to-a-reply reference onto its own ancestor, same rule sendMessage
  // uses), then returns the root plus its replies in chronological order.
  // Mirrors listPinnedMessages' accepted N+1 getMessageFull-per-row pattern —
  // expected reply volumes per thread are small, so a second aggregation
  // strategy isn't warranted here.
  async function listThreadReplies({ messageId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);

    // Membership folded into the same query (rather than a separate
    // assertMember call) so a nonexistent message id and a message the
    // caller isn't a member of both produce the same 404 — same
    // non-leaking convention pinMessage already uses (spec Section 12).
    const targetRows = await prisma.$queryRaw`
      SELECT m.id, m.conversation_id, m.thread_root_id
      FROM chat_messages m
      INNER JOIN chat_conversation_members ccm
        ON ccm.conversation_id = m.conversation_id AND ccm.user_id = ${profileId} AND ccm.left_at IS NULL
      WHERE m.id = ${messageId}
      LIMIT 1
    `;
    if (!targetRows.length) throw new ChatServiceError("Mensaje no encontrado.", 404);
    const rootId = targetRows[0].thread_root_id ?? targetRows[0].id;

    const root = await getMessageFull(rootId);
    const replyRows = await prisma.$queryRaw`
      SELECT id FROM chat_messages
      WHERE thread_root_id = ${rootId}
      ORDER BY created_at ASC
    `;
    const replies = await Promise.all(replyRows.map((r) => getMessageFull(r.id)));

    return { root, replies: replies.filter(Boolean) };
  }

  async function markConversationRead({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);

    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET last_read_at = NOW()
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId}
    `;
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Attachments — presign/sign/delete live in chat-attachments-service.js
  // ------------------------------------------------------------------

  const attachmentsService = createChatAttachmentsService({
    prisma,
    supabaseAdmin,
    getUserProfileId,
    assertMember,
    getCachedSignedUrl,
    setCachedSignedUrl,
  });
  const { presignAttachmentUpload, getAttachmentSignedUrl, deleteAttachment } = attachmentsService;

  return {
    listConversations,
    archiveConversation,
    unarchiveConversation,
    pinConversation,
    hideConversation,
    createConversation,
    getConversation,
    getMessageReceipt,
    updateConversation,
    deleteConversation,
    addMembers,
    removeMember,
    listMessages,
    sendMessage,
    forwardMessages,
    editMessage,
    deleteMessage,
    deleteAttachment,
    pinMessage,
    listPinnedMessages,
    listThreadReplies,
    markConversationRead,
    presignAttachmentUpload,
    getAttachmentSignedUrl,
  };
}
