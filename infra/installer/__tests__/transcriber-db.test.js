import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSCRIBER_ROLE_NAME,
  buildTranscriberDatabaseUrl,
  generateTranscriberPassword,
} from "../lib/transcriber-db.mjs";

describe("generateTranscriberPassword", () => {
  it("produces a sufficiently long secret from injected randomness", () => {
    const pw = generateTranscriberPassword((n) => Buffer.alloc(n, 0xab));
    assert.equal(typeof pw, "string");
    assert.ok(pw.length >= 40);
  });
});

describe("buildTranscriberDatabaseUrl", () => {
  it("swaps the credential but keeps host/port/database from the application's connection string", () => {
    const url = buildTranscriberDatabaseUrl("postgresql://runly_app:app-secret@db.example.test:5433/postgres", "tx-secret");
    const parsed = new URL(url);
    assert.equal(parsed.username, TRANSCRIBER_ROLE_NAME);
    assert.equal(parsed.password, "tx-secret");
    assert.equal(parsed.hostname, "db.example.test");
    assert.equal(parsed.port, "5433");
    assert.equal(parsed.pathname, "/postgres");
  });
});
