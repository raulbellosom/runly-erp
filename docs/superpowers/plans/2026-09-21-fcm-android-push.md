# FCM Android Push Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FCM push pipeline documented as pending in `docs/mobile/FIREBASE_SETUP.md` — token registration, server-side send from the existing notification queue, and the Android native receiver — so notifications reach the Runly Android app when it is backgrounded or killed.

**Architecture:** Reuse the existing `NotificationDelivery` queue (`channel` is a free string already handling `email`/`web_push`) by adding a parallel `fcm` channel that rides along automatically whenever `web_push` is requested, gated by the same `pushEnabled` preference — no existing producer call site changes. A new `FcmDeviceToken` table (mirrors `PushSubscription`) stores tokens; a new `fcm-service.js` (mirrors `web-push-service.js`) sends via `firebase-admin`. On Android, a new `FirebaseMessagingService` reconstructs the same notification the JS side already shows via `HostNotifications.kt` when the app is alive, so both paths converge on identical channels/ids/deep-links.

**Tech Stack:** Node.js (API + worker), Prisma/PostgreSQL, `firebase-admin` (new dependency), Kotlin (Android), Rust/Tauri (native bridge).

**Spec:** `docs/superpowers/specs/2026-09-21-fcm-android-push-design.md`

---

### Task 1: Prisma schema + migration for `FcmDeviceToken`

**Files:**
- Modify: `prisma/schema.prisma` (add model, add reverse relation on `UserProfile`)
- Create: `prisma/migrations/20260921010000_fcm_device_token/migration.sql`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Insert right after the closing `}` of `model PushSubscription` (currently ends at line 845):

```prisma
model FcmDeviceToken {
  id          String    @id @default(uuid(7)) @db.Uuid
  userId      String    @db.Uuid @map("user_id")
  companyId   String?   @db.Uuid @map("company_id")
  token       String    @unique
  deviceLabel String?   @map("device_label")
  enabled     Boolean   @default(true)
  lastSeenAt  DateTime? @map("last_seen_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  user UserProfile @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, enabled])
  @@map("fcm_device_token")
}
```

- [ ] **Step 2: Add the reverse relation on `UserProfile`**

In `model UserProfile`, right after the existing line `pushSubscriptions PushSubscription[]` (line 392), add:

```prisma
  fcmDeviceTokens FcmDeviceToken[]
```

- [ ] **Step 3: Write the migration SQL by hand**

This repo authors migrations by hand and applies them with `prisma migrate deploy` (never `prisma migrate dev` against the shared Supabase instance). Create `prisma/migrations/20260921010000_fcm_device_token/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "fcm_device_token" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "token" TEXT NOT NULL,
    "device_label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fcm_device_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fcm_device_token_token_key" ON "fcm_device_token" ("token");

-- CreateIndex
CREATE INDEX "fcm_device_token_user_id_enabled_idx" ON "fcm_device_token" ("user_id", "enabled");

-- AddForeignKey
ALTER TABLE "fcm_device_token" ADD CONSTRAINT "fcm_device_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Validate the schema parses and apply the migration**

Run: `node -e "require('node:child_process').execSync('pnpm db:generate', {stdio:'inherit'})"`
Expected: Prisma client regenerates without error (this validates `schema.prisma` syntax even before applying the migration).

Then, **only if the local environment has DB connectivity to the Supabase instance** (IP allowlisted, `.env` filled in): run `pnpm db:migrate`. If there is no DB connectivity in this environment, stop here and tell the user the migration is written but not applied — they must run `pnpm db:migrate` themselves before the rest of this feature can be tested end-to-end against a real database. Unit tests in later tasks use Prisma mocks and do not require this.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260921010000_fcm_device_token/migration.sql
git commit -m "feat: add FcmDeviceToken model and migration"
```

---

### Task 2: Validator schema for FCM token registration

**Files:**
- Modify: `packages/validators/src/index.js:715-722` (right after `webPushSubscriptionSchema`)

- [ ] **Step 1: Add `fcmSubscriptionSchema`**

Insert right after the closing `});` of `webPushSubscriptionSchema` (line 722):

```js

export const fcmSubscriptionSchema = z.object({
  token: z.string().trim().min(1).max(500),
  deviceLabel: z.string().trim().max(120).optional(),
});
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "const { fcmSubscriptionSchema } = require('@runly/validators'); console.log(fcmSubscriptionSchema.parse({ token: 'abc' }))"` from `packages/validators` (or `node --check packages/validators/src/index.js`).
Expected: no error; syntax check passes.

- [ ] **Step 3: Commit**

```bash
git add packages/validators/src/index.js
git commit -m "feat: add fcmSubscriptionSchema validator"
```

---

### Task 3: `notification-service.js` — FCM subscribe/unsubscribe + auto-bundling with `web_push`

**Files:**
- Modify: `apps/api/src/services/notification-service.js`
- Test: `apps/api/src/services/__tests__/notification-service.test.js`

- [ ] **Step 1: Update the two existing tests that will change shape**

These two tests currently assert the exact channel list produced by `publish()`. Once `fcm` rides along with `web_push`, both need the extra channel. Edit `apps/api/src/services/__tests__/notification-service.test.js`:

Replace (around line 271-274):
```js
    assert.deepEqual(
      prisma._deliveries.map((delivery) => delivery.channel).sort(),
      ["in_app", "web_push"],
    );
```
with:
```js
    assert.deepEqual(
      prisma._deliveries.map((delivery) => delivery.channel).sort(),
      ["fcm", "in_app", "web_push"],
    );
```

Replace (around line 409):
```js
      assert.deepEqual(prisma._deliveries.map(d => [d.channel, d.status]), [['in_app', 'sent'], ['email', 'queued'], ['web_push', 'queued']]);
```
with:
```js
      assert.deepEqual(prisma._deliveries.map(d => [d.channel, d.status]), [['in_app', 'sent'], ['email', 'queued'], ['web_push', 'queued'], ['fcm', 'queued']]);
```

Leave the `'keeps explicit email and push opt-outs'` test (asserts `['in_app']` when `pushEnabled: false`) and the muted/all-disabled test untouched — they already prove `fcm` is *not* added when `web_push` is filtered out, since both assert on the full delivery list.

- [ ] **Step 2: Run tests to verify these two now fail**

Run: `node --test apps/api/src/services/__tests__/notification-service.test.js`
Expected: FAIL on the two edited assertions (actual list is missing `"fcm"`) — this proves the test correctly targets unbuilt behavior.

- [ ] **Step 3: Import the new schema**

In `apps/api/src/services/notification-service.js`, change the import at the top (lines 1-6):
```js
import {
  notificationPublishSchema,
  notificationListQuerySchema,
  notificationPreferenceUpsertSchema,
  webPushSubscriptionSchema,
} from "@runly/validators";
```
to:
```js
import {
  notificationPublishSchema,
  notificationListQuerySchema,
  notificationPreferenceUpsertSchema,
  webPushSubscriptionSchema,
  fcmSubscriptionSchema,
} from "@runly/validators";
```

- [ ] **Step 4: Bundle `fcm` alongside `web_push` in `publish()`**

In `publish()`, right after the `allowedChannels` computation and its `if (!allowedChannels.length) continue;` guard (around line 298-300):

```js
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
```

change to:

```js
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

        // FCM (native Android push) always mirrors web_push: same preference,
        // same eligibility, no producer has to ask for it separately.
        if (allowedChannels.includes('web_push') && !allowedChannels.includes('fcm')) {
          allowedChannels.push('fcm');
        }

        if (!allowedChannels.length) continue;
```

- [ ] **Step 5: Run tests to verify they pass now**

Run: `node --test apps/api/src/services/__tests__/notification-service.test.js`
Expected: PASS (all tests, including the two edited ones).

- [ ] **Step 6: Add `subscribeFcm`/`unsubscribeFcm`**

Right after `unsubscribeWebPush` and before the `return { ... }` block at the end of `createNotificationService` (currently lines 445-461), add:

```js
  async function subscribeFcm({ authUserId, companyId: activeCompanyId, input }) {
    const parsed = fcmSubscriptionSchema.parse(input ?? {});
    const { profileId, companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const row = await prisma.fcmDeviceToken.upsert({
      where: { token: parsed.token },
      create: {
        userId: profileId,
        companyId,
        token: parsed.token,
        deviceLabel: parsed.deviceLabel ?? null,
        enabled: true,
        lastSeenAt: new Date(),
      },
      update: {
        userId: profileId,
        companyId,
        deviceLabel: parsed.deviceLabel ?? null,
        enabled: true,
        lastSeenAt: new Date(),
      },
    });
    return { data: row };
  }

  async function unsubscribeFcm({ authUserId, companyId: activeCompanyId, id }) {
    const { profileId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const sub = await prisma.fcmDeviceToken.findFirst({
      where: { id, userId: profileId },
      select: { id: true },
    });
    if (!sub) {
      throw new NotificationServiceError(
        "Token FCM no encontrado.",
        404,
        "fcm_token_not_found",
      );
    }
    await prisma.fcmDeviceToken.delete({ where: { id: sub.id } });
    return { data: { deleted: true } };
  }
```

Then update the returned object (currently lines 463-475) to include them:

```js
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
    subscribeFcm,
    unsubscribeFcm,
  };
```

- [ ] **Step 7: Write focused tests for the new functions**

Add to `apps/api/src/services/__tests__/notification-service.test.js`, in a new `describe` block at the end of the file:

```js
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
```

- [ ] **Step 8: Run the full test file**

Run: `node --test apps/api/src/services/__tests__/notification-service.test.js`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/notification-service.js apps/api/src/services/__tests__/notification-service.test.js
git commit -m "feat: bundle fcm channel with web_push and add FCM token subscribe/unsubscribe"
```

---

### Task 4: API routes for FCM token registration

**Files:**
- Modify: `apps/api/src/routes/notifications.js`

- [ ] **Step 1: Add the two routes**

In `apps/api/src/routes/notifications.js`, right after the `DELETE /notifications/subscriptions/webpush/:id` route and before `return app;` (currently lines 197-216), add:

```js
  app.post(
    "/notifications/subscriptions/fcm",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json();
        const result = await service.subscribeFcm({
          authUserId,
          companyId: c.get("companyId"),
          input: body,
        });
        return c.json(result, 201);
      } catch (err) {
        return handleError(c, err, "POST /notifications/subscriptions/fcm");
      }
    },
  );

  app.delete(
    "/notifications/subscriptions/fcm/:id",
    requirePermission("notifications.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const result = await service.unsubscribeFcm({ authUserId, companyId: c.get("companyId"), id });
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "DELETE /notifications/subscriptions/fcm/:id");
      }
    },
  );
```

- [ ] **Step 2: Syntax check**

Run: `node --check apps/api/src/routes/notifications.js`
Expected: no output (pass).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/notifications.js
git commit -m "feat: add FCM token registration routes"
```

---

### Task 5: SDK client methods

**Files:**
- Modify: `packages/sdk/src/index.js:1680-1693` (right after the web push subscribe/unsubscribe methods)

- [ ] **Step 1: Add `subscribeFcm`/`unsubscribeFcm`**

Right after `unsubscribeWebPush` (currently lines 1686-1693), add:

```js
      subscribeFcm: (token, payload) =>
        request("/notifications/subscriptions/fcm", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(payload),
        }),
      unsubscribeFcm: (token, id) =>
        request(
          `/notifications/subscriptions/fcm/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
```

- [ ] **Step 2: Syntax check**

Run: `node --check packages/sdk/src/index.js`
Expected: no output (pass).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/index.js
git commit -m "feat: add subscribeFcm/unsubscribeFcm to Runly SDK client"
```

---

### Task 6: `fcm-service.js` — send via `firebase-admin`

**Files:**
- Modify: `apps/api/package.json` (add dependency)
- Create: `apps/api/src/services/fcm-service.js`
- Test: `apps/api/src/services/__tests__/fcm-service.test.js`

- [ ] **Step 1: Add the dependency**

In `apps/api/package.json`, add to `dependencies` (alphabetically, right before `"hono"`):

```json
    "firebase-admin": "^13.0.0",
```

Run: `pnpm install`
Expected: lockfile updates, install succeeds.

- [ ] **Step 2: Write the failing tests first**

Create `apps/api/src/services/__tests__/fcm-service.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFcmData, createFcmService, isPermanentFcmError } from "../fcm-service.js";

describe("fcm-service", () => {
  it("returns not-configured when no messaging client is available", async () => {
    const service = createFcmService({ messaging: null });
    const result = await service.sendToToken({ token: "tok-1", payload: { title: "Hola" } });
    assert.equal(result.ok, false);
    assert.match(result.error, /no configurado/);
  });

  it("sends via the injected messaging client", async () => {
    const sent = [];
    const service = createFcmService({
      messaging: { send: async (message) => { sent.push(message); } },
    });
    const result = await service.sendToToken({ token: "tok-2", payload: { title: "Hola" } });
    assert.equal(result.ok, true);
    assert.equal(sent[0].token, "tok-2");
    assert.deepEqual(sent[0].data, { title: "Hola" });
  });

  it("flags an unregistered token as a permanent failure", async () => {
    const service = createFcmService({
      messaging: { send: async () => { throw { code: "messaging/registration-token-not-registered" }; } },
    });
    const result = await service.sendToToken({ token: "tok-3", payload: { title: "Hola" } });
    assert.equal(result.ok, false);
    assert.equal(result.permanentFailure, true);
  });

  it("does not flag a transient error as permanent", async () => {
    const service = createFcmService({
      messaging: { send: async () => { throw { code: "messaging/internal-error" }; } },
    });
    const result = await service.sendToToken({ token: "tok-4", payload: { title: "Hola" } });
    assert.equal(result.ok, false);
    assert.equal(result.permanentFailure, false);
  });

  it("marks isPermanentFcmError true/false correctly", () => {
    assert.equal(isPermanentFcmError({ code: "messaging/invalid-registration-token" }), true);
    assert.equal(isPermanentFcmError({ code: "messaging/internal-error" }), false);
  });

  it("builds string-only data payload with the incoming-call tag and callId", () => {
    const payload = buildFcmData({
      notification: {
        id: "n-call",
        title: "Raul",
        eventType: "chat.call.incoming",
        sourceId: "call-1",
        link: "/app/m/runly.chat/chat/inbox/conv-1",
      },
    });
    assert.equal(payload.tag, "call:call-1");
    assert.equal(payload.callId, "call-1");
    for (const value of Object.values(payload)) assert.equal(typeof value, "string");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test apps/api/src/services/__tests__/fcm-service.test.js`
Expected: FAIL with a module-not-found error for `../fcm-service.js`.

- [ ] **Step 4: Implement `fcm-service.js`**

Create `apps/api/src/services/fcm-service.js`:

```js
import { getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

// FCM error codes that mean the token itself is dead — never worth retrying.
// Anything else (network blip, internal-error, quota) is transient.
const PERMANENT_FCM_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function asErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err?.message ?? err);
}

export function isPermanentFcmError(err) {
  return PERMANENT_FCM_ERROR_CODES.has(err?.code ?? err?.errorInfo?.code);
}

// FCM data messages require every value to be a string — the Android
// receiver (RunlyMessagingService.kt) reads these same keys back out.
export function buildFcmData({ notification }) {
  const title = notification?.title ?? "Runly Notifications";
  const body = notification?.body ?? "";
  const link = notification?.link ?? "/app/m/runly.notifications";
  const eventType = notification?.eventType ?? "";
  const callId = eventType === "chat.call.incoming" ? String(notification?.sourceId ?? "") : "";
  const tag = eventType === "chat.call.incoming" && notification?.sourceId
    ? `call:${notification.sourceId}`
    : eventType === "chat.message.new" && notification?.sourceId
      ? `chat:${notification.sourceId}`
      : String(notification?.id ?? "");
  return { title, body, link, eventType, callId, tag };
}

let sharedApp = null;
function getFirebaseApp() {
  if (sharedApp) return sharedApp;
  // Zero-arg initializeApp() uses Application Default Credentials, i.e.
  // GOOGLE_APPLICATION_CREDENTIALS — see docs/mobile/FIREBASE_SETUP.md.
  sharedApp = getApps()[0] ?? initializeApp();
  return sharedApp;
}

export function createFcmService({ messaging = null } = {}) {
  function getClient() {
    if (messaging) return messaging;
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
    return getMessaging(getFirebaseApp());
  }

  async function sendToToken({ token, payload }) {
    const client = getClient();
    if (!client) {
      return { ok: false, error: "FCM no configurado en el servidor." };
    }
    try {
      await client.send({ token, data: payload, android: { priority: "high" } });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        permanentFailure: isPermanentFcmError(err),
        error: asErrorMessage(err),
      };
    }
  }

  return { sendToToken, buildFcmData };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/fcm-service.test.js`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/services/fcm-service.js apps/api/src/services/__tests__/fcm-service.test.js
git commit -m "feat: add fcm-service for sending FCM data messages"
```

---

### Task 7: `notification-delivery-worker.js` — `fcm` channel

**Files:**
- Modify: `apps/api/src/services/notification-delivery-worker.js`
- Test: `apps/api/src/services/__tests__/fcm-service.test.js` (append delivery-worker coverage)

- [ ] **Step 1: Write the failing tests first**

Append to `apps/api/src/services/__tests__/fcm-service.test.js` (add the import at the top alongside the existing ones):

```js
import { createNotificationDeliveryWorker } from "../notification-delivery-worker.js";
```

Then add a new `describe` block at the end of the file:

```js
describe("notification-delivery-worker fcm channel", () => {
  function baseDelivery() {
    return {
      id: "d1",
      attempts: 0,
      notification: { id: "n1", userId: "u1", title: "Aviso", body: "Hola", link: "/app" },
    };
  }

  function basePrisma(deliveries, tokens) {
    return {
      userProfile: { findFirst: async ({ where }) => ({ id: where.id }) },
      notificationDelivery: {
        findMany: async () => deliveries,
        updateMany: async () => ({ count: 0 }),
        updateManyAndReturn: async () => {
          for (const d of deliveries) d.attempts = (d.attempts ?? 0) + 1;
          return deliveries.map((d) => ({ id: d.id }));
        },
        update: async ({ where, data }) => Object.assign(deliveries.find((d) => d.id === where.id), data),
      },
      fcmDeviceToken: {
        findMany: async () => tokens,
        update: async ({ where, data }) => {
          const t = tokens.find((tok) => tok.id === where.id);
          Object.assign(t, data);
          return t;
        },
      },
    };
  }

  it("sends to every active token and marks the delivery sent", async () => {
    const deliveries = [baseDelivery()];
    const tokens = [{ id: "t1", token: "tok-a" }, { id: "t2", token: "tok-b" }];
    const sentTokens = [];
    const worker = createNotificationDeliveryWorker({
      prisma: basePrisma(deliveries, tokens),
      smtpService: { sendEmail: async () => {} },
      fcmService: {
        buildFcmData: () => ({ title: "Aviso" }),
        sendToToken: async ({ token }) => { sentTokens.push(token); return { ok: true }; },
      },
      maxAttempts: 3,
    });

    const result = await worker.processPendingNotificationDeliveries({ channel: "fcm", limit: 10 });

    assert.deepEqual(sentTokens, ["tok-a", "tok-b"]);
    assert.equal(result.sent, 1);
    assert.equal(deliveries[0].status, "sent");
  });

  it("disables a token on permanent failure and still succeeds if another token works", async () => {
    const deliveries = [baseDelivery()];
    const tokens = [{ id: "t1", token: "tok-dead", enabled: true }, { id: "t2", token: "tok-ok", enabled: true }];
    const worker = createNotificationDeliveryWorker({
      prisma: basePrisma(deliveries, tokens),
      smtpService: { sendEmail: async () => {} },
      fcmService: {
        buildFcmData: () => ({ title: "Aviso" }),
        sendToToken: async ({ token }) =>
          token === "tok-dead"
            ? { ok: false, permanentFailure: true, error: "not-registered" }
            : { ok: true },
      },
      maxAttempts: 3,
    });

    const result = await worker.processPendingNotificationDeliveries({ channel: "fcm", limit: 10 });

    assert.equal(result.sent, 1);
    assert.equal(tokens[0].enabled, false);
    assert.equal(tokens[1].enabled, true);
  });

  it("fails the delivery when the recipient has no active tokens", async () => {
    const deliveries = [baseDelivery()];
    const worker = createNotificationDeliveryWorker({
      prisma: basePrisma(deliveries, []),
      smtpService: { sendEmail: async () => {} },
      fcmService: { buildFcmData: () => ({}), sendToToken: async () => ({ ok: true }) },
      maxAttempts: 1,
    });

    const result = await worker.processPendingNotificationDeliveries({ channel: "fcm", limit: 10 });

    assert.equal(result.failed, 1);
    assert.equal(deliveries[0].status, "failed");
  });
});
```

- [ ] **Step 2: Run to verify these fail**

Run: `node --test apps/api/src/services/__tests__/fcm-service.test.js`
Expected: FAIL — `processPendingNotificationDeliveries` doesn't recognize `channel: "fcm"` yet (recipients found but nothing happens / throws on missing `fcmDeviceToken` handling), so the `sent`/`failed` assertions don't match.

- [ ] **Step 3: Wire `fcmService` into the worker factory**

In `apps/api/src/services/notification-delivery-worker.js`, add the import at the top (right after the `createWebPushService` import, line 3):

```js
import { createFcmService } from "./fcm-service.js";
```

Change the factory signature and defaults (currently lines 357-366):

```js
export function createNotificationDeliveryWorker({
  prisma,
  smtpService = null,
  webPushService = null,
  supabaseAdmin = null,
  logger = console,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  const smtp = smtpService ?? createSmtpService({ prisma });
  const webPush = webPushService ?? createWebPushService({ prisma });
```

to:

```js
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
```

- [ ] **Step 4: Add the `fcm` branch**

In the `try { ... }` block inside the delivery loop, right after the closing `}` of the `else if (channel === "web_push") { ... }` block and before `}` that closes the `if/else if` chain (currently lines 522-578), add an `else if`:

```js
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
```

(This sits as an `else if` chained off the existing `if (channel === "email") { ... } else if (channel === "web_push") { ... }`, so the final line of the chain reads `} else if (channel === "fcm") { ... }`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/fcm-service.test.js`
Expected: PASS, all 9 tests (6 from Task 6 + 3 new).

Also re-run the web_push suite to confirm no regression: `node --test apps/api/src/services/__tests__/web-push-service.test.js`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/notification-delivery-worker.js apps/api/src/services/__tests__/fcm-service.test.js
git commit -m "feat: process fcm channel in the notification delivery worker"
```

---

### Task 8: Wire `fcm` into the worker's channel loop and the calls immediate-drain

**Files:**
- Modify: `apps/worker/src/index.js:186`
- Modify: `apps/api/src/routes/calls/call-service.js` (two spots)

- [ ] **Step 1: Add `fcm` to the worker's processed channels**

In `apps/worker/src/index.js`, change line 186:

```js
    const channels = ['email', 'web_push']
```

to:

```js
    const channels = ['email', 'web_push', 'fcm']
```

- [ ] **Step 2: Drain `fcm` immediately alongside `web_push` for ringing calls (first call site)**

In `apps/api/src/routes/calls/call-service.js`, around lines 491-503, change:

```js
          // A ringing call can't wait for the background delivery worker's
          // ~30s poll — push THIS notification's web_push deliveries out now,
          // scoped by notificationId so we don't drain everyone else's queue.
          const notificationIds = (published?.data ?? [])
            .map((n) => n?.id)
            .filter(Boolean);
          if (deliveryWorker?.processPendingNotificationDeliveries && notificationIds.length) {
            deliveryWorker
              .processPendingNotificationDeliveries({ channel: "web_push", notificationIds, limit: notificationIds.length })
              .catch((error) => {
                console.warn("[atlas.calls] Entrega inmediata de push fallo; el worker lo reintentara:", error?.message ?? error);
              });
          }
```

to:

```js
          // A ringing call can't wait for the background delivery worker's
          // ~30s poll — push THIS notification's web_push/fcm deliveries out
          // now, scoped by notificationId so we don't drain everyone else's queue.
          const notificationIds = (published?.data ?? [])
            .map((n) => n?.id)
            .filter(Boolean);
          if (deliveryWorker?.processPendingNotificationDeliveries && notificationIds.length) {
            for (const channel of ["web_push", "fcm"]) {
              deliveryWorker
                .processPendingNotificationDeliveries({ channel, notificationIds, limit: notificationIds.length })
                .catch((error) => {
                  console.warn("[atlas.calls] Entrega inmediata de push fallo; el worker lo reintentara:", error?.message ?? error);
                });
            }
          }
```

- [ ] **Step 3: Same for the second call site (group/room call invite drain)**

Lines 868-883 currently read exactly:

```js
    // 6. Push out THIS alert's web_push deliveries now — don't wait for the
    //    ~30s worker poll — scoped by notificationId so we don't drain the queue.
    if (deliveryWorker?.processPendingNotificationDeliveries && publishedIds.length) {
      deliveryWorker
        .processPendingNotificationDeliveries({
          channel: "web_push",
          notificationIds: publishedIds,
          limit: publishedIds.length,
        })
        .catch((error) => {
          console.warn(
            "[atlas.calls] Entrega inmediata de push a invitados fallo:",
            error?.message ?? error,
          );
        });
    }
```

Replace that whole block with:

```js
    // 6. Push out THIS alert's web_push/fcm deliveries now — don't wait for
    //    the ~30s worker poll — scoped by notificationId so we don't drain the queue.
    if (deliveryWorker?.processPendingNotificationDeliveries && publishedIds.length) {
      for (const channel of ["web_push", "fcm"]) {
        deliveryWorker
          .processPendingNotificationDeliveries({
            channel,
            notificationIds: publishedIds,
            limit: publishedIds.length,
          })
          .catch((error) => {
            console.warn(
              "[atlas.calls] Entrega inmediata de push a invitados fallo:",
              error?.message ?? error,
            );
          });
      }
    }
```

- [ ] **Step 4: Syntax check both files**

Run: `node --check apps/worker/src/index.js && node --check apps/api/src/routes/calls/call-service.js`
Expected: no output (pass).

- [ ] **Step 5: Run the existing calls test suite to confirm no regression**

Run: `node --test apps/api/src/routes/calls/__tests__/call-service.test.js`
Expected: PASS (unchanged — this task only adds a second drained channel, it doesn't change call semantics).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.js apps/api/src/routes/calls/call-service.js
git commit -m "feat: drain fcm deliveries alongside web_push in worker and call alerts"
```

---

### Task 9: Rust bridge command — `host_fcm_token`

**Files:**
- Modify: `apps/desktop/src-tauri/src/mobile_media.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the Rust command**

In `apps/desktop/src-tauri/src/mobile_media.rs`, after `host_screen_status` (end of file, after line 82), add:

```rust

#[tauri::command]
pub async fn host_fcm_token(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    super::mobile_host::check_remote(&window)?;
    run(app, "currentToken", json!({})).await
}
```

- [ ] **Step 2: Register it in the invoke handler**

In `apps/desktop/src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` list (lines 21-36), add a new entry after `mobile_media::host_screen_status` (line 35):

```rust
        .invoke_handler(tauri::generate_handler![
            mobile_host::host_info,
            mobile_host::host_connect,
            mobile_host::host_ready,
            mobile_host::host_events,
            mobile_host::host_ack_events,
            mobile_host::host_open_external,
            #[cfg(target_os = "android")]
            mobile_media::host_notification_show,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_start,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_stop,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_status,
            #[cfg(target_os = "android")]
            mobile_media::host_fcm_token
        ])
```

(Note the added trailing comma after `host_screen_status` — it previously had none since it was last in the list.)

- [ ] **Step 3: Verify the Rust side compiles**

Run: `cd apps/desktop/src-tauri && cargo check` (desktop target is enough to catch a syntax error in shared code; the `#[cfg(target_os = "android")]` lines will simply not compile on this host, which is expected).
Expected: compiles without new errors introduced by this change (pre-existing warnings, if any, are not this task's concern).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/mobile_media.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add host_fcm_token Tauri bridge command"
```

---

### Task 10: Kotlin — expose the stored FCM token to the bridge

**Files:**
- Modify: `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/ScreenSharePlugin.kt`
- Create: `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/RunlyMessagingService.kt`
- Modify: `apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Create `RunlyMessagingService.kt`**

Create `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/RunlyMessagingService.kt`:

```kotlin
package com.racoondevs.runlyerp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Receives FCM pushes when the app process is backgrounded or killed — the
// counterpart to HostNotifications.show(), which JS calls while the process
// is alive. Both converge on the same channel ids and deep-link scheme so
// Android can dedupe by notification id if both paths ever fire for the
// same event.
class RunlyMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    prefs(this).edit().putString(KEY_TOKEN, token).apply()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val title = data["title"]?.take(300)?.ifBlank { null } ?: return
    val body = data["body"]?.take(2000) ?: ""
    val eventType = data["eventType"] ?: ""
    val callId = data["callId"] ?: ""
    val link = data["link"] ?: ""
    val tag = data["tag"]?.ifBlank { null } ?: "$title:$body"
    val channelId = if (eventType == "chat.call.incoming") "runly-calls-v1" else "runly-alerts-v1"
    val channelName = if (channelId == "runly-calls-v1") "Llamadas entrantes" else "Avisos de Runly"

    ensureChannel(channelId, channelName)

    val id = notificationId(tag)
    val intent = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_MAIN
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    if (Regex("^[a-zA-Z0-9-]{1,128}$").matches(callId)) {
      intent.action = Intent.ACTION_VIEW
      intent.setDataAndType(Uri.parse("runly://call/$callId"), "application/octet-stream")
    } else {
      val match = Regex("^/(?:app/)?m/runly\\.chat/chat/inbox/([a-zA-Z0-9-]{1,128})$").find(link)
      if (match != null) {
        intent.action = Intent.ACTION_VIEW
        intent.setDataAndType(Uri.parse("runly://chat/${match.groupValues[1]}"), "application/octet-stream")
      }
    }
    val contentIntent = PendingIntent.getActivity(
      this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(R.mipmap.ic_launcher_monochrome)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(contentIntent)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .build()
    try {
      NotificationManagerCompat.from(this).notify(id, notification)
    } catch (_: SecurityException) {
      // Notification permission was revoked after the token was registered; drop silently.
    }
  }

  private fun ensureChannel(id: String, name: String) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
      lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      enableVibration(true)
      enableLights(true)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val PREFS_NAME = "runly_fcm"
    private const val KEY_TOKEN = "token"

    fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun currentToken(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    // Ported 1:1 from apps/desktop/src/native/notification-policy.js#notificationId
    // (FNV-1a 32-bit) so a local (JS-triggered) and a remote (FCM-triggered)
    // notification for the same tag collapse to the same Android notification id.
    fun notificationId(tag: String): Int {
      var hash = 2166136261.toInt()
      for (ch in tag) hash = (hash xor ch.code) * 16777619
      val result = hash ushr 1
      return if (result == 0) 1 else result
    }
  }
}
```

- [ ] **Step 2: Expose the stored token via a new plugin command**

In `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/ScreenSharePlugin.kt`, add the import `import app.tauri.plugin.JSObject` is already present (line 16). Add a new `@Command` method right after `fun notify(invoke: Invoke) { HostNotifications.show(activity, invoke) }` (line 56):

```kotlin
  @Command
  fun currentToken(invoke: Invoke) {
    invoke.resolve(JSObject().apply { put("token", RunlyMessagingService.currentToken(activity)) })
  }
```

- [ ] **Step 3: Register the service in the manifest**

In `apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml`, add a `<service>` entry inside `<application>`, right after the closing `</activity>` tag (line 52) and before the `<provider>` block:

```xml

        <service
            android:name=".RunlyMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
```

- [ ] **Step 4: Verify the Kotlin compiles**

Run: `cd apps/desktop/src-tauri/gen/android && ./gradlew :app:compileArm64DebugKotlin` (matches the verification command already used for this Android module per `docs/superpowers/plans/2026-09-13-runly-native-identifiers.md`).
Expected: `BUILD SUCCESSFUL`. If `google-services.json` isn't present in this environment (see `docs/mobile/FIREBASE_SETUP.md`), `firebase-messaging` won't be on the classpath and this will fail to resolve `com.google.firebase.messaging.*` imports — in that case, tell the user this step needs to run in an environment with the Firebase Android config already prepared (it already is, per the earlier conversation in this session), and move on if you cannot run Gradle at all in your current environment.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/RunlyMessagingService.kt apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/ScreenSharePlugin.kt apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "feat: add Android FCM receiver (RunlyMessagingService) and token bridge command"
```

---

### Task 11: JS native bridge — implement `getPushToken`

**Files:**
- Modify: `apps/desktop/src/native/index.js:76`
- Test: `apps/desktop/src/native/__tests__/notification-policy.test.js` (existing file — no change needed; this task has no pure-logic unit to add beyond what's already covered, since `getPushToken` is a thin `invoke()` wrapper identical in shape to `openExternal`/`dismiss` above it, which are not separately unit-tested either)

- [ ] **Step 1: Replace the stub**

In `apps/desktop/src/native/index.js`, change line 76:

```js
    getPushToken: unsupported,
```

to:

```js
    async getPushToken() {
      if (!isNativeMobile()) return null
      const response = await invoke('host_fcm_token')
      return response?.token ?? null
    },
```

- [ ] **Step 2: Check if `unsupported` is still used elsewhere in the file**

Run: `grep -n "unsupported" apps/desktop/src/native/index.js`
Expected: if no other reference remains, remove the now-unused `const unsupported = () => { throw new Error('Esta función no está disponible en este dispositivo.') }` (line 13) to avoid an unused-variable lint warning. If it's still referenced elsewhere, leave it.

- [ ] **Step 3: Syntax check**

Run: `node --check apps/desktop/src/native/index.js`
Expected: no output (pass).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/native/index.js
git commit -m "feat: implement native.notifications.getPushToken for Android FCM"
```

---

### Task 12: JS — sync the FCM token with the server after permission is granted

**Files:**
- Create: `apps/desktop/src/lib/fcm.js`
- Modify: `apps/desktop/src/hooks/usePushAutoSubscribe.js`

- [ ] **Step 1: Create the sync helper, mirroring `apps/desktop/src/lib/webPush.js`**

Create `apps/desktop/src/lib/fcm.js`:

```js
import { runly } from "./runly.js";
import { native } from "../native/index.js";

const STORAGE_KEY = "runly.notifications.fcm.token";

export function getStoredFcmToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function clearStoredFcmToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// Registers this device's current FCM token with the server if it hasn't
// been registered yet (or has rotated since the last sync). No-ops on
// anything that isn't the native Android app — FCM is Android-only for now.
export async function syncCurrentDeviceFcmToken({ authToken, deviceLabel = "Android" }) {
  if (!native.isMobile()) return { data: null };
  const fcmToken = await native.notifications.getPushToken().catch(() => null);
  if (!fcmToken || fcmToken === getStoredFcmToken()) return { data: null };

  const response = await runly.notifications.subscribeFcm(authToken, { token: fcmToken, deviceLabel });
  window.localStorage.setItem(STORAGE_KEY, fcmToken);
  return response;
}
```

- [ ] **Step 2: Call it from `usePushAutoSubscribe.js` once permission is granted**

In `apps/desktop/src/hooks/usePushAutoSubscribe.js`, add the import (after the existing `native` import, line 17):

```js
import { syncCurrentDeviceFcmToken } from '../lib/fcm.js';
```

Change `prepareNotifications` (currently lines 68-96) — the `isTauriRuntime()` branch only requests permission today. After permission is confirmed granted, sync the FCM token:

```js
async function prepareNotifications(token) {
  if (isTauriRuntime()) {
    const permission = await getSystemNotificationPermission().catch(() => "unsupported");
    if (permission === "default") { showEnablePrompt(token); return; }
    if (permission === "granted") {
      await syncCurrentDeviceFcmToken({ authToken: token }).catch(() => {});
    }
    return;
  }
  ...
```

Also update `enableFromUserGesture` (currently lines 34-52) so a fresh grant from the toast action registers the token right away instead of waiting for the next `prepare()` pass:

```js
function enableFromUserGesture(token) {
  const soundActivation = unlockCallSounds();
  toast.dismiss(ENABLE_NOTIFICATIONS_TOAST_ID);

  const notificationActivation = isTauriRuntime()
    ? requestSystemNotificationPermission().then(async (permission) => {
        if (permission !== "granted") throw new Error("Permiso de notificaciones denegado.");
        await syncCurrentDeviceFcmToken({ authToken: token }).catch(() => {});
      })
    : subscribeCurrentDeviceToWebPush({ token, deviceLabel: getPwaLabel() });

  Promise.all([soundActivation, notificationActivation])
    .then(([soundUnlocked]) => {
      if (!soundUnlocked) throw new Error("El dispositivo no permitio activar el sonido.");
      toast.success(native.isMobile() ? "Notificaciones activadas." : "Notificaciones y sonidos activados.");
    })
    .catch((error) => {
      toast.error(error?.message ?? "No se pudieron activar las notificaciones.");
    });
}
```

(The mobile success copy dropped "mientras Runly está abierto" — that limitation is exactly what this feature removes on Android. Also update `showEnablePrompt`'s mobile description, which still claims the old limitation — currently lines 54-66:)

```js
function showEnablePrompt(token) {
  toast("Activa las notificaciones", {
    id: ENABLE_NOTIFICATIONS_TOAST_ID,
    description: native.isMobile()
      ? "Recibe avisos y llamadas incluso con Runly cerrado."
      : "Recibe avisos y escucha las llamadas aunque Runly no este visible.",
    duration: Infinity,
    action: {
      label: "Activar",
      onClick: () => enableFromUserGesture(token),
    },
  });
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check apps/desktop/src/lib/fcm.js && node --check apps/desktop/src/hooks/usePushAutoSubscribe.js`
Expected: no output (pass).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/fcm.js apps/desktop/src/hooks/usePushAutoSubscribe.js
git commit -m "feat: sync FCM token to the server once notification permission is granted"
```

---

### Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run every touched Node test file**

Run:
```bash
node --test apps/api/src/services/__tests__/notification-service.test.js
node --test apps/api/src/services/__tests__/web-push-service.test.js
node --test apps/api/src/services/__tests__/fcm-service.test.js
node --test apps/api/src/routes/calls/__tests__/call-service.test.js
```
Expected: all PASS.

- [ ] **Step 2: Syntax-check every modified JS file in one pass**

Run:
```bash
for f in apps/api/src/services/notification-service.js apps/api/src/services/notification-delivery-worker.js apps/api/src/services/fcm-service.js apps/api/src/routes/notifications.js apps/api/src/routes/calls/call-service.js apps/worker/src/index.js packages/sdk/src/index.js packages/validators/src/index.js apps/desktop/src/native/index.js apps/desktop/src/lib/fcm.js apps/desktop/src/hooks/usePushAutoSubscribe.js; do node --check "$f" || echo "FAILED: $f"; done
```
Expected: no `FAILED:` lines printed.

- [ ] **Step 3: Regenerate the Prisma client against the updated schema**

Run: `pnpm db:generate`
Expected: succeeds without error.

- [ ] **Step 4: Report status to the user**

Summarize what was verified automatically (tests, syntax, Prisma client generation, Kotlin compile if it ran) versus what still needs the user's own environment: applying the migration (`pnpm db:migrate`, needs Supabase connectivity), and an actual Android build + install on a device to see a real push arrive (no automated test proves end-to-end delivery — this matches how the original Firebase preparation was verified per `docs/mobile/FIREBASE_SETUP.md`).

---

## Post-implementation note for the user

This plan does not touch:
- The CallKit-style incoming-call UI or lockscreen continuity (explicitly out of scope, per the approved spec).
- iOS/APNs (Android-only).
- `RUNLY_FCM_ENABLED` — that flag was documented as not yet having a consumer; this plan doesn't wire it in either, since `fcm-service.js` already no-ops safely when `GOOGLE_APPLICATION_CREDENTIALS` isn't set. Whether to gate the new `fcm` channel behind that flag explicitly is a product decision the user can make after this lands — flag it to them, don't decide it silently.
