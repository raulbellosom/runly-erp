import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNotificationDeliveryWorker } from "../notification-delivery-worker.js";
import { createNotificationService } from "../notification-service.js";

const AUTH_USER_ID = "auth-user-1";
const PROFILE_ID = "01900000-0000-7000-8000-000000000001";
const COMPANY_ID = "01900000-0000-7000-8000-000000000002";
const RECIPIENT_A = "01900000-0000-7000-8000-000000000003";
const RECIPIENT_B = "01900000-0000-7000-8000-000000000004";

function makeUuidFromInt(value) {
  return `01900000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function buildPrismaMock() {
  let seq = 10;
  const notifications = [];
  const deliveries = [];

  function inCompanyScope(row, where) {
    if (!Array.isArray(where?.OR)) return true;
    return where.OR.some((rule) => {
      if (Object.hasOwn(rule, "companyId")) {
        return row.companyId === rule.companyId;
      }
      return false;
    });
  }

  function matchWhere(row, where = {}) {
    if (where.userId && row.userId !== where.userId) return false;
    if (where.id && row.id !== where.id) return false;
    if (where.dedupeKey && row.dedupeKey !== where.dedupeKey) return false;
    if (where.readAt === null && row.readAt !== null) return false;
    if (!inCompanyScope(row, where)) return false;
    return true;
  }

  const txNotification = {
    findFirst: async ({ where }) => {
      if (where?.createdAt?.gte) {
        return (
          notifications.find(
            (row) =>
              row.userId === where.userId &&
              row.dedupeKey === where.dedupeKey &&
              row.createdAt >= where.createdAt.gte,
          ) ?? null
        );
      }
      // chat.mail throttle shape: { userId, dedupeKey, OR: [{readAt:null},{createdAt:{gte}}] }
      if (Array.isArray(where?.OR) && where.OR.some((r) => Object.hasOwn(r, "readAt") || r?.createdAt?.gte)) {
        const since = where.OR.find((r) => r?.createdAt?.gte)?.createdAt.gte ?? null;
        return (
          notifications.find(
            (row) =>
              row.userId === where.userId &&
              row.dedupeKey === where.dedupeKey &&
              (row.readAt == null || (since && row.createdAt >= since)),
          ) ?? null
        );
      }
      return notifications.find((row) => matchWhere(row, where)) ?? null;
    },
    create: async ({ data }) => {
      const row = {
        id: makeUuidFromInt(seq),
        createdAt: new Date(),
        updatedAt: new Date(),
        readAt: null,
        ...data,
      };
      seq += 1;
      notifications.push(row);
      return row;
    },
  };

  const prisma = {
    $queryRaw: async () => [{ allowed: true }],
    _notifications: notifications,
    _deliveries: deliveries,
    userProfile: {
      findUnique: async ({ where }) =>
        where?.authUserId === AUTH_USER_ID ? { id: PROFILE_ID } : null,
    },
    membership: {
      findFirst: async () => ({ companyId: COMPANY_ID }),
      findMany: async ({ where }) => {
        const candidates = Array.isArray(where?.userId?.in)
          ? where.userId.in
          : [];
        return candidates
          .filter((id) => [PROFILE_ID, RECIPIENT_A, RECIPIENT_B].includes(id))
          .map((id) => ({ userId: id }));
      },
    },
    notification: {
      count: async ({ where }) => notifications.filter(row => matchWhere(row, where)).length,
      findMany: async ({ where, take }) => {
        const rows = notifications
          .filter((row) => matchWhere(row, where))
          .sort((a, b) => String(b.id).localeCompare(String(a.id)));
        return typeof take === "number" ? rows.slice(0, take) : rows;
      },
      findFirst: async ({ where }) =>
        notifications.find((row) => matchWhere(row, where)) ?? null,
      update: async ({ where, data }) => {
        const idx = notifications.findIndex((row) => row.id === where.id);
        if (idx < 0) throw new Error("not found");
        notifications[idx] = {
          ...notifications[idx],
          ...data,
          updatedAt: new Date(),
        };
        return notifications[idx];
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (let index = 0; index < notifications.length; index += 1) {
          if (!matchWhere(notifications[index], where)) continue;
          notifications[index] = {
            ...notifications[index],
            ...data,
            updatedAt: new Date(),
          };
          count += 1;
        }
        return { count };
      },
      ...txNotification,
    },
    notificationDelivery: {
      createMany: async ({ data }) => {
        for (const d of data) {
          deliveries.push({
            id: makeUuidFromInt(seq),
            createdAt: new Date(),
            updatedAt: new Date(),
            attempts: 0,
            sentAt: null,
            lastError: null,
            ...d,
          });
          seq += 1;
        }
        return { count: data.length };
      },
      findMany: async ({ where = {}, take } = {}) => {
        let rows = deliveries.filter((d) => {
          if (where.channel && d.channel !== where.channel) return false;
          if (where.status && d.status !== where.status) return false;
          if (where.id?.in && !where.id.in.includes(d.id)) return false;
          if (where.attempts?.lt != null && !(d.attempts < where.attempts.lt)) return false;
          if (where.notificationId?.in && !where.notificationId.in.includes(d.notificationId)) return false;
          return true;
        });
        rows = rows.map((d) => {
          const n = notifications.find((row) => row.id === d.notificationId) ?? null;
          return {
            ...d,
            notification: n
              ? {
                  ...n,
                  user: {
                    id: n.userId,
                    email: n.userId ? `${n.userId}@example.test` : null,
                    displayName: "Test User",
                  },
                }
              : null,
          };
        });
        return typeof take === "number" ? rows.slice(0, take) : rows;
      },
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const d of deliveries) {
          if (where.channel && d.channel !== where.channel) continue;
          if (where.status && d.status !== where.status) continue;
          if (where.id?.in && !where.id.in.includes(d.id)) continue;
          if (where.updatedAt?.lt && !(d.updatedAt < where.updatedAt.lt)) continue;
          Object.assign(d, data, { updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
      updateManyAndReturn: async ({ where = {}, data, select }) => {
        const changed = [];
        for (const d of deliveries) {
          if (where.id?.in && !where.id.in.includes(d.id)) continue;
          if (where.status && d.status !== where.status) continue;
          const patch = { ...data };
          if (patch.attempts?.increment != null) {
            patch.attempts = (d.attempts ?? 0) + patch.attempts.increment;
          }
          Object.assign(d, patch, { updatedAt: new Date() });
          changed.push(select ? { id: d.id } : { ...d });
        }
        return changed;
      },
      update: async ({ where, data }) => {
        const d = deliveries.find((row) => row.id === where.id);
        if (!d) throw new Error("delivery not found");
        Object.assign(d, data, { updatedAt: new Date() });
        return d;
      },
    },
    notificationPreference: {
      findMany: async () => [],
      findFirst: async () => null,
      upsert: async ({ create, update }) => ({ ...create, ...update }),
    },
    pushSubscription: {
      upsert: async ({ create, update }) => ({ id: "sub-new", ...create, ...update }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async ({ data }) => ({ id: "sub-new", ...data }),
      updateMany: async () => ({ count: 0 }),
      delete: async () => ({ id: "deleted" }),
    },
    $transaction: async (fn) =>
      fn({
        notification: txNotification,
        notificationDelivery: prisma.notificationDelivery,
        notificationPreference: prisma.notificationPreference,
      }),
  };

  return prisma;
}

describe("notification-service", () => {
  it("publishes notifications for valid recipients", async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });

    const result = await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "calendar.event.reminder",
        title: "Recordatorio",
        recipients: { userIds: [RECIPIENT_A, RECIPIENT_B] },
        channels: ["in_app", "email"],
        priority: "high",
      },
    });

    assert.equal(result.created, 2);
    assert.equal(result.deduped, 0);
    assert.equal(prisma._notifications.length, 2);
    assert.equal(prisma._deliveries.length, 2);
  });

  it("enables web push by default for incoming calls", async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });

    await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "chat.call.incoming",
        title: "Llamada entrante",
        recipients: { userIds: [RECIPIENT_A] },
        channels: ["in_app", "web_push"],
        priority: "critical",
      },
    });

    assert.deepEqual(
      prisma._deliveries.map((delivery) => delivery.channel).sort(),
      ["fcm", "in_app", "web_push"],
    );
  });

  it("dedupes repeated publish with same dedupeKey in short window", async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });
    const payload = {
      eventType: "website.sale.confirmed",
      title: "Venta confirmada",
      recipients: { userIds: [RECIPIENT_A] },
      channels: ["in_app"],
      dedupeKey: "sale-100",
    };

    const first = await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: payload,
    });
    const second = await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: payload,
    });

    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.deduped, 1);
    assert.equal(prisma._notifications.length, 1);
  });

  it("lists unread notifications only", async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });

    await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "system.alert",
        title: "Alerta",
        sourceId: "alerta-1",
        recipients: { userIds: [PROFILE_ID] },
      },
    });
    const created = prisma._notifications[0];
    await prisma.notification.update({
      where: { id: created.id },
      data: { readAt: new Date() },
    });
    await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "system.alert",
        title: "Alerta 2",
        sourceId: "alerta-2",
        recipients: { userIds: [PROFILE_ID] },
      },
    });

    const result = await service.list({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      query: { unreadOnly: true },
    });

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].title, "Alerta 2");
    assert.equal(result.data[0].read, false);
  });

  it("marks one notification as read", async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });

    await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "calendar.event.reminder",
        title: "Evento",
        recipients: { userIds: [PROFILE_ID] },
      },
    });

    const target = prisma._notifications[0];
    const updated = await service.markRead({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      id: target.id,
    });

    assert.equal(updated.id, target.id);
    assert.equal(updated.read, true);
    assert.ok(updated.readAt);
  });

  it("marks all unread notifications as read", async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });

    await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "calendar.event.reminder",
        title: "Evento A",
        sourceId: "evento-a",
        recipients: { userIds: [PROFILE_ID] },
      },
    });
    await service.publishFromContext({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: {
        eventType: "calendar.event.reminder",
        title: "Evento B",
        sourceId: "evento-b",
        recipients: { userIds: [PROFILE_ID] },
      },
    });

    const result = await service.markAllRead({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID });
    assert.equal(result.updated, 2);

    const unread = await service.list({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      query: { unreadOnly: true },
    });
    assert.equal(unread.data.length, 0);
  });
});


describe('important notification channels', () => {
  const input = (eventType) => ({ eventType, title: 'Aviso', recipients: { userIds: [RECIPIENT_A] }, channels: ['in_app', 'email', 'web_push'] });
  for (const eventType of ['projects.member.added', 'projects.task.assigned', 'projects.task.mention', 'chat.member.added', 'chat.mention.new', 'notes.note.shared', 'inventory.item.mention']) {
    it(`${eventType} persists in-app and queues email and push by default`, async () => {
      const prisma = buildPrismaMock();
      const broadcasts = [];
      const service = createNotificationService({ prisma, broadcaster: { broadcastToUsers: async (...args) => broadcasts.push(args) } });
      const result = await service.publish({ companyId: COMPANY_ID, input: input(eventType) });
      assert.equal(result.created, 1);
      assert.deepEqual(prisma._deliveries.map(d => [d.channel, d.status]), [['in_app', 'sent'], ['email', 'queued'], ['web_push', 'queued'], ['fcm', 'queued']]);
      assert.deepEqual(broadcasts[0][0], [RECIPIENT_A]);
    });
  }
  it('keeps explicit email and push opt-outs', async () => {
    const prisma = buildPrismaMock();
    prisma.notificationPreference.findFirst = async () => ({ inAppEnabled: true, emailEnabled: false, pushEnabled: false });
    await createNotificationService({ prisma }).publish({ companyId: COMPANY_ID, input: input('projects.member.added') });
    assert.deepEqual(prisma._deliveries.map(d => d.channel), ['in_app']);
  });
  it('does not persist or broadcast while muted, or when every channel is disabled', async () => {
    for (const pref of [{ muteUntil: new Date(Date.now() + 60000) }, { inAppEnabled: false, emailEnabled: false, pushEnabled: false }]) {
      const prisma = buildPrismaMock();
      prisma.notificationPreference.findFirst = async () => pref;
      const service = createNotificationService({ prisma, broadcaster: { broadcastToUsers: async () => assert.fail('must not broadcast') } });
      const result = await service.publish({ companyId: COMPANY_ID, input: input('notes.note.shared') });
      assert.equal(result.created, 0);
      assert.equal(prisma._notifications.length, 0);
      assert.equal(prisma._deliveries.length, 0);
    }
  });
  it('does not broadcast an email-only notification and scopes the inbox to in-app deliveries or legacy records', async () => {
    const prisma = buildPrismaMock();
    prisma.notificationPreference.findFirst = async () => ({ inAppEnabled: false, emailEnabled: true, pushEnabled: false });
    const service = createNotificationService({ prisma, broadcaster: { broadcastToUsers: async () => assert.fail('must not broadcast') } });
    await service.publish({ companyId: COMPANY_ID, input: input('notes.note.shared') });
    assert.deepEqual(prisma._deliveries.map(d => d.channel), ['email']);
    prisma.notification.findMany = async ({ where }) => {
      assert.deepEqual(where.AND[0], { OR: [{ deliveries: { some: { channel: 'in_app' } } }, { deliveries: { none: {} } }] });
      return [];
    };
    await service.list({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID, query: {} });
  });
  it('uses the last returned item as the next page cursor', async () => {
    const prisma = buildPrismaMock();
    prisma.notification.findMany = async () => [3, 2, 1].map(n => ({ id: makeUuidFromInt(n) }));
    const result = await createNotificationService({ prisma }).list({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID, query: { limit: 2 } });
    assert.equal(result.pageInfo.nextCursor, result.data.at(-1).id);
  });
  it('delivers queued email and push from a published event through the worker', async () => {
    const prisma = buildPrismaMock();
    await createNotificationService({ prisma }).publish({ companyId: COMPANY_ID, input: { ...input('notes.note.shared'), link: '/app/m/atlas.notes?note=demo' } });
    prisma.pushSubscription.findMany = async () => [{ id: 'sub', endpoint: 'https://push.example.test', p256dh: 'key', auth: 'auth', userAgent: null }];
    const emails = [], pushes = [];
    const worker = createNotificationDeliveryWorker({ prisma, smtpService: { sendEmail: async mail => emails.push(mail) }, webPushService: { buildPushPayload: ({ notification }) => notification, sendToSubscription: async payload => { pushes.push(payload); return { ok: true }; } } });
    assert.equal((await worker.processPendingNotificationDeliveries({ channel: 'email' })).sent, 1);
    assert.equal((await worker.processPendingNotificationDeliveries({ channel: 'web_push' })).sent, 1);
    assert.equal(emails[0].to, `${RECIPIENT_A}@example.test`);
    assert.equal(emails[0].companyId, COMPANY_ID);
    assert.equal(pushes[0].payload.link, '/app/m/atlas.notes?note=demo');
    // fcm rides along with web_push (see notification-service.js publish()) but has
    // no delivery worker yet, so its row stays queued; only assert the channels
    // this test actually drained.
    assert.ok(prisma._deliveries.filter(d => d.channel !== 'fcm').every(d => d.status === 'sent'));
  });

  it('claims each queued delivery once across concurrent worker passes', async () => {
    const prisma = buildPrismaMock();
    await createNotificationService({ prisma }).publish({ companyId: COMPANY_ID, input: input('notes.note.shared') });
    const emails = [];
    const worker = createNotificationDeliveryWorker({ prisma, smtpService: { sendEmail: async (mail) => { await new Promise((r) => setTimeout(r, 5)); emails.push(mail); } }, webPushService: { buildPushPayload: ({ notification }) => notification, sendToSubscription: async () => ({ ok: true }) } });
    const [a, b] = await Promise.all([
      worker.processPendingNotificationDeliveries({ channel: 'email' }),
      worker.processPendingNotificationDeliveries({ channel: 'email' }),
    ]);
    assert.equal(a.sent + b.sent, 1);
    assert.equal(emails.length, 1);
    assert.equal(prisma._deliveries.filter((d) => d.channel === 'email' && d.status === 'sent').length, 1);
  });

  it('does not deliver an already queued email after resource access is revoked', async () => {
    const prisma = buildPrismaMock();
    await createNotificationService({ prisma }).publish({ companyId: COMPANY_ID, input: input('notes.note.shared') });
    prisma.$queryRaw = async () => [{ allowed: false }];
    const worker = createNotificationDeliveryWorker({ prisma, smtpService: { sendEmail: async () => assert.fail('revoked recipient must not receive content') } });
    const result = await worker.processPendingNotificationDeliveries({ channel: 'email' });
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
  });

  it('requeues a stuck sending row and then delivers it', async () => {
    const prisma = buildPrismaMock();
    await createNotificationService({ prisma }).publish({ companyId: COMPANY_ID, input: input('notes.note.shared') });
    const stuck = prisma._deliveries.find((d) => d.channel === 'email');
    stuck.status = 'sending';
    stuck.updatedAt = new Date(Date.now() - 10 * 60_000);
    const emails = [];
    const worker = createNotificationDeliveryWorker({ prisma, smtpService: { sendEmail: async (mail) => emails.push(mail) }, webPushService: { buildPushPayload: ({ notification }) => notification, sendToSubscription: async () => ({ ok: true }) } });
    const result = await worker.processPendingNotificationDeliveries({ channel: 'email' });
    assert.equal(result.sent, 1);
    assert.equal(emails.length, 1);
    assert.equal(stuck.status, 'sent');
  });
});


it('reports unread notifications beyond the current page', async () => {
  const prisma = buildPrismaMock();
  const service = createNotificationService({ prisma });
  for (let i = 0; i < 25; i++) {
    await service.publish({ companyId: COMPANY_ID, input: { eventType: 'system.alert', title: `Aviso ${i}`, sourceId: String(i), recipients: { userIds: [PROFILE_ID] } } });
  }
  const result = await service.list({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID, query: { limit: 10 } });
  assert.equal(result.data.length, 10);
  assert.equal(result.unreadCount, 25);
});

describe('chat email throttle (chat.mail: dedupeKey)', () => {
  const mailInput = () => ({
    eventType: 'chat.message.new',
    title: 'Nuevo mensaje de Ana',
    recipients: { userIds: [RECIPIENT_A] },
    channels: ['email'],
    sourceType: 'chat_conversation',
    sourceId: 'conv-1',
    dedupeKey: 'chat.mail:conv-1:' + RECIPIENT_A,
  });

  it('suppresses a second chat email while the first is unread', async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });
    const first = await service.publish({ companyId: COMPANY_ID, respectChannelDefaults: false, input: mailInput() });
    const second = await service.publish({ companyId: COMPANY_ID, respectChannelDefaults: false, input: mailInput() });
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.deduped, 1);
  });

  it('re-arms once the prior chat email is read and outside the throttle window', async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });
    await service.publish({ companyId: COMPANY_ID, respectChannelDefaults: false, input: mailInput() });
    const prior = prisma._notifications[0];
    prior.readAt = new Date();
    prior.createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const again = await service.publish({ companyId: COMPANY_ID, respectChannelDefaults: false, input: mailInput() });
    assert.equal(again.created, 1);
  });

  it('still suppresses a read prior email if it is inside the throttle window', async () => {
    const prisma = buildPrismaMock();
    const service = createNotificationService({ prisma });
    await service.publish({ companyId: COMPANY_ID, respectChannelDefaults: false, input: mailInput() });
    prisma._notifications[0].readAt = new Date();
    const again = await service.publish({ companyId: COMPANY_ID, respectChannelDefaults: false, input: mailInput() });
    assert.equal(again.created, 0);
    assert.equal(again.deduped, 1);
  });
});

describe('subscribeWebPush preserves independent installations', () => {
  function withPushStore(prisma) {
    const store = [];
    let n = 100;
    prisma._pushSubs = store;
    prisma.pushSubscription = {
      upsert: async ({ where, create, update }) => {
        const existing = store.find((s) => s.endpoint === where.endpoint);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: makeUuidFromInt(n++), enabled: true, ...create };
        store.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const s of store) {
          if (where.userId && s.userId !== where.userId) continue;
          if (where.id?.not && s.id === where.id.not) continue;
          if (where.enabled != null && s.enabled !== where.enabled) continue;
          if (where.userAgent != null && s.userAgent !== where.userAgent) continue;
          Object.assign(s, data);
          count += 1;
        }
        return { count };
      },
      findFirst: async () => null,
      delete: async () => ({}),
    };
    return store;
  }

  const sub = (endpoint, ua, label) => ({
    authUserId: AUTH_USER_ID,
    companyId: COMPANY_ID,
    userAgent: ua,
    input: { endpoint, keys: { p256dh: 'p', auth: 'a' }, deviceLabel: label },
  });

  it('keeps both endpoints when two installations report the same user agent', async () => {
    const prisma = buildPrismaMock();
    const store = withPushStore(prisma);
    const service = createNotificationService({ prisma });
    await service.subscribeWebPush(sub('https://push/old', 'iPhone; CriOS'));
    await service.subscribeWebPush(sub('https://push/new', 'iPhone; CriOS'));
    const enabled = store.filter((s) => s.enabled).map((s) => s.endpoint);
    assert.deepEqual(enabled, ['https://push/old', 'https://push/new']);
  });

  it('leaves other devices alone', async () => {
    const prisma = buildPrismaMock();
    const store = withPushStore(prisma);
    const service = createNotificationService({ prisma });
    await service.subscribeWebPush(sub('https://push/phone', 'iPhone'));
    await service.subscribeWebPush(sub('https://push/laptop', 'Macintosh'));
    assert.equal(store.filter((s) => s.enabled).length, 2);
  });

  it('never prunes when neither user agent nor device label is known', async () => {
    const prisma = buildPrismaMock();
    const store = withPushStore(prisma);
    const service = createNotificationService({ prisma });
    await service.subscribeWebPush({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID, userAgent: null, input: { endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'a' } } });
    await service.subscribeWebPush({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID, userAgent: null, input: { endpoint: 'https://push/b', keys: { p256dh: 'p', auth: 'a' } } });
    assert.equal(store.filter((s) => s.enabled).length, 2);
  });
});

describe('fcm token subscriptions', () => {
  it('upserts a token by its own value and returns the row', async () => {
    const prisma = buildPrismaMock();
    let upserted = null;
    prisma.fcmDeviceToken = {
      upsert: async ({ create }) => { upserted = { id: 'fcm-1', ...create }; return upserted; },
    };
    const service = createNotificationService({ prisma });
    const result = await service.subscribeFcm({
      authUserId: AUTH_USER_ID, companyId: COMPANY_ID,
      input: { token: 'device-token-abc', deviceLabel: 'Pixel 8' },
    });
    assert.equal(result.data.token, 'device-token-abc');
    assert.equal(upserted.userId, PROFILE_ID);
  });

  it('rejects unsubscribing a token that does not belong to the caller', async () => {
    const prisma = buildPrismaMock();
    prisma.fcmDeviceToken = { findFirst: async () => null };
    const service = createNotificationService({ prisma });
    await assert.rejects(
      () => service.unsubscribeFcm({ authUserId: AUTH_USER_ID, companyId: COMPANY_ID, id: 'not-mine' }),
      /Token FCM no encontrado/,
    );
  });
});
