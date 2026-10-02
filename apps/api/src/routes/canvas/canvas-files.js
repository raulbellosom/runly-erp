// Files that Canvas uploads through runly.files. Files stores
// entityId = companyId and keeps the Canvas entity (Board, library) in
// metadata.sourceEntityId, so ownership checks go through that field.
export const THUMBNAIL_ENTITY_TYPE = 'CanvasThumbnail'
const LEGACY_THUMBNAIL_NAME = 'miniatura.png'

export function canvasFileWhere(companyId, entityType, sourceId) {
  return { enabled: true, moduleKey: 'runly.canvas', entityType, entityId: companyId, metadata: { path: ['sourceEntityId'], equals: sourceId } }
}

// Every thumbnail of a Board except `keepId`, including the ones uploaded
// before thumbnails had their own entity type (CanvasBoard + legacy name).
export function staleThumbnailsWhere(companyId, boardId, keepId) {
  return {
    moduleKey: 'runly.canvas', entityId: companyId, id: { not: keepId },
    metadata: { path: ['sourceEntityId'], equals: boardId },
    OR: [{ entityType: THUMBNAIL_ENTITY_TYPE }, { entityType: 'CanvasBoard', originalName: LEGACY_THUMBNAIL_NAME }],
  }
}

// Removes file rows and their storage objects for real (thumbnails are
// derived data: keeping old ones only clutters Files and storage).
export function createCanvasFileRemover({ prisma, supabaseAdmin }) {
  return async function removeFiles(where) {
    const rows = await prisma.fileAsset.findMany({ where, select: { id: true, bucket: true, objectKey: true } })
    if (!rows.length) return 0
    const byBucket = new Map()
    for (const row of rows) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.objectKey])
    for (const [bucket, keys] of byBucket) await supabaseAdmin.storage.from(bucket).remove(keys)
    await prisma.fileAsset.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
    return rows.length
  }
}
