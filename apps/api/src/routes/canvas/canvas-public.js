// Public, read-only links to a Canvas board. Links live in the core
// `module_public_link` table (moduleKey runly.canvas, resourceKey board.view,
// recordId = boardId, mode view), so token, expiry, revocation and open
// counting follow the same rules as every other module public link
// (linkStatus from module-public-links-service). The RME3 gateway does not
// apply to official modules, so Canvas serves its own path-scoped public
// routes here.
//
// What a public visitor gets: the board, its pages and visible layers, the
// objects on those layers, and each hotspot's title/description/status/
// icon/color. Never exposed: linked ERP records, attachments, comments,
// collaborators or hidden layers.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { createTokenBucketLimiter } from '../../lib/token-bucket-limiter.js'
import { linkStatus } from '../../services/module-public-links-service.js'
import { CanvasServiceError } from './canvas-service.js'

export const CANVAS_MODULE_KEY = 'runly.canvas'
export const BOARD_RESOURCE = 'board.view'
const MAX_LINKS_PER_BOARD = 50

function serialize(link) {
  return {
    id: link.id, label: link.label, token: link.token, mode: link.mode,
    expiresAt: link.expiresAt, maxUses: link.maxUses, useCount: link.useCount, lastUsedAt: link.lastUsedAt,
    revokedAt: link.revokedAt, status: linkStatus(link), createdAt: link.createdAt,
  }
}

export function createCanvasPublicLinksService({ prisma, canvas }) {
  const scope = (companyId, boardId) => ({ companyId, moduleKey: CANVAS_MODULE_KEY, resourceKey: BOARD_RESOURCE, recordId: boardId })

  async function list(companyId, actorId, boardId) {
    await canvas.assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    const rows = await prisma.modulePublicLink.findMany({ where: scope(companyId, boardId), orderBy: { createdAt: 'desc' }, take: MAX_LINKS_PER_BOARD })
    return rows.map(serialize)
  }

  async function create(companyId, actorId, boardId, input = {}) {
    await canvas.assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) throw new CanvasServiceError('La fecha de vencimiento debe ser futura.', 400)
    const maxUses = input.maxUses == null || input.maxUses === '' ? null : Number(input.maxUses)
    if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new CanvasServiceError('El máximo de aperturas no es válido.', 400)
    const link = await prisma.modulePublicLink.create({
      data: {
        ...scope(companyId, boardId), token: crypto.randomBytes(32).toString('base64url'), mode: 'view',
        label: input.label ? String(input.label).trim().slice(0, 120) || null : null, expiresAt, maxUses, createdByUserId: actorId,
      },
    })
    return serialize(link)
  }

  async function revoke(companyId, actorId, boardId, linkId) {
    await canvas.assertBoardAccess(companyId, actorId, boardId, 'OWNER')
    const link = await prisma.modulePublicLink.findFirst({ where: { ...scope(companyId, boardId), id: linkId } })
    if (!link) throw new CanvasServiceError('Enlace no encontrado.', 404)
    const updated = link.revokedAt ? link : await prisma.modulePublicLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } })
    return serialize(updated)
  }

  return { list, create, revoke }
}

function clientIp(c) {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return c.req.header('x-real-ip') ?? 'local'
}

// Public router — path-scoped only; never add a root use('*') (see the
// load-bearing note next to the chat/calls routers in index.js).
export function createCanvasPublicRouter({
  prisma,
  signFile = async () => null,
  resolveLogoUrl = async () => null,
  limiter = createTokenBucketLimiter({ capacity: 60, refillPerSecond: 1 }),
}) {
  const app = new Hono()
  const unavailable = (c, status = 404, reason = null) => c.json({ error: 'Enlace no disponible', ...(reason ? { reason } : {}) }, status)

  async function resolve(c) {
    const token = c.req.param('token')
    const rate = limiter.consume(`${clientIp(c)}:${token}`)
    if (!rate.allowed) { c.header('Retry-After', String(rate.retryAfter)); return { response: c.json({ error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429) } }
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { response: unavailable(c) }
    const link = await prisma.modulePublicLink.findUnique({ where: { token } })
    if (!link || link.moduleKey !== CANVAS_MODULE_KEY || link.resourceKey !== BOARD_RESOURCE || !link.recordId) return { response: unavailable(c) }
    const status = linkStatus(link)
    if (status !== 'activo') return { response: unavailable(c, 410, status) }
    const board = await prisma.canvasBoard.findFirst({ where: { id: link.recordId, companyId: link.companyId, archivedAt: null } })
    if (!board) return { response: unavailable(c, 410, 'archivado') }
    return { link, board }
  }

  app.get('/public/canvas/:token', async (c) => {
    const { response, link, board } = await resolve(c)
    if (response) return response
    // Each board open counts as one use, so "máximo de aperturas" works.
    const counted = await prisma.$queryRaw`
      UPDATE module_public_link SET use_count = use_count + 1, last_used_at = now(), updated_at = now()
       WHERE id = ${link.id}::uuid AND revoked_at IS NULL AND (max_uses IS NULL OR use_count < max_uses)
      RETURNING id`
    if (!counted.length) return unavailable(c, 410, 'agotado')
    const [pages, company] = await Promise.all([
      prisma.canvasPage.findMany({
        where: { boardId: board.id }, orderBy: { position: 'asc' },
        select: { id: true, name: true, layers: { where: { visible: true }, orderBy: { position: 'asc' }, select: { id: true, name: true, type: true } } },
      }),
      prisma.company.findUnique({ where: { id: link.companyId }, select: { name: true, brandingConfig: { select: { logoFileId: true } } } }),
    ])
    return c.json({
      data: {
        board: { id: board.id, name: board.name, description: board.description, templateType: board.templateType },
        pages, expiresAt: link.expiresAt,
        company: { name: company?.name ?? '', logoUrl: await resolveLogoUrl(company?.brandingConfig?.logoFileId ?? null).catch(() => null) },
      },
    })
  })

  app.get('/public/canvas/:token/pages/:pageId/objects', async (c) => {
    const { response, board, link } = await resolve(c)
    if (response) return response
    const page = await prisma.canvasPage.findFirst({ where: { id: c.req.param('pageId'), boardId: board.id }, select: { id: true } })
    if (!page) return c.json({ error: 'Página no encontrada.' }, 404)
    const rows = await prisma.canvasObject.findMany({
      where: { boardId: board.id, pageId: page.id, deletedAt: null, layer: { visible: true } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, layerId: true, type: true, position: true, transform: true, geometry: true, style: true, properties: true,
        hotspot: { select: { id: true, title: true, description: true, status: true, icon: true, color: true, archivedAt: true } },
      },
    })
    const objects = rows.map(({ hotspot, ...row }) => ({
      ...row,
      // Only presentation fields leave the server for image objects.
      properties: row.type === 'image' ? { fileId: row.properties?.fileId ?? null, page: row.properties?.page ?? null } : row.properties,
      hotspot: hotspot && !hotspot.archivedAt ? { id: hotspot.id, title: hotspot.title, description: hotspot.description, status: hotspot.status, icon: hotspot.icon, color: hotspot.color } : null,
    }))
    const fileIds = [...new Set(objects.filter((row) => row.type === 'image' && row.properties.fileId).map((row) => row.properties.fileId))]
    // Sign only files that belong to the board's company.
    const files = fileIds.length ? await prisma.fileAsset.findMany({ where: { id: { in: fileIds }, entityId: link.companyId, enabled: true }, select: { id: true } }) : []
    const imageUrls = Object.fromEntries(await Promise.all(files.map(async (file) => [file.id, await signFile(file.id).catch(() => null)])))
    return c.json({ data: { objects, imageUrls } })
  })

  return app
}
