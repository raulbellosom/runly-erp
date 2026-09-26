// apps/api/src/lib/send-password-reset-email.js
//
// Shared by the public "olvidé mi contraseña" flow (POST /auth/forgot-password,
// still inline in index.js) and the admin-triggered "enviar restablecimiento"
// action (identity-routes.js). Extracted from index.js on 2026-09-25 so
// identity-routes.js doesn't need to import from index.js. Never throws on a
// missing SMTP config or unknown email — callers must always answer the
// caller with a generic success message so this can't be used to enumerate
// accounts.
import { buildPasswordResetEmail, resolveAppBaseUrl } from "../services/email-templates.js";
import { createSmtpService } from "../services/smtp-service.js";

export async function sendPasswordResetEmail(email, { requestedByAdmin = false, prisma, supabaseAdmin, companyBrandService }) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: normalized,
    });
    if (error || !data?.properties?.hashed_token) {
      // Silent to the caller by design (no account enumeration) — but log
      // server-side, since "no such Supabase Auth user" is by far the most
      // common reason this looks like it silently does nothing in dev.
      console.warn("[auth] password reset: generateLink failed for", normalized, "-", error?.message ?? "no hashed_token in response");
      return;
    }

    const appBaseUrl = resolveAppBaseUrl(process.env);
    if (!appBaseUrl) {
      console.warn("[auth] password reset: no app base URL resolved (RUNLY_APP_URL/APP_URL/PUBLIC_APP_URL) — email not sent");
      return;
    }
    const resetUrl = `${appBaseUrl}/app/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;

    const brand = await companyBrandService.getBrandForEmail(normalized);
    const mail = buildPasswordResetEmail({ resetUrl, requestedByAdmin, brand });
    const smtp = createSmtpService({ prisma });
    await smtp.sendEmail({
      to: normalized,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      fromName: companyBrandService.fromNameFor(brand),
    });
  } catch (err) {
    console.warn("[auth] password reset email failed:", err?.message ?? err);
  }
}
