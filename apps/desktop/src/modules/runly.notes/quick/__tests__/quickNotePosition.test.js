import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampToViewport,
  defaultPosition,
  passedDragThreshold,
  isQuickNoteShortcut,
  snapToEdge,
} from "../quickNotePosition.js";
import { isInBubbleDropZone } from "../../../../lib/bubbleDropZone.js";

const viewport = { width: 1000, height: 800 };
const size = { width: 360, height: 420 };

test("snapToEdge sticks the bubble to the nearer side edge", () => {
  const bubble = { width: 48, height: 48 };
  assert.deepEqual(snapToEdge({ x: 300, y: 200 }, bubble, viewport, 20), { x: 20, y: 200 });
  assert.deepEqual(snapToEdge({ x: 700, y: 200 }, bubble, viewport, 20), { x: 932, y: 200 });
});

test("isInBubbleDropZone hits only near the bottom-center", () => {
  assert.equal(isInBubbleDropZone({ x: 500, y: 750 }, viewport), true);
  assert.equal(isInBubbleDropZone({ x: 500, y: 600 }, viewport), false);
});

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
