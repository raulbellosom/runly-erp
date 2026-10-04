import { test } from "node:test";
import assert from "node:assert/strict";
import { availableWidgets, visibleWidgets, toggleHidden } from "../homeWidgets.js";

const catalog = [
  { id: "agenda", moduleKey: "runly.calendar" },
  { id: "pfm", moduleKey: "runly.pfm" },
  { id: "online", moduleKey: "runly.chat" },
];

test("only widgets of available modules are offered, in catalog order", () => {
  assert.deepEqual(
    availableWidgets(catalog, ["runly.chat", "runly.calendar"]).map((w) => w.id),
    ["agenda", "online"],
  );
});

test("hidden widgets are filtered out; unknown hidden ids are ignored", () => {
  const keys = ["runly.calendar", "runly.pfm", "runly.chat"];
  assert.deepEqual(visibleWidgets(catalog, keys, ["pfm", "gone"]).map((w) => w.id), ["agenda", "online"]);
  assert.equal(visibleWidgets(catalog, keys).length, 3);
});

test("toggleHidden adds and removes ids", () => {
  assert.deepEqual(toggleHidden(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleHidden(["a", "b"], "a"), ["b"]);
});
