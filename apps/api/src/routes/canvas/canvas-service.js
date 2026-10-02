import { effectiveBoardSettings, normalizeBoardSettings, templateFor, templateLayerRows } from './canvas-templates.js'

const ROLE_RANK = { VIEWER: 1, COMMENTER: 2, EDITOR: 3, OWNER: 4 }
const LAYER_TYPES = new Set(['vector', 'hotspot', 'data'])
const OBJECT_TYPES = new Set(['line', 'polyline', 'freehand', 'arrow', 'rectangle', 'ellipse', 'polygon', 'path', 'text', 'image', 'group', 'hotspot'])
const TARGET_TYPES = new Set(['BOARD', 'PAGE', 'OBJECT', 'HOTSPOT'])

export class CanvasServiceError extends Error {
  constructor(message, status = 500, code = null) {
    super(message)
    this.name = 'CanvasServiceError'
    this.status = status
    this.code = code
  }
}

function cleanText(value, max = 5000) {
  if (value == null) return null
  return String(value).trim().slice(0, max) || null
}

function jsonValue(value) {
  if (value == null) return null
  return JSON.parse(JSON.stringify(value))
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value) }

// Settings errors from the catalog surface as regular 400 service errors.
function boardSettings(input, base) {
  try { return normalizeBoardSettings(input, base) } catch (error) { throw new CanvasServiceError(error.message, 400) }
}

export function validateCanvasObject(data, { partial = false } = {}) {
  if (!partial || data.type !== undefined) {
    if (!OBJECT_TYPES.has(data.type)) throw new CanvasServiceError('Tipo de objeto no soportado.', 400)
  }
  if (!partial || data.transform !== undefined) {
    const transform = data.transform ?? {}
    for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) {
      if (transform[key] !== undefined && !finite(transform[key])) throw new CanvasServiceError(`Transformación inválida: ${key}.`, 400)
    }
  }
  if (!partial || data.geometry !== undefined) {
    const geometry = data.geometry ?? {}
    const type = data.type
    if (geometry.width !== undefined && (!finite(geometry.width) || geometry.width < 0)) throw new CanvasServiceError('La geometría requiere width válido.', 400)
    if (geometry.height !== undefined && (!finite(geometry.height) || geometry.height < 0)) throw new CanvasServiceError('La geometría requiere height válido.', 400)
    if (geometry.points !== undefined && (!Array.isArray(geometry.points) || geometry.points.length > 10000 || geometry.points.some((point) => !finite(point?.x) || !finite(point?.y)))) throw new CanvasServiceError('La geometría de puntos no es válida.', 400)
    if (['rectangle', 'ellipse', 'image', 'text', 'hotspot'].includes(type)) {
      if (!finite(geometry.width) || !finite(geometry.height) || geometry.width < 0 || geometry.height < 0) throw new CanvasServiceError('La geometría requiere width/height válidos.', 400)
    }
    if (['line', 'arrow'].includes(type) && (!finite(geometry.x2) || !finite(geometry.y2))) throw new CanvasServiceError('La línea requiere x2/y2 válidos.', 400)
    if (['polyline', 'freehand', 'polygon', 'path'].includes(type)) {
      if (!Array.isArray(geometry.points) || geometry.points.length < 2 || geometry.points.length > 10000 || geometry.points.some((point) => !finite(point?.x) || !finite(point?.y))) {
        throw new CanvasServiceError('La geometría de puntos no es válida.', 400)
      }
    }
  }
  return true
}

function objectPatch(data, actorId) {
  const allowed = ['type', 'position', 'transform', 'geometry', 'style', 'properties', 'metadata', 'layerId']
  const patch = { updatedById: actorId, revision: { increment: 1 } }
  for (const key of allowed) {
    if (data[key] !== undefined) patch[key] = data[key]
  }
  validateCanvasObject(data, { partial: true })
  return patch
}

export function createCanvasService({ prisma, entityResolver = null }) {
  async function audit(db, { companyId, actorId, action, entityType, entityId, before = null, after = null, metadata = null }) {
    return db.auditLog.create({ data: { companyId, actorId, moduleKey: 'runly.canvas', action, entityType, entityId, before: jsonValue(before), after: jsonValue(after), metadata: jsonValue(metadata) } })
  }

  async function assertBoardAccess(companyId, actorId, boardId, minRole = 'VIEWER', db = prisma, { includeArchived = false } = {}) {
    if (!companyId || !actorId || !boardId) throw new CanvasServiceError('Board no encontrado.', 404)
    const board = await db.canvasBoard.findFirst({
      where: { id: boardId, companyId, ...(includeArchived ? {} : { archivedAt: null }) },
      include: { collaborators: { where: { userId: actorId }, select: { role: true } } },
    })
    if (!board) throw new CanvasServiceError('Board no encontrado.', 404)
    const role = board.ownerId === actorId ? 'OWNER' : board.collaborators[0]?.role
    if (!role) throw new CanvasServiceError('Board no encontrado.', 404)
    if ((ROLE_RANK[role] ?? 0) < (ROLE_RANK[minRole] ?? 1)) {
      throw new CanvasServiceError('No tienes acceso suficiente a este Board.', 403)
    }
    return { board, role }
  }

  // Each board carries the caller's role (`myRole`) so the UI can switch to
  // read-only for VIEWER/COMMENTER without another request.
  async function listBoards(companyId, actorId) {
    const rows = await prisma.canvasBoard.findMany({
      where: { companyId, archivedAt: null, OR: [{ ownerId: actorId }, { collaborators: { some: { userId: actorId } } }] },
      include: { _count: { select: { pages: true, collaborators: true } }, collaborators: { where: { userId: actorId }, select: { role: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map(({ collaborators, ...board }) => ({ ...board, myRole: board.ownerId === actorId ? 'OWNER' : collaborators[0]?.role ?? 'VIEWER' }))
  }

  async function getBoard(companyId, actorId, boardId) {
    const { role } = await assertBoardAccess(companyId, actorId, boardId)
    const board = await prisma.canvasBoard.findFirst({
      where: { id: boardId, companyId },
      include: {
        pages: { include: { layers: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } },
        collaborators: { orderBy: { createdAt: 'asc' } },
      },
    })
    return board ? { ...board, myRole: role, effectiveSettings: effectiveBoardSettings(board) } : board
  }

  async function createBoard(companyId, actorId, data) {
    const name = cleanText(data?.name, 200)
    if (!name) throw new CanvasServiceError('El nombre del Board es requerido.', 400)
    const template = templateFor(data?.templateType)
    const settings = boardSettings(data?.settings, template.settings)
    return prisma.$transaction(async (tx) => {
      const board = await tx.canvasBoard.create({ data: {
        companyId, ownerId: actorId, createdById: actorId, updatedById: actorId, name,
        description: cleanText(data?.description), templateType: template.key,
        settings, metadata: data?.metadata ?? {},
      } })
      await tx.canvasCollaborator.create({ data: { boardId: board.id, userId: actorId, role: 'OWNER', createdBy: actorId } })
      const page = await tx.canvasPage.create({ data: {
        boardId: board.id, name: 'Página 1', position: 0, infinite: data?.infinite !== false,
        coordinateSystem: { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' },
        background: data?.background ?? null,
      } })
      await tx.canvasLayer.createMany({ data: templateLayerRows(template, page.id) })
      await audit(tx, { companyId, actorId, action: 'BOARD_CREATED', entityType: 'CanvasBoard', entityId: board.id, after: board })
      return board
    })
  }

  async function updateBoard(companyId, actorId, boardId, data) {
    const { board } = await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const patch = { updatedById: actorId }
    if (data.name !== undefined) {
      patch.name = cleanText(data.name, 200)
      if (!patch.name) throw new CanvasServiceError('El nombre del Board es requerido.', 400)
    }
    for (const key of ['description', 'metadata', 'thumbnailFileId']) {
      if (data[key] !== undefined) patch[key] = key === 'description' ? cleanText(data[key]) : data[key]
    }
    if (data.settings !== undefined) patch.settings = boardSettings(data.settings, effectiveBoardSettings(board))
    const updated = await prisma.canvasBoard.update({ where: { id: boardId }, data: patch })
    await audit(prisma, { companyId, actorId, action: 'BOARD_UPDATED', entityType: 'CanvasBoard', entityId: boardId, before: board, after: updated })
    return updated
  }

  async function archiveBoard(companyId, actorId, boardId) {
    const { board } = await assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    const updated = await prisma.canvasBoard.update({ where: { id: boardId }, data: { archivedAt: new Date(), updatedById: actorId } })
    await audit(prisma, { companyId, actorId, action: 'BOARD_ARCHIVED', entityType: 'CanvasBoard', entityId: boardId, before: board, after: updated })
    return updated
  }

  async function createPage(companyId, actorId, boardId, data) {
    const { board } = await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    return prisma.$transaction(async (tx) => {
      const last = await tx.canvasPage.findFirst({ where: { boardId }, orderBy: { position: 'desc' }, select: { position: true } })
      const page = await tx.canvasPage.create({ data: {
        boardId, name: cleanText(data?.name, 200) ?? 'Página', position: (last?.position ?? -1) + 1,
        width: data?.width ?? null, height: data?.height ?? null, infinite: data?.infinite !== false,
        background: data?.background ?? null,
        coordinateSystem: data?.coordinateSystem ?? { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' },
        calibration: data?.calibration ?? null, metadata: data?.metadata ?? {},
      } })
      await tx.canvasLayer.createMany({ data: templateLayerRows(templateFor(board.templateType), page.id) })
      return page
    })
  }

  async function updatePage(companyId, actorId, boardId, pageId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const page = await prisma.canvasPage.findFirst({ where: { id: pageId, boardId } })
    if (!page) throw new CanvasServiceError('Página no encontrada.', 404)
    const patch = {}
    for (const key of ['name', 'width', 'height', 'infinite', 'background', 'coordinateSystem', 'calibration', 'metadata']) {
      if (data[key] !== undefined) patch[key] = key === 'name' ? cleanText(data[key], 200) : data[key]
    }
    return prisma.canvasPage.update({ where: { id: pageId }, data: patch })
  }

  async function deletePage(companyId, actorId, boardId, pageId) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const pages = await prisma.canvasPage.findMany({ where: { boardId }, orderBy: { position: 'asc' }, select: { id: true } })
    if (!pages.some((page) => page.id === pageId)) throw new CanvasServiceError('Página no encontrada.', 404)
    if (pages.length === 1) throw new CanvasServiceError('Un Board debe conservar al menos una página.', 409)
    return prisma.$transaction(async (tx) => {
      await tx.canvasPage.delete({ where: { id: pageId } })
      const remaining = pages.filter((page) => page.id !== pageId)
      for (let index = 0; index < remaining.length; index += 1) await tx.canvasPage.update({ where: { id: remaining[index].id }, data: { position: -100000 - index } })
      for (let index = 0; index < remaining.length; index += 1) await tx.canvasPage.update({ where: { id: remaining[index].id }, data: { position: index } })
    })
  }

  async function createLayer(companyId, actorId, boardId, pageId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    if (!LAYER_TYPES.has(data?.type ?? 'vector')) throw new CanvasServiceError('Tipo de capa no soportado.', 400)
    const page = await prisma.canvasPage.findFirst({ where: { id: pageId, boardId }, select: { id: true } })
    if (!page) throw new CanvasServiceError('Página no encontrada.', 404)
    const last = await prisma.canvasLayer.findFirst({ where: { pageId }, orderBy: { position: 'desc' }, select: { position: true } })
    return prisma.canvasLayer.create({ data: {
      pageId, name: cleanText(data?.name, 200) ?? 'Capa', type: data?.type ?? 'vector', position: (last?.position ?? -1) + 1,
      visible: data?.visible !== false, locked: Boolean(data?.locked), opacity: data?.opacity ?? 1, metadata: data?.metadata ?? {},
    } })
  }

  async function updateLayer(companyId, actorId, boardId, pageId, layerId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const layer = await prisma.canvasLayer.findFirst({ where: { id: layerId, pageId, page: { boardId } } })
    if (!layer) throw new CanvasServiceError('Capa no encontrada.', 404)
    const patch = {}
    for (const key of ['name', 'visible', 'locked', 'opacity', 'metadata']) if (data[key] !== undefined) patch[key] = key === 'name' ? cleanText(data[key], 200) : data[key]
    if (patch.opacity != null && (patch.opacity < 0 || patch.opacity > 1)) throw new CanvasServiceError('La opacidad debe estar entre 0 y 1.', 400)
    return prisma.canvasLayer.update({ where: { id: layerId }, data: patch })
  }

  async function deleteLayer(companyId, actorId, boardId, pageId, layerId) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const layer = await prisma.canvasLayer.findFirst({ where: { id: layerId, pageId, page: { boardId } }, include: { _count: { select: { objects: true } } } })
    if (!layer) throw new CanvasServiceError('Capa no encontrada.', 404)
    if (layer._count.objects) throw new CanvasServiceError('Mueve o elimina los objetos de la capa antes de borrarla.', 409)
    await prisma.canvasLayer.delete({ where: { id: layerId } })
  }

  async function reorderLayers(companyId, actorId, boardId, pageId, layerIds) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const layers = await prisma.canvasLayer.findMany({ where: { pageId, page: { boardId } }, select: { id: true } })
    const existing = new Set(layers.map((layer) => layer.id))
    if (layerIds.length !== existing.size || layerIds.some((id) => !existing.has(id)) || new Set(layerIds).size !== layerIds.length) {
      throw new CanvasServiceError('El orden de capas no es válido.', 400)
    }
    return prisma.$transaction(async (tx) => {
      for (let i = 0; i < layerIds.length; i += 1) {
        await tx.canvasLayer.update({ where: { id: layerIds[i] }, data: { position: -100000 - i } })
      }
      for (let i = 0; i < layerIds.length; i += 1) {
        await tx.canvasLayer.update({ where: { id: layerIds[i] }, data: { position: i } })
      }
      return tx.canvasLayer.findMany({ where: { pageId }, orderBy: { position: 'asc' } })
    })
  }

  async function listObjects(companyId, actorId, boardId, { pageId = null, layerId = null } = {}) {
    await assertBoardAccess(companyId, actorId, boardId)
    return prisma.canvasObject.findMany({
      where: { companyId, boardId, deletedAt: null, ...(pageId ? { pageId } : {}), ...(layerId ? { layerId } : {}) },
      // Hotspot metadata travels with its object so the editor can label pins
      // and open the hotspot sheet without an extra round trip per pin.
      include: { hotspot: true },
      orderBy: [{ layerId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async function batchObjects(companyId, actorId, boardId, operations) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) {
      throw new CanvasServiceError('El lote debe contener entre 1 y 500 operaciones.', 400)
    }
    return prisma.$transaction(async (tx) => {
      const results = []
      // A stale or missing row is reported with its current server state
      // (null = gone) instead of aborting the whole batch.
      const currentRow = (id) => tx.canvasObject.findFirst({ where: { id, companyId, boardId, deletedAt: null }, include: { hotspot: true } })
      const conflict = async (id) => results.push({ op: 'conflict', id, object: await currentRow(id) })
      for (const operation of operations) {
        if (operation.op === 'create') {
          const data = operation.data ?? {}
          validateCanvasObject(data)
          const layer = await tx.canvasLayer.findFirst({ where: { id: data.layerId, pageId: data.pageId, page: { boardId } }, select: { id: true } })
          if (!layer) throw new CanvasServiceError('Capa no encontrada.', 404)
          const row = await tx.canvasObject.create({ data: {
            companyId, boardId, pageId: data.pageId, layerId: data.layerId, type: data.type, position: data.position ?? 0,
            transform: data.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, geometry: data.geometry ?? {},
            style: data.style ?? {}, properties: data.properties ?? {}, metadata: data.metadata ?? {},
            createdById: actorId, updatedById: actorId,
          } })
          results.push({ op: 'create', clientId: operation.clientId ?? null, object: row })
        } else if (operation.op === 'update') {
          const expectedRevision = Number(operation.expectedRevision)
          if (!operation.id || !Number.isInteger(expectedRevision)) throw new CanvasServiceError('La revisión esperada es requerida.', 400)
          if (operation.data?.layerId) {
            const current = await tx.canvasObject.findFirst({ where: { id: operation.id, companyId, boardId, deletedAt: null }, select: { pageId: true } })
            if (!current) { await conflict(operation.id); continue }
            const layer = await tx.canvasLayer.findFirst({ where: { id: operation.data.layerId, pageId: current.pageId, page: { boardId } }, select: { id: true } })
            if (!layer) throw new CanvasServiceError('Capa no encontrada.', 404)
          }
          const changed = await tx.canvasObject.updateMany({
            where: { id: operation.id, companyId, boardId, deletedAt: null, revision: expectedRevision },
            data: objectPatch(operation.data ?? {}, actorId),
          })
          if (changed.count !== 1) { await conflict(operation.id); continue }
          results.push({ op: 'update', object: await tx.canvasObject.findFirst({ where: { id: operation.id, companyId, boardId } }) })
        } else if (operation.op === 'delete') {
          const expectedRevision = Number(operation.expectedRevision)
          const changed = await tx.canvasObject.updateMany({
            where: { id: operation.id, companyId, boardId, deletedAt: null, ...(Number.isInteger(expectedRevision) ? { revision: expectedRevision } : {}) },
            data: { deletedAt: new Date(), updatedById: actorId, revision: { increment: 1 } },
          })
          if (changed.count !== 1) { await conflict(operation.id); continue }
          results.push({ op: 'delete', id: operation.id })
        } else if (operation.op === 'restore') {
          // Undo of a delete (or redo of a create) brings back the same row, so
          // its hotspot, entity links, attachments and comments survive.
          const changed = await tx.canvasObject.updateMany({
            where: { id: operation.id, companyId, boardId, deletedAt: { not: null } },
            data: { deletedAt: null, updatedById: actorId, revision: { increment: 1 } },
          })
          if (changed.count !== 1) { await conflict(operation.id); continue }
          results.push({ op: 'restore', object: await tx.canvasObject.findFirst({ where: { id: operation.id, companyId, boardId }, include: { hotspot: true } }) })
        } else {
          throw new CanvasServiceError('Operación de objeto no soportada.', 400)
        }
      }
      await tx.canvasBoard.update({ where: { id: boardId }, data: { updatedById: actorId, updatedAt: new Date() } })
      return results
    })
  }

  async function createHotspot(companyId, actorId, boardId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const title = cleanText(data?.title, 300)
    if (!title) throw new CanvasServiceError('El título del hotspot es requerido.', 400)
    const object = await prisma.canvasObject.findFirst({ where: { id: data.objectId, companyId, boardId, deletedAt: null } })
    if (!object) throw new CanvasServiceError('Objeto no encontrado.', 404)
    if (object.type !== 'hotspot') throw new CanvasServiceError('El objeto debe ser de tipo hotspot.', 400)
    return prisma.$transaction(async (tx) => {
      const hotspot = await tx.canvasHotspot.create({ data: {
        companyId, boardId, objectId: object.id, title, description: cleanText(data.description), icon: cleanText(data.icon, 100),
        color: cleanText(data.color, 20), status: cleanText(data.status, 50) ?? 'ACTIVE', tags: data.tags ?? [],
        customFields: data.customFields ?? {}, metadata: data.metadata ?? {}, createdById: actorId, updatedById: actorId,
      } })
      await audit(tx, { companyId, actorId, action: 'HOTSPOT_CREATED', entityType: 'CanvasHotspot', entityId: hotspot.id, after: hotspot })
      return hotspot
    })
  }

  async function updateHotspot(companyId, actorId, boardId, hotspotId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const existing = await prisma.canvasHotspot.findFirst({ where: { id: hotspotId, companyId, boardId, archivedAt: null } })
    if (!existing) throw new CanvasServiceError('Hotspot no encontrado.', 404)
    const patch = { updatedById: actorId }
    for (const key of ['title', 'description', 'icon', 'color', 'status', 'tags', 'customFields', 'metadata']) {
      if (data[key] !== undefined) patch[key] = ['title', 'description', 'icon', 'color', 'status'].includes(key) ? cleanText(data[key], key === 'description' ? 5000 : 300) : data[key]
    }
    if (data.title !== undefined && !patch.title) throw new CanvasServiceError('El título del hotspot es requerido.', 400)
    const row = await prisma.canvasHotspot.update({ where: { id: hotspotId }, data: patch })
    await audit(prisma, { companyId, actorId, action: 'HOTSPOT_UPDATED', entityType: 'CanvasHotspot', entityId: hotspotId, before: existing, after: row })
    return row
  }

  async function deleteHotspot(companyId, actorId, boardId, hotspotId) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const existing = await prisma.canvasHotspot.findFirst({ where: { id: hotspotId, companyId, boardId, archivedAt: null } })
    if (!existing) throw new CanvasServiceError('Hotspot no encontrado.', 404)
    return prisma.$transaction(async (tx) => {
      await tx.canvasHotspot.update({ where: { id: hotspotId }, data: { archivedAt: new Date(), updatedById: actorId } })
      await tx.canvasObject.updateMany({ where: { id: existing.objectId, companyId, boardId, deletedAt: null }, data: { deletedAt: new Date(), updatedById: actorId, revision: { increment: 1 } } })
      await audit(tx, { companyId, actorId, action: 'HOTSPOT_DELETED', entityType: 'CanvasHotspot', entityId: hotspotId, before: existing })
    })
  }

  async function assertCanvasTarget(boardId, targetType, targetId, db = prisma) {
    if (!TARGET_TYPES.has(targetType)) throw new CanvasServiceError('Destino Canvas no soportado.', 400)
    if (targetType === 'BOARD' && targetId === boardId) return
    const model = { PAGE: 'canvasPage', OBJECT: 'canvasObject', HOTSPOT: 'canvasHotspot' }[targetType]
    const row = await db[model].findFirst({ where: { id: targetId, boardId }, select: { id: true } })
    if (!row) throw new CanvasServiceError('Destino Canvas no encontrado.', 404)
  }

  async function createEntityLink(companyId, actorId, authUserId, boardId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    await assertCanvasTarget(boardId, data.targetType, data.targetId)
    if (!entityResolver) throw new CanvasServiceError('El tipo de entidad todavía no tiene un resolver autorizado.', 422)
    const resolved = await entityResolver({ authUserId, companyId, moduleKey: data.moduleKey, entityType: data.entityType, entityId: data.entityId })
    if (!resolved) throw new CanvasServiceError('La entidad vinculada no existe o no pertenece a la empresa activa.', 400)
    const link = await prisma.canvasEntityLink.create({ data: {
      companyId, boardId, targetType: data.targetType, targetId: data.targetId, moduleKey: data.moduleKey,
      entityType: data.entityType, entityId: data.entityId, relationType: data.relationType ?? 'related',
      metadata: { ...(data.metadata ?? {}), resolved }, createdById: actorId,
    } })
    await audit(prisma, { companyId, actorId, action: 'ENTITY_LINK_CREATED', entityType: 'CanvasEntityLink', entityId: link.id, after: link })
    return link
  }

  async function listEntityLinks(companyId, actorId, boardId, query = {}) {
    await assertBoardAccess(companyId, actorId, boardId)
    return prisma.canvasEntityLink.findMany({ where: { companyId, boardId, ...(query.targetType ? { targetType: query.targetType } : {}), ...(query.targetId ? { targetId: query.targetId } : {}) }, orderBy: { createdAt: 'asc' } })
  }

  async function removeEntityLink(companyId, actorId, boardId, linkId) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    const link = await prisma.canvasEntityLink.findFirst({ where: { id: linkId, companyId, boardId } })
    if (!link) throw new CanvasServiceError('Relación no encontrada.', 404)
    await prisma.canvasEntityLink.delete({ where: { id: linkId } })
    await audit(prisma, { companyId, actorId, action: 'ENTITY_LINK_REMOVED', entityType: 'CanvasEntityLink', entityId: linkId, before: link })
  }

  async function addCollaborator(companyId, actorId, boardId, data, assertCandidate) {
    const { board } = await assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    if (!['EDITOR', 'COMMENTER', 'VIEWER'].includes(data?.role)) throw new CanvasServiceError('Rol de colaborador no válido.', 400)
    if (!data?.userId) throw new CanvasServiceError('Indica a quién compartir el Board.', 400)
    if (data.userId === board.ownerId) throw new CanvasServiceError('El propietario ya tiene acceso total al Board.', 409)
    await assertCandidate(data.userId)
    const row = await prisma.canvasCollaborator.upsert({
      where: { boardId_userId: { boardId, userId: data.userId } },
      update: { role: data.role },
      create: { boardId, userId: data.userId, role: data.role, createdBy: actorId },
    })
    await audit(prisma, { companyId, actorId, action: 'BOARD_SHARED', entityType: 'CanvasBoard', entityId: boardId, metadata: { userId: data.userId, role: data.role } })
    return row
  }

  async function listCollaborators(companyId, actorId, boardId) {
    const { board } = await assertBoardAccess(companyId, actorId, boardId)
    const rows = await prisma.canvasCollaborator.findMany({ where: { boardId }, orderBy: { createdAt: 'asc' } })
    const ids = [...new Set([board.ownerId, ...rows.map((row) => row.userId)])]
    const profiles = await prisma.userProfile.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, email: true, avatarFileId: true } })
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    const people = rows.map((row) => ({ ...row, role: row.userId === board.ownerId ? 'OWNER' : row.role }))
    if (!people.some((row) => row.userId === board.ownerId)) people.unshift({ boardId, userId: board.ownerId, role: 'OWNER' })
    return people.map((row) => ({
      ...row,
      name: byId.get(row.userId)?.displayName ?? 'Usuario', email: byId.get(row.userId)?.email ?? null, avatarFileId: byId.get(row.userId)?.avatarFileId ?? null,
    }))
  }

  async function removeCollaborator(companyId, actorId, boardId, userId) {
    const { board } = await assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    if (board.ownerId === userId) throw new CanvasServiceError('No se puede eliminar al propietario del Board.', 409)
    await prisma.canvasCollaborator.deleteMany({ where: { boardId, userId } })
  }

  async function createVersion(companyId, actorId, boardId, data = {}) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    return prisma.$transaction(async (tx) => {
      const board = await tx.canvasBoard.findFirst({ where: { id: boardId, companyId } })
      const pages = await tx.canvasPage.findMany({ where: { boardId }, include: { layers: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } })
      const objects = await tx.canvasObject.findMany({ where: { boardId, companyId, deletedAt: null }, orderBy: { createdAt: 'asc' } })
      const hotspots = await tx.canvasHotspot.findMany({ where: { boardId, companyId, archivedAt: null } })
      const links = await tx.canvasEntityLink.findMany({ where: { boardId, companyId } })
      const last = await tx.canvasVersion.findFirst({ where: { boardId }, orderBy: { number: 'desc' }, select: { number: true } })
      const version = await tx.canvasVersion.create({ data: {
        boardId, number: (last?.number ?? 0) + 1, name: cleanText(data.name, 200), description: cleanText(data.description),
        snapshot: jsonValue({ schemaVersion: 1, board, pages, objects, hotspots, links }), objectCount: objects.length, createdById: actorId,
      } })
      await tx.canvasBoard.update({ where: { id: boardId }, data: { currentVersionId: version.id, updatedById: actorId } })
      await audit(tx, { companyId, actorId, action: 'BOARD_VERSION_CREATED', entityType: 'CanvasVersion', entityId: version.id, after: { number: version.number, objectCount: version.objectCount } })
      return version
    })
  }

  async function listVersions(companyId, actorId, boardId) {
    await assertBoardAccess(companyId, actorId, boardId)
    return prisma.canvasVersion.findMany({ where: { boardId }, select: { id: true, number: true, name: true, description: true, objectCount: true, createdById: true, restoredAt: true, createdAt: true }, orderBy: { number: 'desc' } })
  }

  async function restoreVersion(companyId, actorId, boardId, versionId) {
    await assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    return prisma.$transaction(async (tx) => {
      const version = await tx.canvasVersion.findFirst({ where: { id: versionId, boardId } })
      if (!version?.snapshot || version.snapshot.schemaVersion !== 1) throw new CanvasServiceError('Versión no encontrada o incompatible.', 404)
      const snapshot = version.snapshot
      await tx.canvasEntityLink.deleteMany({ where: { boardId, companyId } })
      await tx.canvasHotspot.deleteMany({ where: { boardId, companyId } })
      await tx.canvasObject.deleteMany({ where: { boardId, companyId } })
      await tx.canvasLayer.deleteMany({ where: { page: { boardId } } })
      await tx.canvasPage.deleteMany({ where: { boardId } })
      for (const page of snapshot.pages ?? []) {
        await tx.canvasPage.create({ data: {
          id: page.id, boardId, name: page.name, position: page.position, width: page.width, height: page.height,
          infinite: page.infinite, background: page.background, coordinateSystem: page.coordinateSystem,
          calibration: page.calibration, metadata: page.metadata,
        } })
        for (const layer of page.layers ?? []) {
          await tx.canvasLayer.create({ data: {
            id: layer.id, pageId: page.id, name: layer.name, type: layer.type, position: layer.position,
            visible: layer.visible, locked: layer.locked, opacity: layer.opacity, metadata: layer.metadata,
          } })
        }
      }
      for (const object of snapshot.objects ?? []) {
        await tx.canvasObject.create({ data: {
          id: object.id, companyId, boardId, pageId: object.pageId, layerId: object.layerId, type: object.type,
          position: object.position, transform: object.transform, geometry: object.geometry, style: object.style,
          properties: object.properties, metadata: object.metadata, revision: Number(object.revision ?? 0) + 1,
          createdById: object.createdById, updatedById: actorId,
        } })
      }
      for (const hotspot of snapshot.hotspots ?? []) {
        await tx.canvasHotspot.create({ data: {
          id: hotspot.id, companyId, boardId, objectId: hotspot.objectId, title: hotspot.title,
          description: hotspot.description, icon: hotspot.icon, color: hotspot.color, status: hotspot.status,
          tags: hotspot.tags, customFields: hotspot.customFields, metadata: hotspot.metadata,
          createdById: hotspot.createdById, updatedById: actorId,
        } })
      }
      for (const link of snapshot.links ?? []) {
        await tx.canvasEntityLink.create({ data: {
          id: link.id, companyId, boardId, targetType: link.targetType, targetId: link.targetId,
          moduleKey: link.moduleKey, entityType: link.entityType, entityId: link.entityId,
          relationType: link.relationType, metadata: link.metadata, createdById: link.createdById,
        } })
      }
      const boardData = snapshot.board ?? {}
      await tx.canvasBoard.update({ where: { id: boardId }, data: {
        name: boardData.name, description: boardData.description, templateType: boardData.templateType,
        settings: boardData.settings, metadata: boardData.metadata, thumbnailFileId: boardData.thumbnailFileId,
        currentVersionId: version.id, updatedById: actorId,
      } })
      const restored = await tx.canvasVersion.update({ where: { id: version.id }, data: { restoredAt: new Date() } })
      await audit(tx, { companyId, actorId, action: 'BOARD_VERSION_RESTORED', entityType: 'CanvasVersion', entityId: version.id, metadata: { boardId, number: version.number } })
      return restored
    })
  }

  async function listAttachments(companyId, actorId, boardId, targetType, targetId) {
    await assertBoardAccess(companyId, actorId, boardId)
    await assertCanvasTarget(boardId, targetType, targetId)
    return prisma.canvasAttachment.findMany({ where: { companyId, boardId, targetType, targetId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
  }

  async function addAttachment(companyId, actorId, boardId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'COMMENTER')
    await assertCanvasTarget(boardId, data.targetType, data.targetId)
    const file = await prisma.fileAsset.findFirst({
      where: { id: data.fileAssetId, entityId: companyId, enabled: true, OR: [{ accessScope: 'COMPANY' }, { uploadedById: actorId }] },
      select: { id: true },
    })
    if (!file) throw new CanvasServiceError('Archivo no encontrado.', 404)
    return prisma.canvasAttachment.create({ data: {
      companyId, boardId, targetType: data.targetType, targetId: data.targetId, fileAssetId: data.fileAssetId,
      label: cleanText(data.label, 300), position: Number.isInteger(data.position) ? data.position : 0, createdById: actorId,
    } })
  }

  // Hotspot files in the shape @runly/ui AttachmentsPanel expects: one row
  // per association with its FileAsset (name, type, size) inlined.
  async function listHotspotAttachments(companyId, actorId, boardId, hotspotId) {
    await assertBoardAccess(companyId, actorId, boardId)
    await assertCanvasTarget(boardId, 'HOTSPOT', hotspotId)
    const rows = await prisma.canvasAttachment.findMany({ where: { companyId, boardId, targetType: 'HOTSPOT', targetId: hotspotId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
    if (!rows.length) return []
    const files = await prisma.fileAsset.findMany({
      where: { id: { in: rows.map((row) => row.fileAssetId) }, entityId: companyId, enabled: true },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
    })
    const byId = new Map(files.map((file) => [file.id, file]))
    return rows.filter((row) => byId.has(row.fileAssetId)).map((row) => ({
      id: row.id, fileAssetId: row.fileAssetId, label: row.label, createdAt: row.createdAt, createdById: row.createdById, fileAsset: byId.get(row.fileAssetId),
    }))
  }

  async function removeAttachment(companyId, actorId, boardId, attachmentId) {
    await assertBoardAccess(companyId, actorId, boardId, 'COMMENTER')
    const attachment = await prisma.canvasAttachment.findFirst({ where: { id: attachmentId, companyId, boardId } })
    if (!attachment) throw new CanvasServiceError('Archivo asociado no encontrado.', 404)
    if (attachment.createdById !== actorId) await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    await prisma.canvasAttachment.delete({ where: { id: attachmentId } })
  }

  async function listComments(companyId, actorId, boardId, targetType, targetId) {
    await assertBoardAccess(companyId, actorId, boardId)
    await assertCanvasTarget(boardId, targetType, targetId)
    const entityType = targetType === 'BOARD' ? 'CanvasBoard' : 'CanvasHotspot'
    if (!['BOARD', 'HOTSPOT'].includes(targetType)) throw new CanvasServiceError('Este destino no admite comentarios.', 400)
    return prisma.entityComment.findMany({ where: { companyId, entityType, entityId: targetId }, include: { author: { select: { id: true, displayName: true, avatarFileId: true } } }, orderBy: { createdAt: 'asc' } })
  }

  async function createComment(companyId, actorId, boardId, data) {
    await assertBoardAccess(companyId, actorId, boardId, 'COMMENTER')
    await assertCanvasTarget(boardId, data.targetType, data.targetId)
    if (!['BOARD', 'HOTSPOT'].includes(data.targetType)) throw new CanvasServiceError('Este destino no admite comentarios.', 400)
    const body = cleanText(data.body, 5000)
    if (!body) throw new CanvasServiceError('El comentario no puede estar vacío.', 400)
    return prisma.entityComment.create({ data: {
      companyId, entityType: data.targetType === 'BOARD' ? 'CanvasBoard' : 'CanvasHotspot',
      entityId: data.targetId, authorId: actorId, body,
    } })
  }

  return {
    assertBoardAccess, listBoards, getBoard, createBoard, updateBoard, archiveBoard,
    createPage, updatePage, deletePage, createLayer, updateLayer, deleteLayer, reorderLayers, listObjects, batchObjects,
    createHotspot, updateHotspot, deleteHotspot, createEntityLink, listEntityLinks, removeEntityLink,
    addCollaborator, listCollaborators, removeCollaborator, createVersion, listVersions, restoreVersion,
    listAttachments, listHotspotAttachments, addAttachment, removeAttachment, listComments, createComment,
  }
}
