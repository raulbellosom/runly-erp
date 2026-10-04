// Canvas boards in Desactivados (spec 2026-10-04-trash-retention-conflicts §4.5).
// "Eliminar tablero" archives (`archived_at`); restore clears it; purge reuses
// the full board deletion (pages, objects, hotspots, files) run as the board
// owner, since the caller already holds canvas.delete + core.records.purge.
import { createCanvasService } from '../../routes/canvas/canvas-service.js'
import { createCanvasBoardDeletion } from '../../routes/canvas/canvas-board-delete.js'
import { createCanvasFileRemover } from '../../routes/canvas/canvas-files.js'
import { TrashError } from './trash-errors.js'
import { contains } from './core-trash-providers.js'

const PAGE_SIZE = 25

export function createCanvasTrashProvider({ prisma, supabaseAdmin }) {
  if (!supabaseAdmin) return null
  const removeFiles = createCanvasFileRemover({ prisma, supabaseAdmin })
  const deletion = createCanvasBoardDeletion({ prisma, canvas: createCanvasService({ prisma, removeFiles }), removeFiles })
  const where = (companyId, extra = {}) => ({ companyId, archivedAt: { not: null }, ...extra })
  const find = async (db, companyId, id) => {
    const board = await db.canvasBoard.findFirst({ where: where(companyId, { id }), select: { id: true, name: true, ownerId: true } })
    if (!board) throw new TrashError('El tablero no está en Desactivados o no existe.', 404)
    return board
  }
  return {
    id: 'runly.canvas:board', table: 'canvas_board', transactional: false,
    moduleKey: 'runly.canvas', moduleName: 'Canvas', label: 'Tablero', pluralLabel: 'Tableros',
    permissions: { restore: 'canvas.delete' },
    count: ({ prisma: db, companyId }) => db.canvasBoard.count({ where: where(companyId) }),
    async expired({ prisma: db, companyId }, before, limit = 200) {
      return (await db.canvasBoard.findMany({ where: where(companyId, { archivedAt: { lt: before } }), select: { id: true }, orderBy: { archivedAt: 'asc' }, take: limit })).map((row) => row.id)
    },
    async list({ prisma: db, companyId }, { search = '', page = 1 } = {}) {
      const term = String(search ?? '').trim()
      const filter = where(companyId, term ? { name: contains(term) } : {})
      const [rows, total] = await Promise.all([
        db.canvasBoard.findMany({ where: filter, select: { id: true, name: true, archivedAt: true }, orderBy: { archivedAt: 'desc' }, take: PAGE_SIZE, skip: (Math.max(1, Number(page) || 1) - 1) * PAGE_SIZE }),
        db.canvasBoard.count({ where: filter }),
      ])
      return { items: rows.map((row) => ({ id: row.id, label: row.name, deactivatedAt: row.archivedAt })), total }
    },
    async restore({ prisma: db, companyId }, id) {
      const board = await find(db, companyId, id)
      await db.canvasBoard.update({ where: { id: board.id }, data: { archivedAt: null } })
      return { id: board.id, label: board.name }
    },
    async purge({ prisma: db, companyId }, id) {
      const board = await find(db, companyId, id)
      await deletion.deleteBoard(companyId, board.ownerId, board.id)
      return { id: board.id, label: board.name }
    },
  }
}
