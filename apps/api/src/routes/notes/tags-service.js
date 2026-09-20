export class TagsServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "TagsServiceError";
    this.status = status;
  }
}

export function createTagsService({ prisma }) {
  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------

  async function listTags({ userId, companyId }) {
    const rows = await prisma.$queryRaw`
      SELECT
        note_tags.*,
        COUNT(n.id) AS note_count
      FROM note_tags
      LEFT JOIN note_tag_assignments
        ON note_tags.id = note_tag_assignments.tag_id
      LEFT JOIN notes n ON n.id = note_tag_assignments.note_id
        AND n.company_id IS NOT DISTINCT FROM note_tags.company_id
        AND n.deleted_at IS NULL
        AND public.runly_note_user_access(n.id, ${userId}::uuid, false)
      WHERE note_tags.owner_user_id = ${userId}
        AND (note_tags.company_id = ${companyId ?? null}::uuid OR note_tags.company_id IS NULL)
      GROUP BY note_tags.id
      ORDER BY note_tags.name ASC
    `;
    return rows.map((row) => ({
      ...row,
      note_count: parseInt(row.note_count, 10),
    }));
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async function createTag({ userId, companyId, name, color }) {
    try {
      const rows = await prisma.$queryRaw`
        INSERT INTO note_tags (owner_user_id, company_id, name, color)
        VALUES (
          ${userId},
          ${companyId ?? null}::uuid,
          ${name},
          ${color ?? "#6366f1"}
        )
        RETURNING *
      `;
      return rows[0];
    } catch (err) {
      if (err?.message?.includes("unique") || err?.code === "23505") {
        throw new TagsServiceError("Ya existe una etiqueta con ese nombre", 409);
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  async function updateTag(tagId, userId, data, companyId) {
    const existing = await prisma.$queryRaw`
      SELECT id
      FROM note_tags
      WHERE id = ${tagId}
        AND owner_user_id = ${userId}
        AND (company_id = ${companyId ?? null}::uuid OR company_id IS NULL)
      LIMIT 1
    `;

    if (!existing.length) {
      throw new TagsServiceError("Etiqueta no encontrada.", 404);
    }

    const rows = await prisma.$queryRaw`
      UPDATE note_tags
      SET
        name       = COALESCE(${data.name ?? null}::text, name),
        color      = COALESCE(${data.color ?? null}::text, color)
      WHERE id = ${tagId}
        AND owner_user_id = ${userId}
        AND (company_id = ${companyId ?? null}::uuid OR company_id IS NULL)
      RETURNING *
    `;

    if (!rows.length) {
      throw new TagsServiceError("Etiqueta no encontrada.", 404);
    }

    return rows[0];
  }

  // ------------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------------

  async function deleteTag(tagId, userId, companyId) {
    const existing = await prisma.$queryRaw`
      SELECT id
      FROM note_tags
      WHERE id = ${tagId}
        AND owner_user_id = ${userId}
        AND (company_id = ${companyId ?? null}::uuid OR company_id IS NULL)
      LIMIT 1
    `;

    if (!existing.length) {
      throw new TagsServiceError("Etiqueta no encontrada.", 404);
    }

    await prisma.$executeRaw`
      DELETE FROM note_tags
      WHERE id = ${tagId}
        AND owner_user_id = ${userId}
        AND (company_id = ${companyId ?? null}::uuid OR company_id IS NULL)
    `;

    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Set note tags (replace-all)
  // ------------------------------------------------------------------

  async function setNoteTags(noteId, userId, tagIds) {
    // Verify user has edit access to this note (owner OR share with edit permission)
    const access = await prisma.$queryRaw`
      SELECT id, company_id FROM notes
      WHERE id = ${noteId}::uuid
        AND deleted_at IS NULL
        AND public.runly_note_user_access(id, ${userId}::uuid, true)
        AND (
          owner_user_id = ${userId}::uuid
          OR id IN (
            SELECT note_id FROM note_shares
            WHERE shared_with_user_id = ${userId}::uuid
              AND permission = 'edit'
          )
        )
    `
    if (!access.length) throw new TagsServiceError('No tienes permiso para editar esta nota', 403)

    const requested = Array.isArray(tagIds) ? [...new Set(tagIds.filter(Boolean))] : []
    // Only the acting user's own tags may be attached.
    let ownTagIds = []
    if (requested.length > 0) {
      const owned = await prisma.$queryRaw`
        SELECT id FROM note_tags
        WHERE owner_user_id = ${userId}::uuid
          AND company_id IS NOT DISTINCT FROM ${access[0].company_id ?? null}::uuid
          AND id = ANY(${requested}::uuid[])
      `
      ownTagIds = owned.map((r) => r.id)
      if (ownTagIds.length !== requested.length) {
        throw new TagsServiceError('Una o mas etiquetas no te pertenecen', 403)
      }
    }

    await prisma.$executeRaw`DELETE FROM note_tag_assignments WHERE note_id = ${noteId}::uuid`
    if (ownTagIds.length === 0) return { ok: true, count: 0 }
    for (const tagId of ownTagIds) {
      await prisma.$executeRaw`
        INSERT INTO note_tag_assignments (note_id, tag_id)
        VALUES (${noteId}::uuid, ${tagId}::uuid)
        ON CONFLICT DO NOTHING
      `
    }
    return { ok: true, count: ownTagIds.length }
  }

  // ------------------------------------------------------------------
  // Remove single note tag
  // ------------------------------------------------------------------

  async function removeNoteTag(noteId, tagId, userId) {
    // Verify user has edit access
    const access = await prisma.$queryRaw`
      SELECT id FROM notes
      WHERE id = ${noteId}::uuid
        AND deleted_at IS NULL
        AND public.runly_note_user_access(id, ${userId}::uuid, true)
        AND (
          owner_user_id = ${userId}::uuid
          OR id IN (
            SELECT note_id FROM note_shares
            WHERE shared_with_user_id = ${userId}::uuid
              AND permission = 'edit'
          )
        )
    `
    if (!access.length) throw new TagsServiceError('No tienes permiso para editar esta nota', 403)

    await prisma.$executeRaw`
      DELETE FROM note_tag_assignments
      WHERE note_id = ${noteId}::uuid
        AND tag_id  = ${tagId}::uuid
    `
    return { ok: true }
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return { listTags, createTag, updateTag, deleteTag, setNoteTags, removeNoteTag };
}
