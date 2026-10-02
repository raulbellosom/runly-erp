import * as Y from 'yjs'

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
const MAX_MERGE_ATTEMPTS = 5

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

  // Merges the client's Yjs update (a full state or an incremental diff — both
  // are valid Yjs updates) INTO the stored state instead of replacing it. A
  // blind overwrite let whichever collaborator saved last erase everything the
  // other one wrote that never reached them over realtime (a dropped broadcast,
  // a channel that never joined). Y.mergeUpdates is a CRDT union, so no
  // client's save can delete content it never saw.
  //
  // stateVectorBase64 (optional) is the client's Y.encodeStateVector; when
  // given, the response carries `missing` — the part of the merged doc that
  // client doesn't have yet — so it converges even if realtime missed updates.
  async function saveState(noteId, userId, stateBase64, { stateVectorBase64 = null } = {}) {
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
    const incoming = new Uint8Array(stateBuffer)
    try {
      Y.encodeStateVectorFromUpdate(incoming)
    } catch {
      throw new YDocServiceError('Estado del documento invalido', 400)
    }

    // Optimistic concurrency: two collaborators saving at the same moment must
    // not read the same base and have the second write drop the first merge.
    let merged = null
    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS && !merged; attempt += 1) {
      const [row] = await prisma.$queryRaw`
        SELECT state, version FROM note_ydoc_state WHERE note_id = ${noteId}::uuid
      `
      if (!row) {
        const inserted = await prisma.$executeRaw`
          INSERT INTO note_ydoc_state (note_id, state, version, updated_at)
          VALUES (${noteId}::uuid, ${stateBuffer}::bytea, 1, NOW())
          ON CONFLICT (note_id) DO NOTHING
        `
        if (inserted > 0) merged = incoming
        continue
      }
      const existing = new Uint8Array(row.state)
      const next = Y.mergeUpdates([existing, incoming])
      if (next.length > MAX_YDOC_BYTES) {
        throw new YDocServiceError('El documento excede el tamano maximo permitido', 413)
      }
      // Nothing new (the incoming update was already part of the stored state):
      // skip the write so a no-op save doesn't churn the row.
      if (Buffer.compare(Buffer.from(next), Buffer.from(existing)) === 0) {
        merged = existing
        break
      }
      const updated = await prisma.$executeRaw`
        UPDATE note_ydoc_state
        SET state = ${Buffer.from(next)}::bytea,
            version = version + 1,
            updated_at = NOW()
        WHERE note_id = ${noteId}::uuid AND version = ${row.version}
      `
      if (updated > 0) merged = next
    }
    if (!merged) {
      throw new YDocServiceError('Conflicto al guardar el documento, reintenta', 409)
    }

    const result = { ok: true }
    if (typeof stateVectorBase64 === 'string' && stateVectorBase64.length > 0) {
      try {
        const missing = Y.diffUpdate(merged, new Uint8Array(Buffer.from(stateVectorBase64, 'base64')))
        result.missing = Buffer.from(missing).toString('base64')
      } catch {
        // A malformed state vector only costs the catch-up; the save itself stands.
      }
    }
    return result
  }

  return { getState, getPublicState, saveState }
}
