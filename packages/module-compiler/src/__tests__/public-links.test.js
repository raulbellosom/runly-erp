import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import { validateView, validateManifest } from '@runly/module-engine'
import { compileModule, validateModuleDefinition } from '../index.js'

const COMPANY = '0192f000-0000-7000-8000-000000000001'
const SURVEY = '0192f000-0000-7000-8000-0000000000e1'

const BASE = {
  schemaVersion: 1,
  key: 'custom.encuestas',
  name: 'Encuestas',
  version: '1.0.0',
  icon: 'Users',
  color: '#2563EB',
  pwa: { shortName: 'Encuestas', startPath: '/encuestas' },
  entities: [
    { key: 'encuesta', label: 'Encuesta', pluralLabel: 'Encuestas', fields: [
      { key: 'titulo', type: 'text', label: 'Título', required: true },
      { key: 'notas_internas', type: 'text', label: 'Notas internas' },
      { key: 'adjunto', type: 'file', label: 'Adjunto' },
    ] },
    { key: 'respuesta', label: 'Respuesta', pluralLabel: 'Respuestas', fields: [
      { key: 'nombre', type: 'text', label: 'Nombre', required: true },
      { key: 'calificacion', type: 'select', label: 'Calificación', options: ['buena', 'mala'] },
      { key: 'encuesta', type: 'relation', label: 'Encuesta', targetEntity: 'encuesta', required: true },
    ] },
  ],
  publicLinks: [
    { key: 'ficha', entity: 'encuesta', mode: 'view', title: 'Ficha', fields: ['titulo'] },
    { key: 'responder', entity: 'encuesta', mode: 'submit', title: 'Responder encuesta', fields: ['titulo'],
      targetEntity: 'respuesta', formFields: ['nombre', 'calificacion'], linkField: 'encuesta' },
  ],
}

const codes = (definition) => validateModuleDefinition(definition).errors.map((error) => error.code)
const fileOf = (compiled, path) => compiled.files.find((file) => file.path === path)?.content

test('public link diagnostics', () => {
  assert.deepEqual(codes(structuredClone(BASE)), [])
  const bad = structuredClone(BASE)
  bad.publicLinks[0].fields = ['adjunto', 'fantasma']
  bad.publicLinks[1].formFields = ['calificacion']
  bad.publicLinks[1].linkField = 'nombre'
  const found = codes(bad)
  for (const code of ['PUBLIC_LINK_FIELD_NOT_ALLOWED', 'PUBLIC_LINK_FIELD_NOT_FOUND', 'PUBLIC_LINK_REQUIRED_FIELD_MISSING', 'PUBLIC_LINK_LINK_FIELD_INVALID']) {
    assert.ok(found.includes(code), code)
  }
})

test('compiles manifest resources and public views with only the allowlisted fields', () => {
  const compiled = compileModule(structuredClone(BASE))
  const manifest = fileOf(compiled, 'module.manifest.js')
  assert.match(manifest, /"managePermission": "encuestas\.encuesta\.update"/)
  assert.match(manifest, /'\.\/views\/responder\.public\.js'/)
  const view = fileOf(compiled, 'views/responder.public.js')
  assert.match(view, /"path": "\/p\/encuestas\/responder"/)
  assert.match(view, /"component": "runly\.public:RecordPage"/)
  assert.doesNotMatch(view, /notas_internas/)
  assert.doesNotMatch(fileOf(compiled, 'api/public.js'), /notas_internas/)
  const viewObject = JSON.parse(view.slice(view.indexOf('defineView(') + 'defineView('.length, view.lastIndexOf(')')))
  assert.deepEqual(validateView(viewObject).errors, [])
  const resources = JSON.parse(manifest.slice(manifest.indexOf('publicResources: ') + 17, manifest.lastIndexOf(']') + 1))
  const permissions = [{ key: 'encuestas.encuesta.update', name: 'Editar' }]
  assert.deepEqual(validateManifest({ key: 'custom.encuestas', name: 'E', version: '1.0.0', icon: 'Box', color: '#336699', pwa: { shortName: 'E', startPath: '/e' }, permissions, publicResources: resources }).errors, [])
})

test('generated api/public.js reads the shared record and creates a linked record', async () => {
  const compiled = compileModule(structuredClone(BASE))
  const dir = await mkdtemp(join(process.cwd(), '.tmp-public-links-'))
  try {
    for (const file of compiled.files.filter((item) => /^(api|validators)\//.test(item.path))) {
      const target = join(dir, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content)
    }
    const inserts = []
    const prisma = {
      async $queryRaw(strings, ...values) {
        const sql = strings.join('?')
        if (sql.includes('INSERT INTO encuestas_respuesta')) { inserts.push(values); return [{ id: 'r1' }] }
        if (sql.includes('FROM encuestas_encuesta')) return [{ id: SURVEY, titulo: 'Clima', notas_internas: 'secreto' }]
        return [{ id: SURVEY }]
      },
      auditLog: { create: async () => ({}) },
    }
    const { default: createPublicRouter } = await import(pathToFileURL(join(dir, 'api', 'public.js')).href)
    const inner = createPublicRouter({ prisma })
    const app = new Hono()
    app.use('*', async (c, next) => { c.set('publicLink', c.env.publicLink); c.set('publicBody', c.env.publicBody); await next() })
    app.route('/', inner)
    const env = (resource, publicBody = null) => ({ publicLink: { companyId: COMPANY, recordId: SURVEY, resource, mode: 'submit' }, publicBody })

    const record = await (await app.request('/record', {}, env('ficha'))).json()
    assert.deepEqual(record.data, { titulo: 'Clima' })

    const bad = await app.request('/submit', { method: 'POST' }, env('responder', { calificacion: 'buena' }))
    assert.equal(bad.status, 400)
    assert.match((await bad.json()).error, /Nombre/)

    const ok = await app.request('/submit', { method: 'POST' }, env('responder', { nombre: 'Ana', calificacion: 'buena', encuesta: 'otro', extra: 1 }))
    assert.equal(ok.status, 201)
    assert.equal(inserts.length, 1)
    assert.ok(inserts[0].includes(SURVEY), 'link field is forced to the shared record')

    assert.equal((await app.request('/submit', { method: 'POST' }, env('ficha', { nombre: 'x' }))).status, 404)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
