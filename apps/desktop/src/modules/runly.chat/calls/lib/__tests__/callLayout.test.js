import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePinnedEntry, resolveSpotlightMain, spotlightStrip, stripRowCount } from "../callLayout.js";

const p = (id, isLocal = false) => ({ participant: { identity: id, sid: id }, isLocal });
const parts = [p("me", true), p("a"), p("b")];

describe("resolvePinnedEntry", () => {
  it("returns the matching entry", () => {
    assert.equal(resolvePinnedEntry(parts, "a").participant.identity, "a");
  });
  it("null for an unknown or empty pin", () => {
    assert.equal(resolvePinnedEntry(parts, "ghost"), null);
    assert.equal(resolvePinnedEntry(parts, null), null);
  });
});

describe("spotlightStrip", () => {
  it("excludes the pinned entry from the strip", () => {
    const out = spotlightStrip({ participants: parts, pinnedIdentity: "a", screenShareEntry: null });
    assert.equal(out.mainEntry.participant.identity, "a");
    assert.deepEqual(out.others.map((e) => e.participant.identity), ["me", "b"]);
    assert.equal(out.showScreenTile, false);
  });
  it("shows a screen tile only when a screen exists and isn't the pinned one", () => {
    const screenB = p("b");
    assert.equal(spotlightStrip({ participants: parts, pinnedIdentity: "a", screenShareEntry: screenB }).showScreenTile, true);
    assert.equal(spotlightStrip({ participants: parts, pinnedIdentity: "b", screenShareEntry: screenB }).showScreenTile, false);
  });
  it("null main when the pin does not resolve and there is no screen share", () => {
    const out = spotlightStrip({ participants: parts, pinnedIdentity: "ghost", screenShareEntry: null });
    assert.equal(out.mainEntry, null);
    assert.deepEqual(out.others, []);
  });
  it("falls back to the screen share as main when there is no valid pin", () => {
    const screenB = p("b");
    const out = spotlightStrip({ participants: parts, pinnedIdentity: null, screenShareEntry: screenB });
    assert.equal(out.mainEntry, screenB);
    assert.deepEqual(out.others.map((e) => e.participant.identity), ["me", "a"]);
    assert.equal(out.showScreenTile, false);
  });
});

describe("resolveSpotlightMain", () => {
  it("a valid pin wins over an active screen share", () => {
    const screenB = p("b");
    const out = resolveSpotlightMain(parts, "a", screenB);
    assert.equal(out.participant.identity, "a");
  });
  it("falls back to the screen share when there is no valid pin", () => {
    const screenB = p("b");
    assert.equal(resolveSpotlightMain(parts, null, screenB), screenB);
    assert.equal(resolveSpotlightMain(parts, "ghost", screenB), screenB);
  });
  it("null when neither a valid pin nor a screen share exist", () => {
    assert.equal(resolveSpotlightMain(parts, null, null), null);
    assert.equal(resolveSpotlightMain(parts, "ghost", null), null);
  });
});

describe("stripRowCount", () => {
  it("one row up to the threshold", () => {
    assert.equal(stripRowCount(0), 1);
    assert.equal(stripRowCount(4), 1);
  });
  it("two rows at and past the threshold", () => {
    assert.equal(stripRowCount(5), 2);
    assert.equal(stripRowCount(9), 2);
  });
});
