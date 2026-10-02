import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLayerTree, moveElement, reorderedLayerIds } from './layerTree.js'

const layers = [{ id: 'L1', name: 'Fondo', position: 0 }, { id: 'L2', name: 'Dibujo', position: 1 }]
const rows = [
  { id: 'a', layerId: 'L2', position: 1 }, { id: 'b', layerId: 'L2', position: 3 }, { id: 'c', layerId: 'L2', position: 2 },
  { id: 'd', layerId: 'L1', position: 0 },
]

describe('layer tree', () => {
  it('lists layers top-most first and elements top-most first', () => {
    const tree = buildLayerTree(layers, rows)
    assert.deepEqual(tree.map((l) => l.id), ['L2', 'L1'])
    assert.deepEqual(tree[0].elements.map((e) => e.id), ['b', 'c', 'a'])
  })
  it('computes new positions when moving an element to the top of its layer', () => {
    const patches = moveElement(rows, 'a', { layerId: 'L2', index: 0 })
    const byId = Object.fromEntries(patches.map((p) => [p.id, p]))
    // Renumbering assigns position = count - treeIndex across the whole
    // destination layer (b, c keep their relative order below a), so "a ends
    // on top" is expressed as the highest position among the layer's
    // elements rather than a value above its own old position.
    assert.ok(byId.a.position > byId.b.position)
    assert.ok(byId.a.position > byId.c.position)
    assert.equal(byId.a.layerId, undefined)
  })
  it('moves an element into another layer at a given tree index', () => {
    const patches = moveElement(rows, 'b', { layerId: 'L1', index: 1 })
    const byId = Object.fromEntries(patches.map((p) => [p.id, p]))
    // d (already in L1) gets renumbered too, since the whole destination
    // layer is renumbered; "b ends below d" is expressed as b's position
    // landing under d's new one, not under zero.
    assert.equal(byId.b.layerId, 'L1')
    assert.ok(byId.b.position < byId.d.position)
  })
  it('turns a visual layer order into the API order (bottom first)', () => {
    assert.deepEqual(reorderedLayerIds(['L1', 'L2']), ['L2', 'L1'])
  })
})
