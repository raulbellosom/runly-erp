import test from "node:test";
import assert from "node:assert/strict";
import { createMiraiThreadsService, autoTitleFrom, DEFAULT_THREAD_TITLE } from "../mirai-threads-service.js";

const ID = "11111111-1111-1111-1111-111111111111";
const ctx = { companyId: "22222222-2222-2222-2222-222222222222", actorProfileId: "33333333-3333-3333-3333-333333333333" };

function fakePrisma(handler) {
  const sql = [];
  const text = (s) => s.join("?");
  return {
    sql,
    $queryRaw: async (s, ...v) => { sql.push(text(s)); return handler(text(s), v) ?? []; },
    $executeRaw: async (s) => { sql.push(text(s)); return 1; },
  };
}

test("autoTitleFrom collapses whitespace and caps at 60 chars", () => {
  assert.equal(autoTitleFrom("  que   huecos tengo  "), "que huecos tengo");
  assert.equal(autoTitleFrom("x".repeat(100)).length, 60);
  assert.equal(autoTitleFrom("   "), null);
});

test("rename validates the title and ownership", async () => {
  const prisma = fakePrisma((q) => (q.includes("created_by_user_id") ? [] : []));
  const svc = createMiraiThreadsService({ prisma, getOrCreateMiraiProfile: async () => "bot" });
  await assert.rejects(svc.rename(ID, "", ctx), (e) => e.status === 400);
  await assert.rejects(svc.rename(ID, "Viaje", ctx), (e) => e.status === 404);
});

test("remove soft-deletes an owned thread and cancels its pending proposals", async () => {
  const prisma = fakePrisma((q) => (q.includes("created_by_user_id") ? [{ id: ID }] : []));
  const svc = createMiraiThreadsService({ prisma, getOrCreateMiraiProfile: async () => "bot" });
  assert.deepEqual(await svc.remove(ID, ctx), { deleted: true });
  assert.ok(prisma.sql.some((q) => q.includes("SET deleted_at = NOW()")));
  assert.ok(prisma.sql.some((q) => q.includes("mirai_action_proposals SET status = 'cancelled'")));
});

test("autoTitle only renames a default-titled thread on its first user message", async () => {
  let row = { title: DEFAULT_THREAD_TITLE, user_messages: 1 };
  const prisma = fakePrisma((q) => (q.includes("user_messages") ? [row] : []));
  const svc = createMiraiThreadsService({ prisma, getOrCreateMiraiProfile: async () => "bot" });
  await svc.autoTitle({ conversationId: ID, text: "Gastos de octubre" });
  assert.ok(prisma.sql.some((q) => q.includes("SET title = ?")));
  prisma.sql.length = 0;
  row = { title: "Mi titulo", user_messages: 1 };
  await svc.autoTitle({ conversationId: ID, text: "Otra cosa" });
  assert.ok(!prisma.sql.some((q) => q.includes("SET title = ?")));
});

test("ensure returns the latest thread without creating one", async () => {
  const prisma = fakePrisma((q) => (q.includes("ORDER BY COALESCE") ? [{ id: ID }] : []));
  const svc = createMiraiThreadsService({ prisma, getOrCreateMiraiProfile: async () => { throw new Error("should not create"); } });
  assert.deepEqual(await svc.ensure(ctx), { conversationId: ID, created: false });
});
