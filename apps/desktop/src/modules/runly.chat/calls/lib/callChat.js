// Pure helpers for the in-call chat panel's mobile view state. No React, no
// DOM — see CallRoom.jsx for the stateful wiring.

export const CALL_VIEWS = ["video", "chat"];

// Given the user's chosen mobile view, return the view that should actually
// render. Anything unrecognised falls back to "video". A screen share no
// longer has its own tab — "video" always shows the combined spotlight +
// camera-strip layout when one is live (see calls/lib/callLayout.js).
export function nextCallView(view) {
  return CALL_VIEWS.includes(view) ? view : "video";
}
