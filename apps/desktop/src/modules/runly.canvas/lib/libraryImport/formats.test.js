import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LIBRARY_IMPORT_ACCEPT, libraryBaseName, librarySourceKind } from './formats.js'

describe('Canvas library import formats', () => {
  it('accepts Excalidraw libraries and ordinary Excalidraw drawings', () => {
    assert.match(LIBRARY_IMPORT_ACCEPT, /\.excalidrawlib/)
    assert.match(LIBRARY_IMPORT_ACCEPT, /\.excalidraw/)
    assert.equal(librarySourceKind('network.excalidrawlib'), 'excalidraw')
    assert.equal(librarySourceKind('diagram.EXCALIDRAW'), 'excalidraw')
    assert.equal(librarySourceKind('legacy.json'), 'excalidraw')
  })

  it('keeps SVG and ZIP imports and rejects unknown files', () => {
    assert.equal(librarySourceKind('icon.svg'), 'svg')
    assert.equal(librarySourceKind('icons.zip'), 'svg')
    assert.equal(librarySourceKind('notes.txt'), null)
    assert.equal(libraryBaseName('network.excalidraw'), 'network')
  })
})
