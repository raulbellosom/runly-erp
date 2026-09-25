// apps/api/src/routes/chat/external-inbox-routes.js
//
// External inbox (operators): the authenticated-operator side of guest/support
// chat — listing the inbox, reading/sending/deleting messages, assigning an
// operator, closing a conversation, and typing broadcasts. Extracted from
// index.js on 2026-09-24 to keep that file under the CLAUDE.md 1000-line
// limit, following the moderation-routes.js / channel-routes.js pattern.
import { Hono } from "hono";
import { chatSendMessageSchema, chatAssignOperatorSchema } from "@runly/validators";
import { ChatServiceError } from "./chat-service-error.js";
import { GuestChatServiceError } from "./guest-service.js";
import { ChatPermissionsError } from "./chat-permissions-service.js";
import { ChatReactionsError } from "./chat-reactions-service.js";
import { ChatModerationServiceError } from "./chat-moderation-service.js";

function handleError(c, err, fallback) {
  if (
    err instanceof ChatServiceError ||
    err instanceof GuestChatServiceError ||
    err instanceof ChatPermissionsError ||
    err instanceof ChatReactionsError ||
    err instanceof ChatModerationServiceError
  ) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[runly.chat]", err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  return c.json({ error: fallback }, 500);
}

export function createExternalInboxRoutes({ requirePermission, chatExternalInboxService, chatService, prisma, broadcaster }) {
  const app = new Hono();

  // GET /chat/external/inbox
  app.get("/external/inbox", requirePermission("chat.support.manage"), async (c) => {
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
  app.post("/external/:id/read", requirePermission("chat.support.manage"), async (c) => {
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
  app.get("/external/:conversationId/messages", requirePermission("chat.support.manage"), async (c) => {
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
  app.post("/external/:conversationId/messages", requirePermission("chat.support.manage"), async (c) => {
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
  app.post("/external/:conversationId/assign", requirePermission("chat.support.manage"), async (c) => {
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
  app.get("/operators/available", requirePermission("chat.support.manage"), async (c) => {
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
  app.post("/external/:conversationId/close", requirePermission("chat.support.manage"), async (c) => {
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
  app.post("/external/:conversationId/typing", requirePermission("chat.support.manage"), async (c) => {
    try {
      await chatExternalInboxService.broadcastOperatorTyping({ conversationId: c.req.param("conversationId") });
      return c.body(null, 204);
    } catch (err) {
      return handleError(c, err, "Error notificando escritura.");
    }
  });

  // DELETE /chat/external/:conversationId/messages/:messageId
  app.delete("/external/:conversationId/messages/:messageId", requirePermission("chat.support.manage"), async (c) => {
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

  return app;
}
