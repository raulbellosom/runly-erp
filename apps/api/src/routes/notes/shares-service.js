import { createUserAccessService } from '../../services/user-access-service.js'
import { randomBytes } from 'node:crypto'
import { createNotificationService } from '../../services/notification-service.js'

export class SharesServiceError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'SharesServiceError'
    this.status = status
  }
}

export function createSharesService({ prisma, broadcaster, notificationService }) {
  const notifications = notificationService ?? createNotificationService({ prisma, broadcaster })
  async function _verifyAccess(noteId, userId) {
    const rows = await prisma.$queryRaw`
      SELECT id, company_id FROM notes
      WHERE id = ${noteId}
        AND deleted_at IS NULL AND public.runly_note_user_access(id, ${userId}::uuid, false)
        AND (
          owner_user_id = ${userId}
          OR EXISTS (
            SELECT 1 FROM note_shares
            WHERE note_shares.note_id = notes.id
              AND note_shares.shared_with_user_id = ${userId}
          )
        )
    `
    if (!rows.length) throw new SharesServiceError('Nota no encontrada', 404)
    return rows[0]
  }

  async function _verifyOwner(noteId, userId) {
    const rows = await prisma.$queryRaw`
      SELECT id, company_id FROM notes
      WHERE id = ${noteId} AND owner_user_id = ${userId} AND deleted_at IS NULL AND public.runly_note_user_access(id, ${userId}::uuid, false)
    `
    if (!rows.length) throw new SharesServiceError('No tienes permiso para realizar esta acción', 403)
    return rows[0]
  }

  async function listShares(noteId, userId) {
    await _verifyAccess(noteId, userId)
    const ownerRows = await prisma.$queryRaw`
      SELECT id, company_id FROM notes WHERE id = ${noteId} AND owner_user_id = ${userId}
    `
    const isOwner = ownerRows.length > 0
    const rows = await prisma.$queryRaw`
      SELECT
        ns.*,
        up.display_name,
        up.avatar_file_id
      FROM note_shares ns
      JOIN user_profile up ON ns.shared_with_user_id = up.id
      WHERE ns.note_id = ${noteId}
    `
    // Email is only exposed to the note owner (who manages the share list).
    if (!isOwner) return rows
    const emails = await prisma.$queryRaw`
      SELECT ns.id, up.email
      FROM note_shares ns
      JOIN user_profile up ON ns.shared_with_user_id = up.id
      WHERE ns.note_id = ${noteId}
    `
    const emailById = new Map(emails.map((r) => [r.id, r.email]))
    return rows.map((r) => ({ ...r, user_email: emailById.get(r.id) ?? null }))
  }

  async function listShareableUsers(actorUserId, search, companyId) {
    const users = await createUserAccessService({ prisma }).listCandidates({ actorId: actorUserId, companyId, search, permission: 'notes.notes.read' })
    return users.filter((u) => u.id !== actorUserId)
  }

  async function shareNote(noteId, userId, { targetUserId, permission }) {
    const note = await _verifyOwner(noteId, userId)
    if (!targetUserId || targetUserId === userId) throw new SharesServiceError("Usuario destino invalido", 400)
    if (!['read', 'edit'].includes(permission)) {
      throw new SharesServiceError("El permiso debe ser 'read' o 'edit'")
    }
    await createUserAccessService({ prisma }).assertCandidates({ companyId: note.company_id, userIds: [targetUserId], permission: 'notes.notes.read' })
    const rows = await prisma.$queryRaw`
      INSERT INTO note_shares (note_id, shared_with_user_id, shared_by_user_id, permission)
      VALUES (${noteId}, ${targetUserId}, ${userId}, ${permission}::text)
      ON CONFLICT (note_id, shared_with_user_id)
      DO UPDATE SET
        permission = EXCLUDED.permission,
        shared_by_user_id = EXCLUDED.shared_by_user_id
      RETURNING *
    `
    const share = rows[0]
    try {
      const [context] = await prisma.$queryRaw`
        SELECT title, company_id FROM notes WHERE id = ${noteId}
      `
      if (context?.company_id) {
        await notifications.publish({
          companyId: context.company_id,
          actorId: userId,
          input: {
            eventType: 'notes.note.shared',
            title: 'Compartieron una nota contigo',
            body: `Ahora puedes ${permission === 'edit' ? 'editar' : 'leer'} "${context.title || 'Nota sin título'}"`.slice(0, 1000),
            link: `/app/m/runly.notes?note=${noteId}`,
            recipients: { userIds: [targetUserId] },
            channels: ['in_app', 'email', 'web_push'],
            sourceType: 'Note',
            sourceId: noteId,
            metadata: { noteId, permission },
          },
        })
      }
    } catch (err) {
      console.error('[notes.note.shared]', err?.message ?? err)
    }
    if (broadcaster) {
      try {
        await broadcaster.broadcastToUser(targetUserId, 'notes.note.shared', {
          noteId,
          permission,
          sharedBy: userId,
        })
      } catch (err) {
        console.warn('[shares-service] broadcast error:', err?.message)
      }
    }
    return share
  }

  async function updateShare(shareId, userId, { permission }) {
    if (!['read', 'edit'].includes(permission)) {
      throw new SharesServiceError("El permiso debe ser 'read' o 'edit'")
    }
    const check = await prisma.$queryRaw`
      SELECT ns.id FROM note_shares ns
      JOIN notes ON ns.note_id = notes.id
      WHERE ns.id = ${shareId} AND notes.owner_user_id = ${userId} AND public.runly_note_user_access(notes.id, ${userId}::uuid, true)
    `
    if (!check.length) throw new SharesServiceError('No tienes permiso para realizar esta acción', 403)
    const rows = await prisma.$queryRaw`
      UPDATE note_shares SET permission = ${permission}::text WHERE id = ${shareId} RETURNING *
    `
    return rows[0]
  }

  async function revokeShare(shareId, userId) {
    const check = await prisma.$queryRaw`
      SELECT ns.id FROM note_shares ns
      JOIN notes ON ns.note_id = notes.id
      WHERE ns.id = ${shareId} AND notes.owner_user_id = ${userId} AND public.runly_note_user_access(notes.id, ${userId}::uuid, true)
    `
    if (!check.length) throw new SharesServiceError('No tienes permiso para realizar esta acción', 403)
    await prisma.$queryRaw`
      DELETE FROM note_shares
      WHERE id = ${shareId}
        AND note_id IN (SELECT id FROM notes WHERE owner_user_id = ${userId})
    `
    return { ok: true }
  }

  async function publishNote(noteId, userId) {
    const rows = await prisma.$queryRaw`
      SELECT id, is_public, public_slug FROM notes
      WHERE id = ${noteId} AND owner_user_id = ${userId} AND deleted_at IS NULL AND public.runly_note_user_access(id, ${userId}::uuid, false)
    `
    if (!rows.length) throw new SharesServiceError('No tienes permiso para realizar esta acción', 403)
    const existing = rows[0]
    if (!existing.is_public || !existing.public_slug) {
      const slug = randomBytes(8).toString('base64url')
      await prisma.$executeRaw`
        UPDATE notes SET is_public = true, public_slug = ${slug}
        WHERE id = ${noteId} AND owner_user_id = ${userId}
      `
    }
    const updated = await prisma.$queryRaw`
      SELECT * FROM notes WHERE id = ${noteId}
    `
    return updated[0]
  }

  async function unpublishNote(noteId, userId) {
    const rows = await prisma.$queryRaw`
      SELECT id, company_id FROM notes
      WHERE id = ${noteId} AND owner_user_id = ${userId} AND deleted_at IS NULL AND public.runly_note_user_access(id, ${userId}::uuid, false)
    `
    if (!rows.length) throw new SharesServiceError('No tienes permiso para realizar esta acción', 403)
    await prisma.$executeRaw`
      UPDATE notes SET is_public = false, public_slug = NULL
      WHERE id = ${noteId} AND owner_user_id = ${userId}
    `
    const updated = await prisma.$queryRaw`
      SELECT * FROM notes WHERE id = ${noteId}
    `
    return updated[0]
  }

  async function getPublicNote(slug) {
    // Public endpoint (no auth) — expose only render-safe fields, never internal
    // identifiers (company_id, owner_user_id, folder_id) or workflow flags.
    const rows = await prisma.$queryRaw`
      SELECT
        notes.id,
        notes.note_type,
        notes.title,
        notes.content,
        notes.content_text,
        notes.icon,
        notes.cover_url,
        notes.background_color,
        notes.background_image_url,
        notes.paper_style,
        notes.paper_margin,
        notes.paper_texture,
        notes.paper_shadow,
        notes.show_public_collaborators,
        notes.word_count,
        notes.public_slug,
        notes.created_at,
        notes.updated_at,
        up.display_name AS author_name,
        up.avatar_file_id AS author_avatar_file_id
      FROM notes
      JOIN user_profile up ON notes.owner_user_id = up.id
      WHERE notes.public_slug = ${slug}
        AND notes.is_public = true AND public.notes_realtime_is_public(notes.id)
        AND notes.deleted_at IS NULL
        AND notes.is_trashed = false
    `
    if (!rows.length) throw new SharesServiceError('Nota no encontrada', 404)
    const note = rows[0]
    if (note.show_public_collaborators === false) return { ...note, collaborators: [] }
    // Collaborators footer for the public page: owner + everyone the note is
    // shared with. Display name only — email and avatar file ids stay
    // internal, this is rendered to anonymous visitors.
    const collaborators = await prisma.$queryRaw`
      SELECT up.display_name, true AS is_owner, NULL::text AS permission
      FROM notes n
      JOIN user_profile up ON up.id = n.owner_user_id
      WHERE n.id = ${note.id}
      UNION ALL
      SELECT up.display_name, false AS is_owner, ns.permission
      FROM note_shares ns
      JOIN user_profile up ON up.id = ns.shared_with_user_id
      WHERE ns.note_id = ${note.id}
      ORDER BY is_owner DESC, display_name ASC
    `
    return { ...note, collaborators }
  }

  return { listShares, listShareableUsers, shareNote, updateShare, revokeShare, publishNote, unpublishNote, getPublicNote }
}
