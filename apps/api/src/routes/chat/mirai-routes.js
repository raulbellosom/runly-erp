// apps/api/src/routes/chat/mirai-routes.js
import { Hono } from "hono";
import { ChatServiceError } from "./chat-service-error.js";

export function createMiraiRoutes({ requirePermission, miraiService, resolveProfileId, assertConversationMember }) {
  const r = new Hono();

  r.get("/chat/mirai", requirePermission("chat.mirai.use"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const companyId = c.get("companyId") ?? null;
      const actorProfileId = await resolveProfileId(authUserId);
      const { conversationId } = await miraiService.ensureMiraiConversation({ companyId, actorProfileId });
      return c.json({ data: { conversationId } });
    } catch (err) {
      if (err instanceof ChatServiceError) return c.json({ error: err.message }, err.status);
      console.error("[runly.chat] mirai ensure", err?.message ?? err);
      return c.json({ error: "No se pudo abrir el chat con MirAI." }, 500);
    }
  });

  r.get("/chat/mirai/status", requirePermission("chat.mirai.use"), async (c) => {
    return c.json({ data: {
      available: Boolean(miraiService.isConfigured()),
      web: Boolean(miraiService.isWebEnabled?.()),
    } });
  });

  // ---- Spec 2: private assistant panel ---------------------------------
  r.get("/chat/mirai/panel/:conversationId", requirePermission("chat.mirai.use"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      if (!(await assertConversationMember(authUserId, conversationId))) {
        return c.json({ error: "Conversacion no encontrada." }, 404);
      }
      const ownerProfileId = await resolveProfileId(authUserId);
      const { threadId, messages } = await miraiService.getPanelThread({ ownerProfileId, hostConversationId: conversationId });
      return c.json({ data: { threadId, messages } });
    } catch (err) {
      console.error("[runly.chat] mirai panel get", err?.message ?? err);
      return c.json({ error: "No se pudo abrir el panel de MirAI." }, 500);
    }
  });

  r.post("/chat/mirai/panel/:conversationId/messages", requirePermission("chat.mirai.use"), async (c) => {
    const authUserId = c.get("authUserId");
    const conversationId = c.req.param("conversationId");
    const body = await c.req.json().catch(() => ({}));
    const content = String(body?.content ?? "").trim();
    if (!content || content.length > 2000) {
      return c.json({ error: "El mensaje esta vacio o es demasiado largo." }, 400);
    }
    if (!(await assertConversationMember(authUserId, conversationId))) {
      return c.json({ error: "Conversacion no encontrada." }, 404);
    }
    try {
      const ownerProfileId = await resolveProfileId(authUserId);
      const { threadId } = await miraiService.getPanelThread({ ownerProfileId, hostConversationId: conversationId });
      const focusMessageId = /^[0-9a-f-]{36}$/i.test(String(body?.focusMessageId ?? "")) ? body.focusMessageId : null;
      const out = await miraiService.handlePanelMessage({
        companyId: c.get("companyId") ?? null, ownerProfileId, ownerAuthUserId: authUserId,
        hostConversationId: conversationId, threadId, content, focusMessageId,
      });
      return c.json({ data: out });
    } catch (err) {
      const m = String(err?.message ?? err);
      if (m === "MIRAI_NOT_CONFIGURED") return c.json({ error: "MirAI no esta configurado en este entorno." }, 503);
      if (m === "MIRAI_RATE_LIMITED") return c.json({ error: "Vas muy rapido, intenta de nuevo en un momento." }, 429);
      console.error("[runly.chat] mirai panel send", m);
      return c.json({ error: "MirAI no pudo responder, intentalo de nuevo." }, 502);
    }
  });

  r.delete("/chat/mirai/panel/:conversationId", requirePermission("chat.mirai.use"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const ownerProfileId = await resolveProfileId(authUserId);
      const out = await miraiService.clearPanelThread({ ownerProfileId, hostConversationId: conversationId });
      return c.json({ data: out });
    } catch (err) {
      console.error("[runly.chat] mirai panel clear", err?.message ?? err);
      return c.json({ error: "No se pudo limpiar el panel." }, 500);
    }
  });

  return r;
}
