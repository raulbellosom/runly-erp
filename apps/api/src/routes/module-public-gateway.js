// Public (no session) gateway for module public links: /public/m/:moduleKey/:token/*
// Spec 4.2 of docs/superpowers/specs/2026-09-28-module-public-links-design.md.
//
// Every route here is path-scoped; never add a root use("*") (see the
// load-bearing note next to the chat/calls routers in index.js).
import { Hono } from "hono";
import { createTokenBucketLimiter } from "../lib/token-bucket-limiter.js";
import { ModulePublicLinkError } from "../services/module-public-links-service.js";

export const PUBLIC_BODY_LIMIT = 64 * 1024;
const READ_METHODS = new Set(["GET", "HEAD"]);
const UNAVAILABLE = "Enlace no disponible";

function clientIp(c) {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return c.req.header("x-real-ip") ?? "local";
}

export function createModulePublicGateway({
  linksService,
  getPublicRouter,
  resolveLogoUrl = async () => null,
  readLimiter = createTokenBucketLimiter({ capacity: 30, refillPerSecond: 0.5 }),
  writeLimiter = createTokenBucketLimiter({ capacity: 5, refillPerSecond: 0.1 }),
}) {
  const app = new Hono();

  async function handle(c) {
    const moduleKey = c.req.param("moduleKey");
    const token = c.req.param("token");
    const method = c.req.method.toUpperCase();
    const isRead = READ_METHODS.has(method);

    const rate = (isRead ? readLimiter : writeLimiter).consume(`${clientIp(c)}:${token}`);
    if (!rate.allowed) {
      c.header("Retry-After", String(rate.retryAfter));
      return c.json({ error: "Demasiadas solicitudes. Intenta más tarde." }, 429);
    }

    let resolved;
    try {
      resolved = await linksService.resolveByToken(moduleKey, token);
    } catch (err) {
      if (err instanceof ModulePublicLinkError) {
        return c.json({ error: UNAVAILABLE, ...(err.reason ? { reason: err.reason } : {}) }, err.status);
      }
      throw err;
    }
    const { link, resource } = resolved;

    const prefix = `/public/m/${moduleKey}/${token}`;
    const rest = c.req.path.slice(prefix.length) || "/";

    if (rest === "/_context" && isRead) {
      const branding = await linksService.loadCompanyBranding(link.companyId);
      return c.json({
        data: {
          resource: { key: resource.key, title: resource.title, mode: link.mode },
          recordId: link.recordId,
          expiresAt: link.expiresAt,
          company: { name: branding.name, logoUrl: await resolveLogoUrl(branding.logoFileId) },
        },
      });
    }

    if (link.mode === "view" && !isRead) {
      return c.json({ error: "Este enlace es de solo lectura." }, 405);
    }

    const moduleRouter = getPublicRouter(moduleKey);
    if (!moduleRouter) return c.json({ error: "No encontrado." }, 404);

    let publicBody = null;
    if (!isRead) {
      const declared = Number(c.req.header("content-length") ?? 0);
      if (declared > PUBLIC_BODY_LIMIT) return c.json({ error: "La solicitud es demasiado grande." }, 413);
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return c.json({ error: "Solo se acepta JSON." }, 415);
      }
      const raw = await c.req.text();
      if (Buffer.byteLength(raw, "utf8") > PUBLIC_BODY_LIMIT) {
        return c.json({ error: "La solicitud es demasiado grande." }, 413);
      }
      try {
        publicBody = raw ? JSON.parse(raw) : {};
      } catch {
        return c.json({ error: "JSON inválido." }, 400);
      }
      if (publicBody && typeof publicBody === "object" && !Array.isArray(publicBody)) {
        // Honeypot: bots fill every field. Pretend success, never reach the module.
        if (publicBody._hp) return c.json({ ok: true });
        delete publicBody._hp;
      }
      if (!(await linksService.reserveUse(link.id))) {
        return c.json({ error: UNAVAILABLE, reason: "agotado" }, 410);
      }
    }

    const url = new URL(c.req.url);
    url.pathname = rest;
    const headers = new Headers(c.req.raw.headers);
    headers.delete("content-length");
    const forwarded = new Request(url, {
      method,
      headers,
      body: isRead ? undefined : JSON.stringify(publicBody),
    });
    const env = {
      publicLink: {
        id: link.id,
        companyId: link.companyId,
        moduleKey,
        resource: link.resourceKey,
        recordId: link.recordId,
        mode: link.mode,
      },
      publicBody,
    };

    let response;
    try {
      response = await moduleRouter.fetch(forwarded, env);
    } catch (err) {
      console.error(`[public-gateway] ${moduleKey}:`, err?.message);
      response = new Response(JSON.stringify({ error: "Error interno." }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    if (!isRead && (response.status < 200 || response.status >= 300)) {
      await linksService.releaseUse(link.id).catch(() => {});
    }
    return response;
  }

  app.all("/public/m/:moduleKey/:token", handle);
  app.all("/public/m/:moduleKey/:token/*", handle);
  return app;
}
