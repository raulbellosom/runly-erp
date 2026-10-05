import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { compileModule, archiveModule, normalizeModuleDefinition, validateModuleDefinition } from '../index.js'
import { inspectModuleZip, readCustomSources, DEFAULT_INSPECTION_LIMITS } from '../inspection/index.js'
import { parseDeclaration, parseDataJson } from '../inspection/declarations.js'
import { crc32 } from '../inspection/zip.js'
import { RME3_CAPABILITIES } from '../contracts.js'

const definition = JSON.parse(await readFile(new URL('./fixtures/inspection-definition.json', import.meta.url), 'utf8'))
const compiled = compileModule(definition)
const validZip = await archiveModule(compiled)
const has = (report, code) => report.diagnostics.some((d) => d.code === code)
const manifestSource = compiled.files.find((f) => f.path === 'module.manifest.js').content
async function changed(path, source) {
  return archiveModule({ files: compiled.files.map((f) => f.path === path ? { path, content: source } : f) })
}

// Build raw STORE entries to preserve duplicates and deliberately malformed
// headers; JSZip's map would overwrite duplicate original names.
function rawZip(entries) {
  const locals = [], central = []
  let offset = 0
  for (const { name, content = '', mode = 0o100644, flags = 0, method = 0, size, crc, localName = name } of entries) {
    const data = Buffer.from(content), n = Buffer.from(name), ln = Buffer.from(localName)
    const checksum = crc ?? crc32(data), length = size ?? data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(length, 22); local.writeUInt16LE(ln.length, 26)
    locals.push(local, ln, data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(0x314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(checksum, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(length, 24); cd.writeUInt16LE(n.length, 28)
    cd.writeUInt32LE((mode << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42)
    central.push(cd, n); offset += local.length + ln.length + data.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

test('existing compiler roundtrip is static, deterministic, versioned and keeps field IDs', async () => {
  const report = inspectModuleZip(validZip, { expectedKey: definition.key, expectedVersion: definition.version })
  assert.equal(report.valid, true, JSON.stringify(report.diagnostics))
  assert.equal(report.generatedMatch, true)
  assert.equal(report.executesUserCode, false)
  assert.equal(report.evidence, 'static')
  assert.equal(report.models[0].fields[0].id, definition.entities[0].fields[0].fieldId)
  assert.equal(report.contracts.capabilitiesVersion, 1)
  assert.equal(report.contracts.engineContractVersion, 1)
  assert.match(report.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(await archiveModule(compileModule(definition)), validZip)
  const normalized = normalizeModuleDefinition(definition)
  assert.deepEqual(normalizeModuleDefinition(normalized), normalized)
})

test('canonical goldenpath manual fixture uses shared declarators without execution', async () => {
  const base = new URL('../../../../scripts/fixtures/rme3-devkit/custom.goldenpath/', import.meta.url)
  const files = []
  async function collect(prefix = '') {
    for (const entry of await readdir(new URL(prefix, base), { withFileTypes: true })) {
      if (entry.isDirectory()) await collect(prefix + entry.name + '/')
      else files.push({ path: prefix + entry.name, content: await readFile(new URL(prefix + entry.name, base), 'utf8') })
    }
  }
  await collect()
  const report = inspectModuleZip(await archiveModule({ files }))
  assert.equal(report.valid, true, JSON.stringify(report.diagnostics))
  assert.equal(report.manifest.key, 'custom.goldenpath')
  assert.equal(report.generatedMatch, null)
  assert.ok(has(report, 'CUSTOM_NOT_EXECUTED'))
})

test('all dynamic declarations fail closed and never execute side effects', async () => {
  globalThis.__rme3InspectionExecuted = false
  for (const code of [
    `globalThis.__rme3InspectionExecuted = true; ${manifestSource}`,
    `import { defineRunlyModule } from '@runly/module-engine'; export default defineRunlyModule((globalThis.__rme3InspectionExecuted = true, {}))`,
    `import { defineRunlyModule } from '@runly/module-engine'; export default defineRunlyModule({ ...process.env })`,
    `import { defineRunlyModule } from '@runly/module-engine'; export default defineRunlyModule({ get key() { globalThis.__rme3InspectionExecuted = true } })`,
    `import x from './evil.js'; export default x`,
    `export default await import('node:fs')`,
  ]) {
    const report = inspectModuleZip(await changed('module.manifest.js', code))
    assert.equal(report.valid, false)
    assert.ok(has(report, 'DYNAMIC_DECLARATION_UNSUPPORTED'))
    assert.equal(globalThis.__rme3InspectionExecuted, false)
  }
  const model = compiled.files.find((f) => f.path.startsWith('models/'))
  const report = inspectModuleZip(await changed(model.path, `globalThis.__rme3InspectionExecuted = true; ${model.content}`))
  assert.equal(report.valid, false)
  assert.equal(globalThis.__rme3InspectionExecuted, false)
  delete globalThis.__rme3InspectionExecuted
})

test('AST grammar rejects pollution, duplicates, closures, templates, recursion and getters', () => {
  for (const value of ['{ __proto__: {} }', '{ key: 1, key: 2 }', '{ ["key"]: 1 }', '{ key: `hello` }', '{ key: (() => 1)() }', '{ key: /x/ }', '{ key: undefined }', '{ key: Infinity }', '{ key: 1e999 }']) {
    assert.throws(() => parseDeclaration(`import { defineModel } from '@runly/module-engine'; export default defineModel(${value})`, 'test.js', ['defineModel'], DEFAULT_INSPECTION_LIMITS))
  }
  assert.throws(() => parseDataJson('{"key":1,"key":2}', 'test.json', DEFAULT_INSPECTION_LIMITS))
  assert.throws(() => parseDataJson('{"__proto__":{}}', 'test.json', DEFAULT_INSPECTION_LIMITS))
  assert.throws(() => parseDataJson('['.repeat(80) + '0' + ']'.repeat(80), '', DEFAULT_INSPECTION_LIMITS), (e) => e.diagnostic.code === 'AST_DEPTH_LIMIT')
  const parsed = parseDeclaration(`import { defineModel as model, FIELD_TYPES as types } from '@atlas/module-engine'; export default model({type:types.TEXT, value:-2})`, 'model.js', ['defineModel'], DEFAULT_INSPECTION_LIMITS)
  assert.deepEqual(parsed.value, { type: 'text', value: -2 })
})

const badZips = [
  ['truncated', Buffer.from('PK'), 'ZIP_EOCD_INVALID'],
  ['duplicate', rawZip([{ name: 'a.js' }, { name: 'a.js' }]), 'ZIP_DUPLICATE_PATH'],
  ['casefold', rawZip([{ name: 'a.js' }, { name: 'A.js' }]), 'ZIP_DUPLICATE_PATH'],
  ['traversal', rawZip([{ name: '../a.js' }]), 'ZIP_UNSAFE_PATH'],
  ['backslash', rawZip([{ name: 'models\\a.js' }]), 'ZIP_UNSAFE_PATH'],
  ['absolute', rawZip([{ name: '/a.js' }]), 'ZIP_UNSAFE_PATH'],
  ['device', rawZip([{ name: 'CON.js' }]), 'ZIP_UNSAFE_PATH'],
  ['NFC', rawZip([{ name: 'e\u0301.js', flags: 0x800 }]), 'ZIP_UNSAFE_PATH'],
  ['symlink', rawZip([{ name: 'a.js', mode: 0o120777 }]), 'ZIP_SPECIAL_FILE'],
  ['encrypted', rawZip([{ name: 'a.js', flags: 1 }]), 'ZIP_FORMAT_UNSUPPORTED'],
  ['unsupported compression', rawZip([{ name: 'a.js', method: 99 }]), 'ZIP_FORMAT_UNSUPPORTED'],
  ['size lie', rawZip([{ name: 'a.js', size: 10 }]), 'ZIP_INTEGRITY_INVALID'],
  ['CRC lie', rawZip([{ name: 'a.js', crc: 1 }]), 'ZIP_INTEGRITY_INVALID'],
  ['local name mismatch', rawZip([{ name: 'a.js', localName: 'b.js' }]), 'ZIP_LOCAL_INVALID'],
  ['file directory clash', rawZip([{ name: 'models' }, { name: 'models/a.js' }]), 'ZIP_PATH_CONFLICT'],
  ['broken deflate', rawZip([{ name: 'a.js', method: 8, content: 'garbage' }]), 'ZIP_DEFLATE_INVALID'],
]
for (const [name, zip, code] of badZips) test(`adversarial ZIP: ${name}`, () => {
  const report = inspectModuleZip(zip)
  assert.equal(report.valid, false)
  assert.ok(has(report, code), JSON.stringify(report.diagnostics))
  assert.match(report.sha256, /^[0-9a-f]{64}$/)
})

test('ZIP budgets enforce compressed/expanded/entry/count/ratio limits, including actual inflation', async () => {
  assert.ok(has(inspectModuleZip(validZip, { limits: { zipBytes: 20 } }), 'ZIP_SIZE_LIMIT'))
  assert.ok(has(inspectModuleZip(validZip, { limits: { entries: 1 } }), 'ZIP_ENTRY_LIMIT'))
  assert.ok(has(inspectModuleZip(validZip, { limits: { entryBytes: 20 } }), 'ZIP_ENTRY_SIZE_LIMIT'))
  assert.ok(has(inspectModuleZip(validZip, { limits: { expandedBytes: 20 } }), 'ZIP_EXPANSION_LIMIT'))
  const bomb = new JSZip().file('bomb.js', 'x'.repeat(2 * 1024 * 1024))
  const zip = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  assert.ok(has(inspectModuleZip(zip), 'ZIP_EXPANSION_LIMIT'))
  // Lie in both headers so metadata budgets pass; maxOutputLength still stops it.
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  zip.writeUInt32LE(10, 22); zip.writeUInt32LE(10, central + 24)
  assert.ok(has(inspectModuleZip(zip), 'ZIP_DEFLATE_INVALID'))
  assert.throws(() => inspectModuleZip(validZip, { limits: { zipBytes: Infinity } }), TypeError)
})

test('identity, permissions, dependency and integration policies fail with clear diagnostics', async () => {
  assert.ok(has(inspectModuleZip(validZip, { expectedKey: 'custom.other' }), 'PACKAGE_IDENTITY_MISMATCH'))
  assert.ok(has(inspectModuleZip(validZip, { expectedVersion: '9.0.0' }), 'PACKAGE_IDENTITY_MISMATCH'))
  const source = manifestSource.replace("version: '1.0.0'", "version: '1.0.0-beta'").replace('  models: [', `  consumes: { 'runly.inventory': ['items.adjustStock'] }, events: { subscribes: ['unknown.item.updated'] }, models: [`)
  const report = inspectModuleZip(await changed('module.manifest.js', source))
  for (const code of ['MODULE_VERSION_UNSUPPORTED', 'SERVICE_CAPABILITY_UNSUPPORTED', 'EVENT_CAPABILITY_UNSUPPORTED', 'INTEGRATION_DEPENDENCY_MISSING', 'DEFINITION_SOURCE_MISMATCH']) assert.ok(has(report, code), code)
  const broken = manifestSource.replace(/permissionKey: '[^']*'/, "permissionKey: 'unknown.read'")
  assert.ok(has(inspectModuleZip(await changed('module.manifest.js', broken)), 'PERMISSION_UNDECLARED'))
  assert.ok(has(inspectModuleZip(validZip, { capabilities: { ...RME3_CAPABILITIES, schemaVersion: 99 } }), 'CAPABILITY_CONTRACT_UNSUPPORTED'))
})

test('embedded definition cannot certify tampered executable files', async () => {
  const api = compiled.files.find((f) => f.path.startsWith('api/'))
  const report = inspectModuleZip(await changed(api.path, 'throw new Error("never execute");'))
  assert.equal(report.generatedMatch, false)
  assert.ok(has(report, 'DEFINITION_SOURCE_MISMATCH'))
  assert.ok(has(report, 'BACKEND_NOT_EXECUTED'))
})

test('ZIP central offsets, ZIP64, multidisk and hidden local entries fail closed', () => {
  const end = validZip.length - 22
  for (const [offset, bytes, value] of [[end + 4, 2, 1], [end + 10, 2, 0xffff], [end + 16, 4, 0xffffffff], [end + 12, 4, 1], [end + 10, 2, 1]]) {
    const zip = Buffer.from(validZip)
    zip[`writeUInt${bytes * 8}LE`](value, offset)
    assert.equal(inspectModuleZip(zip).valid, false)
  }
  const zip = Buffer.from(validZip)
  const central = zip.readUInt32LE(end + 16)
  zip.writeUInt32LE(1, central + 42)
  assert.ok(has(inspectModuleZip(zip), 'ZIP_LOCAL_INVALID'))
})

test('normal directories and streaming data descriptors from JSZip are accepted', async () => {
  const zip = new JSZip()
  for (const file of compiled.files) zip.file(file.path, file.content)
  const stream = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: true })
  const report = inspectModuleZip(stream)
  assert.equal(report.valid, true, JSON.stringify(report.diagnostics))
  assert.equal(report.generatedMatch, true)
})

test('token and node budgets are enforced before normalizers', () => {
  const source = '{"items":[1,2,3,4,5,6]}'
  assert.throws(() => parseDataJson(source, '', { ...DEFAULT_INSPECTION_LIMITS, tokens: 3 }), (e) => e.diagnostic.code === 'AST_TOKEN_LIMIT')
  assert.throws(() => parseDataJson(source, '', { ...DEFAULT_INSPECTION_LIMITS, nodes: 3 }), (e) => e.diagnostic.code === 'AST_NODE_LIMIT')
})

test('existing compiler connections, public links and CUSTOM retain static compatibility', async () => {
  const connected = structuredClone(definition)
  connected.entities[0].fields.push({ key: 'item', label: 'Artículo', type: 'relation', targetExternal: 'inventory_item', required: true })
  connected.connections = [{ key: 'sample_item', target: 'inventory_item', kind: 'fields', entity: 'sample', targetField: 'item', label: 'Muestra', fields: [{ field: 'name', form: true }] }]
  const publicModule = { ...definition, publicLinks: [{ key: 'ficha', entity: 'sample', mode: 'view', title: 'Ficha', fields: ['name'] }] }
  for (const input of [connected, publicModule, { ...definition, preset: 'crud-custom' }]) {
    const report = inspectModuleZip(await archiveModule(compileModule(input)))
    assert.equal(report.valid, true, JSON.stringify(report.diagnostics))
    assert.equal(report.generatedMatch, true)
  }
})

test('known manual integrations accepted; missing and malformed declarations diagnosed', async () => {
  const files = compiled.files.filter((f) => f.path !== '.module-definition.json')
  const manifest = manifestSource.replace('  models: [', `  consumes: { 'runly.inventory': ['items.read'] }, events: { subscribes: ['inventory.item.updated'] }, models: [`)
    .replace('dependencies: [{"key":"runly.core"}]', 'dependencies: [{"key":"runly.core"},{"key":"runly.inventory"}]')
  const report = inspectModuleZip(await archiveModule({ files: files.map((f) => f.path === 'module.manifest.js' ? { ...f, content: manifest } : f) }))
  assert.equal(report.valid, true, JSON.stringify(report.diagnostics))
  const missing = inspectModuleZip(await archiveModule({ files: files.filter((f) => !f.path.startsWith('models/')) }))
  assert.ok(has(missing, 'PACKAGE_FILE_MISSING'))
  const view = compiled.files.find((f) => f.path.includes('.table.js'))
  assert.ok(has(inspectModuleZip(await changed(view.path, 'globalThis.__rme3InspectionExecuted = true; export default {};')), 'DYNAMIC_DECLARATION_UNSUPPORTED'))
  assert.ok(has(inspectModuleZip(await changed('module.manifest.js', manifestSource.replace("dependencies: [{\"key\":\"runly.core\"}]", 'dependencies: null'))), 'DEPENDENCIES_INVALID'))
})

test('Builder diagnoses unsupported integration keys rather than silently erasing them', () => {
  for (const key of ['consumes', 'events']) {
    const value = { ...definition, [key]: {} }
    assert.ok(validateModuleDefinition(value).errors.some((d) => d.code === 'BUILDER_INTEGRATION_UNSUPPORTED'))
    assert.throws(() => compileModule(value))
  }
})

test('signer rejects dynamic manifest before attempting to read a private key', async () => {
  // Use a bounded fixture file, never execute the uploaded source.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'rme3-inspection-test-'))
  try {
    const zip = join(dir, 'dynamic.zip')
    await writeFile(zip, await changed('module.manifest.js', 'throw new Error("executed-attacker-source"); export default {}'))
    const result = spawnSync(process.execPath, ['scripts/catalog/sign-package.mjs', zip, '--key', join(dir, 'nonexistent-key.pem')], { cwd: new URL('../../../../', import.meta.url), encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /DYNAMIC_DECLARATION_UNSUPPORTED/)
    assert.doesNotMatch(result.stderr, /executed-attacker-source|ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('static signer preserves catalog v1 payload and verification using ephemeral fixture keys', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { generateKeyPairSync } = await import('node:crypto')
  const { verifyPackage } = await import('../../../../apps/api/src/services/catalog/catalog-crypto.js')
  const dir = await mkdtemp(join(tmpdir(), 'rme3-sign-fixture-'))
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const zip = join(dir, 'static.zip'), key = join(dir, 'fixture-key.pem')
    await writeFile(zip, validZip)
    await writeFile(key, privateKey.export({ format: 'pem', type: 'pkcs8' }))
    const result = spawnSync(process.execPath, ['scripts/catalog/sign-package.mjs', zip, '--key', key, '--url', 'https://catalog.example.com/fixture.zip'], { cwd: new URL('../../../../', import.meta.url), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const entry = JSON.parse(result.stdout)
    assert.equal(entry.key, definition.key)
    assert.equal(entry.version, definition.version)
    assert.equal(entry.size, validZip.length)
    assert.equal(verifyPackage({ buffer: validZip, entry, publicKeys: [publicKey.export({ format: 'der', type: 'spki' }).toString('base64')] }).sha256, entry.sha256)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CUSTOM sources are read as bounded text from the verified ZIP, never other paths', async () => {
  const zip = new JSZip()
  zip.file('module.manifest.js', manifestSource)
  zip.file('components/index.js', "export async function register(r) { r.register('custom.x:A', () => null) }")
  zip.file('components/nested/Card.jsx', 'export default function Card() { return null }')
  zip.file('views/panel.custom.js', 'export default {}')
  zip.file('api/index.js', 'throw new Error("never read")')
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  const result = readCustomSources(bytes)
  assert.deepEqual(result.files.map((f) => f.path), ['components/index.js', 'components/nested/Card.jsx', 'views/panel.custom.js'])
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.throws(() => readCustomSources(rawZip([{ name: '../components/index.js', content: 'x' }])), (e) => e.diagnostic?.code === 'ZIP_UNSAFE_PATH')
  assert.throws(() => readCustomSources(rawZip([{ name: 'components/big.js', content: 'a'.repeat(1.6 * 1024 * 1024) }])), (e) => e.diagnostic?.code === 'EXTENSIONS_TOO_LARGE')
  assert.throws(() => readCustomSources(rawZip([{ name: 'components/bin.js', content: Buffer.from([0xff, 0xfe, 0x00]) }])), (e) => e.diagnostic?.code === 'PACKAGE_TEXT_INVALID')
})
