// apps/api/src/services/auth-login-service.js
//
// Server-side login that accepts an email or a username. Supabase Auth only
// knows emails, so a username is resolved to its UserProfile email first.
// Unknown usernames, disabled profiles and wrong passwords all produce the
// same INVALID_CREDENTIALS result so the endpoint can't enumerate accounts.
import { usernameSchema } from "@runly/validators";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

export function createAuthLoginService({ prisma, supabaseAnon, now = () => Date.now() }) {
  const failures = new Map();

  function recentFailures(key) {
    const t = now();
    const list = (failures.get(key) ?? []).filter((at) => t - at < LOGIN_WINDOW_MS);
    failures.set(key, list);
    return list;
  }

  // Returns the email for an identifier, or null when it can't belong to an
  // enabled account. "@" means email; anything else is a username.
  async function resolveEmail(identifier) {
    const value = String(identifier ?? "").trim().toLowerCase();
    if (!value) return null;
    if (value.includes("@")) return value;
    const parsed = usernameSchema.safeParse(value);
    if (!parsed.success) return null;
    const rows = await prisma.$queryRaw`
      SELECT email FROM user_profile
      WHERE lower(username) = ${parsed.data} AND enabled = true
      LIMIT 1`;
    return rows[0]?.email ?? null;
  }

  async function login({ identifier, password }) {
    const key = String(identifier ?? "").trim().toLowerCase();
    if (recentFailures(key).length >= LOGIN_MAX_FAILURES) return { ok: false, code: "RATE_LIMITED" };

    const email = await resolveEmail(key);
    const fail = () => {
      recentFailures(key).push(now());
      return { ok: false, code: "INVALID_CREDENTIALS" };
    };
    if (!email) return fail();

    let result;
    try {
      result = await supabaseAnon.auth.signInWithPassword({ email, password });
    } catch {
      return { ok: false, code: "AUTH_UNAVAILABLE" };
    }
    const { data, error } = result;
    if (error) {
      if (String(error.message ?? "").includes("Email not confirmed")) return { ok: false, code: "EMAIL_NOT_CONFIRMED" };
      if (error.status && error.status >= 500) return { ok: false, code: "AUTH_UNAVAILABLE" };
      return fail();
    }
    failures.delete(key);
    const s = data.session;
    return { ok: true, session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at } };
  }

  return { resolveEmail, login };
}

export const LOGIN_ERROR_RESPONSES = {
  INVALID_CREDENTIALS: [401, "Credenciales incorrectas."],
  EMAIL_NOT_CONFIRMED: [403, "Tu cuenta no ha sido confirmada. Contacta al administrador."],
  RATE_LIMITED: [429, "Demasiados intentos. Espera unos minutos e intenta de nuevo."],
  AUTH_UNAVAILABLE: [503, "Sin conexión con el servidor de autenticación."],
};

// Normalizes a username coming from an edit form: "" / null clears it,
// anything else must pass usernameSchema. Returns { ok, value } or { ok:false, error }.
export function parseUsernameInput(raw) {
  if (raw === null || raw === "" || (typeof raw === "string" && !raw.trim())) return { ok: true, value: null };
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Nombre de usuario inválido." };
  return { ok: true, value: parsed.data };
}

export const USERNAME_TAKEN_ERROR = "Ese nombre de usuario ya está en uso.";

export function isUniqueViolation(err) {
  return err?.code === "P2002" || /duplicate key|unique constraint/i.test(String(err?.message ?? ""));
}
