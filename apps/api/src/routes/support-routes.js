import { Hono } from "hono";
import { bugReportSchema } from "@runly/validators";
import { createSupportReportService, SupportReportError } from "../services/support-report-service.js";

const COMPANY_HEADER_CANDIDATES = ["X-Runly-Company-Id", "X-Atlas-Company-Id"];

function handleError(c, error, fallback) {
  if (error instanceof SupportReportError) {
    return c.json(
      {
        error: error.message,
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      error.status,
    );
  }
  if (error?.name === "ZodError") {
    return c.json({ error: (error.errors ?? error.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
  }
  console.error("[runly.support]", error?.stack ?? error);
  return c.json({ error: fallback }, 500);
}

// "Reportar bug" — any authenticated user, no dedicated permission: this is a
// diagnostics/support channel to the vendor, not a business-data endpoint.
export function createSupportRouter({ prisma, authMiddleware, env = process.env }) {
  const app = new Hono();
  const reportService = createSupportReportService({ prisma, env });

  // Scoped to the concrete path, not "*" — this router is mounted at "/",
  // and a root-scoped guard would 401 every unmatched anonymous request
  // (including the public marketing site). See the load-bearing warning
  // above the app.route(...) calls in index.js.
  app.use("/support/*", authMiddleware);

  app.post("/support/report-bug", async (c) => {
    try {
      const payload = bugReportSchema.parse(await c.req.json());

      const profile = await prisma.userProfile.findUnique({
        where: { authUserId: c.get("authUserId") },
      });
      if (!profile?.enabled) {
        throw new SupportReportError("Perfil no encontrado.", 404, "profile_not_found");
      }

      let companyName = null;
      const companyId = COMPANY_HEADER_CANDIDATES
        .map((header) => c.req.header(header))
        .find(Boolean) ?? null;
      if (companyId) {
        const membership = await prisma.membership.findFirst({
          where: { userId: profile.id, companyId, enabled: true },
          include: { company: { select: { name: true } } },
        });
        companyName = membership?.company?.name ?? null;
      }

      await reportService.sendBugReport({
        userId: profile.id,
        userName: profile.displayName,
        userEmail: profile.email,
        companyId,
        companyName,
        payload,
      });

      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error, "No se pudo enviar el reporte.");
    }
  });

  return app;
}
