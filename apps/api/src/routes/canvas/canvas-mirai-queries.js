// apps/api/src/routes/canvas/canvas-mirai-queries.js
//
// runly.canvas read tools for MirAI. Every query is scoped to boards of the
// active company that the caller owns or collaborates on (same rule as
// canvas-service.js listBoards/assertBoardAccess). Counts are computed in SQL
// and returned as exact numbers; lists return `total` plus at most 30 rows.
const LIST_MAX = 30
const TEXT_MAX = 200
const DAY_MS = 86_400_000

export const BOARD_TYPES = [
  { templateType: 'blank', label: 'En blanco', uso: 'Lienzo libre para bocetos, ideas o cualquier uso que no encaje en otro tipo.' },
  { templateType: 'plan', label: 'Plano', uso: 'Plantas de oficinas, bodegas, locales o casas: inserta el plano (imagen o PDF) y marca areas y puntos.' },
  { templateType: 'technical-map', label: 'Mapa tecnico', uso: 'Instalaciones y redes (electricidad, agua, datos, maquinaria) con hotspots vinculados a inventario o vehiculos.' },
  { templateType: 'diagram', label: 'Diagrama', uso: 'Procesos, flujos y organigramas con rectangulos, rombos de decision, flechas y textos.' },
  { templateType: 'layout', label: 'Distribucion', uso: 'Acomodo de espacios y mobiliario: mesas, estantes, puestos de trabajo, eventos o reubicaciones.' },
  { templateType: 'pdf-review', label: 'Revision de PDF', uso: 'Insertar paginas de un PDF y marcar observaciones encima con hotspots, formas y textos.' },
]
export const HOTSPOT_STATUS = { ACTIVE: 'Activo', REVIEW: 'En revision', RESOLVED: 'Resuelto', INACTIVE: 'Inactivo' }
const TYPE_LABEL = Object.fromEntries(BOARD_TYPES.map((t) => [t.templateType, t.label]))

export const boardLink = (boardId) => `/app/m/runly.canvas/${boardId}`
export const boardAccessWhere = (actx) => ({
  companyId: actx.companyId,
  archivedAt: null,
  OR: [{ ownerId: actx.actorProfileId }, { collaborators: { some: { userId: actx.actorProfileId } } }],
})
const clip = (value) => (value ? String(value).slice(0, TEXT_MAX) : null)

export function createCanvasMiraiQueries({ prisma }) {
  const canvas_board_types = {
    name: 'canvas_board_types',
    permission: 'canvas.view',
    definition: {
      description: 'Lista los tipos (plantillas) de Board de Canvas con su uso recomendado. Todos los tipos tienen las mismas herramientas; la plantilla solo identifica el uso.',
      parameters: { type: 'object', properties: {} },
    },
    async run() {
      return { tipos: BOARD_TYPES, nota: 'Todas las herramientas (formas, textos, hotspots, imagenes y PDF) funcionan igual en cualquier tipo.' }
    },
  }

  const canvas_boards = {
    name: 'canvas_boards',
    permission: 'canvas.view',
    definition: {
      description: 'Busca los Boards de Canvas del usuario. Devuelve el total exacto y hasta 30 Boards con boardId, tipo, paginas, colaboradores y fecha de edicion.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar en nombre o descripcion.' },
          templateType: { type: 'string', enum: BOARD_TYPES.map((t) => t.templateType) },
          editedWithinDays: { type: 'integer', minimum: 1, maximum: 365, description: 'Solo Boards editados en los ultimos N dias.' },
        },
      },
    },
    async run(args, actx) {
      const and = []
      if (args?.query) and.push({ OR: [{ name: { contains: args.query, mode: 'insensitive' } }, { description: { contains: args.query, mode: 'insensitive' } }] })
      if (args?.templateType) and.push({ templateType: args.templateType })
      if (args?.editedWithinDays) and.push({ updatedAt: { gte: new Date(Date.now() - Number(args.editedWithinDays) * DAY_MS) } })
      const where = { ...boardAccessWhere(actx), ...(and.length ? { AND: and } : {}) }
      const [total, rows] = await Promise.all([
        prisma.canvasBoard.count({ where }),
        prisma.canvasBoard.findMany({ where, include: { _count: { select: { pages: true, collaborators: true } } }, orderBy: { updatedAt: 'desc' }, take: LIST_MAX }),
      ])
      return {
        total,
        boards: rows.map((b) => ({
          boardId: b.id, nombre: b.name, tipo: TYPE_LABEL[b.templateType] ?? b.templateType, descripcion: clip(b.description),
          paginas: b._count.pages, colaboradores: b._count.collaborators, editado: b.updatedAt, link: boardLink(b.id),
        })),
      }
    },
  }

  const canvas_board_summary = {
    name: 'canvas_board_summary',
    permission: 'canvas.view',
    definition: {
      description: 'Resumen exacto de un Board: paginas con conteo de elementos por tipo, hotspots por estado, registros vinculados y colaboradores. Requiere boardId (de canvas_boards o del contexto de pantalla).',
      parameters: { type: 'object', properties: { boardId: { type: 'string' } }, required: ['boardId'] },
    },
    async run(args, actx) {
      const board = await prisma.canvasBoard.findFirst({
        where: { ...boardAccessWhere(actx), id: String(args?.boardId ?? '') },
        include: { pages: { orderBy: { position: 'asc' }, select: { id: true, name: true } }, _count: { select: { collaborators: true } } },
      }).catch(() => null)
      if (!board) return { error: 'No encontre ese Board o no tienes acceso. Usa canvas_boards para obtener su boardId.' }
      const [objects, hotspots, links] = await Promise.all([
        prisma.canvasObject.groupBy({ by: ['pageId', 'type'], where: { boardId: board.id, deletedAt: null }, _count: { _all: true } }),
        prisma.canvasHotspot.groupBy({ by: ['status'], where: { boardId: board.id, archivedAt: null, object: { deletedAt: null } }, _count: { _all: true } }),
        prisma.canvasEntityLink.count({ where: { boardId: board.id } }),
      ])
      return {
        boardId: board.id, nombre: board.name, tipo: TYPE_LABEL[board.templateType] ?? board.templateType, descripcion: clip(board.description),
        colaboradores: board._count.collaborators, registrosVinculados: links, link: boardLink(board.id),
        paginas: board.pages.map((page) => {
          const rows = objects.filter((row) => row.pageId === page.id)
          return { pageId: page.id, nombre: page.name, elementos: rows.reduce((sum, row) => sum + row._count._all, 0), porTipo: Object.fromEntries(rows.map((row) => [row.type, row._count._all])) }
        }),
        hotspots: {
          total: hotspots.reduce((sum, row) => sum + row._count._all, 0),
          porEstado: Object.fromEntries(hotspots.map((row) => [HOTSPOT_STATUS[row.status] ?? row.status, row._count._all])),
        },
      }
    },
  }

  const canvas_hotspots = {
    name: 'canvas_hotspots',
    permission: 'canvas.view',
    definition: {
      description: 'Busca hotspots en los Boards del usuario por texto (titulo/descripcion), estado o Board. Devuelve el total exacto y hasta 30 hotspots con hotspotId, Board, pagina y registros vinculados.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          status: { type: 'string', enum: Object.keys(HOTSPOT_STATUS), description: 'ACTIVE=Activo, REVIEW=En revision, RESOLVED=Resuelto, INACTIVE=Inactivo.' },
          boardId: { type: 'string' },
        },
      },
    },
    async run(args, actx) {
      const where = {
        archivedAt: null,
        object: { deletedAt: null },
        board: boardAccessWhere(actx),
        ...(args?.boardId ? { boardId: String(args.boardId) } : {}),
        ...(args?.status ? { status: args.status } : {}),
        ...(args?.query ? { OR: [{ title: { contains: args.query, mode: 'insensitive' } }, { description: { contains: args.query, mode: 'insensitive' } }] } : {}),
      }
      const [total, rows] = await Promise.all([
        prisma.canvasHotspot.count({ where }),
        prisma.canvasHotspot.findMany({
          where, orderBy: { updatedAt: 'desc' }, take: LIST_MAX,
          include: { board: { select: { id: true, name: true } }, object: { select: { page: { select: { name: true } } } } },
        }),
      ])
      const links = rows.length
        ? await prisma.canvasEntityLink.findMany({ where: { targetType: 'HOTSPOT', targetId: { in: rows.map((row) => row.id) } } })
        : []
      return {
        total,
        hotspots: rows.map((row) => ({
          hotspotId: row.id, titulo: row.title, descripcion: clip(row.description), estado: HOTSPOT_STATUS[row.status] ?? row.status, icono: row.icon ?? null,
          boardId: row.board.id, board: row.board.name, pagina: row.object?.page?.name ?? null, link: boardLink(row.board.id),
          registros: links.filter((link) => link.targetId === row.id).map((link) => link.metadata?.resolved?.title ?? link.entityType),
        })),
      }
    },
  }

  return [canvas_board_types, canvas_boards, canvas_board_summary, canvas_hotspots]
}
