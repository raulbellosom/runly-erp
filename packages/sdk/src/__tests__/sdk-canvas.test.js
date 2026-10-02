import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createRunlyClient } from "../index.js";

describe("Runly SDK — Canvas", () => {
  it("accepts an empty 204 response when removing a collaborator", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => { throw new Error("json() must not be called for 204"); },
    }));
    globalThis.fetch = fetchMock;

    try {
      const client = createRunlyClient({ baseUrl: "https://api.example.com" });
      const result = await client.canvas.removeCollaborator("board-1", "user-1", "token");

      assert.equal(result, null);
      const [url, options] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, "https://api.example.com/canvas/boards/board-1/collaborators/user-1");
      assert.equal(options.method, "DELETE");
      assert.equal(options.headers.Authorization, "Bearer token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
