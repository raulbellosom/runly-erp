// apps/api/src/routes/notes/mirai-actions.js
//
// runly.notes actions MirAI can propose (spec
// 2026-09-30-mirai-remaining-modules §3). prepare() resolves folder/tag names
// -> ids without writing; execute() goes through notesSvc/foldersSvc/tagsSvc
// exactly like the HTTP routes in routes/notes/index.js (no extraction
// needed: those routes have no inline side effects beyond the services
// themselves — notesSvc.updateNote already owns the collaborator broadcast).
//
// OMITTED: "append to a note" (spec §3, runly.notes). A note's real content
// lives in two places: the `content`/`content_text` columns (plain HTML +
// text mirror, see notes-service.js) and, once the note has been opened in
// the collaborative editor, a separate Y.js binary snapshot in
// note_ydoc_state (ydoc-service.js). The editor prefers the Y.Doc snapshot
// whenever one exists (NoteEditor.jsx: `hadServerState`) — ydoc-service.js
// only exposes raw getState/saveState on an opaque binary blob, with no
// "merge this plain text into the existing Y.Doc" primitive. Appending via
// notesSvc.updateNote would silently diverge from a note that already has
// live collaborative state: the editor would keep showing the old content
// until the Y.Doc is discarded. There is no safe path through the existing
// services, so the action is omitted per spec's own escape hatch ("if
// appending ... is not safely supported by the service, omit it").
// create/rename/move/delete never touch `content`, so they carry no such risk.
import { z } from "zod";

const LINK = (id) => `/app/m/runly.notes?noteId=${id}`;

const createArgs = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1).max(20000),
  folder: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).max(10).optional(),
});
const renameMoveArgs = z.object({
  noteId: z.string().min(1),
  title: z.string().trim().max(200).optional(),
  folder: z.string().trim().nullable().optional(), // "" or null clears the folder
});
const deleteArgs = z.object({ noteId: z.string().min(1) });

// Plain text -> the same minimal HTML the editor would save (one <p> per line).
function textToHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(text).split(/\n+/).filter((line) => line.trim().length).map((line) => `<p>${esc(line)}</p>`).join("") || "<p></p>";
}

export function createNotesMiraiActions({ prisma, notesSvc, foldersSvc, tagsSvc }) {
  async function resolveFolder(userId, companyId, name) {
    if (!name) return { folderId: null };
    const folders = await foldersSvc.listFolders({ userId, companyId });
    const q = name.trim().toLowerCase();
    const exact = folders.filter((f) => f.name.toLowerCase() === q);
    const matches = exact.length ? exact : folders.filter((f) => f.name.toLowerCase().includes(q));
    if (matches.length === 1) return { folderId: matches[0].id, folderName: matches[0].name };
    if (!matches.length) return { error: `No encontre la carpeta "${name}". Tus carpetas: ${folders.map((f) => f.name).join(", ") || "(ninguna)"}.` };
    return { error: `Hay varias carpetas que coinciden: ${matches.map((f) => f.name).join(", ")}.` };
  }

  async function resolveTagIds(userId, companyId, names) {
    if (!names?.length) return { tagIds: [] };
    const tags = await tagsSvc.listTags({ userId, companyId });
    const ids = [];
    const problems = [];
    for (const raw of names) {
      const q = raw.trim().toLowerCase();
      const matches = tags.filter((t) => t.name.toLowerCase() === q);
      if (matches.length === 1) ids.push(matches[0].id);
      else problems.push(raw);
    }
    if (problems.length) return { error: `No encontre estas etiquetas (deben existir ya): ${problems.join(", ")}. Tus etiquetas: ${tags.map((t) => t.name).join(", ") || "(ninguna)"}.` };
    return { tagIds: ids, tagNames: names };
  }

  const create = {
    key: "notes.note.create",
    moduleKey: "runly.notes",
    operation: "create",
    label: "Crear nota",
    permission: "notes.notes.create",
    description: "Crea una nota con titulo, contenido (texto plano), carpeta y etiquetas opcionales. Las carpetas/etiquetas deben existir ya; usa notes_search o pide al usuario que las cree primero si no.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        folder: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
    async prepare(args, actx) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica al menos el contenido de la nota." };
      const a = parsed.data;
      const folder = await resolveFolder(actx.actorProfileId, actx.companyId, a.folder);
      if (folder.error) return { error: folder.error };
      const tags = await resolveTagIds(actx.actorProfileId, actx.companyId, a.tags);
      if (tags.error) return { error: tags.error };
      return {
        input: {
          title: a.title ?? null,
          content: a.content,
          folderId: folder.folderId,
          tagIds: tags.tagIds,
        },
        preview: {
          title: "Crear nota",
          fields: [
            a.title ? { label: "Titulo", value: a.title } : { label: "Titulo", value: "(se toma del contenido)" },
            { label: "Contenido", value: a.content.slice(0, 300) },
            folder.folderName ? { label: "Carpeta", value: folder.folderName } : null,
            tags.tagNames?.length ? { label: "Etiquetas", value: tags.tagNames.join(", ") } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const html = textToHtml(input.content);
      const note = await notesSvc.createNote({
        userId: actx.actorProfileId,
        companyId: actx.companyId,
        title: input.title,
        content: html,
        folderId: input.folderId,
      });
      // createNote doesn't set content_text (only the real editor's autosave
      // does) — set it here so the note is findable via notes_search/listNotes'
      // full-text filter right away.
      await notesSvc.updateNote(note.id, actx.actorProfileId, { contentText: input.content });
      if (input.tagIds.length) await tagsSvc.setNoteTags(note.id, actx.actorProfileId, input.tagIds);
      return { id: note.id, summary: `Nota creada: ${note.title || "(sin titulo)"}`, link: LINK(note.id) };
    },
  };

  const renameMove = {
    key: "notes.note.rename_move",
    moduleKey: "runly.notes",
    operation: "update",
    label: "Renombrar/mover nota",
    permission: "notes.notes.update",
    description: "Cambia el titulo y/o la carpeta de una nota existente. Requiere el noteId de notes_search. No toca el contenido.",
    parameters: {
      type: "object",
      properties: { noteId: { type: "string" }, title: { type: "string" }, folder: { type: "string", description: "Nombre de la carpeta destino; cadena vacia para quitarla de su carpeta." } },
      required: ["noteId"],
    },
    async prepare(args, actx) {
      const parsed = renameMoveArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el noteId (de notes_search) y el titulo y/o carpeta nuevos." };
      const a = parsed.data;
      let note;
      try {
        note = await notesSvc.getNote(a.noteId, actx.actorProfileId);
      } catch {
        return { error: "No encontre esa nota o no tienes acceso. Usa notes_search para obtener su noteId." };
      }
      const data = {};
      const fields = [{ label: "Nota", value: note.title }];
      if (a.title !== undefined && a.title !== note.title) {
        data.title = a.title;
        fields.push({ label: "Titulo", before: note.title, value: a.title });
      }
      if (a.folder !== undefined) {
        const folder = await resolveFolder(actx.actorProfileId, actx.companyId, a.folder || null);
        if (folder.error) return { error: folder.error };
        if (folder.folderId !== (note.folder_id ?? null)) {
          const existing = note.folder_id ? await foldersSvc.listFolders({ userId: actx.actorProfileId, companyId: actx.companyId }) : [];
          const beforeName = existing.find((f) => f.id === note.folder_id)?.name ?? "(sin carpeta)";
          data.folderId = folder.folderId;
          fields.push({ label: "Carpeta", before: beforeName, value: folder.folderName ?? "(sin carpeta)" });
        }
      }
      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto a la nota actual." };
      return { input: { noteId: note.id, data }, targetId: note.id, preview: { title: "Editar nota", fields } };
    },
    async execute(input, actx) {
      const note = await notesSvc.updateNote(input.noteId, actx.actorProfileId, input.data);
      return { id: note.id, summary: `Nota actualizada: ${note.title || "(sin titulo)"}`, link: LINK(note.id) };
    },
  };

  const remove = {
    key: "notes.note.delete",
    moduleKey: "runly.notes",
    operation: "delete",
    label: "Eliminar nota",
    permission: "notes.notes.delete",
    description: "Mueve una nota a la papelera (borrado logico, recuperable). Requiere el noteId de notes_search. Solo el dueno de la nota puede eliminarla.",
    parameters: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] },
    async prepare(args, actx) {
      const parsed = deleteArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el noteId (de notes_search)." };
      let note;
      try {
        note = await notesSvc.getNote(parsed.data.noteId, actx.actorProfileId);
      } catch {
        return { error: "No encontre esa nota o no tienes acceso. Usa notes_search para obtener su noteId." };
      }
      return {
        input: { noteId: note.id },
        targetId: note.id,
        preview: { title: "Eliminar nota (papelera)", fields: [{ label: "Nota", value: note.title }] },
      };
    },
    async execute(input, actx) {
      await notesSvc.trashNote(input.noteId, actx.actorProfileId);
      return { id: input.noteId, summary: "Nota movida a la papelera." };
    },
  };

  return [create, renameMove, remove];
}
