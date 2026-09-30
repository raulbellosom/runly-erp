import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rejoinDelayMs } from "../callReconnect.js";

describe("rejoinDelayMs", () => {
  it("retries immediately first, then backs off exponentially up to 30s", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(rejoinDelayMs), [0, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});
