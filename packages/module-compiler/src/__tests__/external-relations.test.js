import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileModule, validateModuleDefinition } from '../index.js'

const VEHICLE = '0192f000-0000-7000-8000-0000000000a1'
const BASE = {
  schemaVersion: 1, key: 'custom.mantenimiento', name: 'Mantenimiento', version: '1.0.0', icon: 'Wrench', color: '#2563EB',
  pwa: { shortName: 'Mant', startPath: '/servicios' },
  entities: [{ key: 'servicio', label: 'Servicio', pluralLabel: 'Servicios', fields: [
    { key: 'descripcion', type: 'text', label: 'Descripción' },
    { key: 'vehiculo', type: 'relation', label: 'Vehículo', targetExternal: 'vehicle', required: true },
  ] }],
}
const fileOf = (compiled, path) => compiled.files.find((file) => file.path === path)?.content

test('validation and automatic dependency on the owning module', () => {
  const bad = structuredClone(BASE)
  bad.entities[0].fields[1].targetExternal = 'nave'
  assert.ok(validateModuleDefinition(bad).errors.some((error) => error.code === 'EXTERNAL_RELATION_TARGET_NOT_FOUND'))
  const conflict = structuredClone(BASE)
  conflict.entities[0].fields[1].targetEntity = 'servicio'
  assert.ok(validateModuleDefinition(conflict).errors.some((error) => error.code === 'RELATION_TARGET_CONFLICT'))
  const compiled = compileModule(structuredClone(BASE))
  assert.deepEqual(compiled.definition.dependencies.map((dependency) => dependency.key), ['runly.core', 'runly.fleet'])
  assert.match(fileOf(compiled, 'module.manifest.js'), /runly\.fleet/)
})

test('views use the relation-targets search and show label + link', () => {
  const compiled = compileModule(structuredClone(BASE))
  assert.match(fileOf(compiled, 'views/servicio.form.js'), /apiPath: '\/relation-targets\/vehicle\/search', labelField: 'title', valueField: 'id'/)
  assert.match(fileOf(compiled, 'views/servicio.table.js'), /field: 'vehiculo__label'/)
  assert.match(fileOf(compiled, 'views/servicio.detail.js'), /type: 'external-link', urlField: 'vehiculo__url'/)
  const routes = fileOf(compiled, 'api/servicio-routes.js')
  assert.equal((routes.match(/assertExternalTargets\(c, moduleContext, parsed\.data\)/g) ?? []).length, 2)
  assert.equal((routes.match(/withExternalLabels\(/g) ?? []).length, 2)
})

test('generated code validates targets and adds labels through moduleContext.relations', async () => {
  const compiled = compileModule(structuredClone(BASE))
  const dir = await mkdtemp(join(process.cwd(), '.tmp-external-'))
  try {
    for (const file of compiled.files.filter((item) => item.path.startsWith('api/'))) {
      await mkdir(dirname(join(dir, file.path)), { recursive: true })
      await writeFile(join(dir, file.path), file.content)
    }
    const { assertExternalTargets, withExternalLabels } = await import(pathToFileURL(join(dir, 'api/servicio-relations.js')).href)
    const calls = []
    const moduleContext = { relations: { resolve: async (_c, type, ids) => { calls.push([type, ids]); return new Map(ids.filter((id) => id === VEHICLE).map((id) => [id, { title: 'ABC-123', subtitle: 'Nissan NP300', url: `/app/m/runly.fleet/vehicles/${id}` }])) } } }
    await assertExternalTargets({}, moduleContext, { vehiculo: VEHICLE })
    await assert.rejects(assertExternalTargets({}, moduleContext, { vehiculo: 'otro' }), (error) => error.status === 400 && /Vehículo/.test(error.message))
    const rows = await withExternalLabels({}, moduleContext, [{ vehiculo: VEHICLE }, { vehiculo: 'otro' }, { vehiculo: null }])
    assert.equal(rows[0].vehiculo__label, 'ABC-123 · Nissan NP300')
    assert.equal(rows[0].vehiculo__url, `/app/m/runly.fleet/vehicles/${VEHICLE}`)
    assert.match(rows[1].vehiculo__label, /No disponible/)
    assert.deepEqual(calls.at(-1), ['vehicle', [VEHICLE, 'otro']])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
