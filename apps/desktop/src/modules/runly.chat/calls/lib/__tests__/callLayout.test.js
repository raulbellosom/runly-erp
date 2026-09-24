import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePinnedEntry, resolveSpotlightMain, spotlightStrip, stripRowCount, advanceSpeakingFocus, orderBySpeakingFocus } from "../callLayout.js";

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
  it("keeps the screen-sharer's own camera as a strip tile when their screen is the spotlight", () => {
    const two = [p("a"), p("b")];
    const screenA = { ...p("a"), hasCamera: true };
    const out = spotlightStrip({ participants: two, pinnedIdentity: null, screenShareEntry: screenA });
    assert.equal(out.mainEntry, screenA);
    const identities = out.others.map((e) => e.participant.identity);
    assert.deepEqual(identities.sort(), ["a", "b"]);
    assert.equal(out.showScreenTile, false);
  });
  it("does not add an extra tile for the sharer when they have no live camera", () => {
    const two = [p("a"), p("b")];
    const screenA = { ...p("a"), hasCamera: false };
    const out = spotlightStrip({ participants: two, pinnedIdentity: null, screenShareEntry: screenA });
    const identities = out.others.map((e) => e.participant.identity);
    assert.deepEqual(identities, ["b"]);
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

describe("advanceSpeakingFocus", () => {
  it("starts with no focused speaker", () => {
    const state = advanceSpeakingFocus(null, { candidateId: null, now: 0, stableMs: 1500 });
    assert.equal(state.focusedId, null);
  });

  it("does not focus a new candidate before it has been stable for stableMs", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    assert.equal(state.focusedId, null);
    state = advanceSpeakingFocus(state, { candidateId: "b", now: 1000, stableMs: 1500 });
    assert.equal(state.focusedId, null);
  });

  it("focuses the candidate once it has been stable for stableMs", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "b", now: 1500, stableMs: 1500 });
    assert.equal(state.focusedId, "b");
  });

  it("resets the stability timer if the candidate changes before stableMs", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "c", now: 1000, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "c", now: 2000, stableMs: 1500 });
    assert.equal(state.focusedId, null);
    state = advanceSpeakingFocus(state, { candidateId: "c", now: 2500, stableMs: 1500 });
    assert.equal(state.focusedId, "c");
  });

  it("keeps the current focus when nobody is speaking (candidateId null) instead of clearing it immediately", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "b", now: 1500, stableMs: 1500 });
    assert.equal(state.focusedId, "b");
    state = advanceSpeakingFocus(state, { candidateId: null, now: 1600, stableMs: 1500 });
    assert.equal(state.focusedId, "b");
  });
});

describe("orderBySpeakingFocus", () => {
  it("returns the base order when there is no focused speaker", () => {
    const entries = [{ participant: { identity: "a" } }, { participant: { identity: "b" } }];
    assert.deepEqual(orderBySpeakingFocus(entries, null).map((e) => e.participant.identity), ["a", "b"]);
  });

  it("moves the focused speaker to the front, keeping the rest in order", () => {
    const entries = [
      { participant: { identity: "a" } },
      { participant: { identity: "b" } },
      { participant: { identity: "c" } },
    ];
    assert.deepEqual(orderBySpeakingFocus(entries, "c").map((e) => e.participant.identity), ["c", "a", "b"]);
  });

  it("is a no-op when the focused id is not present in entries", () => {
    const entries = [{ participant: { identity: "a" } }, { participant: { identity: "b" } }];
    assert.deepEqual(orderBySpeakingFocus(entries, "ghost").map((e) => e.participant.identity), ["a", "b"]);
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
