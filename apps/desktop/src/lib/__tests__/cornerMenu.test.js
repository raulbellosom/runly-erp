import { test } from "node:test";
import assert from "node:assert/strict";
import { itemAngle, itemOffset, pickCornerItem, buildFavoriteSlots } from "../cornerMenu.js";

test("items spread from near-vertical to near-horizontal", () => {
  assert.equal(itemAngle(0, 3), 82);
  assert.equal(itemAngle(2, 3), 8);
  assert.equal(itemAngle(0, 1), 45);
  const up = itemOffset(0, 3, 100);
  assert.ok(up.y < -90 && up.x > 0 && up.x < 20, "first item is almost straight up");
});

test("dead zone cancels; distance picks the ring; angle picks the item", () => {
  assert.equal(pickCornerItem(20, -20, [3, 5]), null);
  // Straight up, close: inner ring, first item.
  assert.deepEqual(pickCornerItem(5, -90, [3, 5]), { ring: 0, index: 0 });
  // Straight right, far: outer ring, last item.
  assert.deepEqual(pickCornerItem(175, -5, [3, 5]), { ring: 1, index: 4 });
  // Diagonal, far: outer middle item.
  assert.deepEqual(pickCornerItem(120, -120, [3, 5]), { ring: 1, index: 2 });
});

test("an empty ring hands selection to the other ring", () => {
  assert.deepEqual(pickCornerItem(120, -120, [3, 0]), { ring: 0, index: 1 });
  assert.equal(pickCornerItem(120, -120, [0, 0]), null);
});

test("favorite slots: favorites first, then recents, deduped and capped", () => {
  const modules = ["a", "b", "c", "d"].map((key) => ({ key }));
  assert.deepEqual(
    buildFavoriteSlots(modules, ["b", "x"], ["b", "a", "c"], 3).map((m) => m.key),
    ["b", "a", "c"],
  );
});
