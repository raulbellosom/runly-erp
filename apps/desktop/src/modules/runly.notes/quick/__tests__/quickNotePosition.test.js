import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampToViewport,
  defaultPosition,
  passedDragThreshold,
  isQuickNoteShortcut,
} from "../quickNotePosition.js";

const viewport = { width: 1000, height: 800 };
const size = { width: 360, height: 420 };

test("clampToViewport keeps the box inside the viewport", () => {
  assert.deepEqual(clampToViewport({ x: -50, y: 900 }, size, viewport), { x: 12, y: 368 });
  assert.deepEqual(clampToViewport({ x: 300, y: 200 }, size, viewport), { x: 300, y: 200 });
  // Viewport smaller than the box: pin to the margin instead of going negative.
  assert.deepEqual(clampToViewport({ x: 50, y: 50 }, size, { width: 300, height: 300 }), { x: 12, y: 12 });
});

test("defaultPosition sits bottom-right, inside the viewport", () => {
  assert.deepEqual(defaultPosition(size, viewport), { x: 544, y: 356 });
});

test("drag threshold is larger for touch", () => {
  const start = { x: 0, y: 0 };
  assert.equal(passedDragThreshold(start, { x: 6, y: 0 }, "mouse"), true);
  assert.equal(passedDragThreshold(start, { x: 6, y: 0 }, "touch"), false);
});

test("shortcut is Ctrl/Cmd+Alt+N without Shift", () => {
  assert.equal(isQuickNoteShortcut({ ctrlKey: true, altKey: true, code: "KeyN" }), true);
  assert.equal(isQuickNoteShortcut({ metaKey: true, altKey: true, code: "KeyN" }), true);
  assert.equal(isQuickNoteShortcut({ ctrlKey: true, altKey: true, shiftKey: true, code: "KeyN" }), false);
  assert.equal(isQuickNoteShortcut({ ctrlKey: true, code: "KeyN" }), false);
});
