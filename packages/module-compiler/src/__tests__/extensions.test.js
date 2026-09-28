import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyModulePackage, compileModule, validateModuleDefinition } from '../index.js'

const BASE = {
  schemaVersion: 1, key: 'custom.visitas', name: 'Visitas', version: '1.0.0', icon: 'Users', color: '#2563EB',
  pwa: { shortName: 'Visitas', startPath: '/visitas' },
  entities: [{ key: 'visita', label: 'Visita', pluralLabel: 'Visitas', fields: [{ key: 'nombre', type: 'text', label: 'Nombre' }] }],
}
const EXTENSIONS = {
  files: [
    { path: 'components/index.js', content: "export async function register(registry) {}\n" },
    { path: 'components/Panel.jsx', content: "export default function Panel() { return null }\n" },
    { path: 'views/panel.custom.js', content: "export default {}\n" },
  ],
  views: [{ file: 'views/panel.custom.js' }],
  navigation: [{ label: 'Panel', path: '/app/m/custom.visitas/panel', icon: 'LayoutDashboard', permissionKey: 'visitas.visita.read' }],
}

// The manifest object a real loader would produce for a compiled package.
function manifestOf(compiled) {
  const text = compiled.files.find((file) => file.path === 'module.manifest.js').content
  const list = (name) => [...text.slice(text.indexOf(`${name}: [`)).split(']')[0].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((match) => match[1])
  return {
    views: list('views'),
    models: list('models'),
    permissions: [...text.matchAll(/\{ key: '([^']+)'/g)].map((match) => ({ key: match[1] })),
    navigation: [...text.matchAll(/label: (?:'([^']*)'|"([^"]*)"),\n\s+path: (?:'([^']*)'|"([^"]*)")/g)].map((match) => ({ label: match[1] ?? match[2], path: match[3] ?? match[4] })),
  }
}

test('extensions are emitted and listed in the manifest', () => {
  const compiled = compileModule({ ...structuredClone(BASE), extensions: EXTENSIONS })
  assert.ok(compiled.files.some((file) => file.path === 'components/Panel.jsx'))
  const manifest = manifestOf(compiled)
  assert.ok(manifest.views.includes('./views/panel.custom.js'))
  assert.ok(manifest.navigation.some((item) => item.path === '/app/m/custom.visitas/panel'))
})

test('extension validation', () => {
  const bad = { ...structuredClone(BASE), extensions: {
    files: [{ path: 'api/hack.js', content: 'x' }],
    views: [{ file: 'views/missing.custom.js' }],
    navigation: [{ label: 'X', path: '/app/m/otro/x', permissionKey: 'nope' }],
  } }
  const codes = validateModuleDefinition(bad).errors.map((error) => error.code)
  for (const code of ['EXTENSION_PATH_NOT_ALLOWED', 'EXTENSION_VIEW_NOT_FOUND', 'UNSAFE_ROUTE_PATH', 'NAVIGATION_PERMISSION_NOT_FOUND']) assert.ok(codes.includes(code), code)
})

test('a package with only extensions is Builder-compatible and round-trips', () => {
  const compiled = compileModule({ ...structuredClone(BASE), extensions: EXTENSIONS })
  const result = classifyModulePackage({ key: 'custom.visitas', files: compiled.files, manifest: manifestOf(compiled) })
  assert.equal(result.managed, true)
  assert.deepEqual(result.foreign, [])
  assert.deepEqual(result.extensions.files.map((file) => file.path).sort(), EXTENSIONS.files.map((file) => file.path).sort())
  assert.deepEqual(result.extensions.views, EXTENSIONS.views)
  assert.deepEqual(result.extensions.navigation.map((item) => item.path), ['/app/m/custom.visitas/panel'])
})

test('modified generated files, api changes or a missing definition are foreign', () => {
  const compiled = compileModule(structuredClone(BASE))
  const files = compiled.files.map((file) => (file.path === 'api/visita-service.js' ? { ...file, content: `${file.content}\n// hack` } : file))
  files.push({ path: 'api/extra.js', content: 'x' })
  const result = classifyModulePackage({ key: 'custom.visitas', files, manifest: manifestOf(compiled) })
  assert.deepEqual(result.foreign.map((item) => [item.path, item.reason]).sort(), [['api/extra.js', 'agregado'], ['api/visita-service.js', 'modificado']])
  const noDefinition = classifyModulePackage({ key: 'custom.visitas', files: files.filter((file) => file.path !== '.module-definition.json'), manifest: manifestOf(compiled) })
  assert.equal(noDefinition.managed, false)
})
