import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestChatDomain } from "../guestChat.js";

test("listMessages returns { messages, operatorLastReadAt } and normalizes to snake_case", async () => {
  const request = async () => ({
    data: [{ id: "m1", body: "hi", senderType: "guest", messageType: "text", createdAt: "t" }],
    operatorLastReadAt: "2026-09-08T00:00:00Z",
  });
  const d = createGuestChatDomain(request, "http://x", "anon");
  const res = await d.listMessages("tok");
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].sender_type, "guest");
  assert.equal(res.messages[0].message_type, "text");
  assert.equal(res.messages[0].created_at, "t");
  assert.equal(res.operatorLastReadAt, "2026-09-08T00:00:00Z");
});

test("listMessages tolerates a bare array payload", async () => {
  const request = async () => ({ data: [{ id: "m1", sender_type: "user", created_at: "t" }] });
  const d = createGuestChatDomain(request, "http://x", "anon");
  const res = await d.listMessages("tok");
  assert.equal(res.messages.length, 1);
  assert.equal(res.operatorLastReadAt, null);
});

test("sendTyping and markRead hit the right paths", async () => {
  const calls = [];
  const request = async (method, path) => { calls.push([method, path]); return {}; };
  const d = createGuestChatDomain(request, "http://x", "anon");
  await d.sendTyping("tok");
  await d.markRead("tok");
  assert.deepEqual(calls, [
    ["POST", "/public/chat/session/tok/typing"],
    ["POST", "/public/chat/session/tok/read"],
  ]);
});

test("getAttachmentUrl unwraps res.data.url", async () => {
  const request = async (method, path) => {
    assert.equal(path, "/public/chat/session/tok/attachments/att-1/url");
    return { data: { url: "https://signed" } };
  };
  const d = createGuestChatDomain(request, "http://x", "anon");
  assert.equal(await d.getAttachmentUrl("tok", "att-1"), "https://signed");
});

test("subscribeToReplies still accepts a bare onMessage function (back-compat)", () => {
  const d = createGuestChatDomain(async () => ({}), "", "");
  const unsub = d.subscribeToReplies("conv-1", () => {}, () => {});
  assert.equal(typeof unsub, "function");
  unsub();
});

test("subscribeToReplies accepts an options object", () => {
  const d = createGuestChatDomain(async () => ({}), "", "");
  const unsub = d.subscribeToReplies("conv-1", { onMessage: () => {}, onTyping: () => {}, onRead: () => {}, onClose: () => {} });
  assert.equal(typeof unsub, "function");
  unsub();
});

test("createSession forwards realtimeToken from the response without throwing (no realtime client constructed yet)", async () => {
  const request = async () => ({ data: { token: "sess-tok", conversationId: "conv-1", realtimeToken: "rt-token-1" } });
  const d = createGuestChatDomain(request, "http://x", "anon");
  const res = await d.createSession({ email: "a@b.com" });
  assert.equal(res.realtimeToken, "rt-token-1");
});

test("getSession and sendMessage both forward realtimeToken from the response without throwing", async () => {
  const request = async (method, path) => {
    if (path.endsWith("/messages")) return { data: { messageId: "m1", realtimeToken: "rt-2" } };
    return { data: { sessionId: "s1", realtimeToken: "rt-1" } };
  };
  const d = createGuestChatDomain(request, "http://x", "anon");
  const sessionRes = await d.getSession("tok");
  assert.equal(sessionRes.realtimeToken, "rt-1");
  const msgRes = await d.sendMessage("tok", "hola");
  assert.equal(msgRes.realtimeToken, "rt-2");
});

test("sendFileMessage returns the attachment's own fields alongside the message result", async () => {
  const request = async (method, path, body) => {
    if (path.endsWith("/attachments/presign")) {
      return { data: { attachmentId: "att-1", uploadUrl: "https://upload" } };
    }
    assert.equal(path, "/public/chat/session/tok/messages");
    assert.deepEqual(body.metadata, { attachmentId: "att-1", fileName: "foto.png", mimeType: "image/png", sizeBytes: 3 });
    return { data: { messageId: "m1", createdAt: "t1" } };
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true });
  try {
    const d = createGuestChatDomain(request, "http://x", "anon");
    const res = await d.sendFileMessage("tok", {
      fileName: "foto.png", mimeType: "image/png", sizeBytes: 3, file: new Blob(["abc"]),
    });
    // The caller (useGuestChat's sendFile) needs these to render the guest's
    // own upload immediately — the send endpoint itself never returns them.
    assert.deepEqual(res, {
      messageId: "m1", createdAt: "t1",
      attachmentId: "att-1", fileName: "foto.png", mimeType: "image/png", sizeBytes: 3,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("resumeByCode forwards realtimeToken from the response", async () => {
  const request = async () => ({ data: { token: "resume-tok", conversationId: "conv-1", realtimeToken: "rt-3" } });
  const d = createGuestChatDomain(request, "http://x", "anon");
  const res = await d.resumeByCode("CHAT-000001", "a@b.com");
  assert.equal(res.realtimeToken, "rt-3");
});
