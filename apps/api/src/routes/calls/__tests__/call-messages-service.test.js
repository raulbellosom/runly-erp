import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallMessagesService, CallMessageError } from "../call-messages-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

function sql(s) {
  return String(Array.isArray(s) ? s.join("?") : s);
}

describe("createCallMessagesService.postGuestMessage", () => {
  it("rejects an empty body", async () => {
    const svc = createCallMessagesService({ prisma: {} });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "   " }),
      (e) => e instanceof CallMessageError && e.status === 422);
  });

  it("rejects a >4000 char body", async () => {
    const svc = createCallMessagesService({ prisma: {} });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "x".repeat(4001) }),
      (e) => e instanceof CallMessageError);
  });

  it("refuses a guest that is not ADMITTED", async () => {
    const guestService = { resolveAdmittedGuestForMessage: async () => { throw new CallMessageError("no", 403); } };
    const svc = createCallMessagesService({ prisma: {}, guestService });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "hi" }), (e) => e.status === 403);
  });

  it("inserts into chat_messages with sender_call_guest_id, bumps the conversation, and broadcasts to real members", async () => {
    let insertedText = null;
    let insertedValues = null;
    let updatedConversation = null;
    let broadcastArgs = null;
    const createdAt = new Date("2026-09-23T10:00:00.000Z");
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) {
          insertedText = text;
          insertedValues = values;
          return [{ id: "m1", created_at: createdAt }];
        }
        if (text.includes("SELECT user_id FROM chat_conversation_members")) {
          return [{ user_id: "member-1" }, { user_id: "member-2" }];
        }
        return [];
      },
      $executeRaw: async (strings, ...values) => {
        if (sql(strings).includes("UPDATE chat_conversations")) updatedConversation = values;
        return 1;
      },
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const broadcaster = {
      broadcastToUsers: async (userIds, event, payload) => { broadcastArgs = { userIds, event, payload }; },
    };
    const svc = createCallMessagesService({ prisma, guestService, broadcaster });

    const out = await svc.postGuestMessage({ guestToken: "gt", body: "  hola  " });

    // 'guest' is a literal in the SQL text (not a ${} placeholder, same style
    // as call-service.js's postSystemMessage), so it shows up in the joined
    // template text, not in the interpolated values array.
    assert.ok(insertedText.includes("'guest'"));
    assert.deepEqual(insertedValues, [CONV, "g1", "hola"]);
    assert.equal(updatedConversation[0], "m1");
    assert.deepEqual(broadcastArgs.userIds, ["member-1", "member-2"]);
    assert.equal(broadcastArgs.event, "chat.message.new");
    assert.equal(broadcastArgs.payload.conversationId, CONV);
    assert.equal(broadcastArgs.payload.senderName, "Vis");
    assert.equal(out.message.id, "m1");
    assert.equal(out.message.senderKind, "guest");
    assert.equal(out.message.senderName, "Vis");
    assert.equal(out.message.body, "hola");
  });

  it("does not throw if there is no broadcaster configured", async () => {
    const prisma = {
      $queryRaw: async (strings) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) return [{ id: "m2", created_at: new Date() }];
        return [];
      },
      $executeRaw: async () => 1,
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const svc = createCallMessagesService({ prisma, guestService });
    const out = await svc.postGuestMessage({ guestToken: "gt", body: "hola" });
    assert.equal(out.message.id, "m2");
  });

  it("allows an empty body when metadata.attachmentId is present (attachment-only message)", async () => {
    const prisma = {
      $queryRaw: async (strings) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) return [{ id: "m3", created_at: new Date() }];
        if (text.includes("SELECT id, file_name")) return [{ id: "att-1", fileName: "foto.png", mimeType: "image/png", sizeBytes: 1234 }];
        return [];
      },
      $executeRaw: async (strings) => (sql(strings).includes("SET message_id") ? 1 : 1),
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const svc = createCallMessagesService({ prisma, guestService });
    const out = await svc.postGuestMessage({ guestToken: "gt", body: "", metadata: { attachmentId: "att-1" } });
    assert.equal(out.message.body, "");
    assert.deepEqual(out.message.attachments, [{ id: "att-1", fileName: "foto.png", mimeType: "image/png", sizeBytes: 1234 }]);
  });

  it("links a pending attachment to the new message and bumps attachment_count", async () => {
    let linkArgs = null;
    let bumpCalled = false;
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) return [{ id: "m4", created_at: new Date() }];
        if (text.includes("SELECT id, file_name")) return [{ id: "att-1", fileName: "doc.pdf", mimeType: "application/pdf", sizeBytes: 555 }];
        return [];
      },
      $executeRaw: async (strings, ...values) => {
        const text = sql(strings);
        if (text.includes("UPDATE chat_attachments") && text.includes("SET message_id")) { linkArgs = values; return 1; }
        if (text.includes("attachment_count = attachment_count")) { bumpCalled = true; return 1; }
        return 1;
      },
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const svc = createCallMessagesService({ prisma, guestService });
    const out = await svc.postGuestMessage({ guestToken: "gt", body: "un doc", metadata: { attachmentId: "att-1" } });
    assert.ok(linkArgs.includes("att-1"), "update should be scoped to the attachmentId");
    assert.ok(linkArgs.includes(CONV), "update should be scoped to the conversation");
    assert.ok(bumpCalled, "expected attachment_count to be bumped");
    assert.equal(out.message.attachments.length, 1);
  });

  it("does not bump attachment_count when the attachmentId is stale or foreign (scoped update no-ops)", async () => {
    let bumpCalled = false;
    const prisma = {
      $queryRaw: async (strings) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) return [{ id: "m5", created_at: new Date() }];
        return [];
      },
      $executeRaw: async (strings) => {
        const text = sql(strings);
        if (text.includes("UPDATE chat_attachments") && text.includes("SET message_id")) return 0;
        if (text.includes("attachment_count = attachment_count")) { bumpCalled = true; return 1; }
        return 1;
      },
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const svc = createCallMessagesService({ prisma, guestService });
    const out = await svc.postGuestMessage({ guestToken: "gt", body: "hola", metadata: { attachmentId: "stale-id" } });
    assert.equal(bumpCalled, false);
    assert.deepEqual(out.message.attachments, []);
  });
});
