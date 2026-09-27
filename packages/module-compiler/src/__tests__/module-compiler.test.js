import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { compileModule, normalizeModuleDefinition, validateModuleDefinition } from '../index.js'
import { writeCompiledModule } from '../../../../scripts/scaffold/writer.js'
import { loadModuleManifest, loadModuleModels, loadModuleViews } from '../../../../apps/api/src/services/module-discovery-service.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..')

const BASIC = {
  schemaVersion: 1,
  key: 'custom.compilerfixture',
  name: 'Compiler Fixture',
  version: '1.0.0',
  description: 'Fixture determinista',
  icon: 'Truck',
  color: '#2563EB',
  pwa: { shortName: 'Compiler', startPath: '/vehicles' },
  entities: [{
    key: 'vehicle', label: 'Vehículo', pluralLabel: 'Vehículos',
    fields: [
      { key: 'plate', type: 'text', label: 'Placa', required: true },
      { key: 'brand', type: 'text', label: 'Marca' },
      { key: 'mileage', type: 'number', label: 'Kilometraje' },
    ],
  }],
}

test('validates and normalizes ModuleDefinition v1 defaults', () => {
  const normalized = normalizeModuleDefinition(BASIC)
  assert.equal(validateModuleDefinition(normalized).valid, true)
  assert.equal(normalized.entities[0].companyScoped, true)
  assert.equal(normalized.entities[0].softDelete, true)
  assert.equal(normalized.permissions.length, 4)
  assert.deepEqual(normalized.views.map((view) => view.kind), ['TABLE', 'FORM', 'DETAIL', 'PAGE'])
  assert.equal(normalized.navigation.length, 1)
})

test('returns structured diagnostics for invalid version, duplicates, relation and select configuration', () => {
  const invalid = normalizeModuleDefinition({
    ...BASIC,
    schemaVersion: 9,
    entities: [
      { key: 'vehicle', label: 'A', fields: [{ key: 'status', type: 'select', label: 'Estado', options: [] }] },
      { key: 'vehicle', label: 'B', fields: [{ key: 'owner', type: 'relation', label: 'Owner', targetEntity: 'missing' }] },
    ],
  })
  const result = validateModuleDefinition(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.every((error) => error.path && error.code && error.message))
  assert.ok(result.errors.some((error) => error.code === 'UNSUPPORTED_SCHEMA_VERSION'))
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_ENTITY_KEY'))
  assert.ok(result.errors.some((error) => error.code === 'INVALID_SELECT_OPTIONS'))
  assert.ok(result.errors.some((error) => error.code === 'RELATION_TARGET_NOT_FOUND'))
})

test('rejects non-JSON values and source-code injection before normalization', () => {
  const withFunction = { ...structuredClone(BASIC), extension: () => 'code' }
  assert.throws(() => compileModule(withFunction), (error) => error.diagnostics.errors[0].code === 'NOT_JSON_COMPATIBLE')
  const withQuote = structuredClone(BASIC)
  withQuote.entities[0].fields[0].label = "Nombre'; process.exit() //"
  assert.throws(() => compileModule(withQuote), (error) => error.diagnostics.errors.some((item) => item.code === 'UNSAFE_SOURCE_TEXT'))
})

// name/description are JSON.stringify()'d in generateManifest() (unlike
// entity/field/permission/navigation labels, still naively interpolated
// above), so ordinary punctuation a user is likely to type — an apostrophe,
// a quote, a backslash — must validate and compile cleanly instead of
// tripping UNSAFE_SOURCE_TEXT. Found via a real Module Builder session: the
// default "inventario ligero" template failed Validar out of the box.
test('name/description with quotes, apostrophes and backslashes validate and compile safely', () => {
  const withPunctuation = {
    ...structuredClone(BASIC),
    name: "Juan's Fleet \"Ops\"",
    description: 'Ruta: C:\\datos\\flota — no se pudo importar; revisar \'origen\'.',
  }
  const normalized = normalizeModuleDefinition(withPunctuation)
  assert.equal(validateModuleDefinition(normalized).valid, true)
  const { files } = compileModule(withPunctuation)
  const manifestSource = files.find((f) => f.path === 'module.manifest.js').content
  // The generator must have gone through JSON.stringify() (double-quoted,
  // backslash/quote-escaped), never naive single-quote interpolation — this
  // is what makes the apostrophe/quote/backslash above safe to emit at all.
  assert.ok(manifestSource.includes(`name: ${JSON.stringify(withPunctuation.name)},`))
  assert.ok(manifestSource.includes(`description: ${JSON.stringify(withPunctuation.description)},`))
})

test('compiles deterministic manifest, model, views, API and lifecycle ownership', () => {
  const first = compileModule(BASIC)
  const second = compileModule(JSON.parse(JSON.stringify(BASIC)))
  assert.deepEqual(first.files, second.files)
  assert.equal(first.packageHash, second.packageHash)
  const paths = first.files.map((file) => file.path)
  for (const expected of [
    '.module-definition.json', 'module.manifest.js', 'models/vehicle.model.js',
    'views/vehicle.table.js', 'views/vehicle.form.js', 'views/vehicle.detail.js',
    'views/vehicle.page.js', 'api/vehicle-routes.js', 'api/vehicle-service.js',
    'validators/vehicle.validators.js',
  ]) assert.ok(paths.includes(expected), expected)
  const manifest = first.files.find((file) => file.path === 'module.manifest.js').content
  assert.match(manifest, /compilerfixture\.vehicle\.read/)
  assert.match(manifest, /ownedTables:[\s\S]*'compilerfixture_vehicle'/)
})

test('crud-custom remains a compiler preset', () => {
  const result = compileModule({ ...BASIC, preset: 'crud-custom' })
  assert.ok(result.files.some((file) => file.path === 'components/ModuleDashboard.jsx'))
  assert.ok(result.files.some((file) => file.path === 'views/dashboard.custom.js'))
})

test('compiles and self-hosts a declarative DASHBOARD deterministically', async (t) => {
  const definition = structuredClone(BASIC)
  definition.entities[0].fields.push({ key: 'status', type: 'select', label: 'Estado', options: ['ACTIVE', 'MAINTENANCE'] })
  definition.views = [{
    key: 'compilerfixture.dashboard', kind: 'DASHBOARD', title: 'Resumen',
    widgets: [
      { key: 'totalVehicles', type: 'stat', title: 'Vehículos', source: { entity: 'vehicle', aggregate: 'count' } },
      { key: 'vehiclesByStatus', type: 'chart', chart: 'bar', title: 'Por estado', source: { entity: 'vehicle', groupBy: 'status', aggregate: 'count' } },
    ],
  }]
  definition.navigation = []
  const first = compileModule(definition)
  const second = compileModule(structuredClone(definition))
  assert.equal(first.packageHash, second.packageHash)
  assert.ok(first.files.some((file) => file.path === 'views/dashboard.dashboard.js'))
  const root = await fs.mkdtemp(path.join(REPO_ROOT, '.tmp-dashboard-compiler-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  writeCompiledModule(first, root)
  const manifest = await loadModuleManifest({ manifestPath: path.join(root, 'module.manifest.js'), source: 'custom' })
  const views = await loadModuleViews({ moduleDir: root, manifest: manifest.manifest })
  assert.equal(views.find((view) => view.kind === 'DASHBOARD')?.schema.widgets.length, 2)
})

test('rejects invalid dashboard references and aggregates', () => {
  const definition = structuredClone(BASIC)
  definition.views = [{ key: 'compilerfixture.dashboard', kind: 'DASHBOARD', title: 'Resumen', widgets: [
    { key: 'bad', type: 'stat', title: 'Bad', source: { entity: 'missing', aggregate: 'count' } },
    { key: 'badSum', type: 'stat', title: 'Bad sum', source: { entity: 'vehicle', aggregate: 'sum', aggregateField: 'plate' } },
  ] }]
  assert.throws(() => compileModule(definition), (error) => {
    const codes = error.diagnostics.errors.map((item) => item.code)
    return codes.includes('UNKNOWN_ENTITY') && codes.includes('AGGREGATE_TYPE_MISMATCH')
  })
})

test('compiles a deterministic declarative KANBAN with labeled columns', () => {
  const definition = structuredClone(BASIC)
  definition.entities[0].fields.push({ key: 'status', type: 'select', label: 'Estado', options: [{ value: 'NEW', label: 'Nuevo' }, { value: 'DONE', label: 'Terminado' }] })
  definition.views = [{ key: 'compilerfixture.kanban', kind: 'KANBAN', title: 'Flujo', entity: 'vehicle', groupBy: 'status', card: { titleField: 'plate', subtitleField: 'brand' } }]
  definition.navigation = []
  const first = compileModule(definition)
  const second = compileModule(structuredClone(definition))
  assert.equal(first.packageHash, second.packageHash)
  const file = first.files.find((item) => item.path === 'views/kanban.kanban.js')
  assert.ok(file)
  assert.match(file.content, /"label": "Nuevo"/)
  assert.match(first.files.find((item) => item.path === 'validators/vehicle.validators.js').content, /nullable\(\)\.optional\(\)/)
})

test('rejects invalid KANBAN grouping and card references', () => {
  const definition = structuredClone(BASIC)
  definition.views = [{ key: 'compilerfixture.kanban', kind: 'KANBAN', entity: 'vehicle', groupBy: 'plate', card: { titleField: 'missing' } }]
  assert.throws(() => compileModule(definition), (error) => {
    const codes = error.diagnostics.errors.map((item) => item.code)
    return codes.includes('INVALID_GROUP_FIELD_TYPE') && codes.includes('UNKNOWN_CARD_FIELD')
  })
})

test('self-hosted output loads through the real RME3 discovery loaders', async (t) => {
  const root = await fs.mkdtemp(path.join(REPO_ROOT, '.tmp-module-compiler-'))
  const packageDir = path.join(root, BASIC.key)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const compiled = compileModule(BASIC)
  writeCompiledModule(compiled, packageDir)
  const manifestResult = await loadModuleManifest({
    manifestPath: path.join(packageDir, 'module.manifest.js'),
    source: 'custom',
  })
  assert.equal(manifestResult.status, 'VALID')
  const models = await loadModuleModels({ moduleDir: packageDir, manifest: manifestResult.manifest })
  const views = await loadModuleViews({ moduleDir: packageDir, manifest: manifestResult.manifest })
  assert.equal(models.length, 1)
  assert.equal(views.length, 4)
  assert.equal(models[0].tableName, 'compilerfixture_vehicle')
})
