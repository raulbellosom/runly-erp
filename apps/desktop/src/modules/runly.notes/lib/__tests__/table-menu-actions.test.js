import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTableMenuActions, tableMenuSections } from '../tableMenuActions.js'

function fakeEditor() {
  const calls = []
  const chain = {}
  for (const method of [
    'focus', 'addColumnAfter', 'addColumnBefore', 'addRowAfter', 'addRowBefore',
    'deleteColumn', 'deleteRow', 'deleteTable',
  ]) {
    chain[method] = () => { calls.push(method); return chain }
  }
  chain.run = () => { calls.push('run'); return true }
  return { editor: { chain: () => chain }, calls }
}

test('getTableMenuActions returns the 7 expected actions in order', () => {
  const { editor } = fakeEditor()
  const actions = getTableMenuActions(editor)
  assert.deepEqual(actions.map((a) => a.label), [
    'Agregar columna a la derecha',
    'Agregar columna a la izquierda',
    'Agregar fila abajo',
    'Agregar fila arriba',
    'Eliminar columna',
    'Eliminar fila',
    'Eliminar tabla',
  ])
})

test('getTableMenuActions marks only the delete actions as destructive', () => {
  const { editor } = fakeEditor()
  const actions = getTableMenuActions(editor)
  assert.deepEqual(
    actions.filter((a) => a.destructive).map((a) => a.label),
    ['Eliminar columna', 'Eliminar fila', 'Eliminar tabla'],
  )
})

test('each action onClick chains focus() through to the matching command and run()', () => {
  const { editor, calls } = fakeEditor()
  const actions = getTableMenuActions(editor)
  actions[0].onClick()
  assert.deepEqual(calls, ['focus', 'addColumnAfter', 'run'])
})

test('tableMenuSections groups consecutive same-group actions for divider placement', () => {
  const { editor } = fakeEditor()
  const sections = tableMenuSections(getTableMenuActions(editor))
  assert.deepEqual(sections.map((s) => s.group), ['add', 'delete-cell', 'delete-table'])
  assert.deepEqual(sections.map((s) => s.items.length), [4, 2, 1])
})
