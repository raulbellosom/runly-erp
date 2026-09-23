const STORAGE_KEY = "runly:notifications-prompt-dismissed-at";
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Tauri's isPermissionGranted() collapses "denied" and "not-yet-asked" into the
// same falsy state, so we can't rely on OS permission state alone to stop
// re-prompting after a decline. This tracks the last decline locally instead.
export function createNotificationPromptCooldown({
  storage = safeLocalStorage(),
  now = Date.now,
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  function getDismissedAt() {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return {
    isOnCooldown() {
      const dismissedAt = getDismissedAt();
      return dismissedAt !== null && now() - dismissedAt < cooldownMs;
    },
    markDismissed() {
      storage?.setItem(STORAGE_KEY, String(now()));
    },
  };
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
