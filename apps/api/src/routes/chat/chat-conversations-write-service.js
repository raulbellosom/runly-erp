// apps/api/src/routes/chat/chat-conversations-write-service.js
//
// Conversation + membership WRITE operations: create / update / delete a
// conversation, add / remove members. Extracted from chat-service.js to keep
// that file under its documented 1500-line hard ceiling (it had reached 1595),
// mirroring how chat-conversation-reads-service.js and chat-attachments-service.js
// were already split out.
//
// Receives the shared prisma-backed closures (getUserProfileId, assertMember,
// filterCompanyPeers, assertNotBlockedByTarget, notifyMembersAdded) and the
// conversation-reads getConversation from createChatService rather than
// rebuilding its own — same instance, same caches.
import { Prisma } from "@prisma/client";
import { ChatServiceError } from "./chat-service-error.js";
import { assertNotMirai } from "./mirai-conversation-guard.js";

export function createChatConversationsWriteService({
  prisma,
  channelLinksService = null,
  permissionsService = null,
  notificationService = null,
  broadcaster = null,
  getUserProfileId,
  assertMember,
  filterCompanyPeers,
  assertNotBlockedByTarget,
  notifyMembersAdded,
  getConversation,
}) {
  // New conversations require the server-resolved active company; existing
  // resources use their own company and explicit participant grants.
  async function createConversation({ authUserId, type, title, memberUserIds, metadata = {}, isPublic = false, slug = null, description = null, linkedModule = null, linkedEntityId = null, companyId: requestedCompanyId = null }) {
    if (channelLinksService) channelLinksService.assertBothOrNeither(linkedModule, linkedEntityId);
    if (!requestedCompanyId) throw new ChatServiceError("Empresa activa requerida.", 400);
    const creatorProfileId = await getUserProfileId(authUserId);

    // Cross-tenant guard: a member id must share a company with the creator.
    // Without this, any caller could pass an arbitrary user_profile id (from
    // another company entirely) as memberUserIds and be silently added to a
    // conversation with them — the frontend picker is already company-scoped,
    // but the API must not trust that.
    const requestedMemberIds = [...new Set((memberUserIds ?? []).filter(Boolean))];
    const validMemberIds = await filterCompanyPeers(creatorProfileId, requestedMemberIds, requestedCompanyId);
    if (validMemberIds.length !== requestedMemberIds.length) {
      throw new ChatServiceError("Uno o mas usuarios no pertenecen a tu empresa.", 403);
    }
    memberUserIds = validMemberIds;
    if (type === "direct" && memberUserIds.length !== 1) throw new ChatServiceError("Selecciona un participante.", 400);

    // Prevent self-chat
    if (type === "direct" && memberUserIds.length === 1 && memberUserIds[0] === creatorProfileId.toString()) {
      throw new ChatServiceError("No puedes iniciar un chat contigo mismo.", 400);
    }

    // For direct conversations, enforce uniqueness (find existing)
    if (type === "direct" && memberUserIds.length === 1) {
      const otherId = memberUserIds[0];
      await assertNotBlockedByTarget(creatorProfileId, otherId);
      const existing = await prisma.$queryRaw`
        SELECT c.id FROM chat_conversations c
        WHERE c.type = 'direct'
          AND c.company_id = ${requestedCompanyId}
          AND c.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM chat_conversation_members WHERE conversation_id = c.id AND user_id = ${creatorProfileId} AND left_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM chat_conversation_members WHERE conversation_id = c.id AND user_id = ${otherId} AND left_at IS NULL
          )
        LIMIT 1
      `;
      if (existing.length) {
        return getConversation({ conversationId: existing[0].id, authUserId });
      }
    }

    // Same "find existing, return it" idempotency as above, applied to channel<->module links.
    if (linkedModule && linkedEntityId && channelLinksService) {
      const existing = await channelLinksService.findByLink(linkedModule, linkedEntityId);
      if (existing) return getConversation({ conversationId: existing.id, authUserId });
      await channelLinksService.assertLinkAvailable(linkedModule, linkedEntityId);
    }

    const companyId = requestedCompanyId;

    if (type === "channel" && slug) {
      // IS NOT DISTINCT FROM (not =) because company_id can be NULL for a creator
      // with no active membership — SQL's `NULL = NULL` is UNKNOWN, never TRUE, so
      // a plain `=` would silently let two NULL-company channels share a slug.
      const dupe = await prisma.$queryRaw`
        SELECT id FROM chat_conversations WHERE company_id IS NOT DISTINCT FROM ${companyId} AND slug = ${slug} AND deleted_at IS NULL LIMIT 1
      `;
      if (dupe.length) throw new ChatServiceError("Ya existe un canal con ese slug en tu empresa.", 400);
    }

    const convRows = await prisma.$queryRaw`
      INSERT INTO chat_conversations (type, title, created_by_user_id, company_id, is_public, slug, description, metadata, linked_module, linked_entity_id)
      VALUES (${type}, ${title ?? null}, ${creatorProfileId}, ${companyId}, ${isPublic}, ${slug}, ${description}, ${JSON.stringify(metadata)}::jsonb, ${linkedModule}, ${linkedEntityId})
      RETURNING *
    `;
    const conv = convRows[0];

    // Add creator as owner
    const allMembers = [creatorProfileId, ...memberUserIds.filter(id => id !== creatorProfileId)];
    for (const uid of allMembers) {
      const role = uid === creatorProfileId ? "owner" : "member";
      await prisma.$executeRaw`
        INSERT INTO chat_conversation_members (conversation_id, user_id, role)
        VALUES (${conv.id}, ${uid}, ${role})
        ON CONFLICT DO NOTHING
      `;
    }

    if ((type === "channel" || type === "group") && permissionsService) {
      // Transactional: a crash between seeding the roles and assigning the Owner
      // role would otherwise leave every member (including the creator) with
      // role_id NULL on a channel that already has 4 fully-formed role rows —
      // nobody, not even the nominal Owner, could then manage it (no reseed path).
      await prisma.$transaction(async (tx) => {
        const roleIds = await permissionsService.seedDefaultRoles(conv.id, tx);
        await tx.$executeRaw`
          UPDATE chat_conversation_members SET role_id = ${roleIds.Owner}
          WHERE conversation_id = ${conv.id} AND user_id = ${creatorProfileId}
        `;
        const otherIds = allMembers.filter((id) => id !== creatorProfileId);
        if (otherIds.length) {
          await tx.$executeRaw`
            UPDATE chat_conversation_members SET role_id = ${roleIds.Member}
            WHERE conversation_id = ${conv.id} AND user_id IN (${Prisma.join(otherIds)})
          `;
        }
      });
    }

    // System message: group created
    if (type === "group") {
      const [creatorUser] = await prisma.$queryRaw`
        SELECT display_name FROM user_profile WHERE id = ${creatorProfileId} LIMIT 1
      `;
      const systemBody = `${creatorUser?.display_name ?? "Un usuario"} creó el grupo`;
      await prisma.$executeRaw`
        INSERT INTO chat_messages (conversation_id, sender_type, body, message_type)
        VALUES (${conv.id}, 'system', ${systemBody}, 'system')
      `;
    }

    const newConv = await getConversation({ conversationId: conv.id, authUserId });

    if (broadcaster) {
      const memberIds = allMembers.map((id) => id.toString());
      broadcaster.broadcastToUsers(memberIds, "chat.conversation.new", {
        conversationId: conv.id,
      }).catch(() => {});
    }

    await notifyMembersAdded(conv, creatorProfileId, allMembers);
    return newConv;
  }

  async function updateConversation({ conversationId, authUserId, updates }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);
    await assertNotMirai(prisma, conversationId, "renombrar");

    if (permissionsService) {
      const [conv] = await prisma.$queryRaw`SELECT type FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
      if (conv && (conv.type === "channel" || conv.type === "group")) {
        await permissionsService.assertChannelPermission(conversationId, profileId, "channel.manage");
      }
    }
    if (channelLinksService) channelLinksService.assertBothOrNeither(updates.linkedModule, updates.linkedEntityId);

    const hasTitle = updates.title !== undefined;
    const hasStatus = updates.status !== undefined;
    const hasAvatarFileId = updates.avatarFileId !== undefined;
    const hasAvatarEmoji = updates.avatarEmoji !== undefined;
    const hasDescription = updates.description !== undefined;

    if (!hasTitle && !hasStatus && !hasAvatarFileId && !hasAvatarEmoji && !hasDescription && updates.linkedModule === undefined) {
      return getConversation({ conversationId, authUserId });
    }

    // Mutual exclusivity: setting a real (non-null) avatar of one kind clears
    // the other kind, even if the caller didn't explicitly touch it — a
    // conversation has at most one avatar source at a time. Explicitly
    // clearing one (sending null) does NOT touch the other — a "remove both"
    // action must send both fields as null itself (spec Section 23 edge case 1).
    // If a caller sends both as real (non-null) values in the same request,
    // avatarFileId wins and the emoji is discarded — an `if`, not parallel
    // handling, so this branch always fires first when both are present.
    let nextAvatarFileId = updates.avatarFileId;
    let nextAvatarEmoji = updates.avatarEmoji;
    let touchAvatarFileId = hasAvatarFileId;
    let touchAvatarEmoji = hasAvatarEmoji;
    if (hasAvatarFileId && nextAvatarFileId !== null) {
      nextAvatarEmoji = null;
      touchAvatarEmoji = true;
    } else if (hasAvatarEmoji && nextAvatarEmoji !== null) {
      nextAvatarFileId = null;
      touchAvatarFileId = true;
    }

    const sets = [Prisma.sql`updated_at = NOW()`];
    if (hasTitle) sets.push(Prisma.sql`title = ${updates.title}`);
    if (hasStatus) sets.push(Prisma.sql`status = ${updates.status}`);
    if (touchAvatarFileId) sets.push(Prisma.sql`avatar_file_id = ${nextAvatarFileId}`);
    if (touchAvatarEmoji) sets.push(Prisma.sql`avatar_emoji = ${nextAvatarEmoji}`);
    if (hasDescription) sets.push(Prisma.sql`description = ${updates.description}`);
    if (channelLinksService) sets.push(...(await channelLinksService.applyLinkUpdate(updates, conversationId)));

    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET ${Prisma.join(sets, ", ")}
      WHERE id = ${conversationId}
    `;

    return getConversation({ conversationId, authUserId });
  }

  // Permanently removes a channel/group for every member — gated on
  // channel.manage (Owner + Admin by default), same tier as updateConversation's
  // other channel-level changes. Scoped to channel/group only: direct/
  // external_support already have their own "leave"/block-based exits and no
  // roles to gate this against. Soft-delete (deleted_at) matches the existing
  // convention every read already filters on (getConversation, listConversations,
  // channel-directory-service) — no cascade needed, messages/members just become
  // permanently unreachable through those filters.
  async function deleteConversation({ conversationId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);
    await assertNotMirai(prisma, conversationId, "eliminar");

    const [conv] = await prisma.$queryRaw`
      SELECT type FROM chat_conversations WHERE id = ${conversationId} AND deleted_at IS NULL LIMIT 1
    `;
    if (!conv) throw new ChatServiceError("Conversacion no encontrada.", 404);
    if (conv.type !== "channel" && conv.type !== "group") {
      throw new ChatServiceError("Solo se pueden eliminar canales o grupos.", 400);
    }

    let memberIds = [];
    if (permissionsService) {
      await permissionsService.assertChannelPermission(conversationId, profileId, "channel.manage");
    }
    if (broadcaster) {
      const memberRows = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members WHERE conversation_id = ${conversationId} AND left_at IS NULL
      `;
      memberIds = memberRows.map((r) => r.user_id.toString());
    }

    await prisma.$executeRaw`
      UPDATE chat_conversations SET deleted_at = NOW() WHERE id = ${conversationId}
    `;

    if (broadcaster && memberIds.length) {
      broadcaster.broadcastToUsers(memberIds, "chat.conversation.deleted", { conversationId }).catch(() => {});
    }

    return { ok: true };
  }

  async function addMembers({ conversationId, authUserId, userIds, role = "member" }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);
    await assertNotMirai(prisma, conversationId, "agregar miembros a");

    if (permissionsService) {
      const [conv] = await prisma.$queryRaw`SELECT type FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
      if (conv && (conv.type === "channel" || conv.type === "group")) {
        await permissionsService.assertChannelPermission(conversationId, profileId, "members.manage");
      }
    }

    // Same cross-tenant guard as createConversation — reject any userId that
    // doesn't share a company with the caller rather than silently adding a
    // foreign-company user to this conversation. Scoped to THIS conversation's
    // own company (not the caller's full membership union) — a multi-company
    // member adding people to a Company A channel must not be able to pull in
    // someone who only shares Company B with them.
    const [convCompanyRow] = await prisma.$queryRaw`
      SELECT company_id AS "companyId" FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
    `;
    const requestedUserIds = [...new Set((userIds ?? []).filter(Boolean))];
    const validUserIds = await filterCompanyPeers(profileId, requestedUserIds, convCompanyRow?.companyId ?? null);
    if (validUserIds.length !== requestedUserIds.length) {
      throw new ChatServiceError("Uno o mas usuarios no pertenecen a tu empresa.", 403);
    }

    const results = [];
    for (const uid of validUserIds) {
      // The unique index on (conversation_id, user_id) is partial
      // (WHERE user_id IS NOT NULL AND left_at IS NULL). Postgres only accepts a
      // partial index as an ON CONFLICT arbiter when the clause repeats that
      // predicate — without it every call raises 42P10 ("no unique or exclusion
      // constraint matching the ON CONFLICT specification") and the whole add
      // returns 500. A previously-left member is not in the partial index, so it
      // does not conflict and simply gets a fresh active row.
      const inserted = await prisma.$executeRaw`
        INSERT INTO chat_conversation_members (conversation_id, user_id, role)
        VALUES (${conversationId}, ${uid}, ${role})
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

      // System message
      const [newUser] = await prisma.$queryRaw`
        SELECT display_name FROM user_profile WHERE id = ${uid} LIMIT 1
      `;
      if (newUser) {
        await prisma.$executeRaw`
          INSERT INTO chat_messages (conversation_id, sender_type, body, message_type, sender_user_id)
          VALUES (${conversationId}, 'system', ${`${newUser.display_name} se unió al grupo`}, 'system', ${profileId})
        `;
      }
      results.push(uid);
    }
    if (results.length && notificationService) {
      try {
        const [conversation] = await prisma.$queryRaw`
          SELECT id, company_id, type, title FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
        `;
        await notifyMembersAdded(conversation, profileId, results);
      } catch (err) {
        console.error('[chat.member.added]', err?.message ?? err);
      }
    }
    if (results.length && broadcaster) {
      await broadcaster.broadcastToUsers(results, 'chat.conversation.new', { conversationId }).catch(() => {});
    }
    return { added: results };
  }

  async function removeMember({ conversationId, authUserId, targetUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);
    await assertNotMirai(prisma, conversationId, "quitar miembros de");

    if (permissionsService) {
      const isLast = await permissionsService.isLastOwner(conversationId, targetUserId);
      if (isLast) {
        throw new ChatServiceError("No puedes eliminar al unico Owner de la conversacion. Asigna otro Owner primero.", 400);
      }

      // Removing someone ELSE requires members.manage + outranking them. Leaving
      // a conversation on your own (targetUserId === profileId) is always allowed
      // — it is not a "manage members" action — and must skip this block entirely,
      // with no permission check at all, exactly like before this fix.
      if (targetUserId !== profileId) {
        const [conv] = await prisma.$queryRaw`SELECT type FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
        if (conv && (conv.type === "channel" || conv.type === "group")) {
          const actorRole = await permissionsService.assertChannelPermission(conversationId, profileId, "members.manage");
          const targetRole = await permissionsService.getMemberRole(conversationId, targetUserId);
          // Default to the base Member floor (0), not below it — a role_id-less
          // member (only reachable via the already-documented Member-role-deletion
          // gap) should be exactly as protected as a normal Member, not less.
          const targetPosition = targetRole?.position ?? 0;
          if (actorRole.position <= targetPosition) {
            throw new ChatServiceError("No puedes eliminar a un miembro de rango igual o mayor al tuyo.", 403);
          }
        }
      }
    }

    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET left_at = NOW()
      WHERE conversation_id = ${conversationId}
        AND user_id = ${targetUserId}
        AND left_at IS NULL
    `;

    const [removedUser] = await prisma.$queryRaw`
      SELECT display_name FROM user_profile WHERE id = ${targetUserId} LIMIT 1
    `;
    if (removedUser) {
      await prisma.$executeRaw`
        INSERT INTO chat_messages (conversation_id, sender_type, body, message_type, sender_user_id)
        VALUES (${conversationId}, 'system', ${`${removedUser.display_name} salió del grupo`}, 'system', ${profileId})
      `;
    }

    return { ok: true };
  }

  return { createConversation, updateConversation, deleteConversation, addMembers, removeMember };
}
