// apps/api/src/routes/chat/chat-message-send-service.js
//
// sendMessage: the single write path for posting a chat message (mentions
// resolution, entity-ref attachment, thread/reply resolution, attachment
// re-parenting/cloning, notification fan-out, and broadcaster push).
// Extracted from chat-service.js to keep that file under its documented
// 1000-line soft limit (sendMessage alone was ~384 lines), mirroring how
// chat-conversation-reads-service.js, chat-attachments-service.js and
// chat-conversations-write-service.js were already split out.
//
// Receives the shared prisma-backed closures (getUserProfileId, assertMember,
// assertNotBlocked) and the getMessageFull reader from createChatService
// rather than rebuilding its own — same instance, same caches. getMessageFull
// stays in chat-service.js because it is also used there directly by
// pinMessage/listPinnedMessages/listThreadReplies.
import { parseMentionIds, stripMentionTokens } from "../../lib/mention-utils.js";
import { ChatServiceError } from "./chat-service-error.js";

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

export function createChatMessageSendService({
  prisma,
  notificationService = null,
  broadcaster = null,
  permissionsService = null,
  mentionsService = null,
  entityReferencesService = null,
  getUserProfileId,
  assertMember,
  assertNotBlocked,
  getMessageFull,
}) {
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
                // Per-conversation, not per-message: notificationService.publish
                // collapses repeat unread chat.message.new notifications sharing
                // this key into a single updated row instead of one per message.
                dedupeKey: `chat.message.new:${conversationId}`,
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

  return { sendMessage };
}
