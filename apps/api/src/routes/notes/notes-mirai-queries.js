// apps/api/src/routes/notes/notes-mirai-queries.js
//
// Exact runly.notes read tools for MirAI (spec
// 2026-09-30-mirai-remaining-modules §3): search notes by text/tag/folder
// with a short excerpt, and get a note's full content (capped), both scoped
// to notes the caller owns or has an active share on
// (public.runly_note_user_access, same rule notes-service.js's assertAccess
// and listNotes use).
const SEARCH_MAX = 30;
const EXCERPT_MAX = 200;
const CONTENT_MAX = 6000;

export function createNotesMiraiQueries({ prisma, notesSvc }) {
  const notes_search = {
    name: "notes_search",
    permission: "notes.notes.read",
    definition: {
      description: "Busca notas del usuario por texto (titulo/contenido), etiqueta o carpeta. Devuelve el total exacto y hasta 30 notas con noteId y un extracto corto.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto a buscar en titulo o contenido." },
          tag: { type: "string", description: "Nombre de una etiqueta del usuario." },
          folder: { type: "string", description: "Nombre de una carpeta del usuario." },
        },
      },
    },
    async run(args, actx) {
      const userId = actx.actorProfileId;
      const companyId = actx.companyId;
      let folderId;
      if (args?.folder) {
        const [folder] = await prisma.$queryRaw`
          SELECT id FROM note_folders
          WHERE owner_user_id = ${userId}::uuid
            AND (company_id = ${companyId ?? null}::uuid OR company_id IS NULL)
            AND name ILIKE ${args.folder}
          LIMIT 1
        `;
        if (!folder) return { error: `No encontre la carpeta "${args.folder}".` };
        folderId = folder.id;
      }
      let tagId;
      if (args?.tag) {
        const [tag] = await prisma.$queryRaw`
          SELECT id FROM note_tags
          WHERE owner_user_id = ${userId}::uuid
            AND (company_id = ${companyId ?? null}::uuid OR company_id IS NULL)
            AND name ILIKE ${args.tag}
          LIMIT 1
        `;
        if (!tag) return { error: `No encontre la etiqueta "${args.tag}".` };
        tagId = tag.id;
      }

      const rows = await prisma.$queryRaw`
        SELECT n.id, n.title, n.content_text, n.updated_at, nf.name AS folder_name
        FROM notes n
        LEFT JOIN note_folders nf ON nf.id = n.folder_id
        LEFT JOIN note_shares ns_mine ON ns_mine.note_id = n.id AND ns_mine.shared_with_user_id = ${userId}::uuid
        WHERE (n.company_id = ${companyId ?? null}::uuid OR n.company_id IS NULL OR ns_mine.external_access)
          AND n.deleted_at IS NULL
          AND n.is_trashed = false
          AND public.runly_note_user_access(n.id, ${userId}::uuid, false)
          AND (n.owner_user_id = ${userId}::uuid OR ns_mine.id IS NOT NULL)
          AND (${folderId ?? null}::uuid IS NULL OR n.folder_id = ${folderId ?? null}::uuid)
          AND (
            ${tagId ?? null}::uuid IS NULL
            OR EXISTS (SELECT 1 FROM note_tag_assignments nta WHERE nta.note_id = n.id AND nta.tag_id = ${tagId ?? null}::uuid)
          )
          AND (
            ${args?.query ?? null}::text IS NULL
            OR to_tsvector('spanish', COALESCE(n.title, '') || ' ' || COALESCE(n.content_text, ''))
               @@ plainto_tsquery('spanish', ${args?.query ?? null}::text)
          )
        ORDER BY n.updated_at DESC
      `;
      return {
        total: rows.length,
        notas: rows.slice(0, SEARCH_MAX).map((r) => ({
          noteId: r.id,
          titulo: r.title,
          carpeta: r.folder_name,
          extracto: (r.content_text ?? "").slice(0, EXCERPT_MAX),
          actualizada: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
        })),
      };
    },
  };

  const notes_get = {
    name: "notes_get",
    permission: "notes.notes.read",
    definition: {
      description: "Devuelve el contenido (texto plano, hasta 6000 caracteres) de UNA nota por noteId. Solo funciona si el usuario es dueno o tiene la nota compartida.",
      parameters: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] },
    },
    async run(args, actx) {
      const noteId = String(args?.noteId ?? "");
      if (!noteId) return { error: "Indica el noteId (de notes_search)." };
      try {
        const note = await notesSvc.getNote(noteId, actx.actorProfileId);
        return {
          noteId: note.id,
          titulo: note.title,
          contenido: (note.content_text ?? "").slice(0, CONTENT_MAX),
          truncado: (note.content_text ?? "").length > CONTENT_MAX,
          etiquetas: (note.tags ?? []).map((t) => t.name),
        };
      } catch (err) {
        const notFound = err?.status === 404 || err?.status === 403;
        return { error: notFound ? "No encontre esa nota o no tienes acceso." : String(err?.message ?? err).slice(0, 160) };
      }
    },
  };

  return [notes_search, notes_get];
}
