// apps/desktop/src/modules/runly.chat/lib/__tests__/mirai.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  isMiraiConversation,
  MIRAI_NAME,
  MIRAI_SUBTITLE,
  MIRAI_EXAMPLE_PROMPTS,
  isAssistantMessage,
  mapTypingNames,
} from "../mirai.js";

test("isMiraiConversation matches on type", () => {
  assert.equal(isMiraiConversation({ type: "mirai" }), true);
  assert.equal(isMiraiConversation({ type: "direct" }), false);
  assert.equal(isMiraiConversation(null), false);
  assert.equal(isMiraiConversation(undefined), false);
});

test("isAssistantMessage matches sender_type", () => {
  assert.equal(isAssistantMessage({ sender_type: "assistant" }), true);
  assert.equal(isAssistantMessage({ sender_type: "user" }), false);
  assert.equal(isAssistantMessage({}), false);
});

test("mapTypingNames swaps the mirai sentinel for the display name, leaves others", () => {
  assert.deepEqual(mapTypingNames(["mirai"]), [MIRAI_NAME]);
  assert.deepEqual(mapTypingNames(["abc", "mirai"]), ["abc", MIRAI_NAME]);
  assert.deepEqual(mapTypingNames([]), []);
  assert.deepEqual(mapTypingNames(undefined), []);
});

test("constants are the expected shape", () => {
  assert.equal(MIRAI_NAME, "MirAI");
  assert.match(MIRAI_SUBTITLE, /solo t[uú] ves/i);
  assert.equal(MIRAI_EXAMPLE_PROMPTS.length, 3);
  for (const p of MIRAI_EXAMPLE_PROMPTS) assert.equal(typeof p, "string");
});
