import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthLoginService, parseUsernameInput } from "../auth-login-service.js";

function setup({ profiles = {}, password = "secret" } = {}) {
  const calls = [];
  const prisma = {
    $queryRaw: async (_strings, username) => (profiles[username] ? [{ email: profiles[username] }] : []),
  };
  const supabaseAnon = {
    auth: {
      signInWithPassword: async ({ email, password: pw }) => {
        calls.push(email);
        if (pw !== password) return { data: null, error: { message: "Invalid login credentials", status: 400 } };
        return { data: { session: { access_token: "a", refresh_token: "r", expires_at: 1 } }, error: null };
      },
    },
  };
  return { svc: createAuthLoginService({ prisma, supabaseAnon }), calls };
}

test("logs in by username, case and spaces insensitive", async () => {
  const { svc, calls } = setup({ profiles: { jperez: "j@x.com" } });
  const r = await svc.login({ identifier: " JPerez ", password: "secret" });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["j@x.com"]);
});

test("logs in by email without username lookup", async () => {
  const { svc, calls } = setup();
  const r = await svc.login({ identifier: "A@X.com", password: "secret" });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["a@x.com"]);
});

test("unknown username and wrong password give the same result", async () => {
  const { svc, calls } = setup({ profiles: { jperez: "j@x.com" } });
  const unknown = await svc.login({ identifier: "nadie", password: "secret" });
  const wrong = await svc.login({ identifier: "jperez", password: "bad" });
  assert.deepEqual(unknown, wrong);
  assert.equal(unknown.code, "INVALID_CREDENTIALS");
  assert.deepEqual(calls, ["j@x.com"]);
});

test("rate limits after 10 failures", async () => {
  const { svc } = setup();
  for (let i = 0; i < 10; i++) await svc.login({ identifier: "x", password: "bad" });
  const r = await svc.login({ identifier: "x", password: "secret" });
  assert.equal(r.code, "RATE_LIMITED");
});

test("parseUsernameInput clears, normalizes and rejects", () => {
  assert.deepEqual(parseUsernameInput(""), { ok: true, value: null });
  assert.deepEqual(parseUsernameInput(" Ana.P "), { ok: true, value: "ana.p" });
  assert.equal(parseUsernameInput("a@b").ok, false);
  assert.equal(parseUsernameInput("_ana").ok, false);
});
