// Permanently deletes a Board — the only kind of delete `DELETE
// /canvas/boards/:id` performs now (archiving was removed; see the
// 2026-10-02 canvas-delete-rename spec). Kept in its own module so
// canvas-service.js (already near the 800-line soft limit) does not grow.
//
// Every Prisma-managed child row cascades from `canvasBoard.delete` (pages,
// layers, objects, hotspots, entity links, attachments, versions,
// collaborators — see the `onDelete: Cascade` relations in
// prisma/schema.prisma), but two tables are *not* FK-related to CanvasBoard
// and must be cleaned up explicitly: `entity_comment` (comments on the Board
// itself or any of its hotspots) and `module_public_link` (read-only public
// links, scoped by moduleKey + recordId, see canvas-public.js's `scope()`).
//
// Files uploaded for the Board or its hotspots are identified the same way
// the rest of runly.canvas does (see canvas-files.js): FileAsset.entityId is
// the companyId, and metadata.sourceEntityId carries the Board or hotspot
// id. A file still referenced by a library item's payload (an object or
// image a user copied into a personal/company library) is kept, so
// deleting the Board it came from does not break the library.
function jsonValue(value) {
  if (value == null) return null
  return JSON.parse(JSON.stringify(value))
}

export function createCanvasBoardDeletion({ prisma, canvas, removeFiles }) {
  // One raw query per candidate file id, exactly as the plan calls for: does
  // any library item's JSON payload (company-scoped through canvas_library)
  // mention this file id as a substring? Library image items reference
  // their file through a dedicated column, not payload, but those files
  // live under entityType 'CanvasLibrary' and never reach this candidate
  // set; this only guards against a Board file embedded in an 'objects'-kind
  // library item snapshot.
  async function findLibraryReferencedIds(tx, companyId, fileIds) {
    const referenced = new Set()
    for (const fileId of fileIds) {
      const rows = await tx.$queryRaw`
        SELECT li.id
        FROM canvas_library_item li
        JOIN canvas_library l ON l.id = li.library_id
        WHERE l.company_id = ${companyId}::uuid
          AND li.payload IS NOT NULL
          AND li.payload::text LIKE ${'%' + fileId + '%'}
        LIMIT 1
      `
      if (rows.length) referenced.add(fileId)
    }
    return referenced
  }

  async function deleteBoard(companyId, actorId, boardId) {
    // OWNER-only, same ACL as the API route; includeArchived so an already
    // archived Board (a leftover from before archiving was retired) can
    // still be deleted.
    const { board } = await canvas.assertBoardAccess(companyId, actorId, boardId, 'OWNER', prisma, { includeArchived: true })

    const [pageCount, objectCount, hotspots] = await Promise.all([
      prisma.canvasPage.count({ where: { boardId } }),
      prisma.canvasObject.count({ where: { boardId } }),
      prisma.canvasHotspot.findMany({ where: { boardId }, select: { id: true } }),
    ])
    const hotspotIds = hotspots.map((row) => row.id)

    const candidateFiles = await prisma.fileAsset.findMany({
      where: {
        moduleKey: 'runly.canvas', entityId: companyId, entityType: { in: ['CanvasBoard', 'CanvasThumbnail', 'CanvasHotspot'] },
        OR: [
          { metadata: { path: ['sourceEntityId'], equals: boardId } },
          ...hotspotIds.map((hotspotId) => ({ metadata: { path: ['sourceEntityId'], equals: hotspotId } })),
        ],
      },
      select: { id: true },
    })
    const candidateIds = candidateFiles.map((row) => row.id)

    // Rows go first, inside one transaction; the keep-list of file ids comes
    // back out so storage/FileAsset cleanup can happen after (removeFiles
    // talks to Supabase Storage and must not be part of the DB transaction).
    const fileIds = await prisma.$transaction(async (tx) => {
      const libraryReferenced = await findLibraryReferencedIds(tx, companyId, candidateIds)
      const keep = candidateIds.filter((fileId) => !libraryReferenced.has(fileId))

      await tx.entityComment.deleteMany({ where: { companyId, entityType: 'CanvasBoard', entityId: boardId } })
      if (hotspotIds.length) await tx.entityComment.deleteMany({ where: { companyId, entityType: 'CanvasHotspot', entityId: { in: hotspotIds } } })
      await tx.modulePublicLink.deleteMany({ where: { companyId, moduleKey: 'runly.canvas', recordId: boardId } })

      await tx.canvasBoard.delete({ where: { id: boardId } })

      await tx.auditLog.create({
        data: {
          companyId, actorId, moduleKey: 'runly.canvas', action: 'BOARD_DELETED', entityType: 'CanvasBoard', entityId: boardId,
          before: jsonValue({ name: board.name, templateType: board.templateType }),
          metadata: jsonValue({ pages: pageCount, objects: objectCount, hotspots: hotspotIds.length, files: keep.length }),
        },
      })
      return keep
    })

    if (!fileIds.length) return

    try {
      await removeFiles({ id: { in: fileIds } })
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.warn('[runly.canvas] board file cleanup failed', error?.message)
      // Storage failed but the Board rows are already gone — disable the
      // file rows instead of leaving them pointing at a deleted Board.
      await prisma.fileAsset.updateMany({ where: { id: { in: fileIds } }, data: { enabled: false } })
    }
  }

  return { deleteBoard }
}
