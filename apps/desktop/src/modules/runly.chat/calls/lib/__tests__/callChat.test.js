import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextCallView, CALL_VIEWS } from "../callChat.js";

describe("nextCallView", () => {
  it("keeps a valid view", () => {
    assert.equal(nextCallView("video"), "video");
    assert.equal(nextCallView("chat"), "chat");
  });
  it("falls back to video for unknown or missing views", () => {
    assert.equal(nextCallView("bogus"), "video");
    assert.equal(nextCallView("screen"), "video");
    assert.equal(nextCallView(undefined), "video");
  });
});

describe("CALL_VIEWS", () => {
  it("is the canonical ordered list", () => {
    assert.deepEqual(CALL_VIEWS, ["video", "chat"]);
  });
});
