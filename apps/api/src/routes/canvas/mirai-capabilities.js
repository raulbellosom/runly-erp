// apps/api/src/routes/canvas/mirai-capabilities.js
//
// runly.canvas capability for MirAI (contract:
// docs/ai-context/mirai-module-capabilities.md). Read tools for boards,
// board summaries, hotspots and board types; actions to create a Board and
// update a hotspot. publicLookup: not applicable — boards are private
// company drawings with no public-internet counterpart.
import { createCanvasService } from './canvas-service.js'
import { createCanvasMiraiQueries, boardAccessWhere, BOARD_TYPES } from './canvas-mirai-queries.js'
import { createCanvasMiraiActions } from './canvas-mirai-actions.js'

export function createCanvasMiraiCapabilities({ prisma, broadcaster = null, service = null }) {
  const canvas = service ?? createCanvasService({ prisma })
  return {
    moduleKey: 'runly.canvas',
    label: 'Canvas',
    summary: 'Boards visuales (planos, mapas tecnicos, diagramas, distribuciones, revision de PDF): buscar Boards, resumen, hotspots; crear Boards y actualizar hotspots.',
    tools: createCanvasMiraiQueries({ prisma }),
    actions: createCanvasMiraiActions({ prisma, service: canvas, broadcaster }),
    publicLookup: [],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType !== 'board' || !pageContext.recordId) return null
      const board = await prisma.canvasBoard.findFirst({
        where: { ...boardAccessWhere(actx), id: String(pageContext.recordId) },
        include: { _count: { select: { pages: true } } },
      }).catch(() => null)
      if (!board) return null
      const type = BOARD_TYPES.find((t) => t.templateType === board.templateType)?.label ?? board.templateType
      return `El usuario esta viendo el Board de Canvas "${board.name}" (boardId ${board.id}), tipo ${type}, ${board._count.pages} pagina(s).`
    },
  }
}
