import { createSmtpService } from "./smtp-service.js";
import { buildBugReportEmail } from "./email-templates.js";

export class SupportReportError extends Error {
  constructor(message, status = 500, reason = "support_report_error") {
    super(message);
    this.name = "SupportReportError";
    this.status = status;
    this.reason = reason;
  }
}

const RATE_LIMIT_MS = 5 * 60 * 1000;

function rateLimitKey(userId) {
  return `bugreport:last:${userId}`;
}

// Converts a `data:image/jpeg;base64,...` URL (produced client-side by
// html2canvas) into a nodemailer attachment. Anything else is dropped rather
// than rejected — a missing screenshot must never block sending the report.
function screenshotAttachment(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const ext = match[1] === "png" ? "png" : "jpg";
  return {
    filename: `captura.${ext}`,
    content: match[2],
    encoding: "base64",
  };
}

// Generic counterpart for user-picked attachments (BugReportDialog.jsx) —
// unlike the screenshot, these keep the user's own filename and can be any
// of the MIME types packages/validators/src/support.js's
// ALLOWED_ATTACHMENT_MIME_TYPES allows, not just PNG/JPEG. Trusts that the
// caller already ran bugReportSchema (the only production call site,
// support-routes.js, always does) — MIME allowlist, dataUrl/mimeType
// consistency, size caps, and filename control-character rejection are all
// enforced there, not re-checked here.
function userAttachment({ filename, dataUrl } = {}) {
  if (!filename) return null;
  const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  return { filename, content: match[1], encoding: "base64" };
}

export function createSupportReportService({ prisma, env = process.env }) {
  async function checkRateLimit(userId) {
    const row = await prisma.instanceConfig.findUnique({ where: { key: rateLimitKey(userId) } });
    const lastSentAt = row ? Number(row.value) : 0;
    const elapsed = Date.now() - lastSentAt;
    if (elapsed < RATE_LIMIT_MS) {
      const error = new SupportReportError(
        "Espera antes de enviar otro reporte.",
        429,
        "rate_limited",
      );
      error.retryAfterSeconds = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      throw error;
    }
  }

  async function markSent(userId) {
    await prisma.instanceConfig.upsert({
      where: { key: rateLimitKey(userId) },
      create: { key: rateLimitKey(userId), value: String(Date.now()) },
      update: { value: String(Date.now()) },
    });
  }

  // Tries the platform-level SMTP (env vars or the instance-level Ajustes ->
  // SMTP config) first — this is mail addressed to Runly's own support inbox,
  // not the reporting company's business. Falls back to the active company's
  // SMTP relay only if the platform one isn't usable; the recipient (support
  // address) never changes, only which server relays the send.
  async function sendViaAvailableSmtp({ companyId, ...email }) {
    const platformSmtp = createSmtpService({ prisma, companyId: null, env });
    try {
      await platformSmtp.sendEmail(email);
      return;
    } catch (platformError) {
      if (!companyId) throw platformError;
      const companySmtp = createSmtpService({ prisma, companyId, env });
      await companySmtp.sendEmail(email);
    }
  }

  async function sendBugReport({ userId, userName, userEmail, companyId, companyName, payload }) {
    // RUNLY_SUPPORT_EMAIL lets a self-hosted instance redirect bug reports to
    // its own inbox; when unset, reports fall back to Runly's own support
    // address rather than disabling the feature — every deployment should be
    // able to report a bug out of the box.
    const supportEmail = env.RUNLY_SUPPORT_EMAIL || "hola@runly.mx";

    await checkRateLimit(userId);

    const userAttachments = (payload.attachments ?? []).map(userAttachment).filter(Boolean);

    const { subject, html, text } = buildBugReportEmail({
      errorMessage: payload.errorMessage,
      description: payload.description,
      stackText: [payload.errorStack, payload.componentStack].filter(Boolean).join("\n\n"),
      fields: [
        ["Fecha", new Date().toLocaleString("es-MX")],
        ["Usuario", userName ? `${userName} <${userEmail ?? ""}>` : userEmail],
        ["Empresa", companyName],
        ["Módulo / ruta", payload.context],
        ["URL", payload.url],
        ["Adjuntos", userAttachments.length ? userAttachments.map((a) => a.filename).join(", ") : null],
      ],
      env,
    });

    const attachments = [screenshotAttachment(payload.screenshot), ...userAttachments].filter(Boolean);

    try {
      await sendViaAvailableSmtp({
        companyId,
        to: supportEmail,
        subject,
        html,
        text,
        fromName: "Runly ERP - Reporte de bug",
        attachments: attachments.length ? attachments : undefined,
      });
    } catch (err) {
      throw new SupportReportError(
        "No se pudo enviar el reporte (SMTP no configurado).",
        502,
        "smtp_error",
      );
    }

    await markSent(userId);
  }

  return { sendBugReport };
}
