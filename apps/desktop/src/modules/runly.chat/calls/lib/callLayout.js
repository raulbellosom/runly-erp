// apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js
//
// Pure helpers for the call-room "pin to spotlight" layout. A pin is local to
// the viewer (not synced).
export function resolvePinnedEntry(participants, pinnedIdentity) {
  if (!pinnedIdentity) return null;
  return (participants ?? []).find((e) => e.participant?.identity === pinnedIdentity) ?? null;
}

// Who fills the spotlight main tile: a still-valid manual pin wins; failing
// that, an active screen-share takes over automatically (Teams/WhatsApp-style
// "the presentation is the spotlight until someone chooses otherwise"); with
// neither, there's no spotlight (caller falls back to the classic grid or the
// 1:1 focus layout).
export function resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry = null) {
  return resolvePinnedEntry(participants, pinnedIdentity) ?? screenShareEntry ?? null;
}

// Given the participant entries and the local pin, return the spotlight layout:
// the main tile, the strip (everyone else), and whether the screen share needs
// its own strip tile (present and not already the main).
//
// Camera and screen share are independent LiveKit tracks for the same
// participant — when that participant's screen is the spotlight (automatic,
// no manual pin), their own camera (if live) still gets a strip tile instead
// of disappearing. `screenShareEntry.hasCamera` tells us whether to add it —
// callers compute this from the sharer's own Track.Source.Camera publication.
// See docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.3.
export function spotlightStrip({ participants = [], pinnedIdentity = null, screenShareEntry = null }) {
  const mainEntry = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry);
  if (!mainEntry) return { mainEntry: null, others: [], showScreenTile: false };
  const mainId = mainEntry.participant?.identity;
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  const others = participants.filter((e) => {
    if (e.participant?.identity !== mainId) return true;
    return mainIsSharing && Boolean(screenShareEntry?.hasCamera);
  });
  return { mainEntry, others, showScreenTile: Boolean(screenShareEntry) && !mainIsSharing };
}

// Mobile strip layout: a handful of tiles fit one horizontally-scrollable
// row; past this many, two rows (still horizontally scrollable) show more of
// the call at a glance instead of forcing a long single-row scroll.
export const STRIP_TWO_ROW_THRESHOLD = 5;

export function stripRowCount(tileCount) {
  return tileCount >= STRIP_TWO_ROW_THRESHOLD ? 2 : 1;
}
