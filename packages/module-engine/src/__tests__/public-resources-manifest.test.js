import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../define-module.js'

const base = {
  key: 'custom.encuestas', name: 'Encuestas', version: '1.0.0',
  icon: 'Box', color: '#336699', pwa: { shortName: 'Encuestas', startPath: '/encuestas' },
  permissions: [{ key: 'encuestas.encuesta.update', name: 'Editar' }],
}
const resource = {
  key: 'encuesta.responder', entity: 'encuesta', mode: 'submit',
  view: 'encuestas.responder-publica', title: 'Responder encuesta',
  managePermission: 'encuestas.encuesta.update',
}

test('accepts a valid publicResources entry', () => {
  const r = validateManifest({ ...base, publicResources: [resource] })
  assert.deepEqual(r.errors, [])
})

test('rejects bad mode, duplicate key and unknown permission', () => {
  const r = validateManifest({
    ...base,
    publicResources: [
      { ...resource, mode: 'edit' },
      { ...resource, managePermission: 'otro.permiso' },
    ],
  })
  assert.ok(r.errors.some((e) => e.includes('.mode')))
  assert.ok(r.errors.some((e) => e.includes('duplicated')))
  assert.ok(r.errors.some((e) => e.includes('managePermission')))
})

test('rejects more than 20 resources', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ ...resource, key: `r${i}x` }))
  const r = validateManifest({ ...base, publicResources: many })
  assert.ok(r.errors.some((e) => e.includes('at most 20')))
})
