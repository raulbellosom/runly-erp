import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signAiProof, verifyAiProof, AiProofTokenError } from "../ai-proof-token.js";

const env = { AI_PROOF_SIGNING_SECRET: "test-secret" };

describe("ai-proof-token", () => {
  it("round-trips a signed payload", () => {
    const token = signAiProof({ companyId: "c1", actorId: "u1" }, env);
    const payload = verifyAiProof(token, env);
    assert.equal(payload.companyId, "c1");
    assert.equal(payload.actorId, "u1");
  });

  it("rejects a tampered token", () => {
    const token = signAiProof({ companyId: "c1" }, env);
    const tampered = token.slice(0, -2) + "xx";
    assert.throws(() => verifyAiProof(tampered, env), AiProofTokenError);
  });

  it("rejects an expired token", () => {
    const token = signAiProof({ companyId: "c1" }, env, { nowMs: Date.now() - (3 * 60 * 60 * 1000) });
    assert.throws(() => verifyAiProof(token, env), /expiro/);
  });

  it("throws when no secret is configured", () => {
    assert.throws(() => signAiProof({ companyId: "c1" }, {}), AiProofTokenError);
  });
});
