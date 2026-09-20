// Generates and persists everything infra/installer/supabase/docker-compose.supabase.yml
// needs for a production-grade, self-hosted Supabase instance: secrets, the
// anon/service_role API keys, host ports, and a security-posture report that
// gates the installer's "ready for production" banner. Mirrors the shape of
// lib/livekit-config.mjs / lib/office-config.mjs: pure functions over plain
// values, no filesystem access here (setup-local.mjs owns persistence via
// lib/env-compat.mjs's mergeRunlyEnvText, so secrets generated here survive
// re-runs the same way every other installer-managed secret does).
import crypto from "node:crypto";
import net from "node:net";

// Ten years: these are long-lived API keys (SUPABASE_ANON_KEY/SERVICE_ROLE_KEY),
// not user session tokens — matches the lifetime of Supabase's own self-hosting
// example keys.
const API_KEY_LIFETIME_SECS = 10 * 365 * 24 * 60 * 60;

function clean(value) {
  return String(value ?? "").trim();
}

// Signs a Supabase-compatible HS256 JWT. Same technique as
// apps/api/src/services/jwt-verification.js:signHs256Jwt, hand-rolled here
// too (rather than imported) because this installer is meant to run
// standalone, without the rest of the monorepo present — see
// infra/installer/bootstrap-local.sh.
export function signHs256Jwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { iat: now, exp: now + API_KEY_LIFETIME_SECS, ...payload };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  return `${headerB64}.${payloadB64}.${signature}`;
}

// Verifies a token produced by signHs256Jwt — used by the unit tests and by
// assessSupabaseSecurityPosture to confirm a persisted key still matches its
// persisted secret (catches a hand-edited .env.local going out of sync).
export function verifyHs256Jwt(token, secret) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    const expectedBuf = Buffer.from(expectedSig);
    const receivedBuf = Buffer.from(signatureB64);
    if (expectedBuf.length !== receivedBuf.length) return null;
    if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) return null;
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function randomToken(byteLength, encoding = "base64url", randomBytes = crypto.randomBytes) {
  return randomBytes(byteLength).toString(encoding);
}

// Every secret docker-compose.supabase.yml consumes. `existing` should be
// the already-parsed key/value map of the persisted .env.local (whatever
// survived previous runs) — mergeRunlyEnvText handles the actual file-level
// preservation; this function only decides what to generate when a value is
// still missing, so re-runs never rotate a secret that's already in use by
// running containers/data.
export function resolveSupabaseSecrets(existing = {}, { randomBytes = crypto.randomBytes } = {}) {
  const jwtSecret = clean(existing.SUPABASE_JWT_SECRET) || randomToken(48, "base64url", randomBytes);
  const postgresPassword = clean(existing.SUPABASE_POSTGRES_PASSWORD) || randomToken(32, "base64url", randomBytes);
  const secretKeyBase = clean(existing.RUNLY_SUPABASE_SECRET_KEY_BASE) || randomToken(48, "hex", randomBytes);
  // Realtime requires DB_ENC_KEY to be exactly 16 characters.
  const realtimeDbEncKey = clean(existing.RUNLY_SUPABASE_REALTIME_DB_ENC_KEY) || randomToken(8, "hex", randomBytes);
  const metaCryptoKey = clean(existing.RUNLY_SUPABASE_META_CRYPTO_KEY) || randomToken(24, "base64", randomBytes);

  const anonKey = clean(existing.SUPABASE_ANON_KEY)
    || signHs256Jwt({ role: "anon", iss: "supabase-runly" }, jwtSecret);
  const serviceRoleKey = clean(existing.SUPABASE_SERVICE_ROLE_KEY)
    || signHs256Jwt({ role: "service_role", iss: "supabase-runly" }, jwtSecret);

  return {
    SUPABASE_JWT_SECRET: jwtSecret,
    SUPABASE_POSTGRES_PASSWORD: postgresPassword,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    RUNLY_SUPABASE_SECRET_KEY_BASE: secretKeyBase,
    RUNLY_SUPABASE_REALTIME_DB_ENC_KEY: realtimeDbEncKey,
    RUNLY_SUPABASE_META_CRYPTO_KEY: metaCryptoKey,
  };
}

// Binds a throwaway TCP server on `host` to check whether `port` is free.
// Used only to pick a starting port ONCE for a brand-new instance — never on
// a re-run against an already-running instance (its own containers already
// hold that port, which would make a fresh scan wrongly report it as busy).
function isPortFree(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

export async function findFreePort(preferredPort, { host = "127.0.0.1", maxAttempts = 50, isPortFreeImpl = isPortFree } = {}) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) break;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFreeImpl(candidate, host)) return candidate;
  }
  throw new Error(`Could not find a free port starting at ${preferredPort} on ${host} after ${maxAttempts} attempts.`);
}

// Ports are allocated ONCE per fresh instance and persisted from then on
// (mirrors resolveSupabaseSecrets' preserve-if-present behavior) — restarting
// this same instance must never renumber its own already-published ports.
export async function resolveSupabasePorts(existing = {}, { findFreePortImpl = findFreePort } = {}) {
  const kongPort = Number(existing.RUNLY_SUPABASE_KONG_HOST_PORT) || await findFreePortImpl(8000, { host: "0.0.0.0" });
  const studioPort = Number(existing.RUNLY_SUPABASE_STUDIO_HOST_PORT) || await findFreePortImpl(54323, { host: "127.0.0.1" });
  return { kongPort, studioPort };
}

// Gates the installer's final "ready for production" banner. `critical`
// findings must be zero before that banner is printed; `warning` findings
// are shown but never block it — see setup-local.mjs's end-of-run report.
export function assessSupabaseSecurityPosture({ mode, publicBindAddr, kongPort, studioPort, secrets, smtpConfigured }) {
  const findings = [];

  if (mode === "cli-dev") {
    findings.push({
      level: "critical",
      message: "RUNLY_SUPABASE_MODE=cli-dev uses the Supabase CLI's dev-oriented stack (default/no-auth admin ports). Re-run without --dev-supabase-cli for a production install.",
    });
    return findings; // Nothing else below applies to the CLI-managed stack.
  }

  if (!secrets || Buffer.byteLength(clean(secrets.SUPABASE_JWT_SECRET)) < 32) {
    findings.push({ level: "critical", message: "SUPABASE_JWT_SECRET is missing or shorter than 32 bytes." });
  }
  if (!secrets || clean(secrets.SUPABASE_POSTGRES_PASSWORD).length < 16) {
    findings.push({ level: "critical", message: "SUPABASE_POSTGRES_PASSWORD is missing or too short." });
  }
  if (secrets && !verifyHs256Jwt(secrets.SUPABASE_ANON_KEY, secrets.SUPABASE_JWT_SECRET)) {
    findings.push({ level: "critical", message: "SUPABASE_ANON_KEY does not verify against SUPABASE_JWT_SECRET (out of sync — regenerate both together, never edit one by hand)." });
  }
  if (secrets && !verifyHs256Jwt(secrets.SUPABASE_SERVICE_ROLE_KEY, secrets.SUPABASE_JWT_SECRET)) {
    findings.push({ level: "critical", message: "SUPABASE_SERVICE_ROLE_KEY does not verify against SUPABASE_JWT_SECRET (out of sync — regenerate both together, never edit one by hand)." });
  }
  if (clean(publicBindAddr) === "" || clean(publicBindAddr) === "0.0.0.0") {
    findings.push({
      level: "warning",
      message: `Kong (Supabase API gateway) is bound to 0.0.0.0:${kongPort}. This is expected if a host reverse proxy (Nginx) forwards to it; if this host has no such proxy, restrict RUNLY_PUBLIC_BIND_ADDR to a private interface or your proxy's address.`,
    });
  }
  if (!smtpConfigured) {
    findings.push({
      level: "warning",
      message: "No SMTP configured (RUNLY_SUPABASE_SMTP_HOST) — GOTRUE_MAILER_AUTOCONFIRM is forced on, so account confirmation emails and password-reset emails will not be sent.",
    });
  }
  if (!Number.isInteger(studioPort) || studioPort <= 0) {
    findings.push({ level: "critical", message: "Supabase Studio port could not be resolved." });
  }

  return findings;
}
