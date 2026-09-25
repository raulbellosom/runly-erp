// Facebook-style "hover marks as read": a notification toast that the user
// visibly rests the pointer over (not just brushes past while moving the
// mouse elsewhere) counts as read. Sonner's toast() options don't expose a
// per-toast hover callback, so this delegates mouseover/mouseout on
// document to the rendered `[data-sonner-toast]` element, matched back to
// the caller's read handler via the `testId` passed to toast().
const HOVER_READ_DWELL_MS = 600;

const pending = new Map(); // testId -> { onRead, timer }

let listenersAttached = false;

function ensureListeners() {
  if (listenersAttached || typeof document === "undefined") return;
  listenersAttached = true;

  document.addEventListener(
    "mouseover",
    (event) => {
      const el = event.target?.closest?.("[data-sonner-toast]");
      const testId = el?.getAttribute("data-testid");
      const entry = testId && pending.get(testId);
      if (!entry || entry.timer) return;
      entry.timer = setTimeout(() => {
        pending.delete(testId);
        entry.onRead();
      }, HOVER_READ_DWELL_MS);
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (event) => {
      const el = event.target?.closest?.("[data-sonner-toast]");
      const testId = el?.getAttribute("data-testid");
      const entry = testId && pending.get(testId);
      // Ignore moves between the toast's own children (description, action
      // button, close button) — only a genuine exit past its border cancels
      // the dwell timer.
      if (entry?.timer && !el.contains(event.relatedTarget)) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    },
    true,
  );
}

// Registers `onRead` to fire once the toast rendered with `testId` (pass the
// same value as the `testId` toast() option) is hovered for a sustained
// beat. Auto-expires after `ttlMs` (matched to the toast's own duration) so
// an unhovered, auto-dismissed toast doesn't leak an entry forever.
export function trackToastHoverRead(testId, onRead, ttlMs = 6000) {
  if (!testId || typeof onRead !== "function") return;
  ensureListeners();
  pending.set(testId, { onRead, timer: null });
  setTimeout(() => pending.delete(testId), ttlMs + 1000);
}
