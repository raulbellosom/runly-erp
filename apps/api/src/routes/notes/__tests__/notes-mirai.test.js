// apps/api/src/routes/notes/__tests__/notes-mirai.test.js
//
// Focused tests for runly.notes MirAI tools/actions (spec
// 2026-09-30-mirai-remaining-modules §4): exact totals/ids, prepare() never
// writes, execute() goes through the real services, access-denied -> error.
import test from "node:test";
import assert from "node:assert/strict";
import { createNotesMiraiQueries } from "../notes-mirai-queries.js";
import { createNotesMiraiActions } from "../mirai-actions.js";
import { createNotesMiraiCapabilities } from "../mirai-capabilities.js";
import { NotesServiceError } from "../notes-service.js";

const actx = { companyId: "co1", actorProfileId: "me", actorAuthUserId: "auth" };

function fakeNotesSvc(overrides = {}) {
  return {
    getNote: async () => { throw new NotesServiceError("Nota no encontrada.", 404); },
    createNote: async (data) => ({ id: "n1", title: data.title ?? "Sin titulo" }),
    updateNote: async (id, _userId, data) => ({ id, title: data.title ?? "Nota", ...data }),
    trashNote: async () => ({ ok: true }),
    ...overrides,
  };
}

test("notes_search: returns exact total with noteId and a capped excerpt", async () => {
  const rows = [{ id: "n1", title: "Proveedor X", content_text: "a".repeat(500), updated_at: new Date(), folder_name: null }];
  const prisma = { $queryRaw: async () => rows };
  const [notes_search] = createNotesMiraiQueries({ prisma, notesSvc: fakeNotesSvc() });
  const out = await notes_search.run({ query: "proveedor" }, actx);
  assert.equal(out.total, 1);
  assert.equal(out.notas[0].noteId, "n1");
  assert.equal(out.notas[0].extracto.length, 200);
});

test("notes_get: caps content at 6000 chars and flags truncation", async () => {
  const notesSvc = fakeNotesSvc({ getNote: async () => ({ id: "n1", title: "Larga", content_text: "x".repeat(7000), tags: [{ name: "importante" }] }) });
  const [, notes_get] = createNotesMiraiQueries({ prisma: {}, notesSvc });
  const out = await notes_get.run({ noteId: "n1" }, actx);
  assert.equal(out.contenido.length, 6000);
  assert.equal(out.truncado, true);
  assert.deepEqual(out.etiquetas, ["importante"]);
});

test("notes_get: not found -> error, never throws", async () => {
  const [, notes_get] = createNotesMiraiQueries({ prisma: {}, notesSvc: fakeNotesSvc() });
  const out = await notes_get.run({ noteId: "nope" }, actx);
  assert.match(out.error, /no encontre/i);
});

function setupActions({ folders = [], tags = [] } = {}) {
  const calls = [];
  const notesSvc = fakeNotesSvc({
    createNote: async (data) => { calls.push(["create", data]); return { id: "n1", title: data.title ?? "Sin titulo" }; },
    updateNote: async (id, userId, data) => { calls.push(["update", id, data]); return { id, title: data.title ?? "Nota" }; },
    trashNote: async (id) => { calls.push(["trash", id]); return { ok: true }; },
  });
  const foldersSvc = { listFolders: async () => folders };
  const tagsSvc = { listTags: async () => tags, setNoteTags: async (id, userId, ids) => calls.push(["tags", id, ids]) };
  const actions = Object.fromEntries(createNotesMiraiActions({ prisma: {}, notesSvc, foldersSvc, tagsSvc }).map((a) => [a.key, a]));
  return { actions, calls, notesSvc };
}

test("create: resolves folder/tags by name, writes nothing in prepare", async () => {
  const { actions, calls } = setupActions({ folders: [{ id: "f1", name: "Proveedores" }], tags: [{ id: "t1", name: "urgente" }] });
  const out = await actions["notes.note.create"].prepare({ content: "Resumen de la llamada", folder: "Proveedores", tags: ["urgente"] }, actx);
  assert.equal(out.input.folderId, "f1");
  assert.deepEqual(out.input.tagIds, ["t1"]);
  assert.equal(calls.length, 0);
});

test("create: unknown tag name is rejected (tags must already exist)", async () => {
  const { actions } = setupActions({ tags: [] });
  const out = await actions["notes.note.create"].prepare({ content: "x", tags: ["no-existe"] }, actx);
  assert.match(out.error, /No encontre estas etiquetas/);
});

test("create: execute creates the note, sets content_text, and applies tags", async () => {
  const { actions, calls } = setupActions({ tags: [{ id: "t1", name: "urgente" }] });
  const res = await actions["notes.note.create"].execute({ title: null, content: "Hola\nMundo", folderId: null, tagIds: ["t1"] }, actx);
  assert.equal(res.id, "n1");
  assert.deepEqual(calls.map((c) => c[0]), ["create", "update", "tags"]);
  assert.equal(calls[1][2].contentText, "Hola\nMundo");
});

test("rename/move: no-op change returns an error", async () => {
  const { actions } = setupActions();
  const notesSvc = fakeNotesSvc({ getNote: async () => ({ id: "n1", title: "Nota", folder_id: null }) });
  const actions2 = Object.fromEntries(createNotesMiraiActions({ prisma: {}, notesSvc, foldersSvc: { listFolders: async () => [] }, tagsSvc: { listTags: async () => [] } }).map((a) => [a.key, a]));
  const out = await actions2["notes.note.rename_move"].prepare({ noteId: "n1", title: "Nota" }, actx);
  assert.match(out.error, /ningun cambio/);
  assert.ok(actions["notes.note.create"]); // sanity: setup() helper still usable
});

test("delete: moves to trash via trashNote", async () => {
  const notesSvc = fakeNotesSvc({ getNote: async () => ({ id: "n1", title: "Nota" }), trashNote: async (id) => ({ ok: true, id }) });
  const actions = Object.fromEntries(createNotesMiraiActions({ prisma: {}, notesSvc, foldersSvc: { listFolders: async () => [] }, tagsSvc: { listTags: async () => [] } }).map((a) => [a.key, a]));
  const prepared = await actions["notes.note.delete"].prepare({ noteId: "n1" }, actx);
  assert.equal(prepared.targetId, "n1");
  const res = await actions["notes.note.delete"].execute({ noteId: "n1" }, actx);
  assert.match(res.summary, /papelera/);
});

test("capability has no append action (omitted — see mirai-actions.js comment)", () => {
  const cap = createNotesMiraiCapabilities({ prisma: {} });
  assert.deepEqual(cap.actions.map((a) => a.key).sort(), ["notes.note.create", "notes.note.delete", "notes.note.rename_move"]);
});

test("describeContext: returns null when getNote throws (no access)", async () => {
  const cap = createNotesMiraiCapabilities({ prisma: {} });
  const line = await cap.describeContext({ recordType: "note", recordId: "n1" }, actx);
  assert.equal(line, null);
});
