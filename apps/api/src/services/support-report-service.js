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
    const supportEmail = env.RUNLY_SUPPORT_EMAIL;
    if (!supportEmail) {
      throw new SupportReportError(
        "Reporte de bugs no disponible en esta instancia.",
        503,
        "not_configured",
      );
    }

    await checkRateLimit(userId);

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
      ],
      env,
    });

    const attachment = screenshotAttachment(payload.screenshot);

    try {
      await sendViaAvailableSmtp({
        companyId,
        to: supportEmail,
        subject,
        html,
        text,
        fromName: "Runly ERP - Reporte de bug",
        attachments: attachment ? [attachment] : undefined,
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
