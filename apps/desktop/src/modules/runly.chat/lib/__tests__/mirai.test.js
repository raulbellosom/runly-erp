// apps/desktop/src/modules/runly.chat/lib/__tests__/meridian.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  isMeridianConversation,
  MERIDIAN_NAME,
  MERIDIAN_SUBTITLE,
  MERIDIAN_EXAMPLE_PROMPTS,
  isAssistantMessage,
  mapTypingNames,
} from "../meridian.js";

test("isMeridianConversation matches on type", () => {
  assert.equal(isMeridianConversation({ type: "meridian" }), true);
  assert.equal(isMeridianConversation({ type: "direct" }), false);
  assert.equal(isMeridianConversation(null), false);
  assert.equal(isMeridianConversation(undefined), false);
});

test("isAssistantMessage matches sender_type", () => {
  assert.equal(isAssistantMessage({ sender_type: "assistant" }), true);
  assert.equal(isAssistantMessage({ sender_type: "user" }), false);
  assert.equal(isAssistantMessage({}), false);
});

test("mapTypingNames swaps the meridian sentinel for the display name, leaves others", () => {
  assert.deepEqual(mapTypingNames(["meridian"]), [MERIDIAN_NAME]);
  assert.deepEqual(mapTypingNames(["abc", "meridian"]), ["abc", MERIDIAN_NAME]);
  assert.deepEqual(mapTypingNames([]), []);
  assert.deepEqual(mapTypingNames(undefined), []);
});

test("constants are the expected shape", () => {
  assert.equal(MERIDIAN_NAME, "MeridIAn");
  assert.match(MERIDIAN_SUBTITLE, /solo t[uú] ves/i);
  assert.equal(MERIDIAN_EXAMPLE_PROMPTS.length, 3);
  for (const p of MERIDIAN_EXAMPLE_PROMPTS) assert.equal(typeof p, "string");
});
