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
export function spotlightStrip({ participants = [], pinnedIdentity = null, screenShareEntry = null }) {
  const mainEntry = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry);
  if (!mainEntry) return { mainEntry: null, others: [], showScreenTile: false };
  const mainId = mainEntry.participant?.identity;
  const others = participants.filter((e) => e.participant?.identity !== mainId);
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  return { mainEntry, others, showScreenTile: Boolean(screenShareEntry) && !mainIsSharing };
}

// Mobile strip layout: a handful of tiles fit one horizontally-scrollable
// row; past this many, two rows (still horizontally scrollable) show more of
// the call at a glance instead of forcing a long single-row scroll.
export const STRIP_TWO_ROW_THRESHOLD = 5;

export function stripRowCount(tileCount) {
  return tileCount >= STRIP_TWO_ROW_THRESHOLD ? 2 : 1;
}
