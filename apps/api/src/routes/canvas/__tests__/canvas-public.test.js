import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasPublicLinksService, createCanvasPublicRouter } from '../canvas-public.js'
import { CanvasServiceError } from '../canvas-service.js'

const TOKEN = 'x'.repeat(43)
const link = (overrides = {}) => ({
  id: 'l1', companyId: 'co1', moduleKey: 'runly.canvas', resourceKey: 'board.view', recordId: 'b1', token: TOKEN,
  mode: 'view', revokedAt: null, expiresAt: null, maxUses: null, useCount: 0, ...overrides,
})
const noLimit = { consume: () => ({ allowed: true }) }

test('public links: only the owner can create, and limits are validated', async () => {
  const roles = []
  const canvas = { assertBoardAccess: async (...args) => { roles.push(args[3]); if (args[1] !== 'owner') throw new CanvasServiceError('No tienes acceso suficiente a este Board.', 403) } }
  const prisma = { modulePublicLink: { create: async ({ data }) => ({ id: 'l1', useCount: 0, createdAt: new Date(), ...data }) } }
  const service = createCanvasPublicLinksService({ prisma, canvas })
  await assert.rejects(() => service.create('co1', 'viewer', 'b1', {}), (error) => error.status === 403)
  const created = await service.create('co1', 'owner', 'b1', { label: 'Clientes', maxUses: 10 })
  assert.equal(roles[0], 'OWNER')
  assert.equal(created.mode, 'view')
  assert.equal(created.status, 'activo')
  assert.ok(created.token.length >= 40)
  await assert.rejects(() => service.create('co1', 'owner', 'b1', { expiresAt: '2000-01-01' }), /futura/)
})

test('public board: revoked or exhausted links are unavailable', async () => {
  const revoked = createCanvasPublicRouter({ prisma: { modulePublicLink: { findUnique: async () => link({ revokedAt: new Date() }) } }, limiter: noLimit })
  const res = await revoked.request(`/public/canvas/${TOKEN}`)
  assert.equal(res.status, 410)
  assert.equal((await res.json()).reason, 'revocado')

  const exhausted = createCanvasPublicRouter({
    prisma: {
      modulePublicLink: { findUnique: async () => link() },
      canvasBoard: { findFirst: async () => ({ id: 'b1', name: 'Planta' }) },
      $queryRaw: async () => [],
    },
    limiter: noLimit,
  })
  assert.equal((await exhausted.request(`/public/canvas/${TOKEN}`)).status, 410)
})

test('public objects: hotspots expose presentation fields only and images are signed per company', async () => {
  let fileWhere
  const prisma = {
    modulePublicLink: { findUnique: async () => link() },
    canvasBoard: { findFirst: async () => ({ id: 'b1' }) },
    canvasPage: { findFirst: async () => ({ id: 'p1' }) },
    canvasObject: {
      findMany: async () => [
        { id: 'o1', type: 'hotspot', properties: {}, hotspot: { id: 'h1', title: 'Tablero', description: 'x', status: 'ACTIVE', icon: 'zap', color: '#f00', archivedAt: null } },
        { id: 'o2', type: 'image', properties: { fileId: 'f1', sourceFileId: 'secret', name: 'plano.pdf' }, hotspot: null },
      ],
    },
    fileAsset: { findMany: async ({ where }) => { fileWhere = where; return [{ id: 'f1' }] } },
  }
  const router = createCanvasPublicRouter({ prisma, limiter: noLimit, signFile: async (id) => `https://signed/${id}` })
  const body = (await (await router.request(`/public/canvas/${TOKEN}/pages/p1/objects`)).json()).data
  assert.deepEqual(Object.keys(body.objects[0].hotspot).sort(), ['color', 'description', 'icon', 'id', 'status', 'title'])
  assert.deepEqual(body.objects[1].properties, { fileId: 'f1', page: null })
  assert.equal(body.imageUrls.f1, 'https://signed/f1')
  assert.equal(fileWhere.entityId, 'co1')
})
