export class YDocServiceError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'YDocServiceError'
    this.status = status
  }
}

// Hard ceiling for a single note's Yjs state blob. A rich note is a few hundred
// KB; anything past this is abuse or a client bug, not a real document.
const MAX_YDOC_BYTES = 8 * 1024 * 1024 // 8 MiB

export function createYDocService({ prisma }) {
  async function getState(noteId, userId) {
    const [note] = await prisma.$queryRaw`
      SELECT id FROM notes
      WHERE id = ${noteId}::uuid
        AND public.runly_note_user_access(id, ${userId}::uuid, false)
        AND (
          owner_user_id = ${userId}::uuid
          OR id IN (
            SELECT note_id FROM note_shares
            WHERE shared_with_user_id = ${userId}::uuid
          )
        )
    `
    if (!note) {
      throw new YDocServiceError('Nota no encontrada', 404)
    }

    const [row] = await prisma.$queryRaw`
      SELECT state, version FROM note_ydoc_state
      WHERE note_id = ${noteId}::uuid
    `
    if (!row) {
      return { state: null }
    }

    const state = Buffer.from(row.state).toString('base64')
    return { state, version: row.version }
  }

  // Public read-only counterpart of getState — no userId, gated on the note
  // being published instead of ownership/share. Used by the public note page
  // to join the same `note:ydoc:<id>` realtime topic anonymously and render
  // live edits (see the anon branch added to note_ydoc_receive in migration
  // 20260919120000_notes_ydoc_public_realtime).
  async function getPublicState(slug) {
    const [note] = await prisma.$queryRaw`
      SELECT id FROM notes
      WHERE public_slug = ${slug}
        AND is_public = true AND public.notes_realtime_is_public(id)
        AND deleted_at IS NULL
        AND is_trashed = false
    `
    if (!note) {
      throw new YDocServiceError('Nota no encontrada', 404)
    }
    const [row] = await prisma.$queryRaw`
      SELECT state FROM note_ydoc_state WHERE note_id = ${note.id}::uuid
    `
    if (!row) {
      return { state: null, noteId: note.id }
    }
    return { state: Buffer.from(row.state).toString('base64'), noteId: note.id }
  }

  async function saveState(noteId, userId, stateBase64) {
    if (typeof stateBase64 !== 'string' || stateBase64.length === 0) {
      throw new YDocServiceError('Estado del documento invalido', 400)
    }
    // base64 is ~4/3 the byte size; check before allocating the Buffer.
    if (stateBase64.length > Math.ceil((MAX_YDOC_BYTES * 4) / 3) + 4) {
      throw new YDocServiceError('El documento excede el tamano maximo permitido', 413)
    }
    const [note] = await prisma.$queryRaw`
      SELECT id FROM notes
      WHERE id = ${noteId}::uuid
        AND public.runly_note_user_access(id, ${userId}::uuid, false)
        AND (
          owner_user_id = ${userId}::uuid
          OR id IN (
            SELECT note_id FROM note_shares
            WHERE shared_with_user_id = ${userId}::uuid
              AND permission = 'edit'
          )
        )
    `
    if (!note) {
      throw new YDocServiceError('Sin permisos de edicion', 403)
    }

    const stateBuffer = Buffer.from(stateBase64, 'base64')
    if (stateBuffer.length === 0 || stateBuffer.length > MAX_YDOC_BYTES) {
      throw new YDocServiceError('El documento excede el tamano maximo permitido', 413)
    }
    await prisma.$executeRaw`
      INSERT INTO note_ydoc_state (note_id, state, version, updated_at)
      VALUES (${noteId}::uuid, ${stateBuffer}::bytea, 1, NOW())
      ON CONFLICT (note_id) DO UPDATE
        SET state = EXCLUDED.state,
            version = note_ydoc_state.version + 1,
            updated_at = NOW()
    `
    return { ok: true }
  }

  return { getState, getPublicState, saveState }
}
