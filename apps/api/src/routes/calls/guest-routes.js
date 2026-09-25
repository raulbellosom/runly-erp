import { Hono } from "hono";
import { callGuestJoinSchema, callRoomMessageSchema, callGuestAttachmentPresignSchema } from "@runly/validators";

function guestToken(c) {
  const auth = c.req.header("authorization") || c.req.header("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return c.req.query("gt") || null;
}

function fail(c, error, fallback) {
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  if (status === 500) console.error("[runly.calls/guest]", error?.stack ?? error);
  return c.json(
    { error: status === 500 ? fallback : error.message, ...(error?.reason ? { reason: error.reason } : {}) },
    status,
  );
}

export function createGuestCallRouter({ guestService, messagesService }) {
  const app = new Hono();

  app.post("/join", async (c) => {
    try {
      const payload = callGuestJoinSchema.parse(await c.req.json());
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
        || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") ?? null;
      const data = await guestService.joinAsGuest({ ...payload, ip, userAgent });
      return c.json({ data });
    } catch (error) {
      if (error?.name === "ZodError") return c.json({ error: "Datos inválidos." }, 422);
      return fail(c, error, "No se pudo unir a la llamada.");
    }
  });

  app.get("/state", async (c) => {
    try {
      return c.json({ data: await guestService.getGuestState({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "No se pudo obtener el estado."); }
  });

  app.post("/token", async (c) => {
    try {
      return c.json({ data: await guestService.getGuestLiveKitToken({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "No se pudo obtener el acceso."); }
  });

  app.post("/heartbeat", async (c) => {
    try {
      return c.json({ data: await guestService.heartbeatGuest({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "Error."); }
  });

  app.post("/leave", async (c) => {
    try {
      return c.json({ data: await guestService.leaveGuest({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "Error."); }
  });

  app.post("/messages", async (c) => {
    try {
      const { body, metadata } = callRoomMessageSchema.parse(await c.req.json());
      return c.json({ data: await messagesService.postGuestMessage({ guestToken: guestToken(c), body, metadata }) });
    } catch (error) {
      if (error?.name === "ZodError") return c.json({ error: "Mensaje inválido." }, 422);
      return fail(c, error, "No se pudo enviar el mensaje.");
    }
  });

  app.post("/attachments/presign", async (c) => {
    try {
      const data = callGuestAttachmentPresignSchema.parse(await c.req.json());
      const result = await guestService.presignGuestAttachmentUpload({ guestToken: guestToken(c), ...data });
      return c.json({ data: result }, 201);
    } catch (error) {
      if (error?.name === "ZodError") return c.json({ error: "Datos inválidos." }, 422);
      return fail(c, error, "No se pudo generar la URL de subida.");
    }
  });

  app.get("/attachments/:attachmentId/url", async (c) => {
    try {
      const attachmentId = c.req.param("attachmentId");
      const data = await guestService.getGuestAttachmentUrl({ guestToken: guestToken(c), attachmentId });
      return c.json({ data });
    } catch (error) {
      return fail(c, error, "No se pudo obtener el adjunto.");
    }
  });

  return app;
}
