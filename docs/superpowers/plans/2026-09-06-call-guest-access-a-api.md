# Guest access to calls — Plan A (API)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side foundation for external guests in `atlas.calls`: per-conversation share links + short codes, email invites, a guest lobby/admit flow, guest LiveKit tokens, and an ephemeral call-scoped chat — all behind the existing `LIVEKIT_*` config, verifiable by curl + unit tests, no UI.

**Architecture:** Five new Prisma models. Three new services in `apps/api/src/routes/calls/` (`call-links-service`, `call-guest-service`, `call-messages-service`) plus an unauthenticated `guest-routes.js` Hono sub-router mounted alongside the existing authenticated calls router. `call-service.js` exposes its "can manage this call" role check for reuse and drives a guest-sweep from its existing interval.

**Tech Stack:** Node.js, Hono, Prisma 7 (`prisma.<model>` accessors are fine here — these ARE real Prisma models, unlike AME3 tables), `livekit-server-sdk`, `node:test`, `nodemailer` via the existing `smtp-service.js`.

**Spec:** `docs/superpowers/specs/2026-09-06-call-guest-access-design.md`.

---

## Conventions for this plan

- New services follow the existing `call-service.js` shape: a
  `createXxxService({ ...deps })` factory, every function declared **inside**
  the factory, typed errors via a `CallServiceError`-style class.
- Reuse `readLiveKitConfig` and the `CallServiceError` class exported from
  `call-service.js`.
- Tests use hand-rolled `prisma` stubs exactly like
  `call-service.test.js` (no DB). Each service test file gets its own
  `describe`.
- Token generation: `crypto.randomBytes(n).toString("hex")`; store
  `crypto.createHash("sha256").update(raw).digest("hex")` where the spec says
  "hash".

---

## Task 1: Migration + Prisma models

**Files:**
- Create: `prisma/migrations/20260906000000_call_guest_access/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write the migration SQL**

Create `prisma/migrations/20260906000000_call_guest_access/migration.sql`:

```sql
-- =============================================================================
-- Atlas Calls — external guest access (links, codes, invites, lobby, chat)
-- =============================================================================

CREATE TABLE "call_link" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "conversation_id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "require_lobby" BOOLEAN NOT NULL DEFAULT true,
  "max_uses" INTEGER,
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_link_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_link_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "user_profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "call_link_token_key" ON "call_link"("token");
CREATE UNIQUE INDEX "call_link_code_key" ON "call_link"("code");
CREATE UNIQUE INDEX "call_link_one_live_per_conversation_idx"
  ON "call_link"("conversation_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "call_link_conversation_id_idx" ON "call_link"("conversation_id");

CREATE TABLE "call_invite" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "link_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "invited_by_user_id" UUID NOT NULL,
  "sent_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_invite_link_id_fkey"
    FOREIGN KEY ("link_id") REFERENCES "call_link"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_invite_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "user_profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "call_invite_token_key" ON "call_invite"("token");
CREATE INDEX "call_invite_link_id_email_normalized_idx"
  ON "call_invite"("link_id", "email_normalized");

CREATE TABLE "call_guest" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "call_id" UUID NOT NULL,
  "link_id" UUID,
  "invite_id" UUID,
  "display_name" TEXT NOT NULL,
  "email" TEXT,
  "session_token_hash" TEXT NOT NULL,
  "livekit_identity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LOBBY',
  "admitted_by_user_id" UUID,
  "join_ip" TEXT,
  "user_agent" TEXT,
  "admitted_at" TIMESTAMP(3),
  "left_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_guest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_guest_status_check"
    CHECK ("status" IN ('LOBBY','ADMITTED','LEFT','KICKED','DENIED')),
  CONSTRAINT "call_guest_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "call"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_guest_link_id_fkey"
    FOREIGN KEY ("link_id") REFERENCES "call_link"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "call_guest_invite_id_fkey"
    FOREIGN KEY ("invite_id") REFERENCES "call_invite"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "call_guest_admitted_by_user_id_fkey"
    FOREIGN KEY ("admitted_by_user_id") REFERENCES "user_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "call_guest_call_id_livekit_identity_key"
  ON "call_guest"("call_id", "livekit_identity");
CREATE INDEX "call_guest_call_id_status_idx" ON "call_guest"("call_id", "status");
CREATE INDEX "call_guest_session_token_hash_idx" ON "call_guest"("session_token_hash");

CREATE TABLE "call_message" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "call_id" UUID NOT NULL,
  "sender_kind" TEXT NOT NULL,
  "sender_user_id" UUID,
  "sender_guest_id" UUID,
  "sender_name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_message_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_message_sender_kind_check"
    CHECK ("sender_kind" IN ('user','guest','system')),
  CONSTRAINT "call_message_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "call"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_message_sender_user_id_fkey"
    FOREIGN KEY ("sender_user_id") REFERENCES "user_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "call_message_sender_guest_id_fkey"
    FOREIGN KEY ("sender_guest_id") REFERENCES "call_guest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "call_message_call_id_created_at_idx"
  ON "call_message"("call_id", "created_at");

CREATE TABLE "call_guest_join_attempt" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "ip" TEXT NOT NULL,
  "link_id" UUID,
  "outcome" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_guest_join_attempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "call_guest_join_attempt_ip_created_at_idx"
  ON "call_guest_join_attempt"("ip", "created_at");

-- Realtime publication (guarded, same pattern as the calls migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "call_guest";
    ALTER PUBLICATION supabase_realtime ADD TABLE "call_message";
  END IF;
END $$;

GRANT SELECT ON TABLE "call_link" TO authenticated;
GRANT SELECT ON TABLE "call_guest" TO authenticated;
GRANT SELECT ON TABLE "call_message" TO authenticated;

ALTER TABLE "call_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_guest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_guest_join_attempt" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "call_link_member_select" ON "call_link"
  FOR SELECT TO authenticated USING (chat_is_member(conversation_id));
CREATE POLICY "call_guest_member_select" ON "call_guest"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM "call" c WHERE c.id = call_id AND chat_is_member(c.conversation_id))
  );
CREATE POLICY "call_message_member_select" ON "call_message"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM "call" c WHERE c.id = call_id AND chat_is_member(c.conversation_id))
  );

CREATE POLICY "call_link_service_all" ON "call_link"
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_invite_service_all" ON "call_invite"
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_guest_service_all" ON "call_guest"
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_message_service_all" ON "call_message"
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_guest_join_attempt_service_all" ON "call_guest_join_attempt"
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Add the Prisma models**

In `prisma/schema.prisma`, immediately after the `CallParticipant` model
(around line 1885), add:

```prisma
model CallLink {
  id               String    @id @default(uuid(7)) @db.Uuid
  conversationId   String    @db.Uuid @map("conversation_id")
  token            String    @unique
  code             String    @unique
  requireLobby     Boolean   @default(true) @map("require_lobby")
  maxUses          Int?      @map("max_uses")
  useCount         Int       @default(0) @map("use_count")
  expiresAt        DateTime? @map("expires_at")
  revokedAt        DateTime? @map("revoked_at")
  createdByUserId  String    @db.Uuid @map("created_by_user_id")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @default(now()) @updatedAt @map("updated_at")

  createdBy UserProfile  @relation("CallLinkCreatedBy", fields: [createdByUserId], references: [id])
  invites   CallInvite[]
  guests    CallGuest[]

  @@index([conversationId])
  @@map("call_link")
}

model CallInvite {
  id              String    @id @default(uuid(7)) @db.Uuid
  linkId          String    @db.Uuid @map("link_id")
  email           String
  emailNormalized String    @map("email_normalized")
  token           String    @unique
  invitedByUserId String    @db.Uuid @map("invited_by_user_id")
  sentAt          DateTime? @map("sent_at")
  acceptedAt      DateTime? @map("accepted_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  link      CallLink    @relation(fields: [linkId], references: [id], onDelete: Cascade)
  invitedBy UserProfile @relation("CallInviteInvitedBy", fields: [invitedByUserId], references: [id])
  guests    CallGuest[]

  @@index([linkId, emailNormalized])
  @@map("call_invite")
}

model CallGuest {
  id                String    @id @default(uuid(7)) @db.Uuid
  callId            String    @db.Uuid @map("call_id")
  linkId            String?   @db.Uuid @map("link_id")
  inviteId          String?   @db.Uuid @map("invite_id")
  displayName       String    @map("display_name")
  email             String?
  sessionTokenHash  String    @map("session_token_hash")
  livekitIdentity   String    @map("livekit_identity")
  status            String    @default("LOBBY")
  admittedByUserId  String?   @db.Uuid @map("admitted_by_user_id")
  joinIp            String?   @map("join_ip")
  userAgent         String?   @map("user_agent")
  admittedAt        DateTime? @map("admitted_at")
  leftAt            DateTime? @map("left_at")
  lastSeenAt        DateTime? @map("last_seen_at")
  createdAt         DateTime  @default(now()) @map("created_at")

  call       Call         @relation(fields: [callId], references: [id], onDelete: Cascade)
  link       CallLink?    @relation(fields: [linkId], references: [id])
  invite     CallInvite?  @relation(fields: [inviteId], references: [id])
  admittedBy UserProfile? @relation("CallGuestAdmittedBy", fields: [admittedByUserId], references: [id])
  messages   CallMessage[]

  @@unique([callId, livekitIdentity])
  @@index([callId, status])
  @@index([sessionTokenHash])
  @@map("call_guest")
}

model CallMessage {
  id            String   @id @default(uuid(7)) @db.Uuid
  callId        String   @db.Uuid @map("call_id")
  senderKind    String   @map("sender_kind")
  senderUserId  String?  @db.Uuid @map("sender_user_id")
  senderGuestId String?  @db.Uuid @map("sender_guest_id")
  senderName    String   @map("sender_name")
  body          String
  createdAt     DateTime @default(now()) @map("created_at")

  call        Call         @relation(fields: [callId], references: [id], onDelete: Cascade)
  senderUser  UserProfile? @relation("CallMessageSenderUser", fields: [senderUserId], references: [id])
  senderGuest CallGuest?   @relation(fields: [senderGuestId], references: [id])

  @@index([callId, createdAt])
  @@map("call_message")
}

model CallGuestJoinAttempt {
  id        String   @id @default(uuid(7)) @db.Uuid
  ip        String
  linkId    String?  @db.Uuid @map("link_id")
  outcome   String
  createdAt DateTime @default(now()) @map("created_at")

  @@index([ip, createdAt])
  @@map("call_guest_join_attempt")
}
```

- [ ] **Step 3: Add the back-relations on `Call` and `UserProfile`**

In `model Call`, add to the relation block:

```prisma
  guests   CallGuest[]
  messages CallMessage[]
  links    CallLink[]     @relation("CallLinkConversation")  // NOTE: remove — links are by conversation_id, not a Call FK
```

Actually **do not** add a `Call.links` relation — `call_link.conversation_id`
has no FK. Only add:

```prisma
  guests   CallGuest[]
  messages CallMessage[]
```

In `model UserProfile`, next to the existing `callsInitiated` /
`callParticipants` lines, add:

```prisma
  callLinksCreated       CallLink[]                @relation("CallLinkCreatedBy")
  callInvitesSent        CallInvite[]              @relation("CallInviteInvitedBy")
  callGuestsAdmitted     CallGuest[]               @relation("CallGuestAdmittedBy")
  callMessagesSent       CallMessage[]             @relation("CallMessageSenderUser")
```

- [ ] **Step 4: Generate the client**

Run: `pnpm db:generate`
Expected: "Generated Prisma Client" with no schema validation errors. If it
reports a missing opposite relation, add the named back-relation it asks for.

- [ ] **Step 5: Do NOT run db:migrate here**

Applying to the live Supabase DB needs network + allowlist. Leave the
migration file in place; it will be applied by whoever runs `pnpm db:migrate`
during deploy. All Plan A tests mock Prisma and need no DB.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20260906000000_call_guest_access/ prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(calls): schema + migration for guest access (links, invites, guests, messages)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Validators

**Files:**
- Create: `packages/validators/src/calls.js`
- Modify: `packages/validators/src/index.js` (add `export * from "./calls.js";`
  — check the file; if it re-exports per-domain, follow that pattern)

- [ ] **Step 1: Write the schemas**

Create `packages/validators/src/calls.js`:

```js
import { z } from "zod";

export const callLinkPatchSchema = z.object({
  requireLobby: z.boolean().optional(),
  maxUses: z.number().int().positive().max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const callInviteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
});

export const callGuestJoinSchema = z.object({
  token: z.string().min(1).max(128).optional(),
  code: z.string().min(1).max(32).optional(),
  inviteToken: z.string().min(1).max(128).optional(),
  displayName: z.string().trim().min(2).max(40),
  email: z.string().email().optional(),
}).refine((v) => v.token || v.code || v.inviteToken, {
  message: "Se requiere un enlace, código o invitación.",
});

export const callRoomMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const callGuestModerationSchema = z.object({
  muted: z.boolean(),
});
```

- [ ] **Step 2: Re-export**

Check `packages/validators/src/index.js`. If it has lines like
`export * from "./chat.js";`, add `export * from "./calls.js";` alphabetically.

- [ ] **Step 3: Syntax check + commit**

```bash
node --check packages/validators/src/calls.js
git add packages/validators/src/calls.js packages/validators/src/index.js
git commit -m "$(cat <<'EOF'
feat(validators): schemas for call guest links, invites, join, room messages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Export `assertCanManageCall` from `call-service.js`

**Files:**
- Modify: `apps/api/src/routes/calls/call-service.js`

Currently `endCall` inlines the "initiator or channel.manage" check. Extract it
so the new services reuse the exact same rule.

- [ ] **Step 1: Extract the helper**

In `createCallService`, find inside `endCall`:

```js
    if (profile.id !== call.initiatedByUserId) {
      const roleRows = await prisma.$queryRaw`
        SELECT r.is_system AS "isSystem", r.permissions
        FROM chat_conversation_members m
        JOIN chat_channel_roles r ON r.id = m.role_id
        WHERE m.conversation_id = ${call.conversationId}
          AND m.user_id = ${profile.id}
          AND m.left_at IS NULL
        LIMIT 1
      `;
      const role = roleRows[0];
      if (!role?.isSystem && role?.permissions?.["channel.manage"] !== true) {
        throw new CallServiceError("No tienes permiso para finalizar esta llamada.", 403);
      }
    }
```

Replace with a call to a new helper and define that helper next to the other
private functions (e.g. after `assertCallAccess`):

```js
  async function assertCanManageCall({ conversationId, initiatedByUserId, profileId, action = "gestionar esta llamada" }) {
    if (profileId === initiatedByUserId) return;
    const roleRows = await prisma.$queryRaw`
      SELECT r.is_system AS "isSystem", r.permissions
      FROM chat_conversation_members m
      JOIN chat_channel_roles r ON r.id = m.role_id
      WHERE m.conversation_id = ${conversationId}
        AND m.user_id = ${profileId}
        AND m.left_at IS NULL
      LIMIT 1
    `;
    const role = roleRows[0];
    if (!role?.isSystem && role?.permissions?.["channel.manage"] !== true) {
      throw new CallServiceError(`No tienes permiso para ${action}.`, 403);
    }
  }
```

`endCall`'s block becomes:

```js
    await assertCanManageCall({
      conversationId: call.conversationId,
      initiatedByUserId: call.initiatedByUserId,
      profileId: profile.id,
      action: "finalizar esta llamada",
    });
```

- [ ] **Step 2: Export it on the returned object**

Add `assertCanManageCall` to the `return { ... }` at the bottom of
`createCallService`.

- [ ] **Step 3: Run existing tests + commit**

```bash
node --test apps/api/src/routes/calls/__tests__/call-service.test.js
```
Expected: all pass (the "end" test still gets 403 for a non-manager). If a
stub lacks `$queryRaw` for the role lookup it already had one — no change
needed.

```bash
git add apps/api/src/routes/calls/call-service.js
git commit -m "$(cat <<'EOF'
refactor(calls): extract assertCanManageCall for reuse by guest services

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `call-links-service.js`

**Files:**
- Create: `apps/api/src/routes/calls/call-links-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-links-service.test.js`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/calls/__tests__/call-links-service.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallLinksService, CallLinkError, generateCallCode } from "../call-links-service.js";

const CONV = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

describe("generateCallCode", () => {
  it("produces 8 Crockford base32 chars, no ambiguous letters", () => {
    for (let i = 0; i < 50; i += 1) {
      const c = generateCallCode();
      assert.match(c, /^[0-9A-HJKMNP-TV-Z]{8}$/);
      assert.equal(/[ILOU]/.test(c), false);
    }
  });
});

describe("createCallLinksService.getOrCreateLink", () => {
  it("returns the existing non-revoked link without creating a second", async () => {
    const existing = { id: "l1", conversationId: CONV, token: "tok", code: "ABCDEFGH", requireLobby: true, maxUses: null, useCount: 0, expiresAt: null, revokedAt: null };
    let created = 0;
    const prisma = {
      $queryRaw: async () => [{ id: "member" }],
      callLink: {
        findFirst: async () => existing,
        create: async () => { created += 1; return existing; },
      },
    };
    const svc = createCallLinksService({ prisma, smtpService: null, callService: { assertCanManageCall: async () => {} } });
    const out = await svc.getOrCreateLink({ authUserId: "auth", conversationId: CONV, profileId: USER });
    assert.equal(out.token, "tok");
    assert.equal(created, 0);
  });

  it("creates a link when none exists", async () => {
    let createArgs;
    const prisma = {
      $queryRaw: async () => [{ id: "member" }],
      callLink: {
        findFirst: async () => null,
        create: async (args) => { createArgs = args; return { id: "l2", ...args.data, useCount: 0, revokedAt: null }; },
      },
    };
    const svc = createCallLinksService({ prisma, smtpService: null, callService: { assertCanManageCall: async () => {} } });
    const out = await svc.getOrCreateLink({ authUserId: "auth", conversationId: CONV, profileId: USER });
    assert.equal(createArgs.data.conversationId, CONV);
    assert.equal(createArgs.data.requireLobby, true);
    assert.match(out.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe("createCallLinksService.resolveLinkForJoin", () => {
  function svcWith(link) {
    const prisma = { callLink: { findUnique: async () => link, findFirst: async () => link } };
    return createCallLinksService({ prisma, smtpService: null, callService: {} });
  }
  it("rejects a bad token", async () => {
    await assert.rejects(svcWith(null).resolveLinkForJoin({ token: "nope" }),
      (e) => e instanceof CallLinkError && e.reason === "bad_token");
  });
  it("rejects a revoked link", async () => {
    await assert.rejects(svcWith({ id: "l", revokedAt: new Date(), code: "X" }).resolveLinkForJoin({ token: "t" }),
      (e) => e.reason === "revoked");
  });
  it("rejects an expired link", async () => {
    await assert.rejects(
      svcWith({ id: "l", revokedAt: null, expiresAt: new Date(Date.now() - 1000), code: "X" }).resolveLinkForJoin({ token: "t" }),
      (e) => e.reason === "expired");
  });
  it("rejects when max uses reached", async () => {
    await assert.rejects(
      svcWith({ id: "l", revokedAt: null, expiresAt: null, maxUses: 3, useCount: 3, code: "X" }).resolveLinkForJoin({ token: "t" }),
      (e) => e.reason === "max_uses");
  });
  it("accepts a good link and matches the code case-insensitively", async () => {
    const link = { id: "l", revokedAt: null, expiresAt: null, maxUses: null, useCount: 0, code: "ABCDEFGH" };
    const out = await svcWith(link).resolveLinkForJoin({ code: "abcdefgh" });
    assert.equal(out.id, "l");
  });
});

describe("createCallLinksService.sendInvites", () => {
  it("splits matched company users from emailed invites and manual fallbacks", async () => {
    const prisma = {
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("membership")) return [{ userId: "u-match", email: "match@x.com" }];
        return [{ id: "member" }];
      },
      callLink: { findFirst: async () => ({ id: "l1", conversationId: CONV, token: "tok", code: "C", revokedAt: null }) },
      callInvite: { create: async ({ data }) => ({ id: `inv-${data.emailNormalized}`, ...data }) },
    };
    const sent = [];
    const smtpService = { isConfigured: async () => true, sendEmail: async (m) => { sent.push(m.to); } };
    const svc = createCallLinksService({ prisma, smtpService, callService: { assertCanManageCall: async () => {} }, env: { PUBLIC_APP_URL: "https://app.test" } });
    const out = await svc.sendInvites({ authUserId: "auth", conversationId: CONV, profileId: USER, emails: ["match@x.com", "outsider@y.com"] });
    assert.deepEqual(out.matchedUsers.map((u) => u.userId), ["u-match"]);
    assert.equal(out.invited.length, 1);
    assert.equal(out.pendingManual.length, 0);
    assert.deepEqual(sent, ["outsider@y.com"]);
  });

  it("returns pendingManual with a copyable URL when SMTP is not configured", async () => {
    const prisma = {
      $queryRaw: async (s) => (String(Array.isArray(s) ? s.join("?") : s).includes("membership") ? [] : [{ id: "member" }]),
      callLink: { findFirst: async () => ({ id: "l1", conversationId: CONV, token: "tok", code: "C", revokedAt: null }) },
      callInvite: { create: async ({ data }) => ({ id: "inv", ...data }) },
    };
    const smtpService = { isConfigured: async () => false, sendEmail: async () => { throw new Error("should not send"); } };
    const svc = createCallLinksService({ prisma, smtpService, callService: { assertCanManageCall: async () => {} }, env: { PUBLIC_APP_URL: "https://app.test" } });
    const out = await svc.sendInvites({ authUserId: "auth", conversationId: CONV, profileId: USER, emails: ["outsider@y.com"] });
    assert.equal(out.pendingManual.length, 1);
    assert.match(out.pendingManual[0].url, /^https:\/\/app\.test\/p\/call\/tok\?i=/);
  });
});
```

- [ ] **Step 2: Run — expect module-not-found failure**

Run: `node --test apps/api/src/routes/calls/__tests__/call-links-service.test.js`
Expected: FAIL — cannot find `../call-links-service.js`.

- [ ] **Step 3: Implement `call-links-service.js`**

Create `apps/api/src/routes/calls/call-links-service.js`:

```js
import crypto from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I L O U
const CODE_LEN = 8;

export class CallLinkError extends Error {
  constructor(message, status = 400, reason = null) {
    super(message);
    this.name = "CallLinkError";
    this.status = status;
    this.reason = reason;
  }
}

export function generateCallCode() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i += 1) out += CROCKFORD[bytes[i] % CROCKFORD.length];
  return out;
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function createCallLinksService({ prisma, smtpService, callService, env = process.env, now = () => new Date() }) {
  const publicAppUrl = String(env.PUBLIC_APP_URL ?? env.ATLAS_APP_URL ?? "").replace(/\/+$/, "");

  function joinUrl(token, inviteToken) {
    const base = `${publicAppUrl}/p/call/${token}`;
    return inviteToken ? `${base}?i=${inviteToken}` : base;
  }

  function toLinkDto(link) {
    return {
      token: link.token,
      code: link.code,
      url: joinUrl(link.token),
      requireLobby: link.requireLobby,
      maxUses: link.maxUses ?? null,
      useCount: link.useCount ?? 0,
      expiresAt: link.expiresAt ?? null,
    };
  }

  async function assertMember(conversationId, profileId) {
    const rows = await prisma.$queryRaw`
      SELECT m.id FROM chat_conversation_members m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND m.user_id = ${profileId}
        AND m.left_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new CallLinkError("Conversación no encontrada.", 404);
  }

  // The manage gate: initiator of the live call OR channel.manage. We do not
  // require a live call to manage the link, so fall back to channel.manage
  // only when there is no live call.
  async function assertCanManage({ conversationId, profileId }) {
    await assertMember(conversationId, profileId);
    const liveRows = await prisma.$queryRaw`
      SELECT initiated_by_user_id AS "initiatedByUserId"
      FROM "call" WHERE conversation_id = ${conversationId}
        AND status IN ('RINGING','ACTIVE') LIMIT 1
    `;
    const initiatedByUserId = liveRows[0]?.initiatedByUserId ?? null;
    await callService.assertCanManageCall({
      conversationId,
      initiatedByUserId,
      profileId,
      action: "gestionar el enlace de invitados",
    });
  }

  async function getLink({ conversationId, profileId }) {
    await assertMember(conversationId, profileId);
    const link = await prisma.callLink.findFirst({
      where: { conversationId, revokedAt: null },
    });
    return link ? toLinkDto(link) : null;
  }

  async function getOrCreateLink({ conversationId, profileId }) {
    await assertCanManage({ conversationId, profileId });
    const existing = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (existing) return toLinkDto(existing);

    // Retry a couple of times on the astronomically unlikely token/code clash.
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const created = await prisma.callLink.create({
          data: {
            conversationId,
            token: crypto.randomBytes(32).toString("hex"),
            code: generateCallCode(),
            requireLobby: true,
            createdByUserId: profileId,
          },
        });
        return toLinkDto(created);
      } catch (error) {
        lastErr = error;
      }
    }
    throw lastErr ?? new CallLinkError("No se pudo crear el enlace.", 500);
  }

  async function updateLink({ conversationId, profileId, patch }) {
    await assertCanManage({ conversationId, profileId });
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (!link) throw new CallLinkError("No hay un enlace activo.", 404);
    const data = {};
    if (patch.requireLobby !== undefined) data.requireLobby = patch.requireLobby;
    if (patch.maxUses !== undefined) data.maxUses = patch.maxUses;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    const updated = await prisma.callLink.update({ where: { id: link.id }, data });
    return toLinkDto(updated);
  }

  async function revokeLink({ conversationId, profileId, guestService = null }) {
    await assertCanManage({ conversationId, profileId });
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (!link) return { revoked: false };
    await prisma.callLink.update({ where: { id: link.id }, data: { revokedAt: now() } });
    if (guestService?.kickGuestsForLink) {
      await guestService.kickGuestsForLink({ linkId: link.id }).catch(() => {});
    }
    return { revoked: true };
  }

  async function resolveLinkForJoin({ token = null, code = null }) {
    let link = null;
    if (token) {
      link = await prisma.callLink.findUnique({ where: { token } });
    } else if (code) {
      link = await prisma.callLink.findFirst({ where: { code: code.trim().toUpperCase() } });
    }
    if (!link) throw new CallLinkError("Enlace no válido.", 404, token ? "bad_token" : "bad_code");
    if (link.revokedAt) throw new CallLinkError("Este enlace fue revocado.", 410, "revoked");
    if (link.expiresAt && new Date(link.expiresAt).getTime() < now().getTime()) {
      throw new CallLinkError("Este enlace expiró.", 410, "expired");
    }
    if (link.maxUses != null && (link.useCount ?? 0) >= link.maxUses) {
      throw new CallLinkError("Este enlace alcanzó su límite de usos.", 410, "max_uses");
    }
    return link;
  }

  async function resolveInvite({ inviteToken, linkId }) {
    if (!inviteToken) return null;
    const invite = await prisma.callInvite.findUnique({ where: { token: inviteToken } });
    if (!invite || invite.linkId !== linkId) {
      throw new CallLinkError("Invitación no válida.", 404, "bad_invite");
    }
    return invite;
  }

  async function sendInvites({ conversationId, profileId, emails }) {
    await assertCanManage({ conversationId, profileId });
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (!link) throw new CallLinkError("Genera un enlace antes de invitar.", 409);

    const normalized = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];

    // Match active company users by email.
    const companyRows = await prisma.$queryRaw`
      SELECT up.id AS "userId", lower(up.email) AS email
      FROM user_profile up
      JOIN membership mem ON mem.user_id = up.id AND mem.enabled = true
      WHERE mem.company_id = (
        SELECT company_id FROM membership WHERE user_id = ${profileId} AND enabled = true
        ORDER BY created_at DESC LIMIT 1
      )
      AND lower(up.email) = ANY(${normalized}::text[])
    `;
    const matchedByEmail = new Map(companyRows.map((r) => [r.email, r.userId]));
    const matchedUsers = [...matchedByEmail.entries()].map(([email, userId]) => ({ email, userId }));

    const smtpOk = smtpService ? await smtpService.isConfigured().catch(() => false) : false;
    const invited = [];
    const pendingManual = [];

    for (const email of normalized) {
      if (matchedByEmail.has(email)) continue;
      const inviteToken = crypto.randomBytes(24).toString("hex");
      const invite = await prisma.callInvite.create({
        data: {
          linkId: link.id,
          email,
          emailNormalized: email,
          token: inviteToken,
          invitedByUserId: profileId,
          sentAt: smtpOk ? now() : null,
        },
      });
      const url = joinUrl(link.token, inviteToken);
      if (smtpOk) {
        try {
          await smtpService.sendEmail({
            to: email,
            subject: "Te invitaron a una llamada",
            text: `Únete a la llamada: ${url}`,
            html: `<p>Te invitaron a una llamada.</p><p><a href="${url}">Unirme a la llamada</a></p><p>${url}</p>`,
          });
          invited.push({ email, inviteId: invite.id });
        } catch {
          pendingManual.push({ email, inviteId: invite.id, url });
        }
      } else {
        pendingManual.push({ email, inviteId: invite.id, url });
      }
    }

    return { matchedUsers, invited, pendingManual };
  }

  return {
    getLink,
    getOrCreateLink,
    updateLink,
    revokeLink,
    resolveLinkForJoin,
    resolveInvite,
    sendInvites,
    joinUrl,
    toLinkDto,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test apps/api/src/routes/calls/__tests__/call-links-service.test.js`
Expected: PASS. Adjust stubs/impl together if a shape mismatch surfaces
(e.g. `prisma.callLink.findFirst` where clause) — keep the DTO shape stable.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/calls/call-links-service.js apps/api/src/routes/calls/__tests__/call-links-service.test.js
git commit -m "$(cat <<'EOF'
feat(calls): call-links-service — per-conversation guest links, codes, invites

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `call-guest-service.js`

**Files:**
- Create: `apps/api/src/routes/calls/call-guest-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-guest-service.test.js`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/calls/__tests__/call-guest-service.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallGuestService, CallGuestError } from "../call-guest-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const GUEST = "99999999-9999-4999-8999-999999999999";

function env() {
  return {
    LIVEKIT_MODE: "embedded",
    LIVEKIT_URL: "wss://rtc.example.test",
    LIVEKIT_INTERNAL_URL: "http://livekit:7880",
    LIVEKIT_API_KEY: "api-key",
    LIVEKIT_API_SECRET: "super-secret",
  };
}

class FakeToken {
  constructor(key, secret, opts) { this.key = key; this.secret = secret; this.opts = opts; this.grant = null; }
  addGrant(g) { this.grant = g; }
  async toJwt() { return "guest-jwt"; }
}

const liveCall = { id: CALL, conversationId: CONV, kind: "VIDEO", status: "ACTIVE", livekitRoomName: `call_${CALL}` };

function baseLinksService(link = { id: "l1", conversationId: CONV, requireLobby: true, useCount: 0 }) {
  return {
    resolveLinkForJoin: async () => link,
    resolveInvite: async () => null,
  };
}

describe("createCallGuestService.joinAsGuest", () => {
  it("rate-limits the 9th attempt from one IP in 10 minutes", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 8, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 0, create: async ({ data }) => ({ id: GUEST, ...data }) },
      callLink: { update: async () => ({}) },
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    await assert.rejects(
      svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" }),
      (e) => e instanceof CallGuestError && e.status === 429,
    );
  });

  it("creates a LOBBY guest when the link requires a lobby", async () => {
    let createData;
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 0, create: async ({ data }) => { createData = data; return { id: GUEST, ...data }; } },
      callLink: { update: async () => ({}) },
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    const out = await svc.joinAsGuest({ token: "t", displayName: "  Ana  ", ip: "192.0.2.1" });
    assert.equal(out.status, "LOBBY");
    assert.equal(createData.status, "LOBBY");
    assert.equal(createData.displayName, "Ana");
    assert.match(createData.livekitIdentity, /^guest_/);
    assert.ok(out.guestToken && out.guestToken.length >= 32);
  });

  it("admits immediately when the link does not require a lobby", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 0, create: async ({ data }) => ({ id: GUEST, ...data }) },
      callLink: { update: async () => ({}) },
    };
    const links = baseLinksService({ id: "l1", conversationId: CONV, requireLobby: false, useCount: 0 });
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: links });
    const out = await svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" });
    assert.equal(out.status, "ADMITTED");
  });

  it("returns waiting when there is no live call", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [],
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    const out = await svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" });
    assert.equal(out.status, "waiting");
  });

  it("rejects the 21st concurrent guest", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 20, create: async () => ({}) },
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    await assert.rejects(
      svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" }),
      (e) => e instanceof CallGuestError && e.status === 409,
    );
  });
});

describe("createCallGuestService.getGuestLiveKitToken", () => {
  function svcFor(guest, call = liveCall) {
    const prisma = {
      callGuest: { findFirst: async () => guest, update: async () => ({}) },
      $queryRaw: async () => (call ? [call] : []),
    };
    return createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
  }
  it("refuses a guest that is not ADMITTED", async () => {
    await assert.rejects(
      svcFor({ id: GUEST, status: "LOBBY", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" }).getGuestLiveKitToken({ guestToken: "gt" }),
      (e) => e instanceof CallGuestError && e.status === 403,
    );
  });
  it("mints a room-scoped token for an ADMITTED guest and never returns the secret", async () => {
    const out = await svcFor({ id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" }).getGuestLiveKitToken({ guestToken: "gt" });
    assert.equal(out.token, "guest-jwt");
    assert.equal(out.livekitUrl, "wss://rtc.example.test");
    assert.equal(JSON.stringify(out).includes("super-secret"), false);
  });
  it("refuses when the call is no longer live", async () => {
    await assert.rejects(
      svcFor({ id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" }, null).getGuestLiveKitToken({ guestToken: "gt" }),
      (e) => e instanceof CallGuestError,
    );
  });
});

describe("createCallGuestService moderation", () => {
  it("admitGuest sets ADMITTED + admittedBy and broadcasts", async () => {
    let updateArgs;
    const broadcasts = [];
    const prisma = {
      $queryRaw: async () => [{ ...liveCall, initiatedByUserId: "host" }],
      callGuest: { findFirst: async () => ({ id: GUEST, callId: CALL, status: "LOBBY" }), update: async (a) => { updateArgs = a; return {}; } },
      callParticipant: { findMany: async () => [{ userId: "host" }] },
    };
    const svc = createCallGuestService({
      prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService(),
      callService: { assertCanManageCall: async () => {} },
      broadcaster: { broadcastToUsers: async (u, ev) => broadcasts.push(ev) },
    });
    await svc.admitGuest({ authUserId: "auth", profileId: "host", callId: CALL, guestId: GUEST });
    assert.equal(updateArgs.data.status, "ADMITTED");
    assert.equal(updateArgs.data.admittedByUserId, "host");
    assert.ok(broadcasts.includes("chat.call.guest_admitted"));
  });

  it("kickGuest flips status and calls removeParticipant", async () => {
    let removed;
    class FakeRoom { async removeParticipant(room, id) { removed = { room, id }; } }
    const prisma = {
      $queryRaw: async () => [{ ...liveCall, initiatedByUserId: "host" }],
      callGuest: { findFirst: async () => ({ id: GUEST, callId: CALL, status: "ADMITTED", livekitIdentity: "guest_x" }), update: async () => ({}) },
      callParticipant: { findMany: async () => [] },
    };
    const svc = createCallGuestService({
      prisma, env: env(), AccessTokenImpl: FakeToken, RoomServiceClientImpl: FakeRoom,
      linksService: baseLinksService(), callService: { assertCanManageCall: async () => {} },
      broadcaster: { broadcastToUsers: async () => {} },
    });
    await svc.kickGuest({ authUserId: "auth", profileId: "host", callId: CALL, guestId: GUEST });
    assert.deepEqual(removed, { room: `call_${CALL}`, id: "guest_x" });
  });
});
```

- [ ] **Step 2: Run — expect module-not-found failure**

Run: `node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js`
Expected: FAIL — cannot find `../call-guest-service.js`.

- [ ] **Step 3: Implement `call-guest-service.js`**

Create `apps/api/src/routes/calls/call-guest-service.js`:

```js
import crypto from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { readLiveKitConfig } from "./call-service.js";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8;
const MAX_GUESTS_PER_CALL = 20;
const GUEST_TOKEN_TTL = "15m";
const ABANDON_MS = 2 * 60 * 1000;
const LIVE = ["RINGING", "ACTIVE"];

export class CallGuestError extends Error {
  constructor(message, status = 400, reason = null) {
    super(message);
    this.name = "CallGuestError";
    this.status = status;
    this.reason = reason;
  }
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function createCallGuestService({
  prisma,
  env = process.env,
  AccessTokenImpl = AccessToken,
  RoomServiceClientImpl = RoomServiceClient,
  linksService,
  callService = null,
  broadcaster = null,
  notificationService = null,
  now = () => new Date(),
}) {
  function config() {
    return readLiveKitConfig(env);
  }
  function assertEnabled() {
    const c = config();
    if (!c.enabled) throw new CallGuestError("Las llamadas no están configuradas.", 501);
    return c;
  }

  async function liveCallForConversation(conversationId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", kind, status,
             livekit_room_name AS "livekitRoomName", initiated_by_user_id AS "initiatedByUserId"
      FROM "call"
      WHERE conversation_id = ${conversationId} AND status IN ('RINGING','ACTIVE')
      ORDER BY created_at DESC LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async function liveCallById(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", kind, status,
             livekit_room_name AS "livekitRoomName", initiated_by_user_id AS "initiatedByUserId"
      FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async function resolveGuest(guestToken) {
    if (!guestToken) throw new CallGuestError("Sesión de invitado no válida.", 401);
    const guest = await prisma.callGuest.findFirst({ where: { sessionTokenHash: hashToken(guestToken) } });
    if (!guest) throw new CallGuestError("Sesión de invitado no válida o expirada.", 401);
    return guest;
  }

  async function recordAttempt(ip, linkId, outcome) {
    try {
      await prisma.callGuestJoinAttempt.create({ data: { ip: ip ?? "unknown", linkId: linkId ?? null, outcome } });
    } catch { /* non-fatal */ }
  }

  async function notifyMembers(call, event, payload) {
    try {
      const parts = await prisma.callParticipant.findMany({
        where: { callId: call.id, status: { in: ["RINGING", "JOINED"] } },
        select: { userId: true },
      });
      const ids = [...new Set(parts.map((p) => p.userId).filter(Boolean))];
      if (ids.length) await broadcaster?.broadcastToUsers?.(ids, event, payload);
    } catch { /* non-fatal */ }
  }

  async function joinAsGuest({ token = null, code = null, inviteToken = null, displayName, email = null, ip = null, userAgent = null }) {
    assertEnabled();
    const name = String(displayName ?? "").trim();
    if (name.length < 2 || name.length > 40) throw new CallGuestError("El nombre debe tener entre 2 y 40 caracteres.", 422);

    const recent = await prisma.callGuestJoinAttempt.count({
      where: { ip: ip ?? "unknown", createdAt: { gte: new Date(now().getTime() - RATE_WINDOW_MS) } },
    });
    if (recent >= RATE_MAX) {
      await recordAttempt(ip, null, "rate_limited");
      throw new CallGuestError("Demasiados intentos. Espera unos minutos.", 429, "rate_limited");
    }

    let link;
    try {
      link = await linksService.resolveLinkForJoin({ token, code });
    } catch (error) {
      await recordAttempt(ip, null, error.reason ?? "bad_token");
      throw new CallGuestError(error.message, error.status ?? 400, error.reason ?? "bad_token");
    }

    let invite = null;
    if (inviteToken) {
      invite = await linksService.resolveInvite({ inviteToken, linkId: link.id });
      if (invite?.acceptedAt) {
        const activePrev = await prisma.callGuest.findFirst({
          where: { inviteId: invite.id, status: { in: ["LOBBY", "ADMITTED"] } },
        });
        if (activePrev) throw new CallGuestError("Esta invitación ya está en uso.", 409, "invite_in_use");
      }
      if (invite?.email && !email) email = invite.email;
    }

    const call = await liveCallForConversation(link.conversationId);
    if (!call) {
      await recordAttempt(ip, link.id, "no_live_call");
      return { status: "waiting" };
    }

    const activeGuests = await prisma.callGuest.count({
      where: { callId: call.id, status: { in: ["LOBBY", "ADMITTED"] } },
    });
    if (activeGuests >= MAX_GUESTS_PER_CALL) {
      await recordAttempt(ip, link.id, "call_full");
      throw new CallGuestError("La llamada alcanzó el máximo de invitados.", 409, "call_full");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const status = link.requireLobby ? "LOBBY" : "ADMITTED";
    const guest = await prisma.callGuest.create({
      data: {
        callId: call.id,
        linkId: link.id,
        inviteId: invite?.id ?? null,
        displayName: name,
        email: email ?? null,
        sessionTokenHash: hashToken(rawToken),
        livekitIdentity: `guest_${crypto.randomUUID()}`,
        status,
        admittedByUserId: null,
        admittedAt: status === "ADMITTED" ? now() : null,
        joinIp: ip ?? null,
        userAgent: userAgent ?? null,
        lastSeenAt: now(),
      },
    });

    await prisma.callLink.update({ where: { id: link.id }, data: { useCount: { increment: 1 } } }).catch(() => {});
    if (invite && !invite.acceptedAt) {
      await prisma.callInvite.update({ where: { id: invite.id }, data: { acceptedAt: now() } }).catch(() => {});
    }
    await recordAttempt(ip, link.id, "ok");

    await notifyMembers(call, status === "LOBBY" ? "chat.call.guest_waiting" : "chat.call.guest_joined", {
      callId: call.id, guestId: guest.id, name,
    });
    if (notificationService?.publish && status === "LOBBY") {
      // fire-and-forget in-app nudge to the initiator
      setImmediate(async () => {
        try {
          const membership = await prisma.membership.findFirst({
            where: { userId: call.initiatedByUserId, enabled: true },
            orderBy: { createdAt: "desc" }, select: { companyId: true },
          });
          if (!membership?.companyId) return;
          await notificationService.publish({
            companyId: membership.companyId,
            input: {
              eventType: "chat.call.guest_waiting",
              title: "Invitado esperando en la llamada",
              body: `${name} quiere unirse.`,
              link: `/app/m/atlas.chat/chat/inbox/${call.conversationId}`,
              recipients: { userIds: [call.initiatedByUserId] },
              channels: ["in_app"],
              priority: "high",
              sourceType: "call",
              sourceId: call.id,
              dedupeKey: `chat.call.guest_waiting:${guest.id}`,
            },
          });
        } catch { /* non-fatal */ }
      });
    }

    return {
      guestToken: rawToken,
      guestId: guest.id,
      status,
      callId: call.id,
      requiresLobby: link.requireLobby,
    };
  }

  async function getGuestState({ guestToken }) {
    assertEnabled();
    const guest = await resolveGuest(guestToken);
    await prisma.callGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now() } }).catch(() => {});
    const call = await liveCallById(guest.callId);
    const live = call && LIVE.includes(call.status);

    let roster = [];
    let messages = [];
    if (live && guest.status === "ADMITTED") {
      const guests = await prisma.callGuest.findMany({
        where: { callId: guest.callId, status: { in: ["ADMITTED"] } },
        select: { id: true, displayName: true },
      });
      roster = guests.map((g) => ({ name: g.displayName, isYou: g.id === guest.id }));
      const rows = await prisma.callMessage.findMany({
        where: { callId: guest.callId },
        orderBy: { createdAt: "asc" }, take: 200,
        select: { id: true, senderKind: true, senderName: true, body: true, createdAt: true },
      });
      messages = rows;
    }

    return {
      status: guest.status,
      callEnded: Boolean(call) && !live,
      call: call ? { id: call.id, kind: call.kind } : null,
      livekitUrl: config().publicUrl,
      guests: roster,
      messages,
    };
  }

  async function getGuestLiveKitToken({ guestToken }) {
    const c = assertEnabled();
    const guest = await resolveGuest(guestToken);
    if (guest.status !== "ADMITTED") throw new CallGuestError("Aún no te han admitido.", 403, guest.status);
    const call = await liveCallById(guest.callId);
    if (!call || !LIVE.includes(call.status)) throw new CallGuestError("La llamada no está activa.", 409, "not_live");

    const at = new AccessTokenImpl(c.apiKey, c.apiSecret, {
      identity: guest.livekitIdentity,
      name: guest.displayName,
      metadata: JSON.stringify({ guest: true }),
      ttl: GUEST_TOKEN_TTL,
    });
    at.addGrant({ room: call.livekitRoomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    await prisma.callGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now() } }).catch(() => {});
    return { livekitUrl: c.publicUrl, token: await at.toJwt() };
  }

  async function heartbeatGuest({ guestToken }) {
    const guest = await resolveGuest(guestToken);
    await prisma.callGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now() } });
    return { ok: true };
  }

  async function leaveGuest({ guestToken }) {
    const guest = await resolveGuest(guestToken);
    await prisma.callGuest.update({ where: { id: guest.id }, data: { status: "LEFT", leftAt: now() } });
    return { ok: true };
  }

  // ---- host moderation -------------------------------------------------------

  async function assertManage({ profileId, callId, action }) {
    const call = await liveCallById(callId);
    if (!call) throw new CallGuestError("Llamada no encontrada.", 404);
    if (!callService?.assertCanManageCall) throw new CallGuestError("No disponible.", 500);
    await callService.assertCanManageCall({
      conversationId: call.conversationId,
      initiatedByUserId: call.initiatedByUserId,
      profileId,
      action,
    });
    return call;
  }

  async function listCallGuests({ profileId, callId }) {
    await assertManage({ profileId, callId, action: "ver los invitados" });
    const guests = await prisma.callGuest.findMany({
      where: { callId, status: { in: ["LOBBY", "ADMITTED", "KICKED", "DENIED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, email: true, status: true, admittedAt: true, createdAt: true },
    });
    return { guests };
  }

  async function setGuestStatus({ profileId, callId, guestId, status, action, event }) {
    const call = await assertManage({ profileId, callId, action });
    const guest = await prisma.callGuest.findFirst({ where: { id: guestId, callId } });
    if (!guest) throw new CallGuestError("Invitado no encontrado.", 404);
    const data = { status };
    if (status === "ADMITTED") { data.admittedByUserId = profileId; data.admittedAt = now(); }
    if (status === "LEFT" || status === "KICKED" || status === "DENIED") data.leftAt = now();
    await prisma.callGuest.update({ where: { id: guest.id }, data });
    if (status === "KICKED") {
      try {
        const rc = new RoomServiceClientImpl(config().internalUrl, config().apiKey, config().apiSecret);
        await rc.removeParticipant(call.livekitRoomName, guest.livekitIdentity);
      } catch { /* best effort */ }
    }
    await notifyMembers(call, event, { callId, guestId, name: guest.displayName });
    return { ok: true, status };
  }

  const admitGuest = (a) => setGuestStatus({ ...a, status: "ADMITTED", action: "admitir invitados", event: "chat.call.guest_admitted" });
  const denyGuest = (a) => setGuestStatus({ ...a, status: "DENIED", action: "rechazar invitados", event: "chat.call.guest_denied" });
  const kickGuest = (a) => setGuestStatus({ ...a, status: "KICKED", action: "expulsar invitados", event: "chat.call.guest_kicked" });

  async function muteGuest({ profileId, callId, guestId, muted }) {
    const call = await assertManage({ profileId, callId, action: "silenciar invitados" });
    const guest = await prisma.callGuest.findFirst({ where: { id: guestId, callId } });
    if (!guest) throw new CallGuestError("Invitado no encontrado.", 404);
    try {
      const rc = new RoomServiceClientImpl(config().internalUrl, config().apiKey, config().apiSecret);
      const parts = await rc.listParticipants(call.livekitRoomName);
      const p = parts.find((x) => x.identity === guest.livekitIdentity);
      const audio = p?.tracks?.find((t) => t.type === 1 /* AUDIO */ || t.source === 2);
      if (audio) await rc.mutePublishedTrack(call.livekitRoomName, guest.livekitIdentity, audio.sid, muted);
    } catch { /* best effort */ }
    return { ok: true, muted };
  }

  async function kickGuestsForLink({ linkId }) {
    const guests = await prisma.callGuest.findMany({
      where: { linkId, status: { in: ["LOBBY", "ADMITTED"] } },
      select: { id: true, callId: true, livekitIdentity: true },
    });
    for (const g of guests) {
      await prisma.callGuest.update({ where: { id: g.id }, data: { status: "KICKED", leftAt: now() } }).catch(() => {});
      const call = await liveCallById(g.callId);
      if (call && LIVE.includes(call.status)) {
        try {
          const rc = new RoomServiceClientImpl(config().internalUrl, config().apiKey, config().apiSecret);
          await rc.removeParticipant(call.livekitRoomName, g.livekitIdentity);
        } catch { /* best effort */ }
      }
    }
    return { kicked: guests.length };
  }

  async function sweepAbandonedGuests() {
    const cutoff = new Date(now().getTime() - ABANDON_MS);
    const res = await prisma.callGuest.updateMany({
      where: { status: "LOBBY", lastSeenAt: { lt: cutoff } },
      data: { status: "DENIED", leftAt: now() },
    });
    return res?.count ?? 0;
  }

  return {
    joinAsGuest,
    getGuestState,
    getGuestLiveKitToken,
    heartbeatGuest,
    leaveGuest,
    listCallGuests,
    admitGuest,
    denyGuest,
    kickGuest,
    muteGuest,
    kickGuestsForLink,
    sweepAbandonedGuests,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js`
Expected: PASS. If the LiveKit `AccessToken`/`RoomServiceClient` real imports
break under test, the FakeToken/FakeRoom stubs already override them — verify
the `import { readLiveKitConfig } from "./call-service.js"` resolves (it does;
`call-service.js` exports it).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/calls/call-guest-service.js apps/api/src/routes/calls/__tests__/call-guest-service.test.js
git commit -m "$(cat <<'EOF'
feat(calls): call-guest-service — lobby, guest tokens, moderation, rate limit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `call-messages-service.js`

**Files:**
- Create: `apps/api/src/routes/calls/call-messages-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-messages-service.test.js`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/calls/__tests__/call-messages-service.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallMessagesService, CallMessageError } from "../call-messages-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

describe("createCallMessagesService.postMemberMessage", () => {
  it("rejects an empty body", async () => {
    const svc = createCallMessagesService({ prisma: {} });
    await assert.rejects(svc.postMemberMessage({ profileId: "u", callId: CALL, body: "   " }),
      (e) => e instanceof CallMessageError && e.status === 422);
  });
  it("rejects a >4000 char body", async () => {
    const svc = createCallMessagesService({ prisma: {} });
    await assert.rejects(svc.postMemberMessage({ profileId: "u", callId: CALL, body: "x".repeat(4001) }),
      (e) => e instanceof CallMessageError);
  });
  it("inserts a user message after checking membership", async () => {
    let insertData;
    const prisma = {
      $queryRaw: async (s) => {
        const sql = String(Array.isArray(s) ? s.join("?") : s);
        if (sql.includes("FROM \"call\"") || sql.includes("FROM call")) return [{ id: CALL, conversationId: CONV }];
        if (sql.includes("chat_conversation_members")) return [{ id: "member" }];
        if (sql.includes("user_profile")) return [{ displayName: "Ana" }];
        return [];
      },
      callMessage: { create: async ({ data }) => { insertData = data; return { id: "m1", ...data, createdAt: new Date() }; } },
    };
    const svc = createCallMessagesService({ prisma });
    const out = await svc.postMemberMessage({ profileId: "u", callId: CALL, body: "  hola  " });
    assert.equal(insertData.senderKind, "user");
    assert.equal(insertData.body, "hola");
    assert.equal(insertData.senderName, "Ana");
    assert.equal(out.message.id, "m1");
  });
});

describe("createCallMessagesService.postGuestMessage", () => {
  it("refuses a guest that is not ADMITTED", async () => {
    const guestService = { resolveAdmittedGuestForMessage: async () => { throw new CallMessageError("no", 403); } };
    const svc = createCallMessagesService({ prisma: {}, guestService });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "hi" }), (e) => e.status === 403);
  });
  it("inserts a guest message", async () => {
    let insertData;
    const prisma = { callMessage: { create: async ({ data }) => { insertData = data; return { id: "m2", ...data, createdAt: new Date() }; } } };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const svc = createCallMessagesService({ prisma, guestService });
    await svc.postGuestMessage({ guestToken: "gt", body: "hola" });
    assert.equal(insertData.senderKind, "guest");
    assert.equal(insertData.senderGuestId, "g1");
    assert.equal(insertData.senderName, "Vis");
  });
});

describe("createCallMessagesService.listMessages", () => {
  it("returns messages ordered ascending and honours sinceId", async () => {
    let where;
    const prisma = { callMessage: { findMany: async (args) => { where = args.where; return [{ id: "a" }, { id: "b" }]; } } };
    const svc = createCallMessagesService({ prisma });
    const out = await svc.listMessages({ callId: CALL, sinceId: "a" });
    assert.equal(out.messages.length, 2);
    assert.ok(where.id?.gt === "a" || where.createdAt); // sinceId translated to a cursor predicate
  });
});
```

- [ ] **Step 2: Run — expect module-not-found failure**

Run: `node --test apps/api/src/routes/calls/__tests__/call-messages-service.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `call-messages-service.js`**

Create `apps/api/src/routes/calls/call-messages-service.js`:

```js
export class CallMessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallMessageError";
    this.status = status;
  }
}

const MAX_BODY = 4000;

function cleanBody(body) {
  const b = String(body ?? "").trim();
  if (!b) throw new CallMessageError("El mensaje no puede estar vacío.", 422);
  if (b.length > MAX_BODY) throw new CallMessageError("El mensaje es demasiado largo.", 422);
  return b;
}

export function createCallMessagesService({ prisma, guestService = null, broadcaster = null, now = () => new Date() }) {
  async function loadCall(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", status FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    if (!rows.length) throw new CallMessageError("Llamada no encontrada.", 404);
    return rows[0];
  }

  async function assertMember(conversationId, profileId) {
    const rows = await prisma.$queryRaw`
      SELECT m.id FROM chat_conversation_members m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND m.user_id = ${profileId}
        AND m.left_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new CallMessageError("No formas parte de esta conversación.", 403);
  }

  async function displayName(profileId) {
    const rows = await prisma.$queryRaw`SELECT display_name AS "displayName" FROM user_profile WHERE id = ${profileId} LIMIT 1`;
    return rows[0]?.displayName ?? "Usuario";
  }

  async function postMemberMessage({ profileId, callId, body }) {
    const clean = cleanBody(body);
    const call = await loadCall(callId);
    await assertMember(call.conversationId, profileId);
    const name = await displayName(profileId);
    const created = await prisma.callMessage.create({
      data: { callId, senderKind: "user", senderUserId: profileId, senderName: name, body: clean },
    });
    return { message: shape(created) };
  }

  async function postGuestMessage({ guestToken, body }) {
    const clean = cleanBody(body);
    if (!guestService?.resolveAdmittedGuestForMessage) throw new CallMessageError("No disponible.", 500);
    const { guestId, callId, displayName: name } = await guestService.resolveAdmittedGuestForMessage({ guestToken });
    const created = await prisma.callMessage.create({
      data: { callId, senderKind: "guest", senderGuestId: guestId, senderName: name, body: clean },
    });
    return { message: shape(created) };
  }

  async function listMessages({ callId, sinceId = null, limit = 200 }) {
    const where = { callId };
    if (sinceId) where.id = { gt: sinceId };
    const rows = await prisma.callMessage.findMany({
      where, orderBy: { createdAt: "asc" }, take: Math.min(limit, 500),
      select: { id: true, senderKind: true, senderName: true, body: true, createdAt: true, senderUserId: true },
    });
    return { messages: rows.map(shape) };
  }

  function shape(m) {
    return {
      id: m.id,
      senderKind: m.senderKind,
      senderName: m.senderName,
      senderUserId: m.senderUserId ?? null,
      body: m.body,
      createdAt: m.createdAt,
    };
  }

  return { postMemberMessage, postGuestMessage, listMessages };
}
```

**Note:** `sinceId` as `{ id: { gt } }` relies on uuidv7 being monotonic —
which it is (time-ordered). The test accepts either that or a `createdAt`
cursor.

- [ ] **Step 4: Add `resolveAdmittedGuestForMessage` to `call-guest-service.js`**

In `call-guest-service.js`, add this function inside the factory and to the
returned object:

```js
  async function resolveAdmittedGuestForMessage({ guestToken }) {
    const guest = await resolveGuest(guestToken);
    if (guest.status !== "ADMITTED") throw new CallGuestError("Aún no te han admitido.", 403);
    const call = await liveCallById(guest.callId);
    if (!call || !LIVE.includes(call.status)) throw new CallGuestError("La llamada no está activa.", 409);
    return { guestId: guest.id, callId: guest.callId, displayName: guest.displayName };
  }
```

(It throws `CallGuestError`; `call-messages-service` only checks `.status`, so
that is compatible — the route error handler maps both.)

- [ ] **Step 5: Run both service test files — expect pass**

```bash
node --test apps/api/src/routes/calls/__tests__/call-messages-service.test.js apps/api/src/routes/calls/__tests__/call-guest-service.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/calls/call-messages-service.js apps/api/src/routes/calls/call-guest-service.js apps/api/src/routes/calls/__tests__/call-messages-service.test.js
git commit -m "$(cat <<'EOF'
feat(calls): call-messages-service — ephemeral call-scoped chat (users + guests)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Routes — host + unauthenticated guest sub-router

**Files:**
- Create: `apps/api/src/routes/calls/guest-routes.js`
- Modify: `apps/api/src/routes/calls/index.js`

- [ ] **Step 1: Guest sub-router**

Create `apps/api/src/routes/calls/guest-routes.js`:

```js
import { Hono } from "hono";
import { callGuestJoinSchema, callRoomMessageSchema } from "@atlas/validators";

function guestToken(c) {
  const auth = c.req.header("authorization") || c.req.header("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return c.req.query("gt") || null;
}

function fail(c, error, fallback) {
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  if (status === 500) console.error("[atlas.calls/guest]", error?.stack ?? error);
  return c.json({ error: status === 500 ? fallback : error.message, ...(error?.reason ? { reason: error.reason } : {}) }, status);
}

export function createGuestCallRouter({ guestService, messagesService }) {
  const app = new Hono();

  app.post("/join", async (c) => {
    try {
      const payload = callGuestJoinSchema.parse(await c.req.json());
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
        || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") ?? null;
      const data = await guestService.joinAsGuest({ ...payload, ip, userAgent });
      return c.json({ data });
    } catch (error) {
      if (error?.name === "ZodError") return c.json({ error: "Datos inválidos." }, 422);
      return fail(c, error, "No se pudo unir a la llamada.");
    }
  });

  app.get("/state", async (c) => {
    try {
      return c.json({ data: await guestService.getGuestState({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "No se pudo obtener el estado."); }
  });

  app.post("/token", async (c) => {
    try {
      return c.json({ data: await guestService.getGuestLiveKitToken({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "No se pudo obtener el acceso."); }
  });

  app.post("/heartbeat", async (c) => {
    try {
      return c.json({ data: await guestService.heartbeatGuest({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "Error."); }
  });

  app.post("/leave", async (c) => {
    try {
      return c.json({ data: await guestService.leaveGuest({ guestToken: guestToken(c) }) });
    } catch (error) { return fail(c, error, "Error."); }
  });

  app.post("/messages", async (c) => {
    try {
      const { body } = callRoomMessageSchema.parse(await c.req.json());
      return c.json({ data: await messagesService.postGuestMessage({ guestToken: guestToken(c), body }) });
    } catch (error) {
      if (error?.name === "ZodError") return c.json({ error: "Mensaje inválido." }, 422);
      return fail(c, error, "No se pudo enviar el mensaje.");
    }
  });

  return app;
}
```

- [ ] **Step 2: Host routes in `index.js`**

Open `apps/api/src/routes/calls/index.js`. Change `createCallsRouter` to build
the new services and mount the routes. Full updated file:

```js
import { Hono } from "hono";
import { z } from "zod";
import {
  callCreateSchema,
  callLinkPatchSchema,
  callInviteSchema,
  callRoomMessageSchema,
} from "@atlas/validators";
import { createCallService, CallServiceError } from "./call-service.js";
import { createCallLinksService, CallLinkError } from "./call-links-service.js";
import { createCallGuestService, CallGuestError } from "./call-guest-service.js";
import { createCallMessagesService, CallMessageError } from "./call-messages-service.js";
import { createGuestCallRouter } from "./guest-routes.js";

const callIdSchema = z.string().uuid();
const conversationIdSchema = z.string().uuid();

function handleError(c, error, fallback) {
  if (
    error instanceof CallServiceError
    || error instanceof CallLinkError
    || error instanceof CallGuestError
    || error instanceof CallMessageError
  ) {
    return c.json(
      { error: error.message, ...(error.details ? { details: error.details } : {}), ...(error.reason ? { reason: error.reason } : {}) },
      error.status,
    );
  }
  if (error?.name === "ZodError") {
    return c.json({ error: (error.errors ?? error.issues)?.[0]?.message ?? "Datos invalidos." }, 422);
  }
  console.error("[atlas.calls]", error?.stack ?? error);
  return c.json({ error: fallback }, 500);
}

export function createCallsRouter({ prisma, authMiddleware, notificationService = null, broadcaster = null, deliveryWorker = null, smtpService = null, service = null }) {
  const app = new Hono();
  const internal = new Hono();

  const calls = service ?? createCallService({ prisma, notificationService, broadcaster, deliveryWorker });
  const linksService = createCallLinksService({ prisma, smtpService, callService: calls });
  const guestService = createCallGuestService({ prisma, linksService, callService: calls, broadcaster, notificationService });
  const messagesService = createCallMessagesService({ prisma, guestService, broadcaster });

  if (!service) {
    calls.startExpirySweeper();
    const t = setInterval(() => { guestService.sweepAbandonedGuests().catch(() => {}); }, 30_000);
    t.unref?.();
  }

  // ---- unauthenticated guest routes (mounted BEFORE the auth middleware) ----
  app.route("/calls/guest", createGuestCallRouter({ guestService, messagesService }));

  internal.use("*", authMiddleware);

  async function profileId(c) {
    const rows = await prisma.$queryRaw`SELECT id FROM user_profile WHERE auth_user_id = ${c.get("authUserId")} LIMIT 1`;
    if (!rows.length) throw new CallServiceError("Perfil no encontrado.", 404);
    return rows[0].id;
  }

  internal.get("/config", async (c) => c.json({ data: await calls.getConfigStatus() }));

  internal.get("/current", async (c) => {
    try { return c.json({ data: await calls.getCurrentCall({ authUserId: c.get("authUserId") }) }); }
    catch (error) { return handleError(c, error, "Error obteniendo la llamada actual."); }
  });

  internal.post("/", async (c) => {
    try {
      const payload = callCreateSchema.parse(await c.req.json());
      const data = await calls.createCall({ authUserId: c.get("authUserId"), ...payload });
      return c.json({ data }, 201);
    } catch (error) { return handleError(c, error, "Error iniciando la llamada."); }
  });

  // ---- guest link (by conversation) ----
  internal.get("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      return c.json({ data: { link: await linksService.getLink({ conversationId, profileId: await profileId(c) }) } });
    } catch (error) { return handleError(c, error, "Error obteniendo el enlace."); }
  });
  internal.post("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      return c.json({ data: { link: await linksService.getOrCreateLink({ conversationId, profileId: await profileId(c) }) } });
    } catch (error) { return handleError(c, error, "Error creando el enlace."); }
  });
  internal.patch("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const patch = callLinkPatchSchema.parse(await c.req.json());
      return c.json({ data: { link: await linksService.updateLink({ conversationId, profileId: await profileId(c), patch }) } });
    } catch (error) { return handleError(c, error, "Error actualizando el enlace."); }
  });
  internal.delete("/conversations/:conversationId/link", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      return c.json({ data: await linksService.revokeLink({ conversationId, profileId: await profileId(c), guestService }) });
    } catch (error) { return handleError(c, error, "Error revocando el enlace."); }
  });
  internal.post("/conversations/:conversationId/link/invites", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const { emails } = callInviteSchema.parse(await c.req.json());
      return c.json({ data: await linksService.sendInvites({ conversationId, profileId: await profileId(c), emails }) });
    } catch (error) { return handleError(c, error, "Error enviando invitaciones."); }
  });

  // ---- guest moderation (by call) ----
  internal.get("/:callId/guests", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      return c.json({ data: await guestService.listCallGuests({ profileId: await profileId(c), callId }) });
    } catch (error) { return handleError(c, error, "Error obteniendo invitados."); }
  });
  for (const action of ["admit", "deny", "kick"]) {
    internal.post(`/:callId/guests/:guestId/${action}`, async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        const guestId = z.string().uuid().parse(c.req.param("guestId"));
        const fn = { admit: "admitGuest", deny: "denyGuest", kick: "kickGuest" }[action];
        return c.json({ data: await guestService[fn]({ profileId: await profileId(c), callId, guestId }) });
      } catch (error) { return handleError(c, error, `Error al ${action}.`); }
    });
  }
  internal.post("/:callId/guests/:guestId/mute", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      const guestId = z.string().uuid().parse(c.req.param("guestId"));
      const { muted } = z.object({ muted: z.boolean() }).parse(await c.req.json());
      return c.json({ data: await guestService.muteGuest({ profileId: await profileId(c), callId, guestId, muted }) });
    } catch (error) { return handleError(c, error, "Error al silenciar."); }
  });

  // ---- call-room chat (members) ----
  internal.get("/:callId/messages", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      const sinceId = c.req.query("sinceId") || null;
      // membership is enforced inside listMessages' callers; here re-check via a member post-guard:
      await messagesService.postMemberMessage; // no-op ref; membership check is in listMessagesGuarded below
      return c.json({ data: await messagesService.listMessagesGuarded({ profileId: await profileId(c), callId, sinceId }) });
    } catch (error) { return handleError(c, error, "Error obteniendo mensajes."); }
  });
  internal.post("/:callId/messages", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      const { body } = callRoomMessageSchema.parse(await c.req.json());
      return c.json({ data: await messagesService.postMemberMessage({ profileId: await profileId(c), callId, body }) });
    } catch (error) { return handleError(c, error, "Error enviando el mensaje."); }
  });

  internal.get("/:id", async (c) => {
    try {
      const id = callIdSchema.parse(c.req.param("id"));
      return c.json({ data: await calls.getCall({ authUserId: c.get("authUserId"), callId: id }) });
    } catch (error) { return handleError(c, error, "Error obteniendo la llamada."); }
  });

  for (const [action, method] of [["join", "joinCall"], ["decline", "declineCall"], ["leave", "leaveCall"], ["end", "endCall"]]) {
    internal.post(`/:id/${action}`, async (c) => {
      try {
        const id = callIdSchema.parse(c.req.param("id"));
        return c.json({ data: await calls[method]({ authUserId: c.get("authUserId"), callId: id }) });
      } catch (error) { return handleError(c, error, `Error procesando la accion ${action}.`); }
    });
  }

  app.route("/calls", internal);
  return app;
}
```

**Route ordering matters:** the specific `/:callId/guests`, `/:callId/messages`
and `/conversations/:conversationId/link` routes are registered **before** the
generic `/:id` and `/:id/:action` routes, so Hono matches them first. Keep that
order.

- [ ] **Step 3: Add `listMessagesGuarded` to `call-messages-service.js`**

The GET route needs a membership check before listing. Add to
`call-messages-service.js` factory + return:

```js
  async function listMessagesGuarded({ profileId, callId, sinceId = null }) {
    const call = await loadCall(callId);
    await assertMember(call.conversationId, profileId);
    return listMessages({ callId, sinceId });
  }
```

Remove the bogus `await messagesService.postMemberMessage;` line from the GET
route in `index.js` (it was a placeholder note) — the guard is now real.

- [ ] **Step 4: Syntax check**

```bash
node --check apps/api/src/routes/calls/guest-routes.js
node --check apps/api/src/routes/calls/index.js
node --check apps/api/src/routes/calls/call-messages-service.js
```
Expected: exit 0 each.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/calls/guest-routes.js apps/api/src/routes/calls/index.js apps/api/src/routes/calls/call-messages-service.js
git commit -m "$(cat <<'EOF'
feat(calls): host guest-link/moderation routes + unauthenticated /calls/guest router

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `smtpService` in `apps/api/src/index.js`

**Files:**
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Import + instantiate**

Near the other service imports in `apps/api/src/index.js`, add:

```js
import { createSmtpService } from "./services/smtp-service.js";
```

Near where other services are constructed (before the `app.route("/", createCallsRouter(...))` line ~3366), add:

```js
const smtpService = createSmtpService({ prisma });
```

(If a `smtpService` / `createSmtpService` is already constructed elsewhere in
the file, reuse that binding instead of making a second one.)

- [ ] **Step 2: Pass it to the calls router**

Change:

```js
app.route("/", createCallsRouter({ prisma, authMiddleware, notificationService, broadcaster, deliveryWorker: notificationDeliveryWorker }));
```

to:

```js
app.route("/", createCallsRouter({ prisma, authMiddleware, notificationService, broadcaster, deliveryWorker: notificationDeliveryWorker, smtpService }));
```

- [ ] **Step 3: Syntax check + commit**

```bash
node --check apps/api/src/index.js
git add apps/api/src/index.js
git commit -m "$(cat <<'EOF'
feat(calls): provide smtpService to the calls router for guest email invites

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: SDK domain methods

**Files:**
- Modify: `packages/sdk/src/domains/calls.js`

- [ ] **Step 1: Extend the domain**

Replace `packages/sdk/src/domains/calls.js` with:

```js
export function createCallsDomain(request, withAuthHeaders) {
  const action = (callId, name, token) =>
    request(`/calls/${encodeURIComponent(callId)}/${name}`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({}),
    });

  const json = (path, method, body, token) =>
    request(path, {
      method,
      headers: withAuthHeaders(token),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // Guest calls carry ONLY the guest session token (never the user's JWT).
  const guestHeaders = (guestToken) => ({
    "Content-Type": "application/json",
    ...(guestToken ? { Authorization: `Bearer ${guestToken}` } : {}),
  });
  const guestJson = (path, method, body, guestToken) =>
    request(path, {
      method,
      headers: guestHeaders(guestToken),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  return {
    getConfig: (token) => request("/calls/config", { headers: withAuthHeaders(token) }),
    getCurrent: (token) => request("/calls/current", { headers: withAuthHeaders(token) }),
    create: (data, token) => json("/calls", "POST", data, token),
    get: (callId, token) => request(`/calls/${encodeURIComponent(callId)}`, { headers: withAuthHeaders(token) }),
    join: (callId, token) => action(callId, "join", token),
    decline: (callId, token) => action(callId, "decline", token),
    leave: (callId, token) => action(callId, "leave", token),
    end: (callId, token) => action(callId, "end", token),

    // --- guest link (by conversation) ---
    getLink: (conversationId, token) =>
      request(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, { headers: withAuthHeaders(token) }),
    createLink: (conversationId, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, "POST", {}, token),
    updateLink: (conversationId, patch, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, "PATCH", patch, token),
    revokeLink: (conversationId, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, "DELETE", undefined, token),
    sendInvites: (conversationId, emails, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link/invites`, "POST", { emails }, token),

    // --- guest moderation (by call) ---
    listGuests: (callId, token) =>
      request(`/calls/${encodeURIComponent(callId)}/guests`, { headers: withAuthHeaders(token) }),
    admitGuest: (callId, guestId, token) => json(`/calls/${callId}/guests/${guestId}/admit`, "POST", {}, token),
    denyGuest: (callId, guestId, token) => json(`/calls/${callId}/guests/${guestId}/deny`, "POST", {}, token),
    kickGuest: (callId, guestId, token) => json(`/calls/${callId}/guests/${guestId}/kick`, "POST", {}, token),
    muteGuest: (callId, guestId, muted, token) => json(`/calls/${callId}/guests/${guestId}/mute`, "POST", { muted }, token),

    // --- call-room chat (members) ---
    listMessages: (callId, sinceId, token) =>
      request(`/calls/${encodeURIComponent(callId)}/messages${sinceId ? `?sinceId=${encodeURIComponent(sinceId)}` : ""}`, { headers: withAuthHeaders(token) }),
    sendMessage: (callId, body, token) => json(`/calls/${callId}/messages`, "POST", { body }, token),

    // --- guest (unauthenticated) ---
    guest: {
      join: (payload) => guestJson("/calls/guest/join", "POST", payload),
      state: (guestToken) => guestJson("/calls/guest/state", "GET", undefined, guestToken),
      token: (guestToken) => guestJson("/calls/guest/token", "POST", {}, guestToken),
      heartbeat: (guestToken) => guestJson("/calls/guest/heartbeat", "POST", {}, guestToken),
      leave: (guestToken) => guestJson("/calls/guest/leave", "POST", {}, guestToken),
      sendMessage: (guestToken, body) => guestJson("/calls/guest/messages", "POST", { body }, guestToken),
    },
  };
}
```

- [ ] **Step 2: Verify the request signature**

Open `packages/sdk/src/index.js` (or wherever `createCallsDomain` is wired) and
confirm `request(path, opts)` and `withAuthHeaders(token)` match this usage. If
`request` already injects `Content-Type`, drop it from `guestHeaders`.

- [ ] **Step 3: Syntax check + commit**

```bash
node --check packages/sdk/src/domains/calls.js
git add packages/sdk/src/domains/calls.js
git commit -m "$(cat <<'EOF'
feat(sdk): calls domain — guest links, invites, moderation, room chat, guest api

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full verification

- [ ] **Step 1: All calls service + route tests**

```bash
node --test \
  apps/api/src/routes/calls/__tests__/call-service.test.js \
  apps/api/src/routes/calls/__tests__/call-routes.test.js \
  apps/api/src/routes/calls/__tests__/call-system-messages.test.js \
  apps/api/src/routes/calls/__tests__/call-links-service.test.js \
  apps/api/src/routes/calls/__tests__/call-guest-service.test.js \
  apps/api/src/routes/calls/__tests__/call-messages-service.test.js
```
Expected: all green, 0 failures.

- [ ] **Step 2: Regression sweep**

```bash
find apps/api/src/routes/chat/__tests__ apps/api/src/services/__tests__ -name '*.test.js' -print0 | xargs -0 node --test 2>&1 | grep -E '^# (tests|pass|fail)'
```
Expected: no new failures vs. `main`.

- [ ] **Step 3: Syntax + lint**

```bash
node --check apps/api/src/routes/calls/index.js
node --check apps/api/src/index.js
pnpm lint
```
Expected: exit 0; lint clean.

- [ ] **Step 4: Prisma client generates**

```bash
pnpm db:generate
```
Expected: "Generated Prisma Client" — no validation errors.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(calls): verification fixups for guest-access API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" || echo "nothing to commit"
```

---

## Self-review

- **Spec coverage:** tables (T1), validators (T2), manage-gate reuse (T3),
  links + codes + invites + resolve (T4), lobby/join/rate-limit/concurrency/
  guest-token/moderation/sweep (T5), ephemeral chat users+guests (T6),
  unauthenticated guest router + host routes + ordering (T7), smtp wiring (T8),
  SDK incl. token-free guest calls (T9), verification (T10).
- **Placeholder scan:** the one deliberate no-op ref in T7 Step 2 is removed in
  T7 Step 3; no TBD/TODO elsewhere.
- **Type consistency:** `CallGuestError`/`CallLinkError`/`CallMessageError` all
  carry `{ status, reason? }` and are all handled in `index.js` `handleError`
  and `guest-routes` `fail`. `resolveLinkForJoin` returns the raw link row;
  `joinAsGuest` reads `link.id`, `link.conversationId`, `link.requireLobby`,
  `link.useCount`, `link.maxUses` — all present on the Prisma `CallLink`.
  `getGuestState`/`getGuestLiveKitToken` both key off `guest.status ===
  "ADMITTED"` and a live call. `messagesService` consumes
  `guestService.resolveAdmittedGuestForMessage` (added in T6 Step 4).
- **Not changed:** the user call flow (create/join/decline/leave/end), the
  in-call-chat system messages from the prior spec, `call_participant`.
- **DB:** migration written, not applied (needs the live Supabase); tests are
  all Prisma-stubbed.
