// apps/api/src/routes/chat/meridian-routes.js
import { Hono } from "hono";
import { ChatServiceError } from "./chat-service-error.js";

export function createMeridianRoutes({ requirePermission, meridianService, resolveProfileId, assertConversationMember }) {
  const r = new Hono();

  r.get("/chat/meridian", requirePermission("chat.meridian.use"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const companyId = c.get("companyId") ?? null;
      const actorProfileId = await resolveProfileId(authUserId);
      const { conversationId } = await meridianService.ensureMeridianConversation({ companyId, actorProfileId });
      return c.json({ data: { conversationId } });
    } catch (err) {
      if (err instanceof ChatServiceError) return c.json({ error: err.message }, err.status);
      console.error("[runly.chat] meridian ensure", err?.message ?? err);
      return c.json({ error: "No se pudo abrir el chat con MeridIAn." }, 500);
    }
  });

  r.get("/chat/meridian/status", requirePermission("chat.meridian.use"), async (c) => {
    return c.json({ data: {
      available: Boolean(meridianService.isConfigured()),
      web: Boolean(meridianService.isWebEnabled?.()),
    } });
  });

  // ---- Spec 2: private assistant panel ---------------------------------
  r.get("/chat/meridian/panel/:conversationId", requirePermission("chat.meridian.use"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      if (!(await assertConversationMember(authUserId, conversationId))) {
        return c.json({ error: "Conversacion no encontrada." }, 404);
      }
      const ownerProfileId = await resolveProfileId(authUserId);
      const { threadId, messages } = await meridianService.getPanelThread({ ownerProfileId, hostConversationId: conversationId });
      return c.json({ data: { threadId, messages } });
    } catch (err) {
      console.error("[runly.chat] meridian panel get", err?.message ?? err);
      return c.json({ error: "No se pudo abrir el panel de MeridIAn." }, 500);
    }
  });

  r.post("/chat/meridian/panel/:conversationId/messages", requirePermission("chat.meridian.use"), async (c) => {
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
      const { threadId } = await meridianService.getPanelThread({ ownerProfileId, hostConversationId: conversationId });
      const focusMessageId = /^[0-9a-f-]{36}$/i.test(String(body?.focusMessageId ?? "")) ? body.focusMessageId : null;
      const out = await meridianService.handlePanelMessage({
        companyId: c.get("companyId") ?? null, ownerProfileId, ownerAuthUserId: authUserId,
        hostConversationId: conversationId, threadId, content, focusMessageId,
      });
      return c.json({ data: out });
    } catch (err) {
      const m = String(err?.message ?? err);
      if (m === "MERIDIAN_NOT_CONFIGURED") return c.json({ error: "MeridIAn no esta configurado en este entorno." }, 503);
      if (m === "MERIDIAN_RATE_LIMITED") return c.json({ error: "Vas muy rapido, intenta de nuevo en un momento." }, 429);
      console.error("[runly.chat] meridian panel send", m);
      return c.json({ error: "MeridIAn no pudo responder, intentalo de nuevo." }, 502);
    }
  });

  r.delete("/chat/meridian/panel/:conversationId", requirePermission("chat.meridian.use"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const conversationId = c.req.param("conversationId");
      const ownerProfileId = await resolveProfileId(authUserId);
      const out = await meridianService.clearPanelThread({ ownerProfileId, hostConversationId: conversationId });
      return c.json({ data: out });
    } catch (err) {
      console.error("[runly.chat] meridian panel clear", err?.message ?? err);
      return c.json({ error: "No se pudo limpiar el panel." }, 500);
    }
  });

  return r;
}
