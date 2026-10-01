import test from "node:test";
import assert from "node:assert/strict";
import { miraiPromptsFor } from "../miraiPrompts.js";

test("miraiPromptsFor returns module prompts and a generic fallback", () => {
  assert.ok(miraiPromptsFor("runly.calendar").some((p) => p.includes("huecos")));
  assert.deepEqual(miraiPromptsFor(null), miraiPromptsFor("runly.unknown"));
  assert.ok(miraiPromptsFor(null).length >= 3);
});
