import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRealtimeBroadcaster } from "../realtime-broadcaster.js";

// Regression coverage for a real production incident (2026-09-11): every
// topic this broadcaster targets (user:*:events, company:*:events,
// chat:presence:*, chat:conv:*, chat:company:*) was switched to Supabase
// Realtime Authorization (private channels). Realtime treats a private and
// non-private subscriber to the SAME topic as two different delivery pools
// — a message posted to the REST broadcast endpoint without `private: true`
// silently never reaches a client that joined privately, even though that
// client's own subscription succeeds and logs no error. This is exactly
// what broke real-time chat/notifications until this fix: verified live
// against the real self-hosted Realtime server (a private-channel
// subscriber received nothing from a broadcast lacking this flag, and
// received it correctly once the flag was added).

const prisma = {
  userProfile: { findFirst: async () => ({ id: 'enabled-user' }) },
  $queryRaw: async () => [{ revision: '7' }],
  $transaction: async (fn) => fn(prisma),
};
let originalFetch;
let calls;

function installFetchMock() {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, text: async () => "" };
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("createRealtimeBroadcaster — private:true on every message", () => {
  beforeEach(installFetchMock);
  afterEach(restoreFetch);

  it("broadcastToUser marks its message private", async () => {
    const b = createRealtimeBroadcaster({ prisma, supabaseUrl: "https://x", serviceRoleKey: "key" });
    await b.broadcastToUser("user-1", "notification.new", { a: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.messages[0].private, true);
    assert.equal(calls[0].body.messages[0].topic, "user:user-1:events@7");
  });

  it("broadcastToUsers marks EVERY message private, not just the first", async () => {
    const b = createRealtimeBroadcaster({ prisma, supabaseUrl: "https://x", serviceRoleKey: "key" });
    await b.broadcastToUsers(["user-1", "user-2", "user-3"], "chat.message.new", {});
    assert.equal(calls.length, 1);
    const messages = calls[0].body.messages;
    assert.equal(messages.length, 3);
    assert.ok(messages.every((m) => m.private === true), "every fanned-out message must be private");
  });

  it("broadcastToCompany marks its message private", async () => {
    const b = createRealtimeBroadcaster({ prisma, supabaseUrl: "https://x", serviceRoleKey: "key" });
    await b.broadcastToCompany("company-1", "pos.order.updated", {});
    assert.equal(calls[0].body.messages[0].private, true);
    assert.equal(calls[0].body.messages[0].topic, "company:company-1:events@7");
  });

  it("broadcastToChannel marks its message private, for any channel name", async () => {
    const b = createRealtimeBroadcaster({ prisma, supabaseUrl: "https://x", serviceRoleKey: "key" });
    await b.broadcastToChannel("chat:conv:conv-1", "new_operator_message", {});
    assert.equal(calls[0].body.messages[0].private, true);
    assert.equal(calls[0].body.messages[0].topic, "chat:conv:conv-1@7");
  });
});
