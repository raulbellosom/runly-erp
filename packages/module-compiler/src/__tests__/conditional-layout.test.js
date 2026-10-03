import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { compileModule, validateModuleDefinition } from '../index.js'

const BASE = {
  schemaVersion: 1,
  key: 'custom.clientes',
  name: 'Clientes',
  version: '1.0.0',
  icon: 'Users',
  color: '#2563EB',
  pwa: { shortName: 'Clientes', startPath: '/clientes' },
  entities: [{
    key: 'cliente', label: 'Cliente', pluralLabel: 'Clientes',
    fields: [
      { key: 'nombre', type: 'text', label: 'Nombre', required: true },
      { key: 'tipo', type: 'select', label: 'Tipo', options: ['PERSONA', 'EMPRESA'] },
      { key: 'rfc', type: 'text', label: 'RFC', required: true },
      { key: 'credito', type: 'boolean', label: 'Con credito' },
      { key: 'limite', type: 'decimal', label: 'Limite', required: true },
    ],
  }],
}

const LAYOUT = {
  tabs: [
    { key: 'general', label: 'General', sections: [
      { key: 'datos', label: 'Datos', fields: ['nombre', 'tipo', 'credito'] },
      { key: 'fiscal', label: 'Fiscal', fields: ['rfc'], visibleWhen: { field: 'tipo', equals: 'EMPRESA' } },
    ] },
    { key: 'credito_tab', label: 'Credito', visibleWhen: { field: 'credito', truthy: true }, sections: [
      { key: 'limites', label: 'Limites', fields: ['limite'] },
    ] },
  ],
}

function withLayout(layout) {
  const definition = structuredClone(BASE)
  definition.entities[0].layout = layout
  return definition
}

function codes(layout) {
  return validateModuleDefinition(withLayout(layout)).errors.map((error) => error.code)
}

function viewSchema(compiled, path) {
  const content = compiled.files.find((file) => file.path === path).content
  return JSON.parse(content.slice(content.indexOf('defineView(') + 11, content.lastIndexOf(')'))).schema
}

test('valid rules pass', () => {
  assert.deepEqual(validateModuleDefinition(withLayout(LAYOUT)).errors, [])
})

test('rule validation codes', () => {
  const bad = structuredClone(LAYOUT)
  bad.tabs[0].sections[1].visibleWhen = { field: 'nombre', equals: 'x' }
  bad.tabs[1].visibleWhen = { field: 'tipo', equals: 'OTRO' }
  bad.tabs[0].sections[0].visibleWhen = { field: 'tipo', equals: 'EMPRESA', truthy: true }
  bad.tabs[1].sections[0].fieldRules = { nombre: { field: 'tipo', in: ['EMPRESA'] }, limite: { field: 'fantasma', truthy: true } }
  const found = codes(bad)
  for (const code of ['LAYOUT_RULE_FIELD_TYPE', 'LAYOUT_RULE_UNKNOWN_OPTION', 'LAYOUT_RULE_INVALID', 'LAYOUT_RULE_FIELD_NOT_PLACED', 'LAYOUT_RULE_FIELD_NOT_FOUND']) assert.ok(found.includes(code), code)
  const selfHiding = structuredClone(LAYOUT)
  selfHiding.tabs[0].sections[0].visibleWhen = { field: 'tipo', equals: 'EMPRESA' }
  assert.ok(codes(selfHiding).includes('LAYOUT_RULE_SELF_HIDING'))
})

test('rules are emitted on tabs, sections and fields; detail can use its own tree', () => {
  const layout = structuredClone(LAYOUT)
  layout.tabs[0].sections[0].fieldRules = { credito: { field: 'tipo', equals: 'EMPRESA' } }
  layout.detail = { tabs: [{ key: 'resumen', label: 'Resumen', sections: [{ key: 'todo', label: 'Todo', fields: ['nombre'] }] }] }
  const compiled = compileModule(withLayout(layout))
  const form = viewSchema(compiled, 'views/cliente.form.js')
  assert.deepEqual(form.tabs[1].visibleWhen, { field: 'credito', truthy: true })
  assert.deepEqual(form.sections.find((section) => section.id === 'fiscal').visibleWhen, { field: 'tipo', equals: 'EMPRESA' })
  assert.deepEqual(form.sections[0].fields.find((field) => field.field === 'credito').visibleWhen, { field: 'tipo', equals: 'EMPRESA' })
  const detail = viewSchema(compiled, 'views/cliente.detail.js')
  assert.equal(detail.tabs, undefined)
  assert.deepEqual(detail.sections.map((section) => section.id), ['todo', 'otros_datos', 'audit'])
})

test('conditional required fields are optional in the validator and enforced by the routes', async () => {
  const compiled = compileModule(withLayout(LAYOUT))
  const validators = compiled.files.find((file) => file.path === 'validators/cliente.validators.js').content
  const createBlock = validators.slice(0, validators.indexOf('updateClienteSchema'))
  assert.match(createBlock, /rfc: z\.string\(\)\.optional\(\)/)
  assert.match(createBlock, /nombre: z\.string\(\)\.min\(1\)/)
  const routes = compiled.files.find((file) => file.path === 'api/cliente-routes.js').content
  assert.equal((routes.match(/findMissingConditionalRequired\(/g) ?? []).length, 2)
  assert.match(routes, /const existing = await service\.getClienteById/)

  const visibility = compiled.files.find((file) => file.path === 'api/cliente-visibility.js').content
  const dir = await mkdtemp(join(process.cwd(), '.tmp-visibility-'))
  try {
    await writeFile(join(dir, 'visibility.mjs'), visibility)
    await writeFile(join(dir, 'routes.mjs'), routes)
    execFileSync(process.execPath, ['--check', join(dir, 'routes.mjs')])
    const { findMissingConditionalRequired } = await import(pathToFileURL(join(dir, 'visibility.mjs')).href)
    assert.equal(findMissingConditionalRequired({ tipo: 'PERSONA' }), null)
    assert.equal(findMissingConditionalRequired({ tipo: 'EMPRESA' })?.field, 'rfc')
    assert.equal(findMissingConditionalRequired({ tipo: 'EMPRESA', rfc: 'XAXX010101000' }), null)
    assert.equal(findMissingConditionalRequired({ credito: true, tipo: 'PERSONA' })?.field, 'limite')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('entities without conditional required fields get no visibility module', () => {
  const compiled = compileModule(structuredClone(BASE))
  assert.ok(!compiled.files.some((file) => file.path.endsWith('-visibility.js')))
})
