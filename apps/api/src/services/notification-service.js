import {
  notificationPublishSchema,
  notificationListQuerySchema,
  notificationPreferenceUpsertSchema,
  webPushSubscriptionSchema,
} from "@runly/validators";

import { getDefaultNotificationPreference } from '@runly/core';

const DEDUPE_WINDOW_MS = 5000;

// Chat-message emails (`chat.mail:<conv>:<user>` dedupe keys) are throttled to at
// most one per conversation per recipient within this window, and additionally
// suppressed while a prior one is still unread — opening the conversation marks
// it read (markReadBySource), which re-arms the next email. Product behavior, not
// configuration; keep in sync with CHAT_EMAIL_THROTTLE_MS in chat-service.js.
const CHAT_MAIL_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours

const PRIORITY_KIND_MAP = {
  low: "info",
  medium: "info",
  high: "warning",
  critical: "error",
};

export class NotificationServiceError extends Error {
  constructor(message, status = 500, code = "notification_error") {
    super(message);
    this.name = "NotificationServiceError";
    this.status = status;
    this.code = code;
  }
}

function toNotificationView(row) {
  return {
    ...row,
    read: Boolean(row.readAt),
  };
}

function buildCompanyScopeClause(companyId) {
  return {
    OR: [{ companyId }, { companyId: null }],
  };
}

function buildListWhere({ userId, companyId, query }) {
  const where = {
    userId,
    ...buildCompanyScopeClause(companyId),
    AND: [{ OR: [{ deliveries: { some: { channel: "in_app" } } }, { deliveries: { none: {} } }] }],
  };

  if (query.unreadOnly === true) {
    where.readAt = null;
  }
  if (query.priority) {
    where.priority = query.priority;
  }
  if (query.eventType) {
    where.eventType = query.eventType;
  }
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = query.from;
    if (query.to) where.createdAt.lte = query.to;
  }
  if (query.q) {
    const term = query.q.trim();
    if (term) {
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { body: { contains: term, mode: "insensitive" } },
        { eventType: { contains: term, mode: "insensitive" } },
      ];
      where.AND.push(buildCompanyScopeClause(companyId));
    }
  }
  return where;
}

export function createNotificationService({ prisma, broadcaster = null }) {
  // activeCompanyId: the caller's validated active company, resolved by the
  // API's tenant middleware and threaded down from routes/notifications.js.
  // See docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
  async function resolveCompanyContext(authUserId, activeCompanyId) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotificationServiceError(
        "Perfil de usuario no encontrado.",
        404,
        "profile_not_found",
      );
    }

    if (activeCompanyId) {
      return { profileId: profile.id, companyId: activeCompanyId };
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: profile.id, enabled: true },
      orderBy: { createdAt: "desc" },
      select: { companyId: true },
    });
    if (!membership?.companyId) {
      throw new NotificationServiceError(
        "No tienes una empresa activa.",
        403,
        "no_active_company",
      );
    }

    return {
      profileId: profile.id,
      companyId: membership.companyId,
    };
  }

  async function list({ authUserId, companyId: activeCompanyId, query }) {
    const parsed = notificationListQuerySchema.parse(query ?? {});
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const where = buildListWhere({ userId: profileId, companyId, query: parsed });

    const take = parsed.limit + 1;
    const options = {
      where,
      orderBy: [{ id: "desc" }],
      take,
    };
    if (parsed.cursor) {
      options.cursor = { id: parsed.cursor };
      options.skip = 1;
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany(options),
      prisma.notification.count({ where: buildListWhere({ userId: profileId, companyId, query: { unreadOnly: true } }) }),
    ]);
    const hasNext = rows.length > parsed.limit;
    const items = hasNext ? rows.slice(0, parsed.limit) : rows;
    const nextCursor = hasNext ? items.at(-1)?.id ?? null : null;

    return {
      data: items.map(toNotificationView),
      unreadCount,
      pageInfo: { nextCursor },
    };
  }

  async function getOwnedNotification({ authUserId, companyId: activeCompanyId, id }) {
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const row = await prisma.notification.findFirst({
      where: {
        id,
        userId: profileId,
        ...buildCompanyScopeClause(companyId),
      },
    });
    if (!row) {
      throw new NotificationServiceError(
        "Notificacion no encontrada.",
        404,
        "notification_not_found",
      );
    }
    return row;
  }

  async function markRead({ authUserId, companyId: activeCompanyId, id }) {
    const row = await getOwnedNotification({ authUserId, companyId: activeCompanyId, id });
    if (row.readAt) return toNotificationView(row);

    const updated = await prisma.notification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
    });
    return toNotificationView(updated);
  }

  async function markAllRead({ authUserId, companyId: activeCompanyId }) {
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const result = await prisma.notification.updateMany({
      where: {
        userId: profileId,
        readAt: null,
        ...buildCompanyScopeClause(companyId),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async function resolveRecipientUserIds({ companyId, userIds }) {
    const rows = await prisma.membership.findMany({
      where: {
        companyId,
        enabled: true,
        userId: { in: userIds },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }

  async function isDuplicate({ tx, userId, dedupeKey }) {
    if (!dedupeKey) return false;
    // Chat notifications deduplicate against any existing UNREAD notification
    // for the same conversation — no time window — to prevent message spam.
    if (dedupeKey.startsWith('chat.message.new:')) {
      const row = await tx.notification.findFirst({
        where: { userId, dedupeKey, readAt: null },
        select: { id: true },
      });
      return Boolean(row);
    }
    // Chat email throttle: skip if a prior chat email for this conversation is
    // still unread OR was created within the throttle window.
    if (dedupeKey.startsWith('chat.mail:')) {
      const since = new Date(Date.now() - CHAT_MAIL_THROTTLE_MS);
      const row = await tx.notification.findFirst({
        where: {
          userId,
          dedupeKey,
          OR: [{ readAt: null }, { createdAt: { gte: since } }],
        },
        select: { id: true },
      });
      return Boolean(row);
    }
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const row = await tx.notification.findFirst({
      where: { userId, dedupeKey, createdAt: { gte: since } },
      select: { id: true },
    });
    return Boolean(row);
  }

  async function markReadBySource({ authUserId, companyId: activeCompanyId, sourceType, sourceId }) {
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const result = await prisma.notification.updateMany({
      where: {
        userId: profileId,
        readAt: null,
        sourceType,
        sourceId,
        ...buildCompanyScopeClause(companyId),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // `respectChannelDefaults: false` — the caller has already decided the
  // recipient should get this on the external channels (e.g. chat-service has
  // run its own away/throttle gate for chat-message email), so email/web_push
  // are allowed unless the recipient has an EXPLICIT saved opt-out. `mute` and
  // in-app defaults are still honoured.
  async function publish({ companyId, actorId = null, input, respectChannelDefaults = true }) {
    const parsed = notificationPublishSchema.parse(input ?? {});
    const recipientUserIds = await resolveRecipientUserIds({
      companyId,
      userIds: parsed.recipients.userIds,
    });
    if (!recipientUserIds.length) {
      throw new NotificationServiceError(
        "No se encontraron destinatarios validos para la empresa activa.",
        400,
        "no_valid_recipients",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      const inAppRecipientIds = [];
      let deduped = 0;

      for (const userId of recipientUserIds) {
        const dedupeKey =
          parsed.dedupeKey ??
          `${parsed.eventType}:${parsed.sourceType ?? ""}:${parsed.sourceId ?? ""}:${userId}`;
        if (await isDuplicate({ tx, userId, dedupeKey })) {
          deduped += 1;
          continue;
        }

        // Saved choices always override defaults, including explicit opt-outs.
        const pref = await tx.notificationPreference.findFirst({
          where: { userId, eventType: parsed.eventType },
          select: { inAppEnabled: true, emailEnabled: true, pushEnabled: true, muteUntil: true },
        });
        const effective = { ...getDefaultNotificationPreference(parsed.eventType), ...pref };
        const muted = pref?.muteUntil && new Date(pref.muteUntil) > new Date();
        const allowedChannels = parsed.channels.filter((ch) => {
          if (muted) return false;
          if (ch === 'in_app') return effective.inAppEnabled !== false;
          if (ch === 'email') {
            return respectChannelDefaults ? effective.emailEnabled === true : pref?.emailEnabled !== false;
          }
          if (ch === 'web_push') {
            return respectChannelDefaults ? effective.pushEnabled === true : pref?.pushEnabled !== false;
          }
          return true;
        });

        if (!allowedChannels.length) continue;

        const notification = await tx.notification.create({
          data: {
            userId,
            companyId,
            kind: PRIORITY_KIND_MAP[parsed.priority] ?? "info",
            eventType: parsed.eventType,
            sourceType: parsed.sourceType ?? null,
            sourceId: parsed.sourceId ?? null,
            sourceActivityId: parsed.sourceActivityId ?? null,
            priority: parsed.priority ?? "medium",
            title: parsed.title,
            body: parsed.body ?? null,
            link: parsed.link ?? null,
            metadata: parsed.metadata ?? null,
            dedupeKey,
            expiresAt: parsed.expiresAt ?? null,
          },
        });

        if (allowedChannels.length > 0) {
          await tx.notificationDelivery.createMany({
            data: allowedChannels.map((channel) => ({
              notificationId: notification.id,
              channel,
              status: channel === 'in_app' ? 'sent' : 'queued',
              sentAt: channel === 'in_app' ? new Date() : null,
              attempts: 0,
            })),
            skipDuplicates: true,
          });
        }

        if (allowedChannels.includes('in_app')) inAppRecipientIds.push(userId);

        created.push(notification);
      }

      return { created, deduped, inAppRecipientIds };
    });

    const publishResult = {
      created: result.created.length,
      deduped: result.deduped,
      data: result.created.map(toNotificationView),
      actorId,
    };

    if (broadcaster && result.inAppRecipientIds.length > 0) {
      await broadcaster.broadcastToUsers(result.inAppRecipientIds, "notification.new", {
        companyId, sourceType: parsed.sourceType, sourceId: parsed.sourceId,
        eventType: parsed.eventType,
        title: parsed.title,
        body: parsed.body ?? null,
        priority: parsed.priority ?? "medium",
        link: parsed.link ?? null,
        // Lets the client collapse the realtime copy against the web-push copy
        // of the same alert (both compute `dk:<dedupeKey>`). Only stable when an
        // explicit dedupeKey was supplied (chat events do); otherwise the client
        // falls back to a content hash, which already matches across surfaces.
        dedupeKey: parsed.dedupeKey ?? null,
      }).catch(() => {});
    }

    return publishResult;
  }

  async function publishFromContext({ authUserId, companyId: activeCompanyId, input }) {
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    return publish({ companyId, actorId: profileId, input });
  }

  async function listPreferences({ authUserId, companyId: activeCompanyId }) {
    const { profileId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const rows = await prisma.notificationPreference.findMany({
      where: { userId: profileId },
      orderBy: [{ eventType: "asc" }],
    });
    return { data: rows };
  }

  async function upsertPreference({ authUserId, companyId: activeCompanyId, input }) {
    const parsed = notificationPreferenceUpsertSchema.parse(input ?? {});
    const { profileId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const row = await prisma.notificationPreference.upsert({
      where: {
        userId_eventType: {
          userId: profileId,
          eventType: parsed.eventType,
        },
      },
      create: {
        userId: profileId,
        eventType: parsed.eventType,
        inAppEnabled: parsed.inAppEnabled,
        emailEnabled: parsed.emailEnabled,
        pushEnabled: parsed.pushEnabled,
        muteUntil: parsed.muteUntil ?? null,
      },
      update: {
        inAppEnabled: parsed.inAppEnabled,
        emailEnabled: parsed.emailEnabled,
        pushEnabled: parsed.pushEnabled,
        muteUntil: parsed.muteUntil ?? null,
      },
    });
    return { data: row };
  }

  async function subscribeWebPush({ authUserId, companyId: activeCompanyId, input, userAgent = null }) {
    const parsed = webPushSubscriptionSchema.parse(input ?? {});
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const row = await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.endpoint },
      create: {
        userId: profileId,
        companyId,
        endpoint: parsed.endpoint,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        deviceLabel: parsed.deviceLabel ?? null,
        userAgent,
        enabled: true,
        lastSeenAt: new Date(),
      },
      update: {
        userId: profileId,
        companyId,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        deviceLabel: parsed.deviceLabel ?? null,
        userAgent,
        enabled: true,
        lastSeenAt: new Date(),
      },
    });

    // A user-agent describes browser software, not a device or installation.
    // Keep distinct endpoints: identical phones and separately installed PWAs
    // must not disable one another. Expired endpoints are retired on delivery.

    return { data: row };
  }

  async function unsubscribeWebPush({ authUserId, companyId: activeCompanyId, id }) {
    const { profileId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const sub = await prisma.pushSubscription.findFirst({
      where: { id, userId: profileId },
      select: { id: true },
    });
    if (!sub) {
      throw new NotificationServiceError(
        "Suscripcion push no encontrada.",
        404,
        "push_subscription_not_found",
      );
    }

    await prisma.pushSubscription.delete({ where: { id: sub.id } });
    return { data: { deleted: true } };
  }

  return {
    resolveCompanyContext,
    list,
    markRead,
    markAllRead,
    markReadBySource,
    publish,
    publishFromContext,
    listPreferences,
    upsertPreference,
    subscribeWebPush,
    unsubscribeWebPush,
  };
}
