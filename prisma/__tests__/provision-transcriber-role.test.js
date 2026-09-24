import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSCRIBER_ROLE_NAME,
  dropTranscriberRole,
  ensureTranscriberRole,
  quoteRolePassword,
} from "../provision-transcriber-role.mjs";

function fakePool(roleExists) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT 1 FROM pg_roles")) return { rows: roleExists ? [{ x: 1 }] : [] };
      return { rows: [] };
    },
  };
}

describe("quoteRolePassword", () => {
  it("accepts base64url output verbatim, quoted", () => {
    assert.equal(quoteRolePassword("abcXYZ012_-"), "'abcXYZ012_-'");
  });

  it("rejects a password that could break out of a SQL literal (defense-in-depth)", () => {
    assert.throws(() => quoteRolePassword("bad'; DROP ROLE postgres; --"), /base64url/);
  });
});

describe("ensureTranscriberRole", () => {
  it("creates the role, grants schema USAGE, then the minimal privilege set, when it does not exist", async () => {
    const pool = fakePool(false);
    await ensureTranscriberRole(pool, "secret-pw");

    const createCall = pool.calls.find((c) => c.sql.includes("CREATE ROLE"));
    assert.ok(createCall.sql.includes(TRANSCRIBER_ROLE_NAME));
    assert.ok(createCall.sql.includes("'secret-pw'"));

    // Confirmed against a real database (docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md,
    // Etapa 2): Supabase does not grant USAGE on the public schema to a new
    // role by default — without this every subsequent GRANT is silently
    // useless ("relation does not exist" at query time, not at GRANT time).
    const schemaGrant = pool.calls.find((c) => c.sql === `GRANT USAGE ON SCHEMA public TO ${TRANSCRIBER_ROLE_NAME}`);
    assert.ok(schemaGrant, "expected an explicit GRANT USAGE ON SCHEMA public");

    const writeGrant = pool.calls.find((c) => c.sql.startsWith("GRANT SELECT, INSERT, UPDATE, DELETE"));
    assert.ok(writeGrant.sql.includes("call_transcript"));
    assert.ok(writeGrant.sql.includes("call_transcript_segment"));

    const readGrant = pool.calls.find((c) => c.sql.startsWith("GRANT SELECT ON call,"));
    assert.ok(readGrant.sql.includes("call_recording"));
    assert.ok(readGrant.sql.includes("user_profile"));
    assert.ok(!pool.calls.some((c) => /finance|ledger|hr_|contacts/i.test(c.sql)));
  });

  it("idempotently rotates the password via ALTER ROLE instead of a duplicate CREATE ROLE", async () => {
    const pool = fakePool(true);
    await ensureTranscriberRole(pool, "new-pw");
    assert.ok(pool.calls.some((c) => c.sql.includes("ALTER ROLE") && c.sql.includes("'new-pw'")));
    assert.ok(!pool.calls.some((c) => c.sql.includes("CREATE ROLE")));
  });
});

describe("dropTranscriberRole", () => {
  it("revokes privileges and schema usage before dropping, and never throws", async () => {
    const pool = fakePool(true);
    await assert.doesNotReject(dropTranscriberRole(pool));
    assert.ok(pool.calls.some((c) => c.sql.startsWith("REVOKE ALL PRIVILEGES")));
    assert.ok(pool.calls.some((c) => c.sql === `REVOKE USAGE ON SCHEMA public FROM ${TRANSCRIBER_ROLE_NAME}`));
    assert.ok(pool.calls.some((c) => c.sql === `DROP ROLE IF EXISTS ${TRANSCRIBER_ROLE_NAME}`));
  });
});
