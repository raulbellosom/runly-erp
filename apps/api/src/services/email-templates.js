// Shared branded Atlas ERP email shell + concrete templates.
// Same visual language as buildNotificationEmail in notification-delivery-worker.js
// (logo header, white card, blue CTA, footer). Keep new transactional emails
// going through renderAtlasEmailLayout so they stay on-brand.

const CTA_COLOR = "#2563eb";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// Public URL of the SPA (for join / open links).
export function resolveAppBaseUrl(env = process.env) {
  for (const candidate of [env.PUBLIC_APP_URL, env.APP_URL, env.RUNLY_APP_URL, env.WEB_APP_URL]) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return env.NODE_ENV !== "production" ? "http://localhost:5173" : null;
}

// Base URL of the API — only used to serve the brand logo asset.
export function resolveApiBaseUrl(env = process.env) {
  for (const candidate of [env.RUNLY_API_URL, env.API_URL, env.VITE_RUNLY_API_URL]) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return env.NODE_ENV !== "production" ? "http://localhost:4010" : null;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Only ever used for a CSS `background:` value below — reject anything that
// isn't a plain #rgb/#rrggbb hex so a stray value in BrandingConfig.primaryColor
// can't inject extra CSS into the email.
function safeHexColor(value, fallback) {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim()) ? value.trim() : fallback;
}

// Branded shell. `bodyHtml` is inserted verbatim — callers must escape their
// own interpolations (use escapeHtml). `cta` is `{ label, url }` or null.
// `brand` is optional company branding — `{ name, logoUrl, primaryColor }` —
// resolved by the caller from BrandingConfig. Any field it omits falls back
// to the plain Runly look, and a small "Con tecnología de Runly ERP" line is
// always kept in the footer so a company-branded email still nods to Runly.
export function renderAtlasEmailLayout({ kicker, heading, bodyHtml = "", cta = null, footnote, brand = null, env = process.env }) {
  const apiBaseUrl = resolveApiBaseUrl(env);
  const runlyLogoUrl = apiBaseUrl ? `${apiBaseUrl}/brand/runly-logo-horizontal.png` : null;
  const logoUrl = brand?.logoUrl || runlyLogoUrl;
  const logoAlt = brand?.logoUrl ? (brand?.name ?? "Empresa") : "Runly ERP";
  const accentColor = safeHexColor(brand?.primaryColor, CTA_COLOR);
  const foot = footnote ?? "Este correo fue generado automaticamente por Runly ERP.";
  const showRunlyWink = Boolean(brand?.logoUrl || brand?.name);

  return `
<div style="background:#f3f4f6;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <tr>
      <td style="padding:20px 24px;border-bottom:1px solid #eef2ff;background:#f8fafc">
        ${logoUrl ? `<img src="${logoUrl}" alt="${escapeHtml(logoAlt)}" style="height:26px;display:block;margin-bottom:10px" />` : ""}
        ${kicker ? `<div style="font-size:12px;color:#6b7280;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(kicker)}</div>` : ""}
        <h1 style="margin:6px 0 0 0;font-size:24px;line-height:1.25;color:#0f172a">${escapeHtml(heading)}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px">
        ${bodyHtml}
        ${
          cta?.url
            ? `<a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${accentColor};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600">${escapeHtml(cta.label ?? "Abrir")}</a>`
            : ""
        }
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:12px;color:#64748b">
        ${escapeHtml(foot)}
        ${showRunlyWink ? `<div style="margin-top:6px;color:#94a3b8">Con tecnología de Runly ERP</div>` : ""}
      </td>
    </tr>
  </table>
</div>
  `.trim();
}

// ── Concrete templates ──────────────────────────────────────────────────────

// `brand` — optional `{ name, logoUrl, primaryColor }` resolved by the caller
// from the inviting company's BrandingConfig. Omit it (or leave fields out)
// and the email renders with plain Runly branding — see renderAtlasEmailLayout.
export function buildCallInviteEmail({ joinUrl, inviterName = null, conversationTitle = null, brand = null, env = process.env }) {
  const orgName = brand?.name ? brand.name : "Runly ERP";
  const who = inviterName ? `${inviterName} te invitó` : "Te invitaron";
  const where = conversationTitle ? ` en "${conversationTitle}"` : "";
  const heading = "Te invitaron a una llamada";

  const bodyHtml = `
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155">
          ${escapeHtml(who)} a una videollamada${escapeHtml(where)} en ${escapeHtml(orgName)}.
        </p>
        <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#64748b">
          Solo necesitas tu nombre para entrar. Si el boton no funciona, copia este enlace en tu navegador:<br />
          <span style="word-break:break-all;color:#334155">${escapeHtml(joinUrl)}</span>
        </p>`;

  const html = renderAtlasEmailLayout({
    kicker: "Invitacion a llamada",
    heading,
    bodyHtml,
    cta: { label: "Unirme a la llamada", url: joinUrl },
    footnote: `Recibiste este correo porque alguien te invitó a una llamada en ${orgName}.`,
    brand,
    env,
  });

  const text = [
    orgName,
    "",
    `${who} a una videollamada${where}.`,
    "",
    `Unirme a la llamada: ${joinUrl}`,
  ].join("\n");

  return { subject: heading, html, text };
}

// `brand` — optional `{ name, logoUrl, primaryColor }` resolved by the caller
// from the recipient's company BrandingConfig. Omit it (or leave fields out)
// and the email renders with plain Runly branding — see renderAtlasEmailLayout.
export function buildPasswordResetEmail({ resetUrl, requestedByAdmin = false, brand = null, env = process.env }) {
  const heading = "Restablecer tu contraseña";
  const orgName = brand?.name ? brand.name : "Runly ERP";

  const bodyHtml = `
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155">
          ${
            requestedByAdmin
              ? `Un administrador solicitó restablecer la contraseña de tu cuenta en ${escapeHtml(orgName)}.`
              : `Recibimos una solicitud para restablecer la contraseña de tu cuenta en ${escapeHtml(orgName)}.`
          }
        </p>
        <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#64748b">
          Si tú no solicitaste esto, puedes ignorar este correo. Si el botón no funciona, copia este enlace en tu navegador:<br />
          <span style="word-break:break-all;color:#334155">${escapeHtml(resetUrl)}</span>
        </p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">
          Este enlace expira pronto por seguridad.
        </p>`;

  const html = renderAtlasEmailLayout({
    kicker: "Seguridad de la cuenta",
    heading,
    bodyHtml,
    cta: { label: "Restablecer contraseña", url: resetUrl },
    footnote: `Recibiste este correo porque se solicitó restablecer la contraseña de tu cuenta en ${orgName}.`,
    brand,
    env,
  });

  const text = [
    orgName,
    "",
    "Restablece tu contraseña usando el siguiente enlace:",
    "",
    resetUrl,
  ].join("\n");

  return { subject: heading, html, text };
}

// Sent to an external website-chat visitor whose session expired — the one
// email in the app that used to be a one-off inline template with no Runly
// branding, no text alternative discipline shared with the rest, and a raw
// (unescaped) company name. `brand` — optional `{ name, logoUrl, primaryColor }`
// — comes from the same BrandingConfig lookup as the other templates here.
export function buildChatGuestExpiryEmail({ resumeUrl, guestName = null, brand = null, env = process.env }) {
  const orgName = brand?.name ? brand.name : "Runly ERP";
  const name = guestName ? guestName : "Visitante";
  const heading = "Tu conversación expiró";

  const bodyHtml = `
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155">
          Hola ${escapeHtml(name)}, tu sesión de chat con <strong>${escapeHtml(orgName)}</strong> expiró por inactividad.
        </p>
        <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#64748b">
          Si deseas retomar la conversación, usa el siguiente enlace. Si el botón no funciona, cópialo en tu navegador:<br />
          <span style="word-break:break-all;color:#334155">${escapeHtml(resumeUrl)}</span>
        </p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">
          Este enlace es de un solo uso y expira en 24 horas.
        </p>`;

  const html = renderAtlasEmailLayout({
    kicker: "Chat en sitio web",
    heading,
    bodyHtml,
    cta: { label: "Retomar conversación", url: resumeUrl },
    footnote: `Recibiste este correo porque tenías una conversación de chat abierta con ${orgName}.`,
    brand,
    env,
  });

  const text = [
    orgName,
    "",
    `Hola ${name}, tu sesión de chat con ${orgName} expiró por inactividad.`,
    "",
    `Retomar conversación: ${resumeUrl}`,
    "",
    "Este enlace es de un solo uso y expira en 24 horas.",
  ].join("\n");

  return { subject: `Tu conversación con ${orgName} ha expirado`, html, text };
}

// Sent when an admin invites someone to join a company in Runly — the other
// email in the app that used to be a raw unstyled <p> with no Runly branding
// and no text alternative. `brand` — optional `{ name, logoUrl, primaryColor }`
// — comes from the same BrandingConfig lookup as the other templates here.
export function buildCompanyInvitationEmail({ invitationUrl, brand = null, env = process.env }) {
  const orgName = brand?.name ? brand.name : "Runly ERP";
  const heading = "Te invitaron a una empresa";

  const bodyHtml = `
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155">
          Te invitaron a unirte a <strong>${escapeHtml(orgName)}</strong> en Runly ERP.
        </p>
        <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#64748b">
          Inicia sesión y acepta la invitación. Si el botón no funciona, copia este enlace en tu navegador:<br />
          <span style="word-break:break-all;color:#334155">${escapeHtml(invitationUrl)}</span>
        </p>`;

  const html = renderAtlasEmailLayout({
    kicker: "Invitación",
    heading,
    bodyHtml,
    cta: { label: "Aceptar invitación", url: invitationUrl },
    footnote: `Recibiste este correo porque te invitaron a unirte a ${orgName} en Runly ERP.`,
    brand,
    env,
  });

  const text = [
    orgName,
    "",
    `Te invitaron a unirte a ${orgName} en Runly ERP.`,
    "",
    `Aceptar invitación: ${invitationUrl}`,
  ].join("\n");

  return { subject: `Te invitaron a ${orgName}`, html, text };
}

// The "Enviar prueba" button in Ajustes -> SMTP — an admin sending this to
// themselves to confirm delivery. Branded like every other template here so
// the same click also previews what the company's branding looks like in a
// real inbox, instead of a bare unstyled <p>.
export function buildSmtpTestEmail({ brand = null, env = process.env }) {
  const orgName = brand?.name ? brand.name : "Runly ERP";
  const heading = "La configuración SMTP funciona";

  const bodyHtml = `
        <p style="margin:0;font-size:15px;line-height:1.6;color:#334155">
          Este es un correo de prueba. Si lo estás viendo, la configuración SMTP de <strong>${escapeHtml(orgName)}</strong> puede enviar correo correctamente.
        </p>`;

  const html = renderAtlasEmailLayout({
    kicker: "Prueba de SMTP",
    heading,
    bodyHtml,
    footnote: `Enviado como prueba de la configuración SMTP de ${orgName} en Runly ERP.`,
    brand,
    env,
  });

  const text = [
    orgName,
    "",
    "La configuración SMTP funciona correctamente.",
  ].join("\n");

  return { subject: "Runly ERP — Prueba de SMTP", html, text };
}
