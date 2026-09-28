import test from "node:test";
import assert from "node:assert/strict";
import { detachBuilderProjectAfterUpload } from "../module-builder-detach.js";

function fakePrisma(count) {
  const calls = [];
  return { calls, moduleBuilderProject: { updateMany: async (args) => { calls.push(args); return { count }; } } };
}

test("a changed upload detaches the module's builder project", async () => {
  const prisma = fakePrisma(1);
  assert.equal(await detachBuilderProjectAfterUpload(prisma, { moduleKey: "custom.visitas", outcome: "PUBLISHED", actorId: "u1" }), true);
  assert.deepEqual(prisma.calls[0].where, { moduleKey: "custom.visitas", detachedAt: null });
  assert.equal(prisma.calls[0].data.updatedById, "u1");
});

test("an unchanged upload or a module without builder project keeps things as they are", async () => {
  const prisma = fakePrisma(0);
  assert.equal(await detachBuilderProjectAfterUpload(prisma, { moduleKey: "custom.visitas", outcome: "NO_CHANGES" }), false);
  assert.equal(prisma.calls.length, 0);
  assert.equal(await detachBuilderProjectAfterUpload(prisma, { moduleKey: "custom.otro", outcome: "PUBLISHED" }), false);
});
