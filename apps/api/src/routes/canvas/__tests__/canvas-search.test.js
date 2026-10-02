import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CanvasServiceError } from '../canvas-service.js'
import { createCanvasSearch, rankBoards, searchTerms } from '../canvas-search.js'

describe('canvas search helpers', () => {
  it('normalises terms', () => {
    assert.deepEqual(searchTerms('  Extintor  BODEGA  extintor '), ['extintor', 'bodega'])
    assert.deepEqual(searchTerms('Almacén'), ['almacen'])
    assert.deepEqual(searchTerms('a b'), [])
    assert.deepEqual(searchTerms('x'), ['x'])
  })
  it('requires every term and ranks by field weight', () => {
    const rows = [
      { boardId: 'b1', field: 'hotspot', label: 'Extintor 2', text: 'Extintor 2', term: 'extintor' },
      { boardId: 'b1', field: 'page', label: 'Bodega', text: 'Bodega', term: 'bodega' },
      { boardId: 'b2', field: 'name', label: 'Extintores', text: 'Extintores', term: 'extintor' },
    ]
    const ranked = rankBoards(rows, ['extintor', 'bodega'])
    assert.deepEqual(ranked.map((r) => r.boardId), ['b1'])
    assert.equal(ranked[0].score, 7)
    assert.deepEqual(ranked[0].matches.map((m) => m.field), ['hotspot', 'page'])
  })
  it('halves fuzzy hits', () => {
    const ranked = rankBoards([{ boardId: 'b', field: 'name', label: 'Extintor', text: 'Extintor', term: 'extintr', fuzzy: true }], ['extintr'])
    assert.equal(ranked[0].score, 5)
  })
})

describe('createCanvasSearch', () => {
  it('rejects a query outside 2..120 chars', async () => {
    const service = createCanvasSearch({ prisma: {} })
    await assert.rejects(() => service.search('company-1', 'user-1', 'x'), CanvasServiceError)
    await assert.rejects(() => service.search('company-1', 'user-1', 'a'.repeat(121)), CanvasServiceError)
  })
  it('rejects a query that normalises to no terms', async () => {
    const service = createCanvasSearch({ prisma: {} })
    await assert.rejects(() => service.search('company-1', 'user-1', 'a b'), CanvasServiceError)
  })
  it('returns [] without querying further when the actor has no accessible boards', async () => {
    let called = false
    const prisma = { canvasBoard: { findMany: async () => { called = true; return [] } } }
    const service = createCanvasSearch({ prisma })
    const result = await service.search('company-1', 'user-1', 'extintor')
    assert.deepEqual(result, [])
    assert.ok(called)
  })
  it('scopes the board lookup to accessible, non-archived boards of the company', async () => {
    let where
    const prisma = {
      canvasBoard: { findMany: async (args) => { where = args.where; return [{ id: 'b1' }] } },
      $queryRaw: async () => [],
    }
    const service = createCanvasSearch({ prisma })
    await service.search('company-1', 'user-1', 'extintor')
    assert.equal(where.companyId, 'company-1')
    assert.equal(where.archivedAt, null)
    assert.deepEqual(where.OR, [{ ownerId: 'user-1' }, { collaborators: { some: { userId: 'user-1' } } }])
  })
})
