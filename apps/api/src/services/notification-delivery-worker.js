import { canReceiveResourceEvent } from './notification-access.js';
import { createSmtpService } from "./smtp-service.js";
import { createWebPushService } from "./web-push-service.js";
import { createFcmService } from "./fcm-service.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 25;
// A row parked in 'sending' longer than this was almost certainly abandoned by a
// killed/crashed pass — reclaim it on the next tick.
const SENDING_RECLAIM_MINUTES = 5;

function asErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== "string") return null;
  const input = value.trim();
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function resolveAppBaseUrl({ prisma }) {
  const envCandidates = [
    process.env.RUNLY_APP_URL,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    process.env.WEB_APP_URL,
  ];
  for (const candidate of envCandidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  if (prisma?.instanceConfig?.findMany) {
    try {
      const cfg = await prisma.instanceConfig.findMany({
        where: {
          key: {
            in: ["app.url", "app.public_url", "platform.public_url"],
          },
        },
        select: { key: true, value: true },
      });
      for (const row of cfg) {
        const normalized = normalizeBaseUrl(row?.value);
        if (normalized) return normalized;
      }
    } catch {
      // Ignore config lookup failures and continue with fallbacks.
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:5173";
  }
  return null;
}

function toAbsoluteLink(link, appBaseUrl) {
  if (!link || typeof link !== "string") return null;
  const value = link.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!appBaseUrl) return value;
  try {
    return new URL(value, `${appBaseUrl}/`).toString();
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function reminderLeadText(minutesBefore) {
  const minutes = Number(minutesBefore);
  if (!Number.isFinite(minutes)) return null;
  if (minutes === 0) return "A la hora del evento";
  if (minutes === 60) return "1 hora antes";
  return `${minutes} minutos antes`;
}

const EVENT_TYPE_LABELS = {
  // Calendar
  "calendar.event.reminder": "Recordatorio de evento",
  "calendar.event.created": "Evento creado",
  "calendar.event.updated": "Evento actualizado",
  "calendar.event.deleted": "Evento eliminado",
  "calendar.event.invite": "Invitacion a evento",
  "calendar.event.reschedule": "Evento reprogramado",
  "calendar.event.cancel": "Evento cancelado",
  // Projects
  "projects.member.added": "Agregado a proyecto",
  "projects.task.assigned": "Tarea asignada",
  "projects.task.unassigned": "Removido de tarea",
  "projects.task.comment": "Comentario en tarea",
  "projects.task.mention": "Mencion en comentario",
  "projects.task.reaction": "Reaccion a tu comentario",
  "projects.task.status_changed": "Estado de tarea actualizado",
  "projects.task.due_soon": "Tarea por vencer",
  // Chat
  "chat.message.new": "Mensaje de chat",
  "chat.thread.reply": "Respuesta en un hilo",
  "chat.mention.new": "Mencion en un chat",
  "chat.member.added": "Te agregaron a un chat",
  // Inventory
  "inventory.item.mention": "Mencion en inventario",
  "inventory.item.comment": "Comentario en elemento",
  "inventory.item.reaction": "Reaccion a tu comentario",
  // Ledger
  "ledger.account_invite": "Invitacion a cuenta",
  "ledger.group_invite": "Invitacion a grupo",
  "ledger.access_revoked": "Acceso revocado",
  // Growth
  "growth.lead.created": "Nuevo lead",
  "growth.lead.assigned": "Lead asignado",
  // Finanzas personales
  "pfm.budget.threshold": "Presupuesto cerca del limite",
  "pfm.budget.overage": "Presupuesto excedido",
  // Notas
  "notes.note.shared": "Nota compartida",
  // Website / storefront
  "website.sale.confirmed": "Venta confirmada",
  // System
  "system.alert": "Alerta del sistema",
  "general": "General",
};

const PRIORITY_LABELS = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const SOURCE_TYPE_LABELS = {
  CalendarEvent: "Evento de calendario",
  Contact: "Contacto",
  HrEmployee: "Empleado",
  FileAsset: "Archivo",
  Company: "Empresa",
  Invoice: "Factura",
  FinanceDocument: "Documento financiero",
  Project: "Proyecto",
  Task: "Tarea",
  LedgerAccount: "Cuenta contable",
  LedgerGroup: "Grupo contable",
  chat_conversation: "Conversacion",
  chat_message: "Mensaje",
};

// Leading segments we strip when humanizing an unmapped dotted/snake token, so a
// fallback never shows a raw identifier like "chat.message.new" to the user.
const TOKEN_NAMESPACES = new Set([
  "chat", "projects", "project", "calendar", "ledger", "pfm", "inventory",
  "notes", "note", "growth", "website", "system", "hr", "finance",
]);

function humanizeToken(raw) {
  if (!raw || typeof raw !== "string") return "";
  const parts = raw.split(/[._-]+/).filter(Boolean);
  if (parts.length > 1 && TOKEN_NAMESPACES.has(parts[0].toLowerCase())) parts.shift();
  const joined = parts.join(" ").trim();
  return joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : "";
}

function labelForEventType(raw) {
  return EVENT_TYPE_LABELS[raw] ?? (humanizeToken(raw) || raw || "Notificacion");
}

function labelForSourceType(raw) {
  return SOURCE_TYPE_LABELS[raw] ?? humanizeToken(raw);
}

// `brand` is resolved per company from BrandingConfig (see resolveCompanyBrand):
// { logoUrl, companyName }. With a logo we show it; otherwise a text wordmark
// using the company name, falling back to "Atlas ERP".
function brandHeaderHtml(brand) {
  const logoUrl = brand?.logoUrl ?? null;
  if (logoUrl) {
    const alt = escapeHtml(brand?.companyName || "Logo");
    return `<img src="${logoUrl}" alt="${alt}" style="max-height:32px;display:block;margin-bottom:10px" />`;
  }
  const name = brand?.companyName;
  if (name) {
    return `<div style="font-size:18px;font-weight:700;letter-spacing:-.01em;color:#0f172a;margin-bottom:8px">${escapeHtml(name)}</div>`;
  }
  return `<div style="font-size:18px;font-weight:700;letter-spacing:-.01em;color:#0f172a;margin-bottom:8px">Runly<span style="color:#2563eb">ERP</span></div>`;
}

const EMAIL_FOOTER_HTML = `<tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:12px;color:#64748b">Este correo fue generado automaticamente por Runly ERP.</td></tr>`;

function buildChatEmail({ notification, link, brand, createdAt }) {
  const meta = notification?.metadata ?? {};
  const kind = typeof meta.kind === "string" ? meta.kind : null;
  const senderName = meta.senderName || notification?.title || "Alguien";
  const convTitle = meta.conversationTitle || null;
  const snippet = meta.snippet || notification?.body || "";
  const verb = kind === "chat_mention" ? "te mencionó" : "te escribió";
  const kicker =
    kind === "chat_mention" ? "Te mencionaron en un chat"
    : kind === "chat_member_added" ? "Te agregaron a un chat"
    : kind === "chat_thread_reply" ? "Respuesta en un hilo"
    : "Nuevo mensaje de chat";
  const subject = convTitle ? `${senderName} · ${convTitle}` : `Nuevo mensaje de ${senderName}`;
  const cta = link
    ? `<a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600">Abrir conversación</a>`
    : "";

  const html = `
<div style="background:#f3f4f6;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <tr>
      <td style="padding:20px 24px;border-bottom:1px solid #eef2ff;background:#f8fafc">
        ${brandHeaderHtml(brand)}
        <div style="font-size:12px;color:#6b7280;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(kicker)}</div>
        <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(senderName)}</h1>
        <div style="margin-top:2px;font-size:13px;color:#64748b">${escapeHtml(convTitle || "Conversación directa")}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px">
        <div style="border-left:3px solid #2563eb;padding:2px 0 2px 14px;margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;white-space:pre-wrap">${escapeHtml(snippet) || "(mensaje sin texto)"}</div>
        ${cta}
        ${createdAt ? `<div style="margin-top:14px;font-size:12px;color:#94a3b8">Recibido el ${escapeHtml(createdAt)}</div>` : ""}
      </td>
    </tr>
    ${EMAIL_FOOTER_HTML}
  </table>
</div>
  `.trim();

  const text = [
    `${senderName} ${verb}${convTitle ? ` en ${convTitle}` : ""}:`,
    "",
    `"${snippet || "(mensaje sin texto)"}"`,
    "",
    link ? `Abrir: ${link}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { subject, html, text };
}

function buildNotificationEmail({ notification, appBaseUrl, brand = null }) {
  const rawEventType = notification?.eventType ?? "general";
  const kind = typeof notification?.metadata?.kind === "string" ? notification.metadata.kind : null;
  const link = toAbsoluteLink(notification?.link ?? null, appBaseUrl);
  const createdAt = formatDateTime(notification?.createdAt);

  if ((kind && kind.startsWith("chat_")) || rawEventType.startsWith("chat.")) {
    return buildChatEmail({ notification, link, brand, createdAt });
  }

  const title = notification?.title ?? "Notificacion de Runly";
  const body = notification?.body ?? "";
  const eventStart = formatDateTime(notification?.metadata?.startAt);
  const reminderLead = reminderLeadText(notification?.metadata?.minutesBefore);
  const titleEsc = escapeHtml(title);
  const bodyEsc = escapeHtml(body);
  const eventTypeEsc = escapeHtml(labelForEventType(rawEventType));
  const rawPriority = notification?.priority ?? "medium";
  const priorityEsc = escapeHtml(PRIORITY_LABELS[rawPriority] ?? rawPriority);
  const sourceLabel = notification?.sourceType ? labelForSourceType(notification.sourceType) : null;

  const details = [
    createdAt ? `Generado: ${createdAt}` : null,
    eventStart ? `Evento: ${eventStart}` : null,
    reminderLead ? `Recordatorio: ${reminderLead}` : null,
    sourceLabel ? `Origen: ${sourceLabel}` : null,
  ].filter(Boolean);

  const html = `
<div style="background:#f3f4f6;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <tr>
      <td style="padding:20px 24px;border-bottom:1px solid #eef2ff;background:#f8fafc">
        ${brandHeaderHtml(brand)}
        <div style="font-size:12px;color:#6b7280;letter-spacing:.06em;text-transform:uppercase">Notificaciones Runly</div>
        <h1 style="margin:6px 0 0 0;font-size:24px;line-height:1.25;color:#0f172a">${titleEsc}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px">
        ${body ? `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155">${bodyEsc}</p>` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px 0;border:1px solid #e5e7eb;border-radius:10px">
          <tr><td style="padding:10px 12px;font-size:13px;color:#475569"><strong style="color:#111827">Tipo:</strong> ${eventTypeEsc}</td></tr>
          <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:13px;color:#475569"><strong style="color:#111827">Prioridad:</strong> ${priorityEsc}</td></tr>
          ${
            details.length
              ? `<tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:13px;color:#475569">${details
                  .map((line) => `<div>${escapeHtml(line)}</div>`)
                  .join("")}</td></tr>`
              : ""
          }
        </table>
        ${
          link
            ? `<a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600">Abrir notificacion</a>`
            : ""
        }
      </td>
    </tr>
    ${EMAIL_FOOTER_HTML}
  </table>
</div>
  `.trim();

  const text = [
    brand?.companyName || "Runly ERP",
    "",
    title,
    body ? body : null,
    link ? `Abrir: ${link}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject: title, html, text };
}

// Email logos are opened long after the send, so sign them for a week rather
// than the usual hour.
const EMAIL_LOGO_SIGNED_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createNotificationDeliveryWorker({
  prisma,
  smtpService = null,
  webPushService = null,
  fcmService = null,
  supabaseAdmin = null,
  logger = console,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  const smtp = smtpService ?? createSmtpService({ prisma });
  const webPush = webPushService ?? createWebPushService({ prisma });
  const fcm = fcmService ?? createFcmService({});

  // company id -> { logoUrl, companyName } for the email header. Logo comes from
  // BrandingConfig; falls back to the company name, then the Atlas wordmark.
  async function resolveCompanyBrands(companyIds) {
    const ids = [...new Set(companyIds.filter(Boolean))];
    const brands = new Map();
    if (!ids.length) return brands;

    let companies = [];
    try {
      companies = await prisma.company.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, brandingConfig: { select: { logoFileId: true } } },
      });
    } catch (err) {
      logger?.warn?.(`[notification-delivery] company brand lookup failed: ${asErrorMessage(err)}`);
      return brands;
    }

    const logoFileIds = companies.map((c) => c.brandingConfig?.logoFileId).filter(Boolean);
    const assetsById = new Map();
    if (logoFileIds.length && supabaseAdmin) {
      const assets = await prisma.fileAsset
        .findMany({ where: { id: { in: logoFileIds } }, select: { id: true, bucket: true, objectKey: true } })
        .catch(() => []);
      for (const asset of assets) assetsById.set(asset.id, asset);
    }

    for (const company of companies) {
      let logoUrl = null;
      const asset = company.brandingConfig?.logoFileId
        ? assetsById.get(company.brandingConfig.logoFileId)
        : null;
      if (asset && supabaseAdmin) {
        try {
          const { data } = await supabaseAdmin.storage
            .from(asset.bucket)
            .createSignedUrl(asset.objectKey, EMAIL_LOGO_SIGNED_TTL_SECONDS);
          logoUrl = data?.signedUrl ?? null;
        } catch {
          logoUrl = null;
        }
      }
      brands.set(company.id, { logoUrl, companyName: company.name ?? null });
    }
    return brands;
  }

  async function processPendingNotificationDeliveries({
    channel = "email",
    limit = DEFAULT_BATCH_SIZE,
    // Optional: restrict this pass to a specific set of notifications. Used by
    // latency-critical flows (incoming calls) to push THEIR own deliveries
    // out immediately without draining every other queued delivery too.
    notificationIds = null,
  } = {}) {
    const appBaseUrl = await resolveAppBaseUrl({ prisma });
    const take = Math.min(Math.max(Number(limit) || DEFAULT_BATCH_SIZE, 1), 200);
    const restrict =
      Array.isArray(notificationIds) && notificationIds.length
        ? { notificationId: { in: notificationIds } }
        : {};

    // Reclaim rows a killed/crashed pass abandoned mid-flight (status 'sending'
    // with no recent heartbeat).
    await prisma.notificationDelivery.updateMany({
      where: {
        channel,
        status: "sending",
        updatedAt: { lt: new Date(Date.now() - SENDING_RECLAIM_MINUTES * 60_000) },
      },
      data: { status: "queued" },
    });

    // Claim this pass's batch atomically: read candidates, then flip them
    // queued -> sending guarded by `status: 'queued'`. Postgres serialises the
    // UPDATEs, so a row that a concurrent worker already flipped no longer
    // matches and is not returned here — each queued row is processed by exactly
    // one pass, without a second worker or an overlapping tick double-sending.
    const candidates = await prisma.notificationDelivery.findMany({
      where: { channel, status: "queued", attempts: { lt: maxAttempts }, ...restrict },
      orderBy: [{ createdAt: "asc" }],
      take,
      select: { id: true },
    });
    const candidateIds = candidates.map((row) => row.id);

    let claimedIds = [];
    if (candidateIds.length) {
      const claimed = await prisma.notificationDelivery.updateManyAndReturn({
        where: { id: { in: candidateIds }, status: "queued" },
        data: { status: "sending", attempts: { increment: 1 } },
        select: { id: true },
      });
      claimedIds = claimed.map((row) => row.id);
    }

    const rows = claimedIds.length
      ? await prisma.notificationDelivery.findMany({
          where: { id: { in: claimedIds } },
          include: {
            notification: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    displayName: true,
                  },
                },
              },
            },
          },
          orderBy: [{ createdAt: "asc" }],
        })
      : [];

    const brandByCompany =
      channel === "email"
        ? await resolveCompanyBrands(rows.map((d) => d.notification?.companyId))
        : new Map();

    let processed = 0;
    let sent = 0;
    let failed = 0;
    let retrying = 0;

    for (const delivery of rows) {
      processed += 1;
      // attempts was already incremented by the claim above.
      const attempts = delivery.attempts ?? 1;
      if (!(await canReceiveResourceEvent(prisma, delivery.notification?.userId, delivery.notification))) {
        await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'failed', lastError: 'Acceso revocado.' } });
        failed += 1;
        continue;
      }
      const recipientEmail = delivery.notification?.user?.email ?? null;

      try {
        if (channel === "email") {
          if (!recipientEmail) {
            throw new Error("Destinatario sin correo electronico.");
          }
          const mail = buildNotificationEmail({
            notification: delivery.notification,
            appBaseUrl,
            brand: brandByCompany.get(delivery.notification?.companyId) ?? null,
          });
          await smtp.sendEmail({
            companyId: delivery.notification?.companyId,
            to: recipientEmail,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          });
        } else if (channel === "web_push") {
          const subscriptions = await prisma.pushSubscription.findMany({
            where: {
              userId: delivery.notification?.userId,
              enabled: true,
            },
            select: {
              id: true,
              endpoint: true,
              p256dh: true,
              auth: true,
            },
          });
          // endpoint is unique in the database. Do not collapse installations
          // by user-agent: that would drop valid recipients with identical UAs.
          if (!subscriptions.length) {
            throw new Error("Destinatario sin suscripciones push activas.");
          }

          const payload = webPush.buildPushPayload({
            notification: delivery.notification,
          });
          let successfulDeliveries = 0;
          const errors = [];
          for (const subscription of subscriptions) {
            const result = await webPush.sendToSubscription({
              subscription: {
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: subscription.p256dh,
                  auth: subscription.auth,
                },
              },
              payload,
            });
            if (result.ok) {
              successfulDeliveries += 1;
              await prisma.pushSubscription
                .update({
                  where: { id: subscription.id },
                  data: { lastSeenAt: new Date() },
                })
                .catch(() => {});
              continue;
            }
            errors.push(result.error ?? "Envio fallido.");
            if (result.permanentFailure) {
              await prisma.pushSubscription.update({
                where: { id: subscription.id },
                data: { enabled: false },
              });
            }
          }
          if (successfulDeliveries === 0) {
            throw new Error(errors.join(" | "));
          }
        } else if (channel === "fcm") {
          const tokens = await prisma.fcmDeviceToken.findMany({
            where: {
              userId: delivery.notification?.userId,
              enabled: true,
            },
            select: { id: true, token: true },
          });
          if (!tokens.length) {
            throw new Error("Destinatario sin tokens FCM activos.");
          }

          const payload = fcm.buildFcmData({ notification: delivery.notification });
          let successfulDeliveries = 0;
          const errors = [];
          for (const deviceToken of tokens) {
            const result = await fcm.sendToToken({ token: deviceToken.token, payload });
            if (result.ok) {
              successfulDeliveries += 1;
              await prisma.fcmDeviceToken
                .update({ where: { id: deviceToken.id }, data: { lastSeenAt: new Date() } })
                .catch(() => {});
              continue;
            }
            errors.push(result.error ?? "Envio fallido.");
            if (result.permanentFailure) {
              await prisma.fcmDeviceToken.update({
                where: { id: deviceToken.id },
                data: { enabled: false },
              });
            }
          }
          if (successfulDeliveries === 0) {
            throw new Error(errors.join(" | "));
          }
        }

        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "sent",
            attempts,
            sentAt: new Date(),
            lastError: null,
          },
        });
        sent += 1;
      } catch (err) {
        const errorMessage = asErrorMessage(err);
        const exhausted = attempts >= maxAttempts;
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: exhausted ? "failed" : "queued",
            attempts,
            lastError: errorMessage.slice(0, 1000),
          },
        });
        if (exhausted) failed += 1;
        else retrying += 1;
        logger?.warn?.(
          `[notification-delivery] ${delivery.id} ${exhausted ? "failed" : "retry"}: ${errorMessage}`,
        );
      }
    }

    return {
      channel,
      processed,
      sent,
      failed,
      retrying,
      maxAttempts,
    };
  }

  return {
    processPendingNotificationDeliveries,
  };
}
