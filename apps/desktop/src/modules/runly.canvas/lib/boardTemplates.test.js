import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { initialLayerId, mediaTargetLayer, parseEmptyAction } from './boardTemplates.js'

const layers = [
  { id: 'doc', type: 'vector', metadata: { mediaTarget: true, lockAfterInsert: true } },
  { id: 'notes', type: 'vector', metadata: {} },
  { id: 'pins', type: 'hotspot', metadata: {} },
]

describe('Canvas template helpers', () => {
  it('starts on the first drawing layer that is not the media backdrop', () => {
    assert.equal(initialLayerId({ layers }), 'notes')
    assert.equal(initialLayerId({ layers: [layers[0], layers[2]] }), 'doc')
    assert.equal(initialLayerId({ layers: [layers[2]] }), 'pins')
    assert.equal(initialLayerId({ layers: [] }), null)
  })

  it('finds the media target layer', () => {
    assert.equal(mediaTargetLayer(layers).id, 'doc')
    assert.equal(mediaTargetLayer([layers[1]]), null)
  })

  it('parses empty-state actions', () => {
    assert.deepEqual(parseEmptyAction('insert-media'), { type: 'insert-media' })
    assert.deepEqual(parseEmptyAction('tool:rectangle'), { type: 'tool', tool: 'rectangle' })
    assert.deepEqual(parseEmptyAction('map'), { type: 'map' })
    assert.equal(parseEmptyAction('tool:laser'), null)
    assert.equal(parseEmptyAction(undefined), null)
  })
})
