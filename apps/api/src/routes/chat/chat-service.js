import { createUserAccessService } from '../../services/user-access-service.js';
import { Prisma } from "@prisma/client";
import { signedUrlWithVariant } from "../../lib/image-variants.js";
import { parseMentionIds, stripMentionTokens } from "../../lib/mention-utils.js";
import { ChatServiceError } from "./chat-service-error.js";
import { createChatConversationReadsService } from "./chat-conversation-reads-service.js";
import { createChatAttachmentsService } from "./chat-attachments-service.js";
import { buildReplyPreview } from "./chat-reply-preview.js";
import { assertNotMirai } from "./mirai-conversation-guard.js";
import { createChatConversationsWriteService } from "./chat-conversations-write-service.js";

export { ChatServiceError };

// Supabase Storage signed URLs are valid for 3600s; cache them for 55 min so we
// never hit the VPS more than once per file per hour regardless of poll frequency.
const _signedUrlCache = new Map();
const SIGNED_URL_TTL_MS = 55 * 60 * 1000; // 55 minutes

// Chat-message email is NOT sent per message — only as a "you're missing
// messages" nudge, the way Meet / Teams do it. These windows are product
// behavior, not configuration:
//   - the recipient must have had no read/activity in the conversation for
//     CHAT_EMAIL_AWAY_MS, and
//   - at most one such email per conversation per recipient within
//     CHAT_EMAIL_THROTTLE_MS (also re-armed the moment they open it).
// CHAT_EMAIL_THROTTLE_MS must stay in sync with CHAT_MAIL_THROTTLE_MS in
// notification-service.js (the publish-layer dedupe for `chat.mail:` keys).
const CHAT_EMAIL_AWAY_MS = 2 * 60 * 60 * 1000; // 2 hours
const CHAT_EMAIL_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  // Which of `candidateIds` should get an EMAIL for a plain chat message right
  // now. Email is deliberately not per-message: a recipient qualifies only when
  //   - they have no recent read of this conversation (away >= CHAT_EMAIL_AWAY_MS),
  //   - they have not themselves sent a message here in that same window, and
  //   - no chat email for this conversation reached them within CHAT_EMAIL_THROTTLE_MS.
  // The publish layer additionally dedupes on `chat.mail:<conv>:<user>` so the
  // throttle also resets the moment they open the conversation (mark-read).
  async function resolveChatEmailRecipients({ conversationId, candidateIds, now = new Date() }) {
    const ids = [...new Set((candidateIds ?? []).map((id) => id?.toString()).filter(Boolean))];
    if (!ids.length) return [];
    const awaySince = new Date(now.getTime() - CHAT_EMAIL_AWAY_MS);
    const throttleSince = new Date(now.getTime() - CHAT_EMAIL_THROTTLE_MS);
    const rows = await prisma.$queryRaw`
      SELECT m.user_id
      FROM chat_conversation_members m
      WHERE m.conversation_id = ${conversationId}
        AND m.left_at IS NULL
        AND m.user_id = ANY(${ids}::uuid[])
        AND (m.last_read_at IS NULL OR m.last_read_at < ${awaySince})
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages sent
          WHERE sent.conversation_id = ${conversationId}
            AND sent.sender_user_id = m.user_id
            AND sent.created_at >= ${awaySince}
        )
        AND NOT EXISTS (
          SELECT 1 FROM notification n
          JOIN notification_delivery d ON d.notification_id = n.id
          WHERE n.user_id = m.user_id
            AND n.source_type = 'chat_conversation'
            AND n.source_id::text = ${conversationId}
            AND d.channel = 'email'
            AND n.created_at >= ${throttleSince}
        )
    `;
    return rows.map((r) => r.user_id.toString());
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

  async function updateConversationLastMessage(conversationId, messageId, createdAt) {
    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET last_message_id = ${messageId},
          last_message_at = ${createdAt},
          updated_at = NOW()
      WHERE id = ${conversationId}
    `;
    // A new message resurfaces the conversation for anyone who "deleted" (hid)
    // it from their list — WhatsApp behaviour. Archived / muted / pinned state
    // is deliberately left untouched.
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET hidden_at = NULL
      WHERE conversation_id = ${conversationId} AND hidden_at IS NOT NULL
    `;
  }

  async function getConversationMemberIds(conversationId) {
    const rows = await prisma.$queryRaw`
      SELECT user_id FROM chat_conversation_members
      WHERE conversation_id = ${conversationId} AND left_at IS NULL AND user_id IS NOT NULL
    `;
    return rows.map((r) => r.user_id.toString());
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
          'id', up.id,
          'displayName', up.display_name,
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
          'id', up.id,
          'displayName', up.display_name,
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

  async function sendMessage({ conversationId, authUserId, body, messageType = "text", metadata = {}, attachmentIds = [], threadRootId = null, entityRefs = [], replyToMessageId = null, cloneAttachmentsFrom = null }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);

    const [convRow] = await prisma.$queryRaw`SELECT type, title FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
    const conversationType = convRow?.type ?? null;
    const conversationTitle = convRow?.title ?? null;
    await assertNotBlocked(conversationId, profileId, conversationType);

    // Validate the quoted message (WhatsApp-style inline reply): must exist,
    // not be soft-deleted, and live in THIS conversation — a quote never
    // crosses conversations (the client only ever offers reply within the
    // open conversation). Independent of threadRootId: a thread reply may
    // also quote another message, so both columns can be set.
    let resolvedReplyToId = null;
    if (replyToMessageId) {
      const [replyTarget] = await prisma.$queryRaw`
        SELECT id, conversation_id, deleted_at
        FROM chat_messages
        WHERE id = ${replyToMessageId}
        LIMIT 1
      `;
      if (!replyTarget || replyTarget.conversation_id !== conversationId || replyTarget.deleted_at) {
        throw new ChatServiceError("No se puede responder a ese mensaje.", 400);
      }
      resolvedReplyToId = replyToMessageId;
    }

    // messages.send is a real, editable permission (RoleEditorDialog already
    // exposes an "Enviar mensajes" checkbox) but was never actually enforced
    // here — every default role happens to grant it, so this only starts
    // rejecting sends once an Owner/Admin explicitly revokes it from a role
    // (e.g. an announcements-only channel). Same conv-type gate pattern as
    // updateConversation/removeMember: direct/external_support conversations
    // have no roles, so skip the check entirely for them.
    if (permissionsService && (conversationType === "channel" || conversationType === "group")) {
      await permissionsService.assertChannelPermission(conversationId, profileId, "messages.send");
    }

    // Resolve threadRootId: validate it exists, belongs to this conversation,
    // isn't soft-deleted, and auto-flatten a reply-to-a-reply onto its own
    // root (spec Non-goal 1 — threads are one level deep, replying to a
    // reply silently redirects to that reply's own root instead of erroring
    // or creating a nested thread).
    let resolvedThreadRootId = null;
    if (threadRootId) {
      // Threads are scoped to channel/group conversations only (spec
      // Non-goal 3) — the UI never offers "Responder en hilo" outside those
      // types, but that's a client-side gate; enforce it here too so a
      // direct API call can't create a thread reply in a direct/
      // external_support conversation, where it would silently vanish from
      // that conversation's timeline (listMessages filters thread_root_id
      // IS NOT NULL out) with no thread UI able to surface it there.
      const targetRows = await prisma.$queryRaw`
        SELECT m.id, m.conversation_id, m.thread_root_id, m.deleted_at, c.type AS conversation_type
        FROM chat_messages m
        INNER JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE m.id = ${threadRootId} AND m.deleted_at IS NULL
        LIMIT 1
      `;
      if (
        !targetRows.length ||
        targetRows[0].conversation_id !== conversationId ||
        (targetRows[0].conversation_type !== "channel" && targetRows[0].conversation_type !== "group")
      ) {
        throw new ChatServiceError("Mensaje no encontrado.", 404);
      }
      resolvedThreadRootId = targetRows[0].thread_root_id ?? targetRows[0].id;
    }

    // Cheap regex scan first — skips the sender-role lookup + resolution queries
    // entirely for the common case (no @ tokens at all, e.g. every direct/
    // external_support message and most channel/group messages too).
    let mentionResult = { userIds: [], roleIds: [], everyone: false, here: false, notifyUserIds: [] };
    if (mentionsService && parseMentionIds(body).length) {
      try {
        const senderRole = permissionsService ? await permissionsService.getMemberRole(conversationId, profileId) : null;
        mentionResult = await mentionsService.resolveMentions({ conversationId, senderProfileId: profileId, body, senderRole });
      } catch (err) {
        if (err?.status === 404) throw err;
        // A malformed-but-regex-matching mention token (e.g. one that fails
        // Postgres's uuid parser) must never block sending the message itself —
        // degrade to "no mentions resolved" instead of failing the whole request.
        console.error("[runly.chat] mention resolution failed, sending without mentions", err?.message ?? err);
      }
    }
    const hasMentions = mentionResult.userIds.length || mentionResult.roleIds.length || mentionResult.everyone || mentionResult.here;
    let finalMetadata = hasMentions
      ? { ...metadata, mentions: { userIds: mentionResult.userIds, roleIds: mentionResult.roleIds, everyone: mentionResult.everyone, here: mentionResult.here } }
      : metadata;

    // Cross-module entity references (Phase F). Only when the caller actually
    // sends entityRefs — the overwhelmingly common plain-text send pays no
    // extra query or service call here at all. Reject the whole send for an
    // external_support conversation BEFORE attempting any resolution (defense
    // in depth: a guest-facing conversation must never expose a clickable
    // link to an internal record, even via a stray direct API call bypassing
    // the composer's hidden button — spec Non-goal 3 / edge case 4). This is
    // a fresh conversation-type lookup rather than reusing the threadRootId
    // block's query above, since that one only runs when threadRootId is set.
    if (entityRefs?.length) {
      const [convRow] = await prisma.$queryRaw`SELECT type, company_id FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
      if (convRow?.type === "external_support") {
        throw new ChatServiceError("No se pueden adjuntar referencias en conversaciones de soporte externo.", 400);
      }
      if (entityReferencesService) {
        const resolvedEntityRefs = await entityReferencesService.resolveEntityRefs({ authUserId, companyId: convRow?.company_id, entityRefs });
        if (resolvedEntityRefs.length) {
          finalMetadata = { ...finalMetadata, entityRefs: resolvedEntityRefs };
        }
      }
    }

    // `cloneAttachmentsFrom` (forwardMessages) re-parents a copy of another
    // message's attachment rows onto this one — the count has to come from
    // that source, not the (empty) attachmentIds a forward passes.
    let attachmentCount = attachmentIds.length;
    if (cloneAttachmentsFrom) {
      const [countRow] = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS n FROM chat_attachments WHERE message_id = ${cloneAttachmentsFrom}
      `;
      attachmentCount = countRow?.n ?? 0;
    }

    let msg;
    if (resolvedThreadRootId) {
      // Insert + root counter-increment must not diverge (reply inserted but
      // counter update fails, or vice versa) — wrap both in a transaction.
      [msg] = await prisma.$transaction(async (tx) => {
        const inserted = await tx.$queryRaw`
          INSERT INTO chat_messages (conversation_id, sender_user_id, sender_type, body, message_type, attachment_count, metadata, thread_root_id, reply_to_message_id)
          VALUES (
            ${conversationId}, ${profileId}, 'user', ${body}, ${messageType}, ${attachmentCount},
            ${JSON.stringify(finalMetadata)}::jsonb, ${resolvedThreadRootId}, ${resolvedReplyToId}
          )
          RETURNING *
        `;
        await tx.$executeRaw`
          UPDATE chat_messages
          SET thread_reply_count = thread_reply_count + 1,
              thread_last_reply_at = ${inserted[0].created_at}
          WHERE id = ${resolvedThreadRootId}
        `;
        return inserted;
      });
    } else {
      const msgRows = await prisma.$queryRaw`
        INSERT INTO chat_messages (conversation_id, sender_user_id, sender_type, body, message_type, attachment_count, metadata, reply_to_message_id)
        VALUES (
          ${conversationId},
          ${profileId},
          'user',
          ${body},
          ${messageType},
          ${attachmentCount},
          ${JSON.stringify(finalMetadata)}::jsonb,
          ${resolvedReplyToId}
        )
        RETURNING *
      `;
      msg = msgRows[0];
    }

    if (cloneAttachmentsFrom) {
      // Forward: copy the source message's attachment rows onto this one,
      // reusing bucket/object_key (the storage object is never deleted, so
      // sharing it across messages is safe) and re-owning them to the sender.
      await prisma.$executeRaw`
        INSERT INTO chat_attachments
          (message_id, conversation_id, bucket, object_key, file_name, mime_type, size_bytes, duration_ms, width, height, uploaded_by_user_id)
        SELECT ${msg.id}, ${conversationId}, bucket, object_key, file_name, mime_type, size_bytes, duration_ms, width, height, ${profileId}
        FROM chat_attachments
        WHERE message_id = ${cloneAttachmentsFrom}
      `;
    } else if (attachmentIds.length) {
      await prisma.$executeRaw`
        UPDATE chat_attachments
        SET message_id = ${msg.id}
        WHERE id = ANY(${attachmentIds}::uuid[])
          AND uploaded_by_user_id = ${profileId}
      `;
    }

    if (!resolvedThreadRootId) {
      await updateConversationLastMessage(conversationId, msg.id, msg.created_at);
    }

    // Fetch full message with sender + attachments joins before returning
    const fullMsg = await getMessageFull(msg.id);

    // Notify other members (fire-and-forget — don't fail the send on notification error)
    if (notificationService) {
      setImmediate(async () => {
        try {
          // The conversation's own company, not re-derived from the
          // sender's memberships — a multi-company sender's "most recently
          // created membership" is not necessarily this conversation's
          // company. See
          // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
          const [conversationRow] = await prisma.$queryRaw`
            SELECT company_id AS "companyId" FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
          `;
          const companyId = conversationRow?.companyId;
          if (!companyId) return;

          const otherMembers = await prisma.$queryRaw`
            SELECT user_id
            FROM chat_conversation_members
            WHERE conversation_id = ${conversationId}
              AND user_id != ${profileId}
              AND left_at IS NULL
          `;
          if (!otherMembers.length) return;

          const mentionedSet = new Set(mentionResult.notifyUserIds);
          const recipientIds = otherMembers
            .map((m) => m.user_id.toString())
            .filter((id) => !mentionedSet.has(id));
          // Notification previews render as plain text — turn the stored
          // @[uuid:Name] mention tokens into "@Name" so a raw UUID (e.g. the
          // all-zero MirAI sentinel) never surfaces in a push/email.
          const previewSource = stripMentionTokens(body);
          const preview = previewSource.length > 80 ? `${previewSource.slice(0, 80)}...` : previewSource;
          const emailPreview = previewSource.length > 280 ? `${previewSource.slice(0, 280)}…` : previewSource;
          const senderName = fullMsg?.sender?.displayName ?? "Alguien";
          const isNamedRoom =
            (conversationType === "channel" || conversationType === "group") &&
            Boolean(conversationTitle);

          // One email-only notification per eligible recipient (see
          // resolveChatEmailRecipients). Never per message: gated by away-time
          // and a per-conversation throttle, and additionally deduped on
          // `chat.mail:<conv>:<user>` by the publish layer.
          async function sendChatEmails(candidateIds, kind) {
            let emailIds = [];
            try {
              emailIds = await resolveChatEmailRecipients({ conversationId, candidateIds });
            } catch (err) {
              // Email eligibility is best-effort — a failure here must never
              // block the in-app / push notifications or the mention fan-out.
              console.error("[chat.mail]", err?.message ?? err);
              return;
            }
            for (const uid of emailIds) {
              await notificationService.publish({
                companyId,
                actorId: profileId,
                // Eligibility already decided by resolveChatEmailRecipients —
                // send unless the recipient has an explicit email opt-out.
                respectChannelDefaults: false,
                input: {
                  eventType: kind === "chat_thread_reply" ? "chat.thread.reply" : "chat.message.new",
                  title: isNamedRoom
                    ? `${senderName} · ${conversationTitle}`
                    : `Nuevo mensaje de ${senderName}`,
                  body: emailPreview,
                  link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
                  recipients: { userIds: [uid] },
                  channels: ["email"],
                  priority: "medium",
                  sourceType: "chat_conversation",
                  sourceId: conversationId,
                  dedupeKey: `chat.mail:${conversationId}:${uid}`,
                  metadata: {
                    kind,
                    conversationId,
                    conversationTitle: conversationTitle ?? null,
                    conversationType: conversationType ?? null,
                    senderName,
                    senderId: profileId.toString(),
                    snippet: emailPreview,
                  },
                },
              }).catch((err) => console.error("[chat.mail]", err?.message ?? err));
            }
          }

          if (resolvedThreadRootId) {
            // Thread replies never fan out chat.message.new to the whole
            // channel (spec Section 8 Goal 4) — only the root author + prior
            // repliers are notified via chat.thread.reply, minus anyone who's
            // already getting chat.mention.new below (same precedence rule
            // applied to the non-thread path above).
            const participantRows = await prisma.$queryRaw`
              SELECT DISTINCT sender_user_id FROM chat_messages
              WHERE (id = ${resolvedThreadRootId} OR thread_root_id = ${resolvedThreadRootId})
                AND sender_user_id IS NOT NULL
                AND sender_user_id != ${profileId}
            `;
            // Thread participation is derived from message history (who's
            // ever posted in this thread), which can include someone who has
            // since left the conversation — otherMembers (above) is already
            // scoped to currently-active members (left_at IS NULL), so
            // intersect against it rather than notifying a former member.
            const activeMemberIds = new Set(otherMembers.map((m) => m.user_id.toString()));
            const threadRecipientIds = participantRows
              .map((r) => r.sender_user_id.toString())
              .filter((id) => activeMemberIds.has(id) && !mentionedSet.has(id));
            if (threadRecipientIds.length) {
              await notificationService.publish({
                companyId,
                actorId: profileId,
                input: {
                  eventType: "chat.thread.reply",
                  title: "Nueva respuesta en un hilo",
                  body: preview,
                  link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
                  recipients: { userIds: threadRecipientIds },
                  channels: ["in_app", "web_push"],
                  priority: "medium",
                  sourceType: "chat_conversation",
                  sourceId: conversationId,
                  dedupeKey: `chat.thread.reply:${msg.id}`,
                },
              });
              await sendChatEmails(threadRecipientIds, "chat_thread_reply");
            }
          } else if (recipientIds.length) {
            await notificationService.publish({
              companyId,
              actorId: profileId,
              input: {
                eventType: "chat.message.new",
                title: "Nuevo mensaje de chat",
                body: preview,
                link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
                recipients: { userIds: recipientIds },
                channels: ["in_app", "web_push"],
                priority: "medium",
                sourceType: "chat_conversation",
                sourceId: conversationId,
                dedupeKey: `chat.message.new:${msg.id}`,
              },
            });
            await sendChatEmails(recipientIds, "chat_message");
          }

          if (mentionResult.notifyUserIds.length) {
            await notificationService.publish({
              companyId,
              actorId: profileId,
              input: {
                eventType: "chat.mention.new",
                title: `Te mencionó ${senderName}`,
                body: preview,
                link: `/app/m/runly.chat/chat/inbox/${conversationId}`,
                recipients: { userIds: mentionResult.notifyUserIds },
                channels: ["in_app", "email", "web_push"],
                priority: "high",
                sourceType: "chat_conversation",
                sourceId: conversationId,
                dedupeKey: `chat.mention.new:${msg.id}`,
                metadata: {
                  kind: "chat_mention",
                  conversationId,
                  conversationTitle: conversationTitle ?? null,
                  conversationType: conversationType ?? null,
                  senderName,
                  senderId: profileId.toString(),
                  snippet: emailPreview,
                },
              },
            });
          }
        } catch (err) {
          console.error("[chat.notification]", err?.message ?? err);
        }
      });
    }

    if (broadcaster) {
      const memberIds = await getConversationMemberIds(conversationId).catch(() => []);
      broadcaster.broadcastToUsers(memberIds, "chat.message.new", {
        conversationId,
        messageId: msg.id,
        senderId: profileId.toString(),
        senderName: fullMsg?.sender?.displayName ?? null,
        threadRootId: resolvedThreadRootId,
        replyToMessageId: resolvedReplyToId,
      }).catch(() => {});
    }

    return fullMsg ?? msg;
  }

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
