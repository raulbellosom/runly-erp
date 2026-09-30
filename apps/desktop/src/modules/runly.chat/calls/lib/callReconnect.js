// Backoff before rejoin attempt N after a dropped call: the first try is
// immediate, then 2s, 4s, 8s... capped at 30s.
export function rejoinDelayMs(attempt) {
  return attempt <= 0 ? 0 : Math.min(2_000 * 2 ** (attempt - 1), 30_000);
}
