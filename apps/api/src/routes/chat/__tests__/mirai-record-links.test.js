import test from "node:test";
import assert from "node:assert/strict";
import { createShowRecordsTool } from "../mirai-record-links.js";

const ctx = () => ({ actorAuthUserId: "auth1", companyId: "co1" });

test("show_records keeps only refs the entity-reference service resolves for the caller", async () => {
  const calls = [];
  const tool = createShowRecordsTool({
    resolveEntityRefs: async (input) => {
      calls.push(input);
      // Service drops what the caller can't read (other company, no permission, missing).
      return input.entityRefs.filter((r) => r.recordId === "ok1").map((r) => ({ ...r, title: "Laptop", url: "/x" }));
    },
  });
  const c = ctx();
  const out = await tool.run({ records: [{ type: "inventory_item", id: "ok1" }, { type: "inventory_item", id: "other-company" }, { type: "bogus", id: "z" }] }, c);
  assert.deepEqual(out, { mostrados: ["Laptop"], omitidos: 1 });
  assert.equal(calls[0].companyId, "co1");
  assert.equal(calls[0].authUserId, "auth1");
  assert.equal(c.recordLinks.length, 1);
});

test("show_records dedupes, strips recurrence suffixes and caps at 5 per reply", async () => {
  const tool = createShowRecordsTool({ resolveEntityRefs: async ({ entityRefs }) => entityRefs.map((r) => ({ ...r, title: r.recordId })) });
  const c = ctx();
  await tool.run({ records: [{ type: "calendar_event", id: "ev1_20261001" }] }, c);
  assert.equal(c.recordLinks[0].recordId, "ev1");
  await tool.run({ records: [{ type: "calendar_event", id: "ev1" }, ...["a", "b", "c", "d", "e"].map((id) => ({ type: "task", id }))] }, c);
  assert.equal(c.recordLinks.length, 5);
  assert.ok((await tool.run({ records: [{ type: "task", id: "f" }] }, c)).error);
});
