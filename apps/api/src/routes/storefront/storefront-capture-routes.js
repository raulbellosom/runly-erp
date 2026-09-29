import { Hono } from "hono";

import { decryptPassword } from "../../services/smtp-service.js";
import { StorefrontCaptureError } from "../../services/storefront-capture-service.js";
import { getCompanySlugHeader, getSiteIdHeader } from "../../lib/public-request-headers.js";
import { createTokenBucketLimiter } from "../../lib/token-bucket-limiter.js";

const DEFAULT_BODY_LIMIT = 64 * 1024;

export { createTokenBucketLimiter };

export function createTurnstileVerifier({
  fetchImpl = globalThis.fetch,
  decryptSecret = decryptPassword,
} = {}) {
  return async function verifyTurnstile({ token, encryptedSecretKey }) {
    if (!token || !encryptedSecretKey || typeof fetchImpl !== "function") {
      return false;
    }

    let secret;
    try {
      secret = decryptSecret(encryptedSecretKey);
    } catch {
      return false;
    }

    const body = new URLSearchParams({
      secret,
      response: token,
    });
    try {
      const response = await fetchImpl(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
      if (!response.ok) return false;
      const result = await response.json();
      return result.success === true;
    } catch {
      return false;
    }
  };
}

function requestScope(c, { allowQuery = false } = {}) {
  return {
    companySlug:
      getCompanySlugHeader(c) ||
      (allowQuery ? c.req.query("company") : undefined),
    siteId:
      getSiteIdHeader(c) ||
      (allowQuery ? c.req.query("siteId") : undefined),
    origin: c.req.header("Origin") || undefined,
  };
}

function clientAddress(c) {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("X-Real-IP") ||
    "unknown"
  );
}

function limiterKey(c, kind) {
  const company =
    getCompanySlugHeader(c) || c.req.query("company") || "unknown";
  const site =
    getSiteIdHeader(c) || c.req.query("siteId") || "default";
  return `${kind}:${company}:${site}:${clientAddress(c)}`;
}

async function readJsonBody(c, maxBodyBytes) {
  const declaredLength = Number(c.req.header("Content-Length") ?? 0);
  if (declaredLength > maxBodyBytes) {
    throw new StorefrontCaptureError(
      "payload_too_large",
      "El cuerpo excede 64 KB.",
      413,
    );
  }

  const text = await c.req.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new StorefrontCaptureError(
      "payload_too_large",
      "El cuerpo excede 64 KB.",
      413,
    );
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new StorefrontCaptureError(
      "invalid_json",
      "El cuerpo JSON no es valido.",
      400,
    );
  }
}

function publicFormData(form) {
  return {
    id: form.id,
    name: form.name,
    description: form.description ?? null,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage ?? null,
    turnstileRequired: Boolean(form.turnstileRequired),
    wizardMode: Boolean(form.wizardMode),
    fields: form.fields.map((field) => ({
      id: field.id,
      name: field.name,
      label: field.label,
      fieldType: field.fieldType,
      semanticKey: field.semanticKey ?? "custom",
      placeholder: field.placeholder ?? null,
      required: Boolean(field.required),
      options: field.options ?? null,
      sortOrder: field.sortOrder,
      stepNumber: field.stepNumber ?? 1,
      stepTitle: field.stepTitle ?? null,
    })),
  };
}

function handleError(c, error) {
  if (error instanceof StorefrontCaptureError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      error.status,
    );
  }
  console.error("[storefront/capture]", error);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Error interno.",
      },
    },
    500,
  );
}

function enforceRateLimit(c, limiter, kind) {
  const result = limiter.consume(limiterKey(c, kind));
  if (result.allowed) return null;
  c.header("Retry-After", String(result.retryAfter));
  return c.json(
    {
      error: {
        code: "rate_limited",
        message: "Demasiadas solicitudes. Intenta de nuevo mas tarde.",
      },
    },
    429,
  );
}

export function createStorefrontCaptureRoutes({
  captureService,
  eventLimiter = createTokenBucketLimiter({
    capacity: 120,
    refillPerSecond: 2,
  }),
  formLimiter = createTokenBucketLimiter({
    capacity: 10,
    refillPerSecond: 0.2,
  }),
  resolveAuthenticatedProfile = async () => null,
  maxBodyBytes = DEFAULT_BODY_LIMIT,
}) {
  const app = new Hono();

  app.get("/config", async (c) => {
    try {
      const data = await captureService.getPublicConfig(requestScope(c));
      return c.json({ data });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/events/batch", async (c) => {
    const limited = enforceRateLimit(c, eventLimiter, "events");
    if (limited) return limited;

    try {
      const payload = await readJsonBody(c, maxBodyBytes);
      const authenticatedProfileId = await resolveAuthenticatedProfile(c);
      const data = await captureService.captureEvents({
        ...requestScope(c, { allowQuery: true }),
        dnt: c.req.header("DNT") === "1",
        authenticatedProfileId,
        payload,
      });
      return c.json({ data }, 202);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/forms/:formId", async (c) => {
    try {
      const form = await captureService.getPublicForm({
        ...requestScope(c),
        formId: c.req.param("formId"),
      });
      return c.json({ data: publicFormData(form) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/forms/:formId/submissions", async (c) => {
    const limited = enforceRateLimit(c, formLimiter, "forms");
    if (limited) return limited;

    try {
      const payload = await readJsonBody(c, maxBodyBytes);
      const data = await captureService.submitForm({
        ...requestScope(c),
        formId: c.req.param("formId"),
        idempotencyKey: c.req.header("Idempotency-Key"),
        payload,
      });
      return c.json({ data }, data.replayed ? 200 : 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
