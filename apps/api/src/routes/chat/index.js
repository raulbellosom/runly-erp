import { UserAccessError } from '../../services/user-access-service.js';
import { withResourceInvitationAccess } from '../../services/resource-invitation-access.js';
import crypto from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  chatCreateConversationSchema,
  chatSendMessageSchema,
  chatEditMessageSchema,
  chatUpdateConversationSchema,
  chatAddMembersSchema,
  chatPresignAttachmentSchema,
  chatGuestSessionSchema,
  chatGuestMessageSchema,
  chatAssignOperatorSchema,
  chatCreateChannelSchema,
  chatCreateChannelRoleSchema,
  chatUpdateChannelRoleSchema,
  chatAssignMemberRoleSchema,
  chatPinMessageSchema,
  chatPinConversationSchema,
  chatToggleReactionSchema,
  chatMessageSearchQuerySchema,
} from "@runly/validators";
import { createChatService, ChatServiceError, resolveUserProfileId } from "./chat-service.js";
import { createMiraiService } from "./mirai-service.js";
import { createMiraiTtsService } from "./mirai-tts-service.js";
import { createCallTranscriptService } from "../calls/call-transcript-service.js";
import { createMiraiRoutes } from "./mirai-routes.js";
import { createVisionService } from "../../services/vision-service.js";
import { createChatExternalInboxService } from "./chat-external-inbox-service.js";
import { createChatModerationService, ChatModerationServiceError } from "./chat-moderation-service.js";
import { createModerationRoutes } from "./moderation-routes.js";
import { createTemplateRoutes } from "./template-routes.js";
import { createMessageForwardRoutes } from "./message-forward-routes.js";
import { createMessageReceiptRoutes } from "./message-receipt-routes.js";
import { createChatOfficeRoutes } from "./chat-office-routes.js";
import { createGuestChatService, GuestChatServiceError, mintGuestRealtimeToken } from "./guest-service.js";
import { getCompanySlugHeader } from "../../lib/public-request-headers.js";
import { createChatTemplateService } from "./template-service.js";
import { expireStaleGuestSessions } from "./session-expiry-job.js";
import { createChatPermissionsService, ChatPermissionsError } from "./chat-permissions-service.js";
import { createChannelDirectoryService } from "./channel-directory-service.js";
import { createChatSearchService } from "./chat-search-service.js";
import { createChatMemberAvatarService } from "./chat-member-avatar-service.js";
import { createChatMentionsService } from "./chat-mentions-service.js";
import { createChatReactionsService, ChatReactionsError } from "./chat-reactions-service.js";
import { createChatEntityReferencesService } from "./chat-entity-references-service.js";
import { createContactsService } from "../../services/contacts-service.js";
import { createFilesService } from "../../services/files-service.js";
import { createHrService } from "../../services/hr-service.js";
import { createLedgerService } from "../ledger/ledger-service.js";
import { createChatChannelLinksService } from "./chat-channel-links-service.js";
import { createProjectsService } from "../projects/projects-service.js";
import { createInventoryService } from "../../services/inventory-service.js";
import { createTasksService } from "../projects/tasks-service.js";
import { createCalendarEventService } from "../calendar/calendar-event-service.js";
import { createFleetService } from "../fleet/fleet-service.js";

function handleError(c, err, fallback) {
  if (err instanceof UserAccessError || err instanceof ChatServiceError || err instanceof GuestChatServiceError || err instanceof ChatPermissionsError || err instanceof ChatReactionsError || err instanceof ChatModerationServiceError) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[runly.chat]", err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  return c.json({ error: fallback }, 500);
}

const uuidParamSchema = z.string().uuid();

export function createChatRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, notificationService = null, broadcaster = null, resolveUserContext = null, officeService = null }) {
  requirePermission = withResourceInvitationAccess({ prisma, requirePermission, resourceType: 'chat' });
  const app = new Hono();
  const permissionsService = createChatPermissionsService({ prisma });
  const mentionsService = createChatMentionsService({ prisma });
  const channelLinksService = createChatChannelLinksService({ prisma });
  // Built once and shared by entity-reference resolution and MirAI's ERP tools.
  const ledgerService = createLedgerService({ prisma });
  const projectsService = createProjectsService({ prisma });
  const tasksService = createTasksService({ prisma });
  const calendarEventService = createCalendarEventService({ prisma });
  const inventoryService = createInventoryService({ prisma });
  const fleetService = createFleetService({ prisma });
  const entityReferencesService = createChatEntityReferencesService({
    prisma,
    contactsService: createContactsService({ prisma }),
    filesService: createFilesService({ prisma, supabaseAdmin }),
    hrService: createHrService({ prisma }),
    ledgerService,
    projectsService,
    tasksService,
    calendarEventService,
    fleetService,
    inventoryService,
  });
  const chatService = createChatService({ prisma, supabaseAdmin, notificationService, broadcaster, permissionsService, mentionsService, entityReferencesService, channelLinksService });
  const chatExternalInboxService = createChatExternalInboxService({ prisma, broadcaster });
  const guestService = createGuestChatService({ prisma, supabaseAdmin, notificationService, broadcaster });
  const templateService = createChatTemplateService({ prisma });
  const channelDirectoryService = createChannelDirectoryService({ prisma });
  const reactionsService = createChatReactionsService({ prisma });
  const moderationService = createChatModerationService({ prisma });
  const chatSearchService = createChatSearchService({ prisma });
  const memberAvatarService = createChatMemberAvatarService({ prisma, supabaseAdmin });

  // MirAI (AI assistant) — Spec 1.
  const visionService = createVisionService();
  async function signAttachmentUrl(bucket, objectKey) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectKey, 120);
    if (error || !data?.signedUrl) throw new Error("no se pudo firmar el adjunto");
    return data.signedUrl;
  }
  async function insertMiraiReply({ conversationId, body, replyToMessageId = null }) {
    // The bot is a member of the `mirai` direct chat, but NOT of channels it
    // is only @mentioned in — fall back to the company's bot profile there.
    const [botRow] = await prisma.$queryRaw`
      SELECT m.user_id AS bot_id
      FROM chat_conversation_members m
      JOIN user_profile up ON up.id = m.user_id
      WHERE m.conversation_id = ${conversationId}::uuid AND up.is_bot = true
      LIMIT 1
    `;
    let botId = botRow?.bot_id ?? null;
    if (!botId) {
      const [row] = await prisma.$queryRaw`
        SELECT up.id AS bot_id
        FROM chat_conversations c
        JOIN membership mm ON mm.company_id = c.company_id AND mm.enabled = true
        JOIN user_profile up ON up.id = mm.user_id AND up.is_bot = true
        WHERE c.id = ${conversationId}::uuid
        LIMIT 1
      `;
      botId = row?.bot_id ?? null;
    }
    if (!botId) {
      console.warn("[runly.chat] MirAI reply: no bot profile found for conversation", conversationId);
    }
    const [msg] = await prisma.$queryRaw`
      INSERT INTO chat_messages (conversation_id, sender_user_id, sender_type, body, message_type, reply_to_message_id)
      VALUES (${conversationId}::uuid, ${botId}, 'assistant', ${String(body).slice(0, 4000)}, 'text', ${replyToMessageId})
      RETURNING id, created_at
    `;
    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET last_message_id = ${msg.id}::uuid, last_message_at = ${msg.created_at}, updated_at = NOW()
      WHERE id = ${conversationId}::uuid
    `;
    if (broadcaster) {
      const memberRows = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members WHERE conversation_id = ${conversationId}::uuid AND left_at IS NULL
      `;
      broadcaster.broadcastToUsers(memberRows.map((m) => m.user_id.toString()), "chat.message.new", {
        conversationId, messageId: msg.id, senderName: "MirAI",
      }).catch(() => {});
    }
    return msg;
  }
  // Read-only from MirAI's tools (list_call_transcripts/get_call_transcript,
  // mirai-tools.js) — a separate lightweight instance from the one
  // apps/api/src/routes/calls/index.js owns, since that one also drives
  // audit logging/system-message posting on write paths this one never
  // touches. Its own access control (participated in the call, or requested
  // it) is unchanged — MirAI never gets broader read access than the user
  // asking it would get calling the REST endpoint directly.
  const callTranscriptService = createCallTranscriptService({ prisma });
  const miraiService = createMiraiService({
    prisma,
    visionService,
    chatSearchService,
    listMessages: chatService.listMessages,
    broadcaster,
    signAttachmentUrl,
    insertAssistantMessage: insertMiraiReply,
    resolveUserContext,
    inventoryService,
    ledgerService,
    calendarEventService,
    projectsService,
    tasksService,
    callTranscriptService,
  });
  const miraiTtsService = createMiraiTtsService();

  // ================================================================
  // INTERNAL CHAT — all routes require authentication
  // ================================================================
  const internal = new Hono();
  internal.use("*", authMiddleware);
  // Revalidate corporate access even while an old session remains open.
  internal.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const resource = path.match(/\/(conversations|messages)\/([0-9a-f-]{36})(?:\/|$)/i);
    if (resource) {
      const authUserId = c.get('authUserId');
      const [allowed] = resource[1] === 'conversations'
        ? await prisma.$queryRaw`SELECT 1 FROM user_profile u WHERE u.auth_user_id = ${authUserId} AND public.runly_chat_user_access(${resource[2]}::uuid, u.id)`
        : await prisma.$queryRaw`SELECT 1 FROM chat_messages m JOIN user_profile u ON u.auth_user_id = ${authUserId} WHERE m.id = ${resource[2]}::uuid AND public.runly_chat_user_access(m.conversation_id, u.id)`;
      if (!allowed) return c.json({ error: 'Recurso no encontrado.' }, 404);
    }
    return next();
  });


  // GET /chat/conversations
  // "Leer en voz alta" availability — deliberately no permission beyond being
  // logged in (`internal` already requires that): it's usable on any message
  // in any conversation, not gated by chat.mirai.use or any conversation-
  // specific check, same as GET /chat/mirai/status but without conflating an
  // unrelated permission with this capability's real availability.
  internal.get("/tts/status", (c) => {
    return c.json({ data: { enabled: Boolean(miraiTtsService.isConfigured()) } });
  });

  internal.get("/conversations", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      try {
        const actorProfileId = await resolveUserProfileId(prisma, authUserId);
        await miraiService.ensureMiraiConversation({ companyId: c.get("companyId") ?? null, actorProfileId });
      } catch (e) {
        console.error("[runly.chat] mirai ensure (list)", e?.message ?? e);
      }
      const { limit, cursor, archived } = c.req.query();
      const result = await chatService.listConversations({
        companyId: c.get('companyId'),
        authUserId,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
        cursor: cursor || null,
        archived: archived === "true",
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando conversaciones.");
    }
  });

  // GET /chat/search/messages — fuzzy message search across the caller's
  // conversations (or one, with ?conversationId=).
  internal.get("/search/messages", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const parsed = chatMessageSearchQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        return c.json({ error: "Parametros de busqueda invalidos." }, 422);
      }
      const { q, conversationId, limit, offset } = parsed.data;
      const result = await chatSearchService.searchMessages({
        authUserId: c.get("authUserId"),
        companyId: c.get("companyId"),
        q,
        conversationId: conversationId || null,
        limit,
        offset,
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error buscando mensajes.");
    }
  });

  // POST /chat/conversations/:id/archive
  internal.post("/conversations/:id/archive", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.archiveConversation({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error archivando conversacion.");
    }
  });

  // POST /chat/conversations/:id/unarchive
  internal.post("/conversations/:id/unarchive", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.unarchiveConversation({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error desarchivando conversacion.");
    }
  });

  // PATCH /chat/conversations/:id/pin
  internal.patch("/conversations/:id/pin", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const { pinned } = chatPinConversationSchema.parse(await c.req.json());
      const result = await chatService.pinConversation({ conversationId, authUserId, pinned });
      return c.json(result);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error fijando conversacion.");
    }
  });

  // POST /chat/conversations/:id/hide  (direct chats only — "Eliminar chat")
  internal.post("/conversations/:id/hide", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.hideConversation({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error eliminando la conversacion de la lista.");
    }
  });

  // POST /chat/conversations
  internal.post("/conversations", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json();
      const data = chatCreateConversationSchema.parse(body);
      // companyId is the server-resolved active company, applied AFTER the
      // spread so a client-supplied field of the same name (there isn't one
      // in the schema today, but never trust it) cannot override it.
      const result = await chatService.createConversation({ authUserId, ...data, companyId: c.get("companyId") });
      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error creando conversacion.");
    }
  });

  // GET /chat/conversations/:id
  internal.get("/conversations/:id", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.getConversation({ conversationId, authUserId });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error obteniendo conversacion.");
    }
  });

  // PATCH /chat/conversations/:id
  internal.patch("/conversations/:id", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const body = await c.req.json();
      const updates = chatUpdateConversationSchema.parse(body);
      const result = await chatService.updateConversation({ conversationId, authUserId, updates });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error actualizando conversacion.");
    }
  });

  // DELETE /chat/conversations/:id
  internal.delete("/conversations/:id", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.deleteConversation({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error eliminando conversacion.");
    }
  });

  // GET /chat/conversations/:id/messages
  internal.get("/conversations/:id/messages", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const { limit, before } = c.req.query();
      const result = await chatService.listMessages({
        conversationId,
        authUserId,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 40,
        before: before || null,
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando mensajes.");
    }
  });

  // POST /chat/conversations/:id/messages
  internal.post("/conversations/:id/messages", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const body = await c.req.json();
      const data = chatSendMessageSchema.parse(body);
      const result = await chatService.sendMessage({ conversationId, authUserId, ...data });

      // If this is the user's MirAI conversation, kick off the assistant
      // turn in the background — do NOT await (the reply arrives via realtime).
      try {
        const [conv] = await prisma.$queryRaw`SELECT type, company_id FROM chat_conversations WHERE id = ${conversationId}::uuid LIMIT 1`;
        if (conv?.type === "mirai") {
          const actorProfileId = await resolveUserProfileId(prisma, authUserId);
          miraiService.handleUserMessage({
            companyId: conv.company_id ?? c.get("companyId") ?? null,
            conversationId,
            actorProfileId,
            actorAuthUserId: authUserId,
            triggerMessageId: result?.id ?? null,
          }).catch((e) => console.error("[runly.chat] mirai turn", e?.message ?? e));
        } else if (
          (conv?.type === "channel" || conv?.type === "group" || conv?.type === "direct") &&
          result?.sender_type !== "assistant" &&
          miraiService.matchMiraiMention(data.body)
        ) {
          // @MirAI in a channel/group/DM: reply visibly, but only if the
          // sender may use MirAI. userContext is already loaded by
          // requirePermission. (The `mirai` and `external_support` types are
          // handled above / excluded on purpose.)
          const uctx = c.get("userContext");
          const allowed = Boolean(uctx?.isAdmin || uctx?.permissionSet?.has("chat.mirai.use"));
          if (allowed) {
            const actorProfileId = await resolveUserProfileId(prisma, authUserId);
            miraiService.handleChannelMention({
              companyId: conv.company_id ?? c.get("companyId") ?? null,
              conversationId,
              actorProfileId,
              actorAuthUserId: authUserId,
              triggerMessageId: result?.id ?? null,
              mentionText: data.body,
            }).catch((e) => console.error("[runly.chat] mirai mention", e?.message ?? e));
          }
        }
      } catch (e) {
        console.error("[runly.chat] mirai dispatch", e?.message ?? e);
      }

      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error enviando mensaje.");
    }
  });

  // PATCH /chat/messages/:messageId
  internal.patch("/messages/:messageId", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const messageId = c.req.param("messageId");
      const body = await c.req.json();
      const data = chatEditMessageSchema.parse(body);
      const result = await chatService.editMessage({ messageId, authUserId, body: data.body });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error editando mensaje.");
    }
  });

  // DELETE /chat/messages/:messageId
  internal.delete("/messages/:messageId", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const messageId = c.req.param("messageId");
      const result = await chatService.deleteMessage({ messageId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error eliminando mensaje.");
    }
  });

  // PATCH /chat/messages/:id/pin
  internal.patch("/messages/:id/pin", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const messageId = c.req.param("id");
      const body = await c.req.json();
      const { pinned } = chatPinMessageSchema.parse(body);
      const result = await chatService.pinMessage({ messageId, authUserId, pinned });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error fijando el mensaje.");
    }
  });

  // GET /chat/conversations/:id/pinned-messages
  internal.get("/conversations/:id/pinned-messages", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.listPinnedMessages({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando mensajes fijados.");
    }
  });

  // GET /chat/messages/:id/thread
  internal.get("/messages/:id/thread", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const messageId = c.req.param("id");
      const result = await chatService.listThreadReplies({ messageId, authUserId });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error listando el hilo.");
    }
  });

  // POST /chat/messages/:id/reactions
  internal.post("/messages/:id/reactions", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const messageId = c.req.param("id");
      const body = await c.req.json();
      const { emoji, attachmentId } = chatToggleReactionSchema.parse(body);
      const result = await reactionsService.toggleReaction({ messageId, authUserId, emoji, attachmentId: attachmentId ?? null });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error reaccionando al mensaje.");
    }
  });

  // DELETE /chat/attachments/:id
  internal.delete("/attachments/:id", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const attachmentId = c.req.param("id");
      const result = await chatService.deleteAttachment({ attachmentId, authUserId });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error eliminando archivo.");
    }
  });

  // POST /chat/conversations/:id/members
  internal.post("/conversations/:id/members", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const body = await c.req.json();
      const data = chatAddMembersSchema.parse(body);
      const result = await chatService.addMembers({ conversationId, authUserId, ...data });
      return c.json(result, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error agregando miembros.");
    }
  });

  // DELETE /chat/conversations/:id/members/:userId
  internal.delete("/conversations/:id/members/:userId", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const targetUserId = c.req.param("userId");
      const result = await chatService.removeMember({ conversationId, authUserId, targetUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error eliminando miembro.");
    }
  });

  // POST /chat/conversations/:id/read
  internal.post("/conversations/:id/read", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatService.markConversationRead({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error marcando como leido.");
    }
  });

  // Mute, block/unblock, groups-in-common, reports — see moderation-routes.js.
  internal.route("", createModerationRoutes({ requirePermission, moderationService }));
  internal.route("", createMessageForwardRoutes({ requirePermission, chatService }));
  internal.route("", createMessageReceiptRoutes({ requirePermission, chatService }));
  if (officeService) internal.route("", createChatOfficeRoutes({ officeService }));

  // ================================================================
  // CHANNELS & ROLES (Phase A foundation)
  // ================================================================

  // POST /chat/channels
  internal.post("/channels", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json();
      const data = chatCreateChannelSchema.parse(body);
      const result = await chatService.createConversation({ authUserId, type: "channel", ...data, companyId: c.get("companyId") });
      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error creando canal.");
    }
  });

  // GET /chat/channels/directory
  internal.get("/channels/directory", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const { cursor, limit } = c.req.query();
      const result = await channelDirectoryService.listChannelDirectory({
        authUserId,
        cursor: cursor || null,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 30,
        activeCompanyId: c.get("companyId"),
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando canales.");
    }
  });

  // GET /chat/channels/linked?module=runly.projects&entityId=<uuid>
  // Used by the source module's UI (e.g. a project's detail screen) to know
  // whether it already has a linked channel before rendering "Crear canal"
  // vs. "Ir al canal".
  internal.get("/channels/linked", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const { module: linkedModule, entityId } = c.req.query();
      if (!linkedModule || !entityId) {
        return c.json({ error: "module y entityId son requeridos." }, 422);
      }
      const conversation = await channelLinksService.findByLink(linkedModule, entityId);
      return c.json({ data: conversation });
    } catch (err) {
      return handleError(c, err, "Error buscando el canal vinculado.");
    }
  });

  // POST /chat/conversations/:id/join
  internal.post("/conversations/:id/join", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await channelDirectoryService.joinChannel({ conversationId, authUserId, activeCompanyId: c.get("companyId") });
      return c.json({ data: result }, 201);
    } catch (err) {
      return handleError(c, err, "Error uniendote al canal.");
    }
  });

  // GET /chat/conversations/:id/roles
  internal.get("/conversations/:id/roles", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await permissionsService.listRoles({ conversationId, authUserId });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error listando roles.");
    }
  });

  // POST /chat/conversations/:id/roles
  internal.post("/conversations/:id/roles", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const body = await c.req.json();
      const data = chatCreateChannelRoleSchema.parse(body);
      const result = await permissionsService.createRole({ conversationId, authUserId, ...data });
      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error creando rol.");
    }
  });

  // PATCH /chat/conversations/:id/roles/:roleId
  internal.patch("/conversations/:id/roles/:roleId", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const roleId = c.req.param("roleId");
      const body = await c.req.json();
      const updates = chatUpdateChannelRoleSchema.parse(body);
      const result = await permissionsService.updateRole({ conversationId, roleId, authUserId, updates });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error actualizando rol.");
    }
  });

  // DELETE /chat/conversations/:id/roles/:roleId
  internal.delete("/conversations/:id/roles/:roleId", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const roleId = c.req.param("roleId");
      const result = await permissionsService.deleteRole({ conversationId, roleId, authUserId });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error eliminando rol.");
    }
  });

  // PATCH /chat/conversations/:id/members/:memberId/role
  internal.patch("/conversations/:id/members/:memberId/role", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const memberUserId = c.req.param("memberId");
      const body = await c.req.json();
      const { roleId } = chatAssignMemberRoleSchema.parse(body);
      const result = await permissionsService.assignMemberRole({ conversationId, memberUserId, roleId, authUserId });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error asignando rol.");
    }
  });

  // PATCH /chat/availability
  internal.patch("/availability", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json();
      if (typeof body?.available !== "boolean") {
        return c.json({ error: "El campo 'available' es requerido y debe ser booleano." }, 422);
      }
      const profile = await prisma.userProfile.update({
        where: { authUserId },
        data: { availableForChat: body.available },
        select: { id: true, availableForChat: true },
      });
      return c.json({ ok: true, available: profile.availableForChat });
    } catch (err) {
      return handleError(c, err, "Error actualizando disponibilidad.");
    }
  });

  // POST /chat/attachments/presign
  internal.post("/attachments/presign", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json();
      const data = chatPresignAttachmentSchema.parse(body);
      const result = await chatService.presignAttachmentUpload({ authUserId, ...data });
      return c.json({ data: result });
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error generando URL de subida.");
    }
  });

  // GET /chat/attachments/:id/signed-url
  internal.get("/attachments/:id/signed-url", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const attachmentId = c.req.param("id");
      const variant = c.req.query("variant") || "full";
      const result = await chatService.getAttachmentSignedUrl({ attachmentId, authUserId, variant });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error obteniendo URL del adjunto.");
    }
  });

  // GET /chat/conversations/:id/members/:userId/avatar/signed-url
  // Full-resolution avatar for a conversation member — the generic files
  // endpoint 404s on identity avatar files and the identity endpoint needs a
  // permission chat users lack, so chat signs it itself, gated on shared
  // conversation membership. See chat-member-avatar-service.js.
  internal.get("/conversations/:id/members/:userId/avatar/signed-url", requirePermission("chat.conversations.read"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const targetUserId = c.req.param("userId");
      const variant = c.req.query("variant") || "full";
      const result = await memberAvatarService.getMemberAvatarSignedUrl({ conversationId, authUserId, targetUserId, variant });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error obteniendo la foto de perfil.");
    }
  });

  // ----------------------------------------------------------------
  // External inbox (operators)
  // ----------------------------------------------------------------

  // GET /chat/external/inbox
  internal.get("/external/inbox", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const companyId = c.get("companyId");
      if (!companyId) return c.json({ data: [] });
      const { status, limit, search } = c.req.query();
      const result = await chatExternalInboxService.listExternalInbox({
        authUserId,
        companyId,
        status: status ?? "open",
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 30,
        search: search?.trim() || null,
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando bandeja externa.");
    }
  });

  // POST /chat/external/:id/read
  internal.post("/external/:id/read", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("id");
      const result = await chatExternalInboxService.markExternalRead({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error marcando conversacion como leida.");
    }
  });

  // GET /chat/external/:conversationId/messages
  internal.get("/external/:conversationId/messages", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const { limit, before } = c.req.query();

      // Add operator as member if not already
      const profileRows = await prisma.$queryRaw`
        SELECT id FROM user_profile WHERE auth_user_id = ${authUserId} LIMIT 1
      `;
      if (profileRows.length) {
        await prisma.$executeRaw`
          INSERT INTO chat_conversation_members (conversation_id, user_id, role)
          VALUES (${conversationId}, ${profileRows[0].id}, 'operator')
          ON CONFLICT DO NOTHING
        `;
      }

      const result = await chatService.listMessages({
        conversationId,
        authUserId,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 40,
        before: before && !Number.isNaN(new Date(before).getTime()) ? before : null,
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando mensajes externos.");
    }
  });

  // POST /chat/external/:conversationId/messages
  internal.post("/external/:conversationId/messages", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const body = await c.req.json();
      const data = chatSendMessageSchema.parse(body);

      // Auto-join as operator and fetch profile for broadcast
      // user_profile has no avatar_url column; avatar is resolved via profile_image_file_id
      const profileRows = await prisma.$queryRaw`
        SELECT id, display_name AS "displayName"
        FROM user_profile WHERE auth_user_id = ${authUserId} LIMIT 1
      `;
      if (profileRows.length) {
        await prisma.$executeRaw`
          INSERT INTO chat_conversation_members (conversation_id, user_id, role)
          VALUES (${conversationId}, ${profileRows[0].id}, 'operator')
          ON CONFLICT DO NOTHING
        `;
      }

      const result = await chatService.sendMessage({ conversationId, authUserId, ...data });

      // Notify the guest widget in real time via HTTP broadcast (no subscribe needed)
      broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "new_operator_message", {
        conversationId,
        messageId: result.id,
        body: data.body,
        senderType: "user",
        senderName: profileRows[0]?.displayName ?? "Operador",
        senderAvatarUrl: null,
        createdAt: result.created_at,
      });

      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error enviando mensaje externo.");
    }
  });

  // POST /chat/external/:conversationId/assign
  internal.post("/external/:conversationId/assign", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const body = await c.req.json();
      const data = chatAssignOperatorSchema.parse(body);
      const result = await chatExternalInboxService.assignOperator({ conversationId, authUserId, ...data });
      return c.json(result);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error asignando operador.");
    }
  });

  // GET /chat/operators/available — list operators available for chat in the caller's company
  internal.get("/operators/available", requirePermission("chat.support.manage"), async (c) => {
    try {
      const companyId = c.get("companyId");
      if (!companyId) return c.json({ data: [] });
      const operators = await prisma.$queryRaw`
        SELECT p.id,
               p.display_name AS "displayName",
               NULL AS "avatarUrl",
               p.email,
               p.available_for_chat AS "availableForChat"
        FROM user_profile p
        INNER JOIN membership m ON m.user_id = p.id AND m.enabled = true
        WHERE m.company_id = ${companyId}::uuid
          AND p.available_for_chat = true
        ORDER BY p.display_name ASC
      `;
      return c.json({ data: operators });
    } catch (err) {
      return handleError(c, err, "Error obteniendo operadores.");
    }
  });

  // POST /chat/external/:conversationId/close
  internal.post("/external/:conversationId/close", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const result = await chatExternalInboxService.closeExternalConversation({ conversationId, authUserId });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error cerrando conversacion.");
    }
  });

  // POST /chat/external/:conversationId/typing — fire-and-forget
  internal.post("/external/:conversationId/typing", requirePermission("chat.support.manage"), async (c) => {
    try {
      await chatExternalInboxService.broadcastOperatorTyping({ conversationId: c.req.param("conversationId") });
      return c.body(null, 204);
    } catch (err) {
      return handleError(c, err, "Error notificando escritura.");
    }
  });

  // DELETE /chat/external/:conversationId/messages/:messageId
  internal.delete("/external/:conversationId/messages/:messageId", requirePermission("chat.support.manage"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const messageId = c.req.param("messageId");
      const result = await chatService.deleteMessage({ messageId, authUserId });
      broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "new_operator_message", {
        conversationId, messageId, deleted: true,
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error eliminando mensaje.");
    }
  });

  // ================================================================
  // PUBLIC GUEST CHAT — no auth, token-based
  // ================================================================
  const pub = new Hono();

  // POST /public/chat/session
  pub.post("/session", async (c) => {
    try {
      const body = await c.req.json();
      const data = chatGuestSessionSchema.parse(body);

      // Resolve companyId from X-Runly-Company header for assignment + lead capture
      let companyId = null;
      const companySlug = getCompanySlugHeader(c);
      if (companySlug) {
        const company = await prisma.company.findUnique({ where: { slug: companySlug }, select: { id: true } });
        companyId = company?.id ?? null;
      }

      const result = await guestService.createGuestSession({ ...data, companyId });
      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error creando sesion de invitado.");
    }
  });

  // GET /public/chat/session/:token
  pub.get("/session/:token", async (c) => {
    try {
      const token = c.req.param("token");
      const result = await guestService.getGuestSessionInfo(token);
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error obteniendo sesion.");
    }
  });

  // POST /public/chat/session/:token/messages
  pub.post("/session/:token/messages", async (c) => {
    try {
      const rawToken = c.req.param("token");
      const body = await c.req.json();
      const data = chatGuestMessageSchema.parse(body);
      const result = await guestService.sendGuestMessage({ rawToken, ...data });
      return c.json({ data: result }, 201);
    } catch (err) {
      if (err?.name === "ZodError") return c.json({ error: (err.errors ?? err.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
      return handleError(c, err, "Error enviando mensaje.");
    }
  });

  // POST /public/chat/session/:token/typing — fire-and-forget
  pub.post("/session/:token/typing", async (c) => {
    try {
      await guestService.broadcastGuestTyping({ rawToken: c.req.param("token") });
      return c.body(null, 204);
    } catch (err) {
      return handleError(c, err, "Error notificando escritura.");
    }
  });

  // POST /public/chat/session/:token/read
  pub.post("/session/:token/read", async (c) => {
    try {
      await guestService.markGuestRead({ rawToken: c.req.param("token") });
      return c.body(null, 204);
    } catch (err) {
      return handleError(c, err, "Error marcando como leido.");
    }
  });

  // GET /public/chat/session/:token/messages
  pub.get("/session/:token/messages", async (c) => {
    try {
      const rawToken = c.req.param("token");
      const { limit, before } = c.req.query();
      const result = await guestService.listGuestMessages({
        rawToken,
        limit: limit ? Math.min(parseInt(limit, 10), 60) : 40,
        before: before && !Number.isNaN(new Date(before).getTime()) ? before : null,
      });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error listando mensajes.");
    }
  });

  // POST /public/chat/session/resume-by-code
  // Guest lost their session but has their tracking code + email
  pub.post("/session/resume-by-code", async (c) => {
    try {
      const body = await c.req.json();
      const { trackingCode, email } = body;
      if (!trackingCode || !email) {
        return c.json({ error: "trackingCode y email son requeridos." }, 422);
      }

      // Find the conversation by tracking code
      const convRows = await prisma.$queryRaw`
        SELECT cc.id AS conversation_id, cc.company_id, cc.tracking_code,
               cgs.id AS session_id, cgs.email AS session_email
        FROM chat_conversations cc
        JOIN chat_guest_sessions cgs ON cgs.id = cc.created_by_guest_id
        WHERE LOWER(cc.tracking_code) = LOWER(${trackingCode.trim()})
          AND cc.deleted_at IS NULL
        LIMIT 1
      `;

      if (!convRows.length) {
        return c.json({ error: "Numero de seguimiento no encontrado." }, 404);
      }

      const conv = convRows[0];

      // Verify email matches (case insensitive)
      if (!conv.session_email || conv.session_email.toLowerCase() !== email.trim().toLowerCase()) {
        return c.json({ error: "El correo no coincide con el registrado para este chat." }, 403);
      }

      // Issue a single-use resume token
      const { randomBytes, createHash } = await import("node:crypto");
      const resumeToken = randomBytes(32).toString("hex");
      const resumeHash = createHash("sha256").update(resumeToken).digest("hex");

      await prisma.$executeRaw`
        UPDATE chat_guest_sessions
        SET resume_token_hash = ${resumeHash},
            idle_expires_at = NOW() + INTERVAL '30 minutes',
            absolute_expires_at = GREATEST(absolute_expires_at, NOW() + INTERVAL '30 minutes'),
            last_seen_at = NOW()
        WHERE id = ${conv.session_id}
      `;

      // Reopen conversation if it was closed due to expiry
      await prisma.$executeRaw`
        UPDATE chat_conversations
        SET status = 'open', updated_at = NOW()
        WHERE id = ${conv.conversation_id}
          AND status = 'closed'
          AND type = 'external_support'
      `;

      return c.json({
        data: {
          token: resumeToken,
          conversationId: conv.conversation_id,
          trackingCode: conv.tracking_code,
          resumed: true,
          realtimeToken: mintGuestRealtimeToken(conv.session_id),
        },
      });
    } catch (err) {
      return handleError(c, err, "Error resumiendo sesion por codigo.");
    }
  });

  // POST /public/chat/session/:token/close
  pub.post("/session/:token/close", async (c) => {
    try {
      const rawToken = c.req.param("token");
      const result = await guestService.closeGuestSession({ rawToken });
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error cerrando sesion.");
    }
  });

  // POST /public/chat/session/:token/attachments/presign
  // Guest uploads a file: we create the chat_attachment row + signed upload URL
  pub.post("/session/:token/attachments/presign", async (c) => {
    try {
      const rawToken = c.req.param("token");
      const body = await c.req.json();
      const { fileName, mimeType, sizeBytes } = body;

      if (!fileName || !mimeType || !sizeBytes) {
        return c.json({ error: "fileName, mimeType, sizeBytes son requeridos." }, 422);
      }

      const ALLOWED_MIME = [/^image\//, /^application\/pdf$/, /^text\/plain$/, /^application\/msword$/, /^application\/vnd\.openxmlformats/];
      if (!ALLOWED_MIME.some((re) => re.test(mimeType))) {
        return c.json({ error: "Tipo de archivo no permitido." }, 422);
      }
      if (sizeBytes > 20 * 1024 * 1024) {
        return c.json({ error: "Archivo demasiado grande (max 20 MB)." }, 422);
      }

      const session = await guestService.resolveGuestSession(rawToken);
      const convRows = await prisma.$queryRaw`
        SELECT c.id FROM chat_conversations c
        INNER JOIN chat_conversation_members ccm
          ON ccm.conversation_id = c.id AND ccm.guest_session_id = ${session.id}
        WHERE c.deleted_at IS NULL AND c.status != 'closed'
        ORDER BY c.created_at DESC LIMIT 1
      `;
      if (!convRows.length) return c.json({ error: "No hay conversacion activa." }, 404);
      const conversationId = convRows[0].id;

      const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
      const objectKey = `conversations/${conversationId}/guest/${crypto.randomUUID()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from("runly-chat")
        .createSignedUploadUrl(objectKey, { expiresIn: 300 });

      if (uploadError) return c.json({ error: "Error generando URL de subida." }, 500);

      const attRows = await prisma.$queryRaw`
        INSERT INTO chat_attachments
          (conversation_id, bucket, object_key, file_name, mime_type, size_bytes)
        VALUES (
          ${conversationId},
          'runly-chat',
          ${objectKey},
          ${fileName},
          ${mimeType},
          ${sizeBytes}
        )
        RETURNING id
      `;

      return c.json({ data: { attachmentId: attRows[0].id, uploadUrl: uploadData.signedUrl } }, 201);
    } catch (err) {
      return handleError(c, err, "Error generando URL de subida.");
    }
  });

  // GET /public/chat/session/:token/attachments/:attachmentId/url
  // Short-lived signed URL for an attachment the guest can see — scoped to the
  // session's own conversation.
  pub.get("/session/:token/attachments/:attachmentId/url", async (c) => {
    try {
      const rawToken = c.req.param("token");
      const attachmentId = c.req.param("attachmentId");
      const result = await guestService.getGuestAttachmentUrl({ rawToken, attachmentId });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error obteniendo URL del adjunto.");
    }
  });

  // Message templates (quick-reply snippets) — see template-routes.js.
  internal.route("", createTemplateRoutes({ requirePermission, templateService }));

  // ================================================================
  // MANUAL ASSIGNMENT
  // ================================================================

  internal.post("/external/:conversationId/assign", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { conversationId } = c.req.param();
      const { userId } = await c.req.json();
      if (!userId) return c.json({ error: "userId requerido." }, 422);

      // Verify operator belongs to company
      const profile = await prisma.userProfile.findFirst({
        where: { authUserId: userId, memberships: { some: { companyId, enabled: true } } },
        select: { id: true },
      });
      if (!profile) return c.json({ error: "Operador no encontrado en esta empresa." }, 404);

      await prisma.$executeRaw`
        UPDATE chat_conversations
        SET assigned_user_id = ${profile.id}::uuid, updated_at = NOW()
        WHERE id = ${conversationId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      `;
      await prisma.$executeRaw`
        INSERT INTO chat_conversation_members (conversation_id, user_id, role)
        VALUES (${conversationId}::uuid, ${profile.id}::uuid, 'operator')
        ON CONFLICT DO NOTHING
      `;
      return c.json({ data: { ok: true, assignedUserId: profile.id } });
    } catch (err) {
      return handleError(c, err, "Error asignando operador.");
    }
  });

  // ================================================================
  // SESSION EXPIRY JOB (internal trigger)
  // ================================================================

  internal.post("/internal/expire-sessions", requirePermission("chat.conversations.create"), async (c) => {
    try {
      const result = await expireStaleGuestSessions(prisma, { supabaseAdmin });
      return c.json({ data: result });
    } catch (err) {
      return handleError(c, err, "Error expirando sesiones.");
    }
  });

  // MirAI (AI assistant) routes carry their own "/chat/..." paths, so they
  // mount at the app root behind authMiddleware (not under the "/chat"-prefixed
  // `internal` sub-app, which would double the prefix).
  // ⚠️ DO NOT widen this to `mirai.use("*", ...)` WITHOUT ASKING RAUL FIRST.
  // Scope the auth guard to the MirAI route surface only. A bare
  // `mirai.use("*", ...)` here — because this sub-app is mounted at the app
  // root (`app.route("", mirai)`) and createChatRouter is registered early in
  // apps/api/src/index.js (before `/public/site/*` and the dist-serve SPA
  // fallback) — intercepts EVERY unmatched anonymous request with a 401 and
  // takes down the public marketing website. Happened on 2026-09-08 (commit
  // 59a439a6); guarded by mirai-mount-scope.test.js.
  const mirai = new Hono();
  mirai.use("/chat/mirai", authMiddleware);
  mirai.use("/chat/mirai/*", authMiddleware);
  mirai.route("", createMiraiRoutes({
    requirePermission,
    miraiService,
    miraiTtsService,
    resolveProfileId: (authUserId) => resolveUserProfileId(prisma, authUserId),
    // listMessages membership-checks the caller and throws if they're not in.
    assertConversationMember: async (authUserId, conversationId) => {
      try { await chatService.listMessages({ conversationId, authUserId, limit: 1 }); return true; }
      catch { return false; }
    },
  }));

  // Mount sub-routers
  app.route("/chat", internal);
  app.route("/public/chat", pub);
  app.route("", mirai);

  return app;
}
