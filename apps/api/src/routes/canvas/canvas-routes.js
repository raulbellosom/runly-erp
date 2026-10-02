import { Hono } from 'hono'
import { UserAccessError, createUserAccessService } from '../../services/user-access-service.js'
import { CanvasServiceError, createCanvasService } from './canvas-service.js'
import { createCanvasSearch } from './canvas-search.js'
import { createCanvasPublicLinksService } from './canvas-public.js'
import { createGeocoder } from './canvas-geocoder.js'
import { CANVAS_TEMPLATES } from './canvas-templates.js'

const actorId = (c) => c.get('userContext')?.profile?.id ?? null
const companyId = (c) => c.get('companyId') ?? null

function errorResponse(c, error, fallback) {
  if (error instanceof CanvasServiceError) return c.json({ error: error.message, code: error.code }, error.status)
  // Sharing with someone who is not an active member or lacks canvas.view.
  if (error instanceof UserAccessError) {
    return c.json({ error: 'Esta persona no puede recibir el Board: necesita ser miembro activo de la empresa y tener el permiso "Ver Boards" de Canvas en su rol. Un administrador puede asignarlo en Identidad > Roles.', code: 'CANDIDATE_NOT_ELIGIBLE' }, 422)
  }
  if (Number.isInteger(error?.status)) return c.json({ error: error.message ?? fallback }, error.status)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.canvas]', error)
  return c.json({ error: fallback }, 500)
}

const DELTA_MAX_CHARS = 200_000

// Realtime payload for an object batch: the rows other editors need to patch
// their caches, or `refetch` when it would be too large for one message.
export function objectsDelta(results) {
  const upserts = [], deletedIds = []
  for (const result of results) {
    if (result.op === 'delete') deletedIds.push(result.id)
    else if (result.op !== 'conflict' && result.object) upserts.push(result.object)
  }
  const delta = { upserts, deletedIds }
  return JSON.stringify(delta).length <= DELTA_MAX_CHARS ? delta : { refetch: true }
}

export function createCanvasRouter({ prisma, requirePermission, broadcaster = null, entityResolver = null, service = null, dataSources = null, geocoder = createGeocoder(), search = null }) {
  const app = new Hono()
  const canvas = service ?? createCanvasService({ prisma, entityResolver })
  const canvasSearch = search ?? (prisma ? createCanvasSearch({ prisma }) : null)
  const access = prisma ? createUserAccessService({ prisma }) : null
  const publicLinks = prisma ? createCanvasPublicLinksService({ prisma, canvas }) : null
  const changed = (boardId, action, payload = {}) => broadcaster?.broadcastToChannel?.(`canvas:board:${boardId}`, 'canvas.changed', { boardId, action, ...payload }).catch(() => {})

  app.get('/canvas/templates', requirePermission('canvas.view'), (c) => c.json({ data: CANVAS_TEMPLATES }))
  app.get('/canvas/map-config', requirePermission('canvas.view'), (c) => c.json({ data: geocoder.mapConfig() }))
  app.get('/canvas/geocode', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await geocoder.search(c.req.query('q')) }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar la dirección.') }
  })

  app.get('/canvas/data-sources', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await dataSources.catalog({ authUserId: c.get('authUserId'), companyId: companyId(c) }) }) }
    catch (error) { return errorResponse(c, error, 'Error al listar fuentes de datos.') }
  })
  app.get('/canvas/data-sources/:source/search', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await dataSources.search({ authUserId: c.get('authUserId'), companyId: companyId(c), source: c.req.param('source'), q: c.req.query('q') ?? '' }) }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar registros.') }
  })
  app.post('/canvas/boards/:boardId/bindings/resolve', requirePermission('canvas.view'), async (c) => {
    try {
      await canvas.assertBoardAccess(companyId(c), actorId(c), c.req.param('boardId'))
      const body = await c.req.json().catch(() => ({}))
      return c.json({ data: await dataSources.resolve({ authUserId: c.get('authUserId'), companyId: companyId(c), refs: Array.isArray(body.refs) ? body.refs : [] }) })
    } catch (error) { return errorResponse(c, error, 'Error al cargar los datos del Board.') }
  })
  app.get('/canvas/references', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await canvas.listReferences(companyId(c), actorId(c), c.req.query()) }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar referencias.') }
  })
  // Content-aware Board search: name, description, pages, hotspots, canvas
  // text and linked records (see canvas-search.js).
  app.get('/canvas/search', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await canvasSearch.search(companyId(c), actorId(c), c.req.query('q') ?? '') }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar Boards.') }
  })

  app.get('/canvas/boards', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.listBoards(companyId(c), actorId(c))) }
    catch (error) { return errorResponse(c, error, 'Error al listar Boards.') }
  })
  app.post('/canvas/boards', requirePermission('canvas.create'), async (c) => {
    try { return c.json(await canvas.createBoard(companyId(c), actorId(c), await c.req.json()), 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear el Board.') }
  })
  app.get('/canvas/boards/:boardId', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.getBoard(companyId(c), actorId(c), c.req.param('boardId'))) }
    catch (error) { return errorResponse(c, error, 'Error al obtener el Board.') }
  })
  app.patch('/canvas/boards/:boardId', requirePermission('canvas.edit'), async (c) => {
    try {
      const boardId = c.req.param('boardId'); const result = await canvas.updateBoard(companyId(c), actorId(c), boardId, await c.req.json())
      changed(boardId, 'board.updated'); return c.json(result)
    } catch (error) { return errorResponse(c, error, 'Error al actualizar el Board.') }
  })
  app.delete('/canvas/boards/:boardId', requirePermission('canvas.delete'), async (c) => {
    try { const boardId = c.req.param('boardId'); const result = await canvas.archiveBoard(companyId(c), actorId(c), boardId); changed(boardId, 'board.archived'); return c.json(result) }
    catch (error) { return errorResponse(c, error, 'Error al archivar el Board.') }
  })

  app.post('/canvas/boards/:boardId/pages', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.createPage(companyId(c), actorId(c), id, await c.req.json()); changed(id, 'page.created', { pageId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear la página.') }
  })
  app.patch('/canvas/boards/:boardId/pages/:pageId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.updatePage(companyId(c), actorId(c), id, c.req.param('pageId'), await c.req.json()); changed(id, 'page.updated', { pageId: row.id }); return c.json(row) }
    catch (error) { return errorResponse(c, error, 'Error al actualizar la página.') }
  })
  app.delete('/canvas/boards/:boardId/pages/:pageId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.deletePage(companyId(c), actorId(c), id, c.req.param('pageId')); changed(id, 'page.deleted'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al eliminar la página.') }
  })
  app.post('/canvas/boards/:boardId/pages/:pageId/layers', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.createLayer(companyId(c), actorId(c), id, c.req.param('pageId'), await c.req.json()); changed(id, 'layer.created', { layerId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear la capa.') }
  })
  app.patch('/canvas/boards/:boardId/pages/:pageId/layers/reorder', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const body = await c.req.json(); const rows = await canvas.reorderLayers(companyId(c), actorId(c), id, c.req.param('pageId'), body.layerIds ?? []); changed(id, 'layers.reordered'); return c.json(rows) }
    catch (error) { return errorResponse(c, error, 'Error al ordenar las capas.') }
  })
  app.patch('/canvas/boards/:boardId/pages/:pageId/layers/:layerId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.updateLayer(companyId(c), actorId(c), id, c.req.param('pageId'), c.req.param('layerId'), await c.req.json()); changed(id, 'layer.updated', { layerId: row.id }); return c.json(row) }
    catch (error) { return errorResponse(c, error, 'Error al actualizar la capa.') }
  })
  app.delete('/canvas/boards/:boardId/pages/:pageId/layers/:layerId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.deleteLayer(companyId(c), actorId(c), id, c.req.param('pageId'), c.req.param('layerId')); changed(id, 'layer.deleted'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al eliminar la capa.') }
  })

  app.get('/canvas/boards/:boardId/objects', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.listObjects(companyId(c), actorId(c), c.req.param('boardId'), { pageId: c.req.query('pageId'), layerId: c.req.query('layerId') })) }
    catch (error) { return errorResponse(c, error, 'Error al cargar objetos.') }
  })
  app.post('/canvas/boards/:boardId/objects/batch', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const body = await c.req.json(); const rows = await canvas.batchObjects(companyId(c), actorId(c), id, body.operations); changed(id, 'objects.changed', objectsDelta(rows)); return c.json({ data: rows }) }
    catch (error) { return errorResponse(c, error, 'Error al guardar objetos.') }
  })
  app.post('/canvas/boards/:boardId/hotspots', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.createHotspot(companyId(c), actorId(c), id, await c.req.json()); changed(id, 'hotspot.created', { hotspotId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear el hotspot.') }
  })
  app.patch('/canvas/boards/:boardId/hotspots/:hotspotId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.updateHotspot(companyId(c), actorId(c), id, c.req.param('hotspotId'), await c.req.json()); changed(id, 'hotspot.updated', { hotspotId: row.id }); return c.json(row) }
    catch (error) { return errorResponse(c, error, 'Error al actualizar el hotspot.') }
  })
  app.delete('/canvas/boards/:boardId/hotspots/:hotspotId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.deleteHotspot(companyId(c), actorId(c), id, c.req.param('hotspotId')); changed(id, 'hotspot.deleted'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al eliminar el hotspot.') }
  })

  app.get('/canvas/boards/:boardId/entity-links', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.listEntityLinks(companyId(c), actorId(c), c.req.param('boardId'), { targetType: c.req.query('targetType'), targetId: c.req.query('targetId') })) }
    catch (error) { return errorResponse(c, error, 'Error al listar relaciones.') }
  })
  app.post('/canvas/boards/:boardId/entity-links', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.createEntityLink(companyId(c), actorId(c), c.get('authUserId'), id, await c.req.json()); changed(id, 'entity-link.created', { linkId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear la relación.') }
  })
  app.delete('/canvas/boards/:boardId/entity-links/:linkId', requirePermission('canvas.edit'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.removeEntityLink(companyId(c), actorId(c), id, c.req.param('linkId')); changed(id, 'entity-link.removed'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al eliminar la relación.') }
  })

  app.post('/canvas/boards/:boardId/collaborators', requirePermission('canvas.share'), async (c) => {
    try {
      const id = c.req.param('boardId'); const body = await c.req.json()
      const row = await canvas.addCollaborator(companyId(c), actorId(c), id, body, (userId) => access.assertCandidates({ companyId: companyId(c), userIds: [userId], permission: 'canvas.view' }))
      changed(id, 'collaborator.updated', { userId: body.userId }); return c.json(row, 201)
    } catch (error) { return errorResponse(c, error, 'Error al compartir el Board.') }
  })
  app.get('/canvas/boards/:boardId/collaborators', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.listCollaborators(companyId(c), actorId(c), c.req.param('boardId'))) }
    catch (error) { return errorResponse(c, error, 'Error al listar colaboradores.') }
  })
  app.delete('/canvas/boards/:boardId/collaborators/:userId', requirePermission('canvas.share'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.removeCollaborator(companyId(c), actorId(c), id, c.req.param('userId')); changed(id, 'collaborator.removed'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al eliminar al colaborador.') }
  })
  // Read-only public links (owner only; see canvas-public.js).
  app.get('/canvas/boards/:boardId/public-links', requirePermission('canvas.share'), async (c) => {
    try { return c.json(await publicLinks.list(companyId(c), actorId(c), c.req.param('boardId'))) }
    catch (error) { return errorResponse(c, error, 'Error al listar enlaces públicos.') }
  })
  app.post('/canvas/boards/:boardId/public-links', requirePermission('canvas.share'), async (c) => {
    try { return c.json(await publicLinks.create(companyId(c), actorId(c), c.req.param('boardId'), await c.req.json()), 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear el enlace público.') }
  })
  app.delete('/canvas/boards/:boardId/public-links/:linkId', requirePermission('canvas.share'), async (c) => {
    try { return c.json(await publicLinks.revoke(companyId(c), actorId(c), c.req.param('boardId'), c.req.param('linkId'))) }
    catch (error) { return errorResponse(c, error, 'Error al revocar el enlace público.') }
  })
  // Hotspot files for AttachmentsPanel (list / associate / remove).
  app.get('/canvas/boards/:boardId/hotspots/:hotspotId/attachments', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await canvas.listHotspotAttachments(companyId(c), actorId(c), c.req.param('boardId'), c.req.param('hotspotId')) }) }
    catch (error) { return errorResponse(c, error, 'Error al listar archivos.') }
  })
  app.post('/canvas/boards/:boardId/hotspots/:hotspotId/attachments', requirePermission('canvas.comment'), async (c) => {
    try {
      const id = c.req.param('boardId'), body = await c.req.json()
      const row = await canvas.addAttachment(companyId(c), actorId(c), id, { targetType: 'HOTSPOT', targetId: c.req.param('hotspotId'), fileAssetId: body.file_asset_id ?? body.fileAssetId, label: body.label })
      changed(id, 'attachment.created', { attachmentId: row.id }); return c.json({ data: row }, 201)
    } catch (error) { return errorResponse(c, error, 'Error al adjuntar el archivo.') }
  })
  app.delete('/canvas/boards/:boardId/hotspots/:hotspotId/attachments/:attachmentId', requirePermission('canvas.comment'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.removeAttachment(companyId(c), actorId(c), id, c.req.param('attachmentId')); changed(id, 'attachment.removed'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al quitar el archivo.') }
  })
  app.get('/canvas/boards/:boardId/versions', requirePermission('canvas.version.view'), async (c) => {
    try { return c.json(await canvas.listVersions(companyId(c), actorId(c), c.req.param('boardId'))) }
    catch (error) { return errorResponse(c, error, 'Error al listar versiones.') }
  })
  app.post('/canvas/boards/:boardId/versions', requirePermission('canvas.version.create'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.createVersion(companyId(c), actorId(c), id, await c.req.json()); changed(id, 'version.created', { versionId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear la versión.') }
  })
  app.post('/canvas/boards/:boardId/versions/:versionId/restore', requirePermission('canvas.version.restore'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.restoreVersion(companyId(c), actorId(c), id, c.req.param('versionId')); changed(id, 'version.restored', { versionId: row.id }); return c.json(row) }
    catch (error) { return errorResponse(c, error, 'Error al restaurar la versión.') }
  })
  app.get('/canvas/boards/:boardId/attachments', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.listAttachments(companyId(c), actorId(c), c.req.param('boardId'), c.req.query('targetType'), c.req.query('targetId'))) }
    catch (error) { return errorResponse(c, error, 'Error al listar archivos.') }
  })
  app.post('/canvas/boards/:boardId/attachments', requirePermission('canvas.comment'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.addAttachment(companyId(c), actorId(c), id, await c.req.json()); changed(id, 'attachment.created', { attachmentId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al asociar el archivo.') }
  })
  app.delete('/canvas/boards/:boardId/attachments/:attachmentId', requirePermission('canvas.comment'), async (c) => {
    try { const id = c.req.param('boardId'); await canvas.removeAttachment(companyId(c), actorId(c), id, c.req.param('attachmentId')); changed(id, 'attachment.removed'); return c.body(null, 204) }
    catch (error) { return errorResponse(c, error, 'Error al eliminar el archivo asociado.') }
  })
  app.get('/canvas/boards/:boardId/comments', requirePermission('canvas.view'), async (c) => {
    try { return c.json(await canvas.listComments(companyId(c), actorId(c), c.req.param('boardId'), c.req.query('targetType'), c.req.query('targetId'))) }
    catch (error) { return errorResponse(c, error, 'Error al listar comentarios.') }
  })
  app.post('/canvas/boards/:boardId/comments', requirePermission('canvas.comment'), async (c) => {
    try { const id = c.req.param('boardId'); const row = await canvas.createComment(companyId(c), actorId(c), id, await c.req.json()); changed(id, 'comment.created', { commentId: row.id }); return c.json(row, 201) }
    catch (error) { return errorResponse(c, error, 'Error al crear el comentario.') }
  })

  return app
}
