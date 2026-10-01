// apps/api/src/routes/chat/mirai-proposal-routes.js
//
// Confirmation endpoints for MirAI action proposals (spec §7.3). Mounted on
// the `mirai` sub-app, already behind authMiddleware for /chat/mirai/*.
import { Hono } from "hono";
import { ChatServiceError } from "./chat-service-error.js";

export function createMiraiProposalRoutes({ requirePermission, proposalService, resolveProfileId }) {
  const r = new Hono();

  async function ctxOf(c) {
    const actorAuthUserId = c.get("authUserId");
    return {
      actorAuthUserId,
      actorProfileId: await resolveProfileId(actorAuthUserId),
      companyId: c.get("companyId") ?? null,
    };
  }

  function fail(c, err, fallback) {
    if (err instanceof ChatServiceError) return c.json({ error: err.message }, err.status);
    console.error("[runly.chat] mirai proposal", err?.message ?? err);
    return c.json({ error: fallback }, 500);
  }

  r.get("/chat/mirai/proposals/:id", requirePermission("chat.mirai.use"), async (c) => {
    try { return c.json({ data: await proposalService.get(c.req.param("id"), await ctxOf(c)) }); }
    catch (err) { return fail(c, err, "No se pudo cargar la propuesta."); }
  });

  r.post("/chat/mirai/proposals/:id/confirm", requirePermission("chat.mirai.use"), async (c) => {
    try { return c.json({ data: await proposalService.confirm(c.req.param("id"), await ctxOf(c)) }); }
    catch (err) { return fail(c, err, "No se pudo ejecutar la propuesta."); }
  });

  r.post("/chat/mirai/proposals/:id/cancel", requirePermission("chat.mirai.use"), async (c) => {
    try { return c.json({ data: await proposalService.cancel(c.req.param("id"), await ctxOf(c)) }); }
    catch (err) { return fail(c, err, "No se pudo cancelar la propuesta."); }
  });

  return r;
}
