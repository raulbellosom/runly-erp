// Regression: two collaborators saving the same note must never erase each
// other's work (the server used to overwrite the stored Y.js state with the
// last saver's copy), opening a note must not bump updated_at, and a
// collaborator can leave a shared note without deleting it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import { createYDocService } from "../ydoc-service.js";
import { hasNoteChanges } from "../notes-service.js";
import { createSharesService, SharesServiceError } from "../shares-service.js";

const NOTE = "01900000-0000-7000-8000-0000000000aa";
const USER = "01900000-0000-7000-8000-000000000001";

function sql(strings) {
  return strings.join(" ? ").replace(/\s+/g, " ").trim().toLowerCase();
}

// In-memory note_ydoc_state row behind the raw-SQL calls ydoc-service makes.
function ydocPrisma() {
  const store = { row: null };
  const run = (strings, ...values) => {
    const text = sql(strings);
    if (text.startsWith("select id from notes")) return Promise.resolve([{ id: NOTE }]);
    if (text.startsWith("select state, version from note_ydoc_state")) {
      return Promise.resolve(store.row ? [{ ...store.row }] : []);
    }
    if (text.startsWith("insert into note_ydoc_state")) {
      if (store.row) return Promise.resolve(0);
      store.row = { state: values[1], version: 1 };
      return Promise.resolve(1);
    }
    if (text.startsWith("update note_ydoc_state")) {
      const [state, , version] = values;
      if (store.row.version !== version) return Promise.resolve(0);
      store.row = { state, version: version + 1 };
      return Promise.resolve(1);
    }
    return Promise.resolve([]);
  };
  return { prisma: { $queryRaw: run, $executeRaw: run }, store };
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function docWith(text) {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return doc;
}

describe("ydoc-service — saves merge instead of overwrite", () => {
  it("keeps both collaborators' edits when each saves a state missing the other's", async () => {
    const { prisma, store } = ydocPrisma();
    const svc = createYDocService({ prisma });
    const a = docWith("A");
    const b = docWith("B"); // never received A's edit (dropped broadcast)

    await svc.saveState(NOTE, USER, b64(Y.encodeStateAsUpdate(a)));
    const res = await svc.saveState(NOTE, USER, b64(Y.encodeStateAsUpdate(b)), {
      stateVectorBase64: b64(Y.encodeStateVector(b)),
    });

    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(store.row.state));
    const text = stored.getText("t").toString();
    assert.ok(text.includes("A") && text.includes("B"), `lost an edit: "${text}"`);

    // B gets back exactly what it was missing and converges.
    Y.applyUpdate(b, new Uint8Array(Buffer.from(res.missing, "base64")));
    assert.equal(b.getText("t").toString(), text);
  });

  it("does not rewrite the row when the update adds nothing new", async () => {
    const { prisma, store } = ydocPrisma();
    const svc = createYDocService({ prisma });
    const a = docWith("hola");
    await svc.saveState(NOTE, USER, b64(Y.encodeStateAsUpdate(a)));
    await svc.saveState(NOTE, USER, b64(Y.encodeStateAsUpdate(a)));
    assert.equal(store.row.version, 1);
  });
});

describe("notes-service — hasNoteChanges", () => {
  const current = { title: "Plan", content: "<p>Plan</p>", content_text: "Plan", icon: "", is_pinned: false };

  it("treats re-sending identical content as no change", () => {
    assert.equal(hasNoteChanges(current, { title: "Plan", content: "<p>Plan</p>", contentText: "Plan" }), false);
  });

  it("detects a real edit", () => {
    assert.equal(hasNoteChanges(current, { content: "<p>Plan B</p>" }), true);
    assert.equal(hasNoteChanges(current, { isPinned: true }), true);
  });
});

describe("shares-service — leaveNote", () => {
  it("rejects leaving a note that is not shared with the user", async () => {
    const prisma = { $queryRaw: async () => [], $executeRaw: async () => 0 };
    const svc = createSharesService({ prisma, broadcaster: null, notificationService: {} });
    await assert.rejects(
      () => svc.leaveNote(NOTE, USER),
      (e) => e instanceof SharesServiceError && e.status === 404,
    );
  });
});
