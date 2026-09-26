// apps/api/src/lib/forgot-password-rate-limit.js
//
// Minimal in-memory throttle for the public forgot-password endpoint (still
// inline in index.js) and the admin-triggered "enviar restablecimiento"
// action (identity-routes.js) — keyed by normalized email, not IP, so it
// also caps admin-triggered resets for the same target. Extracted from
// index.js on 2026-09-25: both call sites import this same module, so ES
// module caching keeps them sharing one Map (a factory would give each file
// its own, breaking the shared rate limit). Not meant to survive a restart
// or a multi-process deployment; just enough to blunt naive abuse of an
// unauthenticated endpoint.
const forgotPasswordAttempts = new Map();
const FORGOT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_PASSWORD_MAX_ATTEMPTS = 3;

export function isForgotPasswordRateLimited(key) {
  const now = Date.now();
  const attempts = (forgotPasswordAttempts.get(key) ?? []).filter(
    (t) => now - t < FORGOT_PASSWORD_WINDOW_MS,
  );
  if (attempts.length >= FORGOT_PASSWORD_MAX_ATTEMPTS) {
    forgotPasswordAttempts.set(key, attempts);
    return true;
  }
  attempts.push(now);
  forgotPasswordAttempts.set(key, attempts);
  return false;
}
