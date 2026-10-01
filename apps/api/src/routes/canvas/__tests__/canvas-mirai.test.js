// Focused tests for runly.canvas MirAI tools/actions: access-scoped queries
// with exact totals, prepare() never writes, execute() goes through the
// canvas service and broadcasts the board change.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasMiraiQueries } from '../canvas-mirai-queries.js'
import { createCanvasMiraiActions } from '../canvas-mirai-actions.js'
import { createCanvasMiraiCapabilities } from '../mirai-capabilities.js'

const actx = { companyId: 'co1', actorProfileId: 'me', actorAuthUserId: 'auth' }
const tool = (prisma, name) => createCanvasMiraiQueries({ prisma }).find((item) => item.name === name)

test('canvas_boards: scopes to the caller and returns the exact total with ids and links', async () => {
  let seenWhere
  const prisma = {
    canvasBoard: {
      count: async ({ where }) => { seenWhere = where; return 42 },
      findMany: async () => [{ id: 'b1', name: 'Bodega', templateType: 'plan', description: null, updatedAt: new Date(), _count: { pages: 2, collaborators: 3 } }],
    },
  }
  const out = await tool(prisma, 'canvas_boards').run({ query: 'bod', templateType: 'plan' }, actx)
  assert.equal(out.total, 42)
  assert.equal(out.boards[0].boardId, 'b1')
  assert.equal(out.boards[0].tipo, 'Plano')
  assert.equal(out.boards[0].link, '/app/m/runly.canvas/b1')
  assert.equal(seenWhere.companyId, 'co1')
  assert.deepEqual(seenWhere.OR, [{ ownerId: 'me' }, { collaborators: { some: { userId: 'me' } } }])
})

test('canvas_board_summary: counts elements per page and hotspots per status', async () => {
  const prisma = {
    canvasBoard: { findFirst: async () => ({ id: 'b1', name: 'Planta', templateType: 'technical-map', description: null, pages: [{ id: 'p1', name: 'Pagina 1' }], _count: { collaborators: 1 } }) },
    canvasObject: { groupBy: async () => [{ pageId: 'p1', type: 'rectangle', _count: { _all: 3 } }, { pageId: 'p1', type: 'hotspot', _count: { _all: 2 } }] },
    canvasHotspot: { groupBy: async () => [{ status: 'REVIEW', _count: { _all: 2 } }] },
    canvasEntityLink: { count: async () => 5 },
  }
  const out = await tool(prisma, 'canvas_board_summary').run({ boardId: 'b1' }, actx)
  assert.equal(out.paginas[0].elementos, 5)
  assert.deepEqual(out.hotspots, { total: 2, porEstado: { 'En revision': 2 } })
  assert.equal(out.registrosVinculados, 5)
})

test('canvas_board_summary: inaccessible board -> error, never throws', async () => {
  const prisma = { canvasBoard: { findFirst: async () => null } }
  const out = await tool(prisma, 'canvas_board_summary').run({ boardId: 'other' }, actx)
  assert.match(out.error, /no encontre/i)
})

test('canvas_hotspots: includes linked record titles', async () => {
  const prisma = {
    canvasHotspot: {
      count: async () => 1,
      findMany: async () => [{ id: 'h1', title: 'Tablero', description: null, status: 'ACTIVE', board: { id: 'b1', name: 'Planta' }, object: { page: { name: 'Pagina 1' } } }],
    },
    canvasEntityLink: { findMany: async () => [{ targetId: 'h1', entityType: 'inventory_item', metadata: { resolved: { title: 'Tablero GE 200A' } } }] },
  }
  const out = await tool(prisma, 'canvas_hotspots').run({ query: 'tablero' }, actx)
  assert.equal(out.total, 1)
  assert.deepEqual(out.hotspots[0].registros, ['Tablero GE 200A'])
})

test('canvas.board.create: prepare has no side effects; execute uses the service', async () => {
  const calls = []
  const service = { createBoard: async (...args) => { calls.push(args); return { id: 'b9', name: args[2].name } } }
  const [create] = createCanvasMiraiActions({ prisma: {}, service })
  const prepared = await create.prepare({ name: 'Bodega norte', templateType: 'plan' }, actx)
  assert.equal(calls.length, 0)
  assert.equal(prepared.input.templateType, 'plan')
  const out = await create.execute(prepared.input, actx)
  assert.deepEqual(calls[0].slice(0, 2), ['co1', 'me'])
  assert.equal(out.link, '/app/m/runly.canvas/b9')
  assert.match((await create.prepare({ name: 'X', templateType: 'nope' }, actx)).error, /tipo valido/)
})

test('canvas.hotspot.update: only changed fields; execute updates and broadcasts', async () => {
  const prisma = { canvasHotspot: { findFirst: async () => ({ id: 'h1', boardId: 'b1', title: 'Fuga', description: null, status: 'ACTIVE', color: '#ef4444', board: { id: 'b1', name: 'Planta' } }) } }
  const calls = [], events = []
  const service = { updateHotspot: async (...args) => { calls.push(args); return { id: 'h1', title: 'Fuga' } } }
  const broadcaster = { broadcastToChannel: async (...args) => { events.push(args) } }
  const [, update] = createCanvasMiraiActions({ prisma, service, broadcaster })
  const prepared = await update.prepare({ hotspotId: 'h1', status: 'RESOLVED', title: 'Fuga' }, actx)
  assert.deepEqual(prepared.input.data, { status: 'RESOLVED' })
  assert.equal(calls.length, 0)
  await update.execute(prepared.input, actx)
  assert.deepEqual(calls[0], ['co1', 'me', 'b1', 'h1', { status: 'RESOLVED' }])
  assert.equal(events[0][0], 'canvas:board:b1')
  assert.match((await update.prepare({ hotspotId: 'h1', status: 'ACTIVE' }, actx)).error, /nada que cambiar/)
})

test('describeContext: describes an accessible board and ignores other record types', async () => {
  const prisma = { canvasBoard: { findFirst: async () => ({ id: 'b1', name: 'Planta', templateType: 'plan', _count: { pages: 2 } }) } }
  const capability = createCanvasMiraiCapabilities({ prisma, service: {} })
  assert.match(await capability.describeContext({ recordType: 'board', recordId: 'b1' }, actx), /Board de Canvas "Planta".*tipo Plano, 2 pagina/)
  assert.equal(await capability.describeContext({ recordType: 'note', recordId: 'x' }, actx), null)
})
