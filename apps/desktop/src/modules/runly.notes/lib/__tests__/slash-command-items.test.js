import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterSlashItems } from '../slashCommandItems.js'

const items = [
  { title: 'Tabla', keywords: ['table', 'tabla'] },
  { title: 'Bloque de codigo', keywords: ['code', 'codigo'] },
  { title: 'Imagen', keywords: ['image', 'imagen', 'foto'], allowedInTable: true },
  { title: 'Canvas de dibujo', keywords: ['drawing', 'dibujo', 'canvas'], allowedInTable: true },
]

test('filterSlashItems returns everything when not inside a table', () => {
  const result = filterSlashItems(items, { query: '', inTable: false })
  assert.deepEqual(result.map((i) => i.title), items.map((i) => i.title))
})

test('filterSlashItems keeps only allowedInTable items when inside a table', () => {
  const result = filterSlashItems(items, { query: '', inTable: true })
  assert.deepEqual(result.map((i) => i.title), ['Imagen', 'Canvas de dibujo'])
})

test('filterSlashItems applies the query filter on top of the table restriction', () => {
  const result = filterSlashItems(items, { query: 'dibujo', inTable: true })
  assert.deepEqual(result.map((i) => i.title), ['Canvas de dibujo'])
})

test('filterSlashItems query matches keywords too, outside a table', () => {
  const result = filterSlashItems(items, { query: 'codigo', inTable: false })
  assert.deepEqual(result.map((i) => i.title), ['Bloque de codigo'])
})
