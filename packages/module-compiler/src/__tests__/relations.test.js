import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { compileModule, validateModuleDefinition } from '../index.js'

const COMPANY = '0192f000-0000-7000-8000-000000000001'
const CLIENT = '0192f000-0000-7000-8000-0000000000c1'

const BASE = {
  schemaVersion: 1,
  key: 'custom.ventas',
  name: 'Ventas',
  version: '1.0.0',
  icon: 'Users',
  color: '#2563EB',
  pwa: { shortName: 'Ventas', startPath: '/clientes' },
  entities: [
    { key: 'cliente', label: 'Cliente', pluralLabel: 'Clientes', fields: [{ key: 'nombre', type: 'text', label: 'Nombre', required: true }] },
    { key: 'pedido', label: 'Pedido', pluralLabel: 'Pedidos', fields: [
      { key: 'folio', type: 'text', label: 'Folio' },
      { key: 'total', type: 'decimal', label: 'Total' },
      { key: 'cliente', type: 'relation', label: 'Cliente', targetEntity: 'cliente', required: true },
    ] },
    { key: 'nota', label: 'Nota', pluralLabel: 'Notas', fields: [
      { key: 'texto', type: 'text', label: 'Texto' },
      { key: 'cliente', type: 'relation', label: 'Cliente', targetEntity: 'cliente', onDisable: 'cascade' },
    ] },
    { key: 'etiqueta', label: 'Etiqueta', pluralLabel: 'Etiquetas', fields: [
      { key: 'nombre', type: 'text', label: 'Nombre' },
      { key: 'cliente', type: 'relation', label: 'Cliente', targetEntity: 'cliente', onDisable: 'setNull' },
    ] },
  ],
}

const codes = (definition) => validateModuleDefinition(definition).errors.map((error) => error.code)
const fileOf = (compiled, path) => compiled.files.find((file) => file.path === path)?.content

test('relation diagnostics', () => {
  assert.deepEqual(codes(structuredClone(BASE)), [])
  const bad = structuredClone(BASE)
  bad.entities[1].fields[2].labelField = 'fantasma'
  bad.entities[1].fields[2].onDisable = 'setNull'
  bad.entities[2].fields[1].onDisable = 'borrar'
  const found = codes(bad)
  for (const code of ['RELATION_LABEL_FIELD_NOT_FOUND', 'RELATION_SET_NULL_REQUIRED', 'RELATION_INVALID_ON_DISABLE']) assert.ok(found.includes(code), code)
  const cycle = structuredClone(BASE)
  cycle.entities[0].fields.push({ key: 'nota', type: 'relation', label: 'Nota', targetEntity: 'nota', onDisable: 'cascade' })
  assert.ok(codes(cycle).includes('RELATION_CASCADE_CYCLE'))
})

test('services join labels, filter by relation and wire integrity', () => {
  const compiled = compileModule(structuredClone(BASE))
  const pedidoService = fileOf(compiled, 'api/pedido-service.js')
  assert.match(pedidoService, /r0\.nombre AS cliente__label/)
  assert.match(pedidoService, /LEFT JOIN ventas_cliente r0 ON r0\.id = t\.cliente AND r0\.company_id = t\.company_id/)
  assert.match(pedidoService, /t\.cliente = \$\{clienteFilter\}::uuid/)
  assert.equal((pedidoService.match(/await assertRelationTargets\(/g) ?? []).length, 2)
  assert.match(fileOf(compiled, 'api/pedido-routes.js'), /const cliente = c\.req\.query\('cliente'\)/)
  const clienteService = fileOf(compiled, 'api/cliente-service.js')
  assert.match(clienteService, /prisma\.\$transaction\(\(tx\) => createClienteService/)
  assert.match(clienteService, /await beforeDisable\(prisma/)
  assert.match(fileOf(compiled, 'views/pedido.table.js'), /field: 'cliente__label'/)
  assert.match(fileOf(compiled, 'views/pedido.form.js'), /labelField: 'nombre'/)
})

function fakeDb({ counts = 0, children = [], targetExists = true } = {}) {
  const calls = []
  const query = (strings, ...values) => {
    const sql = strings.join('?')
    calls.push({ sql, values })
    if (sql.includes('COUNT(*)')) return Promise.resolve([{ total: counts }])
    if (sql.startsWith('SELECT id FROM ventas_nota')) return Promise.resolve(children)
    if (sql.startsWith('SELECT id FROM ventas_cliente')) return Promise.resolve(targetExists ? [{ id: CLIENT }] : [])
    return Promise.resolve([{ id: values.find((value) => typeof value === 'string' && value.startsWith('0192')) ?? 'x' }])
  }
  const tx = { calls, $queryRaw: query, $executeRaw: query, auditLog: { create: async () => ({}) } }
  // The transaction client deliberately has no $transaction of its own.
  return { ...tx, $transaction: async (fn) => fn(tx) }
}

test('generated integrity runs: restrict blocks, setNull clears, cascade disables children', async () => {
  const compiled = compileModule(structuredClone(BASE))
  const dir = await mkdtemp(join(process.cwd(), '.tmp-relations-'))
  try {
    for (const file of compiled.files.filter((item) => item.path.startsWith('api/'))) {
      const target = join(dir, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content)
      execFileSync(process.execPath, ['--check', target])
    }
    const load = (name) => import(pathToFileURL(join(dir, 'api', name)).href)
    const { createClienteService } = await load('cliente-service.js')
    const { assertRelationTargets } = await load('pedido-relations.js')

    await assert.rejects(
      createClienteService({ prisma: fakeDb({ counts: 3 }) }).setClienteEnabled({ companyId: COMPANY, id: CLIENT, enabled: false }),
      (error) => error.status === 409 && /3 Pedidos/.test(error.message),
    )

    const db = fakeDb({ counts: 0, children: [{ id: '0192f000-0000-7000-8000-0000000000a1' }] })
    await createClienteService({ prisma: db }).setClienteEnabled({ companyId: COMPANY, id: CLIENT, enabled: false })
    const sqls = db.calls.map((call) => call.sql.trim())
    assert.ok(sqls.some((sql) => sql.startsWith('UPDATE ventas_etiqueta SET cliente = NULL')))
    assert.ok(sqls.some((sql) => sql.startsWith('UPDATE ventas_nota SET enabled')))
    assert.ok(sqls.some((sql) => sql.startsWith('UPDATE ventas_cliente SET enabled')))

    await assert.rejects(
      assertRelationTargets(fakeDb({ targetExists: false }), { companyId: COMPANY, data: { cliente: CLIENT } }),
      (error) => error.status === 400 && /Cliente/.test(error.message),
    )
    await assertRelationTargets(fakeDb(), { companyId: COMPANY, data: { cliente: CLIENT } })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('related section renders in the detail only', () => {
  const definition = structuredClone(BASE)
  definition.entities[0].layout = { tabs: [
    { key: 'general', label: 'General', sections: [{ key: 'datos', label: 'Datos', fields: ['nombre'] }] },
    { key: 'pedidos_tab', label: 'Pedidos', sections: [{ key: 'pedidos', type: 'related', label: 'Pedidos', source: { entity: 'pedido', field: 'cliente' } }] },
  ] }
  const compiled = compileModule(definition)
  const detail = JSON.parse(fileOf(compiled, 'views/cliente.detail.js').match(/defineView\(([\s\S]*)\)\s*$/)[1]).schema
  const related = detail.sections.find((section) => section.id === 'pedidos')
  assert.equal(related.type, 'relation-list')
  assert.equal(related.relationList.apiPath, '/ventas/pedidos?cliente=:id&pageSize=50')
  assert.equal(related.relationList.hrefTemplate, '/app/m/custom.ventas/ventas-pedidos/:id')
  assert.equal(detail.tabs.length, 2)
  const form = JSON.parse(fileOf(compiled, 'views/cliente.form.js').match(/defineView\(([\s\S]*)\)\s*$/)[1]).schema
  assert.ok(!form.sections.some((section) => section.id === 'pedidos'))
  assert.equal(form.tabs, undefined)

  const bad = structuredClone(definition)
  bad.entities[0].layout.tabs[1].sections[0].source = { entity: 'pedido', field: 'folio' }
  assert.ok(codes(bad).includes('LAYOUT_RELATED_INVALID_SOURCE'))
})
