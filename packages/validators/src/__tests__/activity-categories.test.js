import { test } from "node:test";
import assert from "node:assert/strict";
import { activityCategory, activityCategoryWhere } from "../activity-categories.js";

test("activityCategory maps type suffixes and segments", () => {
  assert.equal(activityCategory("inventory.item.created"), "created");
  assert.equal(activityCategory("hr.employee.update"), "updated");
  assert.equal(activityCategory("inventory.item.assigned"), "assignment");
  assert.equal(activityCategory("inventory.item.returned"), "assignment");
  assert.equal(activityCategory("fleet.vehicle.disable"), "status");
  assert.equal(activityCategory("inventory.item.propose_deregistration"), "status");
  assert.equal(activityCategory("inventory.item.confirm_registration"), "status");
  assert.equal(activityCategory("inventory.item.comment.add"), "comment");
  assert.equal(activityCategory("fleet.vehicle.document.add"), "file");
  assert.equal(activityCategory("system.event"), "other");
});

test("activityCategoryWhere builds an OR on type, null for unknown", () => {
  assert.equal(activityCategoryWhere("nope"), null);
  const where = activityCategoryWhere("comment");
  assert.deepEqual(where.OR[0], { type: { contains: ".comment.", mode: "insensitive" } });
});
