import test from 'node:test'
import assert from 'node:assert/strict'
import { compileModule, validateModuleDefinition } from '../index.js'
import { resolveEntityLayout } from '../layout.js'

const BASE = {
  schemaVersion: 1,
  key: 'custom.taller',
  name: 'Taller',
  version: '1.0.0',
  icon: 'Wrench',
  color: '#2563EB',
  pwa: { shortName: 'Taller', startPath: '/ordenes' },
  entities: [{
    key: 'orden', label: 'Orden', pluralLabel: 'Ordenes',
    fields: [
      { key: 'nombre', type: 'text', label: 'Nombre', required: true },
      { key: 'monto', type: 'decimal', label: 'Monto' },
      { key: 'foto', type: 'file', label: 'Foto', accept: 'image', camera: true, maxSizeMB: 5 },
      { key: 'contrato', type: 'file', label: 'Contrato', accept: 'document' },
      { key: 'estado', type: 'select', label: 'Estado', options: ['NEW', 'DONE'] },
      { key: 'notas', type: 'textarea', label: 'Notas' },
    ],
  }],
}

function withLayout(layout, fieldsPatch) {
  const definition = structuredClone(BASE)
  definition.entities[0].layout = layout
  if (fieldsPatch) fieldsPatch(definition.entities[0].fields)
  return definition
}

const VALID_LAYOUT = {
  mode: 'page',
  tabs: [
    { key: 'general', label: 'General', sections: [{ key: 'datos', label: 'Datos', columns: 2, fields: ['nombre', 'estado', 'foto'] }] },
    { key: 'docs', label: 'Documentos', sections: [{ key: 'adjuntos', type: 'attachments', label: 'Adjuntos' }] },
  ],
  detail: { hero: { titleField: 'nombre', statusField: 'estado', imageField: 'foto' }, kpis: [{ field: 'monto', label: 'Monto' }], twoColumn: true },
}

function codes(definition) {
  return validateModuleDefinition(definition).errors.map((error) => error.code)
}

test('valid layout passes and unplaced fields become a warning', () => {
  const result = validateModuleDefinition(withLayout(VALID_LAYOUT))
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.some((warning) => warning.code === 'LAYOUT_UNPLACED_FIELDS'))
})

test('layout rejects duplicate, unknown fields, bad columns and multiple attachments', () => {
  const layout = structuredClone(VALID_LAYOUT)
  layout.tabs[0].sections.push({ key: 'otra', label: 'Otra', columns: 4, fields: ['nombre', 'fantasma'] })
  layout.tabs[1].sections.push({ key: 'adjuntos2', type: 'attachments', label: 'Más' })
  const found = codes(withLayout(layout))
  for (const code of ['LAYOUT_DUPLICATE_FIELD', 'LAYOUT_FIELD_NOT_FOUND', 'LAYOUT_INVALID_COLUMNS', 'LAYOUT_MULTIPLE_ATTACHMENTS']) assert.ok(found.includes(code), code)
})

test('detail hero and kpis are type-checked', () => {
  const layout = structuredClone(VALID_LAYOUT)
  layout.detail = { hero: { titleField: 'nombre', imageField: 'contrato', statusField: 'monto' }, kpis: [{ field: 'notas', label: 'N' }] }
  const found = codes(withLayout(layout))
  for (const code of ['LAYOUT_HERO_IMAGE_NOT_IMAGE', 'LAYOUT_HERO_STATUS_NOT_SELECT', 'LAYOUT_KPI_INVALID_TYPE']) assert.ok(found.includes(code), code)
})

test('file options are validated even without a layout', () => {
  const definition = structuredClone(BASE)
  definition.entities[0].fields[3].camera = true
  definition.entities[0].fields[2].maxSizeMB = 50
  const found = codes(definition)
  assert.ok(found.includes('FILE_CAMERA_REQUIRES_IMAGE'))
  assert.ok(found.includes('FILE_MAX_SIZE_OUT_OF_RANGE'))
})

test('resolveEntityLayout appends unplaced fields to "Otros datos" in the last tab', () => {
  const resolved = resolveEntityLayout(withLayout(VALID_LAYOUT).entities[0])
  const last = resolved.tabs.at(-1)
  const other = last.sections.at(-1)
  assert.equal(other.label, 'Otros datos')
  assert.deepEqual(other.fields, ['monto', 'contrato', 'notas'])
})

test('normalization keeps the layout in the compiled definition', () => {
  const compiled = compileModule(withLayout(VALID_LAYOUT))
  assert.equal(compiled.definition.entities[0].layout.mode, 'page')
})

async function loadView(compiled, path) {
  const content = compiled.files.find((file) => file.path === path).content
  const body = content.slice(content.indexOf('defineView(') + 'defineView('.length, content.lastIndexOf(')'))
  return JSON.parse(body)
}

test('layout emits flat sections with tab keys, tabs list, mode, hero, kpis and attachments', async () => {
  const compiled = compileModule(withLayout(VALID_LAYOUT))
  const form = await loadView(compiled, 'views/orden.form.js')
  assert.equal(form.schema.formMode, 'page')
  assert.deepEqual(form.schema.tabs, [{ key: 'general', label: 'General' }, { key: 'docs', label: 'Documentos' }])
  assert.deepEqual(form.schema.sections.map((section) => [section.id, section.tab]), [['datos', 'general'], ['adjuntos', 'docs'], ['otros_datos', 'docs']])
  const foto = form.schema.sections[0].fields.find((field) => field.field === 'foto')
  assert.deepEqual(foto, { field: 'foto', label: 'Foto', type: 'file', accept: 'image', camera: true, maxSizeMB: 5, filesPath: '/taller/ordens/files', signedUrlPath: '/taller/ordens/files/:id/signed-url' })
  assert.equal(form.schema.sections[1].attachments.listPath, '/taller/ordens/:id/files')
  assert.equal(form.schema.sections[1].attachments.upload.entityType, 'taller.orden')
  const detail = await loadView(compiled, 'views/orden.detail.js')
  assert.equal(detail.schema.hero.imageField, 'foto')
  assert.equal(detail.schema.layout, 'two-column')
  assert.deepEqual(detail.schema.kpis, [{ field: 'monto', label: 'Monto' }])
  assert.equal(detail.schema.sections[0].fields.find((field) => field.field === 'foto').type, 'file-asset')
})

test('single-tab layout emits no tabs list and no tab keys', async () => {
  const layout = { tabs: [{ key: 'general', label: 'General', sections: [{ key: 'datos', label: 'Datos', fields: ['nombre'] }] }] }
  const form = await loadView(compileModule(withLayout(layout)), 'views/orden.form.js')
  assert.equal(form.schema.tabs, undefined)
  assert.equal(form.schema.formMode, undefined)
  assert.ok(form.schema.sections.every((section) => section.tab === undefined))
})

test('without layout, file fields still get upload props and image table columns', () => {
  const compiled = compileModule(structuredClone(BASE))
  const form = compiled.files.find((file) => file.path === 'views/orden.form.js').content
  const table = compiled.files.find((file) => file.path === 'views/orden.table.js').content
  assert.match(form, /filesPath: "\/taller\/ordens\/files"/)
  assert.match(table, /type: 'image-asset'/)
  assert.doesNotMatch(form, /tabs:/)
})

test('entities with files get a module-scoped file router mounted and linked on save', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const compiled = compileModule(structuredClone(BASE))
  const fileRoutes = compiled.files.find((file) => file.path === 'api/orden-file-routes.js').content
  const routes = compiled.files.find((file) => file.path === 'api/orden-routes.js').content
  assert.match(fileRoutes, /FILE_FIELDS = \["foto","contrato"\]/)
  assert.match(fileRoutes, /app\.delete\('\/taller\/ordens\/:id\/files\/:fileId', requirePermission\('taller\.orden\.update'\)/)
  assert.match(routes, /app\.route\('', createOrdenFileRouter/)
  assert.equal((routes.match(/await linkOrdenFileFields/g) ?? []).length, 2)
  const dir = await mkdtemp(join(tmpdir(), 'layout-routes-'))
  try {
    for (const [name, content] of [['file-routes.mjs', fileRoutes], ['routes.mjs', routes]]) {
      await writeFile(join(dir, name), content)
      execFileSync(process.execPath, ['--check', join(dir, name)])
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('entities without files get no file router', () => {
  const definition = structuredClone(BASE)
  definition.entities[0].fields = definition.entities[0].fields.filter((field) => field.type !== 'file')
  const compiled = compileModule(definition)
  assert.ok(!compiled.files.some((file) => file.path.endsWith('-file-routes.js')))
  assert.doesNotMatch(compiled.files.find((file) => file.path === 'api/orden-routes.js').content, /FileRouter/)
})

test('generated upload route enforces per-field size and image rules', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const source = compileModule(structuredClone(BASE)).files.find((file) => file.path === 'api/orden-file-routes.js').content
  const dir = await mkdtemp(join(process.cwd(), '.tmp-file-routes-'))
  try {
    await writeFile(join(dir, 'routes.mjs'), source)
    const { createOrdenFileRouter } = await import(pathToFileURL(join(dir, 'routes.mjs')).href)
    const uploads = []
    const moduleContext = { files: { upload: async (_c, args) => { uploads.push(args); return { id: 'f1' } } } }
    const requirePermission = () => async (c, next) => { c.set('tenantContext', { isAdmin: true }); await next() }
    const app = createOrdenFileRouter({ requirePermission, moduleContext })
    const post = (file, field) => {
      const form = new FormData()
      form.append('file', file)
      if (field) form.append('field', field)
      return app.request('/taller/ordens/files', { method: 'POST', body: form })
    }
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })
    assert.equal((await post(big, 'foto')).status, 413)
    assert.equal((await post(new File(['x'], 'a.pdf', { type: 'application/pdf' }), 'foto')).status, 400)
    assert.equal((await post(new File(['x'], 'a.pdf', { type: 'application/pdf' }), 'nope')).status, 400)
    assert.equal((await post(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'foto')).status, 201)
    assert.equal((await post(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).status, 201)
    assert.equal(uploads.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
