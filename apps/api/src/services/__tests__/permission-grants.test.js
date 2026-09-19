import test from "node:test";
import assert from "node:assert/strict";
import {
  filterGrantableKeys,
  findEscalatingKeys,
  diffGrantKeys,
  mergeEffectiveKeys,
} from "../../lib/permission-grants.js";

test("filterGrantableKeys keeps only active, non-role, de-duplicated keys", () => {
  const out = filterGrantableKeys({
    requestedKeys: ["chat.mirai.use", "chat.mirai.use", "x.inactive", "hr.employee.read"],
    activeKeys: ["chat.mirai.use", "hr.employee.read"], // x.inactive not active
    roleKeys: ["hr.employee.read"], // already from role -> dropped
  });
  assert.deepEqual(out, ["chat.mirai.use"]);
});

test("filterGrantableKeys ignores non-string / empty entries", () => {
  const out = filterGrantableKeys({
    requestedKeys: ["a.b.c", "", null, undefined, 3],
    activeKeys: ["a.b.c"],
    roleKeys: [],
  });
  assert.deepEqual(out, ["a.b.c"]);
});

test("findEscalatingKeys returns [] for an admin actor regardless of held keys", () => {
  const out = findEscalatingKeys({
    targetKeys: ["a", "b"],
    actorHeldKeys: [],
    actorIsAdmin: true,
  });
  assert.deepEqual(out, []);
});

test("findEscalatingKeys flags keys the non-admin actor does not hold", () => {
  const out = findEscalatingKeys({
    targetKeys: ["chat.mirai.use", "identity.roles.update"],
    actorHeldKeys: new Set(["chat.mirai.use"]),
    actorIsAdmin: false,
  });
  assert.deepEqual(out, ["identity.roles.update"]);
});

test("findEscalatingKeys is empty when the non-admin holds everything requested", () => {
  const out = findEscalatingKeys({
    targetKeys: ["a", "b"],
    actorHeldKeys: new Set(["a", "b", "c"]),
    actorIsAdmin: false,
  });
  assert.deepEqual(out, []);
});

test("diffGrantKeys computes added / removed against the persisted set", () => {
  const { added, removed } = diffGrantKeys({
    existingKeys: ["a", "b"],
    nextKeys: new Set(["b", "c"]),
  });
  assert.deepEqual(added, ["c"]);
  assert.deepEqual(removed, ["a"]);
});

test("diffGrantKeys with identical sets yields no changes", () => {
  const { added, removed } = diffGrantKeys({
    existingKeys: ["a", "b"],
    nextKeys: ["b", "a"],
  });
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
});

test("mergeEffectiveKeys is the union of base, role and grant keys (never subtracts)", () => {
  const eff = mergeEffectiveKeys({
    baseKeys: ["profile.self.read"],
    roleKeys: ["chat.access", "chat.conversations.read"],
    grantKeys: ["chat.mirai.use"],
  });
  assert.equal(eff.has("profile.self.read"), true);
  assert.equal(eff.has("chat.access"), true);
  assert.equal(eff.has("chat.mirai.use"), true);
  assert.equal(eff.size, 4);
});

test("mergeEffectiveKeys: an empty grant set leaves role permissions untouched", () => {
  const eff = mergeEffectiveKeys({
    baseKeys: [],
    roleKeys: ["a", "b"],
    grantKeys: [],
  });
  assert.deepEqual([...eff].sort(), ["a", "b"]);
});
