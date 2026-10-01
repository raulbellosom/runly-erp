// apps/api/src/routes/canvas/canvas-mirai-actions.js
//
// runly.canvas actions MirAI can propose: create a Board and update a
// hotspot's information. prepare() only reads; execute() goes through
// canvas-service.js (ACL, audit log) exactly like the HTTP routes, and
// broadcasts the same `canvas.changed` event so open editors refresh.
// Drawing or moving shapes is intentionally not exposed.
import { z } from 'zod'
import { BOARD_TYPES, HOTSPOT_STATUS, boardAccessWhere, boardLink } from './canvas-mirai-queries.js'

const TEMPLATE_VALUES = BOARD_TYPES.map((t) => t.templateType)
const createArgs = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  templateType: z.enum(TEMPLATE_VALUES).optional(),
})
const updateArgs = z.object({
  hotspotId: z.string().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(Object.keys(HOTSPOT_STATUS)).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().regex(/^[a-z0-9-]{1,60}$/).nullable().optional(),
})

export function createCanvasMiraiActions({ prisma, service, broadcaster = null }) {
  const changed = (boardId, action, payload = {}) =>
    broadcaster?.broadcastToChannel?.(`canvas:board:${boardId}`, 'canvas.changed', { boardId, action, ...payload })?.catch?.(() => {})

  const createBoard = {
    key: 'canvas.board.create',
    moduleKey: 'runly.canvas',
    operation: 'create',
    label: 'Crear Board',
    permission: 'canvas.create',
    description: `Crea un Board de Canvas con nombre, descripcion opcional y tipo (${TEMPLATE_VALUES.join(', ')}; por defecto blank). Usa canvas_board_types si el usuario duda del tipo.`,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, description: { type: 'string' }, templateType: { type: 'string', enum: TEMPLATE_VALUES } },
      required: ['name'],
    },
    async prepare(args) {
      const parsed = createArgs.safeParse(args)
      if (!parsed.success) return { error: `Indica el nombre del Board y, si quieres, un tipo valido: ${TEMPLATE_VALUES.join(', ')}.` }
      const a = parsed.data, type = BOARD_TYPES.find((t) => t.templateType === (a.templateType ?? 'blank'))
      return {
        input: { name: a.name, description: a.description ?? null, templateType: type.templateType },
        preview: {
          title: 'Crear Board',
          fields: [
            { label: 'Nombre', value: a.name },
            { label: 'Tipo', value: type.label },
            a.description ? { label: 'Descripcion', value: a.description.slice(0, 300) } : null,
          ].filter(Boolean),
        },
      }
    },
    async execute(input, actx) {
      const board = await service.createBoard(actx.companyId, actx.actorProfileId, input)
      return { id: board.id, summary: `Board creado: ${board.name}`, link: boardLink(board.id) }
    },
  }

  const updateHotspot = {
    key: 'canvas.hotspot.update',
    moduleKey: 'runly.canvas',
    operation: 'update',
    label: 'Actualizar hotspot',
    permission: 'canvas.edit',
    description: 'Cambia titulo, descripcion, estado (ACTIVE, REVIEW, RESOLVED, INACTIVE), color (#RRGGBB) o icono de un hotspot. El icono es un nombre de lucide en kebab-case (p. ej. fire-extinguisher, plug-zap, cctv, droplet, wifi, wrench) o null para quitarlo. Requiere hotspotId de canvas_hotspots.',
    parameters: {
      type: 'object',
      properties: {
        hotspotId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
        status: { type: 'string', enum: Object.keys(HOTSPOT_STATUS) }, color: { type: 'string' }, icon: { type: ['string', 'null'] },
      },
      required: ['hotspotId'],
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args)
      if (!parsed.success) return { error: 'Indica el hotspotId (de canvas_hotspots) y al menos un cambio valido.' }
      const a = parsed.data
      const hotspot = await prisma.canvasHotspot.findFirst({
        where: { id: a.hotspotId, archivedAt: null, object: { deletedAt: null }, board: boardAccessWhere(actx) },
        include: { board: { select: { id: true, name: true } } },
      }).catch(() => null)
      if (!hotspot) return { error: 'No encontre ese hotspot o no tienes acceso. Usa canvas_hotspots para obtener su hotspotId.' }
      const data = {}, fields = [{ label: 'Hotspot', value: `${hotspot.title} (${hotspot.board.name})` }]
      if (a.title !== undefined && a.title !== hotspot.title) { data.title = a.title; fields.push({ label: 'Titulo', value: a.title }) }
      if (a.description !== undefined && a.description !== (hotspot.description ?? '')) { data.description = a.description; fields.push({ label: 'Descripcion', value: a.description.slice(0, 300) }) }
      if (a.status && a.status !== hotspot.status) { data.status = a.status; fields.push({ label: 'Estado', value: `${HOTSPOT_STATUS[hotspot.status] ?? hotspot.status} -> ${HOTSPOT_STATUS[a.status]}` }) }
      if (a.color && a.color.toLowerCase() !== (hotspot.color ?? '').toLowerCase()) { data.color = a.color.toLowerCase(); fields.push({ label: 'Color', value: a.color }) }
      if (a.icon !== undefined && a.icon !== (hotspot.icon ?? null)) { data.icon = a.icon; fields.push({ label: 'Icono', value: a.icon ?? 'Sin icono' }) }
      if (!Object.keys(data).length) return { error: 'El hotspot ya tiene esos valores; no hay nada que cambiar.' }
      return { input: { hotspotId: hotspot.id, boardId: hotspot.boardId, data }, preview: { title: 'Actualizar hotspot', fields } }
    },
    async execute(input, actx) {
      const row = await service.updateHotspot(actx.companyId, actx.actorProfileId, input.boardId, input.hotspotId, input.data)
      changed(input.boardId, 'hotspot.updated', { hotspotId: row.id })
      return { id: row.id, summary: `Hotspot actualizado: ${row.title}`, link: boardLink(input.boardId) }
    },
  }

  return [createBoard, updateHotspot]
}
