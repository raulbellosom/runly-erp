// Catalog Distribution: Runly Marketplace consumer of the Developer Hub signed
// feeds (official snapshot + community v2). Ephemeral keys only; the pinned
// official key never signs anything here and no production key is generated.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import JSZip from 'jszip'
import { compileModule, archiveModule, createStarterDefinition } from '@runly/module-compiler/server'
import { inspectModuleZip } from '@runly/module-compiler/inspection'
import { RME3_CAPABILITIES } from '@runly/module-compiler/contracts'
import { sha256Of, signedPayload } from '../catalog-crypto.js'
import { manifestCatalogMetadata } from '../catalog-schema.js'
import { releaseStatementBytes, snapshotStatementBytes, snapshotDigest, keyIdOf } from '../catalog-v2-contract.js'
import { officialSnapshotBytes, officialSnapshotDigest, validateOfficialEnvelope } from '../catalog-official-contract.js'
import { createTrustStore } from '../catalog-trust-store.js'
import { sequenceDecision } from '../catalog-sequence.js'
import { createCatalogV2Service, catalogUrlProblem } from '../catalog-v2-service.js'

const pair = () => { const k = generateKeyPairSync('ed25519'); return { privateKey: k.privateKey, publicKey: k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') } }
const official = pair(), nextOfficial = pair(), community = pair(), managed = pair()
const at = (offset = 0) => new Date(Date.parse('2026-10-05T00:00:00.000Z') + offset).toISOString()
const DAY = 86400000
const OFFICIAL_URL = 'https://hub.example/api/v1/marketplace/catalog/official'
const COMMUNITY_URL = 'https://hub.example/api/v1/marketplace/catalog/community'
const contracts = { engine: RME3_CAPABILITIES.engine.schemaVersion, compiler: RME3_CAPABILITIES.compiler.schemaVersion, runtime: RME3_CAPABILITIES.runtime.schemaVersion, capabilities: RME3_CAPABILITIES.schemaVersion }
const profile = (runly = { min: '0.1.0', max: null }) => ({ runly, contracts })

async function moduleZip(key, version = '0.1.0') {
  const definition = createStarterDefinition({ key, name: `Synthetic ${key}` })
  definition.version = version
  const zip = await archiveModule(compileModule(definition))
  return { zip, manifest: inspectModuleZip(zip).manifest }
}
const billing = await moduleZip('custom.billing')
const billing2 = await moduleZip('custom.billing', '0.2.0')
const notes = await moduleZip('custom.notes')
const notes2 = await moduleZip('custom.notes', '0.2.0')
// Zip-slip: a valid package plus an entry escaping the module directory.
const evil = await (async () => { const z = await JSZip.loadAsync(notes.zip); z.file('../../escape.js', 'process.exit(1)'); return z.generateAsync({ type: 'nodebuffer' }) })()

const surfaceOf = (manifest) => { const s = manifestCatalogMetadata(manifest); return { ...s, connections: s.connections.map(({ target, kind, label }) => ({ target, kind, label: label ?? '' })) } }
function officialModule({ zip, manifest }, { key = official, patch = {} } = {}) {
  const sha256 = sha256Of(zip)
  const m = { key: manifest.key, version: manifest.version, sha256, size: zip.length, packageUrl: `packages/${sha256}.zip`, name: manifest.name, description: 'Módulo oficial', icon: 'Boxes', color: '#2563EB', changelog: 'Notas', ...surfaceOf(manifest), keyId: keyIdOf(key.publicKey), ...patch }
  m.signature = sign(null, signedPayload(m), key.privateKey).toString('base64')
  return m
}
function officialEnvelope({ sequence = 1, previous = null, modules = [], revocations = [], signer = official, generatedAt = at(sequence * 1000), patch = {}, runly } = {}) {
  const signed = { schemaVersion: 1, catalog: 'runly-official', trustDomain: 'OFFICIAL', sequence, generatedAt, previous, modules, compatibility: Object.fromEntries(modules.map((m) => [`${m.key}@${m.version}`, profile(runly)])), revocations, ...patch }
  return { signed, keyId: keyIdOf(signer.publicKey), signature: sign(null, officialSnapshotBytes(signed), signer.privateKey).toString('base64') }
}
const officialAfter = (prev, options) => officialEnvelope({ ...options, previous: { sequence: prev.signed.sequence, sha256: officialSnapshotDigest(prev.signed) } })
function communityEntry({ zip, manifest }, { status = 'published', listed = true, publishedAt = at(), runly, patch = {} } = {}) {
  const sha256 = sha256Of(zip)
  const e = { trust: 'community', key: manifest.key, version: manifest.version, sha256, size: zip.length, packageUrl: `packages/${sha256}.zip`, publisher: 'acme-labs', listed, status, publishedAt,
    name: manifest.name, description: '', icon: 'Boxes', color: '#2563EB', changelog: '', ...surfaceOf(manifest), compatibility: profile(runly), provenance: { evidenceSha256: 'b'.repeat(64), toolchainId: 'c'.repeat(64) }, signature: '', keyId: keyIdOf(community.publicKey), ...patch }
  e.signature = sign(null, releaseStatementBytes(e), community.privateKey).toString('base64')
  return e
}
function communityEnvelope({ sequence = 1, previous = null, entries = [], revocations = [], signer = community, generatedAt = at(sequence * 1000) } = {}) {
  const signed = { schemaVersion: 2, catalog: 'runly-v2', sequence, generatedAt, validUntil: new Date(Date.parse(generatedAt) + 7 * DAY).toISOString(), previous,
    trust: { keys: [{ keyId: keyIdOf(community.publicKey), publicKey: community.publicKey, role: 'community', state: 'active', since: at(-DAY), until: null, reason: null }] },
    publishers: [{ handle: 'acme-labs', displayName: 'Acme Labs', verified: true, state: 'active', reason: null, revokedAt: null }], entries, revocations }
  return { signed, signatures: [{ keyId: keyIdOf(signer.publicKey), signature: sign(null, snapshotStatementBytes(signed), signer.privateKey).toString('base64') }] }
}
const communityAfter = (prev, options) => communityEnvelope({ ...options, previous: { sequence: prev.signed.sequence, sha256: snapshotDigest(prev.signed) } })

function fixture({ trust = { official: [official.publicKey], community: [community.publicKey], managed: [] }, urls = { 'catalog.official.url': OFFICIAL_URL, 'catalog.v2.url': COMMUNITY_URL }, rows = [], clock = Date.parse(at(DAY)), publishZip = null } = {}) {
  const configs = new Map(Object.entries(urls).filter(([, v]) => v)), cache = new Map(), feeds = new Map(), modules = new Map(rows.map((r) => [r.key, r]))
  const files = new Map([billing, billing2, notes, notes2].map(({ zip }) => [sha256Of(zip), zip]))
  files.set(sha256Of(evil), evil)
  let offline = false, feedDown = false, published = 0, installed = 0
  const grant = { deleteMany: async () => {}, findMany: async () => [], create: async () => {} }
  const prisma = {
    instanceConfig: { findUnique: async ({ where }) => configs.has(where.key) ? { value: configs.get(where.key) } : null, upsert: async ({ where, update }) => { configs.set(where.key, update.value) } },
    moduleCatalogCache: { findUnique: async ({ where }) => cache.get(where.url) ?? null, upsert: async ({ where, create, update }) => { cache.set(where.url, { ...(cache.get(where.url) ?? create), ...update, payload: update.payload ?? create.payload }) } },
    runlyModule: {
      findMany: async ({ where }) => [...modules.values()].filter((r) => (!where?.key?.in || where.key.in.includes(r.key)) && (!where?.status || where.status === r.status)),
      findUnique: async ({ where }) => modules.get(where.key) ?? null,
    },
    moduleServiceGrant: grant, $transaction: async (fn) => fn({ moduleServiceGrant: grant }),
  }
  const requested = []
  const service = createCatalogV2Service({ prisma, trust, now: () => clock, readBytes: async (url) => {
    requested.push(url)
    if (offline || (feedDown && feeds.has(url))) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    if (feeds.has(url)) return { status: 200, buffer: Buffer.from(JSON.stringify(feeds.get(url))) }
    const sha = /\/packages\/([a-f0-9]{64})\.zip$/.exec(url)?.[1]
    if (!sha || !files.has(sha)) throw Object.assign(new Error('not found'), { code: 'CATALOG_UNREACHABLE' })
    return { status: 200, buffer: files.get(sha) }
  }, packageWiring: { packageSvc: { publishZip: publishZip ?? (async ({ fileBuffer }) => { published++; const m = inspectModuleZip(fileBuffer).manifest; const prev = modules.get(m.key); modules.set(m.key, { key: m.key, version: m.version, status: prev?.status === 'INSTALLED' ? 'INSTALLED' : 'PUBLISHED', manifest: m }); return { outcome: 'published' } }) }, lifecycleSvc: { installModule: async ({ manifest }) => { installed++; modules.get(manifest.key).status = 'INSTALLED' } } } })
  return { service, configs, files, modules, requested, feed: (url, value) => feeds.set(url, value), offline: (value) => { offline = value }, feedDown: (value) => { feedDown = value }, tick: (ms) => { clock += ms }, counts: () => ({ published, installed }) }
}
const consent = (m) => ({ acceptCommunity: true, confirmation: m.confirmation })

test('official snapshot: pinned key, signed compatibility, structured trust and both domains reported', async () => {
  const f = fixture()
  f.feed(OFFICIAL_URL, officialEnvelope({ modules: [officialModule(billing)] }))
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes)] }))
  const list = await f.service.list()
  const byKey = Object.fromEntries(list.modules.map((m) => [m.key, m]))
  assert.deepEqual([byKey['custom.billing'].trust, byKey['custom.billing'].official, byKey['custom.billing'].source, byKey['custom.billing'].state], ['official', true, 'official', 'available'])
  assert.deepEqual(byKey['custom.billing'].compatibilityRequirements, profile())
  assert.deepEqual([byKey['custom.notes'].trust, byKey['custom.notes'].official], ['community-verified', false])
  assert.equal(list.catalogs.official.sequence, 1); assert.equal(list.catalogs.community.sequence, 1)
  assert.equal(byKey['custom.billing'].scope, 'instance')
  // Official installs need no community consent; the bytes come from the official feed.
  const result = await f.service.install({ key: 'custom.billing', version: '0.1.0' })
  assert.deepEqual([result.official, result.phases], [true, ['downloading', 'verifying', 'preflight', 'installing', 'enabled']])
  assert.ok(f.requested.some((url) => url.startsWith('https://hub.example/api/v1/marketplace/catalog/packages/')))
  assert.equal(JSON.parse(f.configs.get('catalog.installed.custom.billing')).source, 'official')
})

test('official signature tampering, wrong key, wrong trust domain and cross-domain replays fail closed', async () => {
  const only = { 'catalog.official.url': OFFICIAL_URL }
  const valid = officialEnvelope({ modules: [officialModule(billing)] })
  const tampered = structuredClone(valid); tampered.signed.modules[0].description = 'alterado'
  const wrongKey = officialEnvelope({ modules: [officialModule(billing)], signer: community })
  const wrongDomain = officialEnvelope({ modules: [officialModule(billing)], patch: { trustDomain: 'COMMUNITY' } })
  const wrongCatalog = officialEnvelope({ modules: [officialModule(billing)], patch: { catalog: 'runly-v2' } })
  // A community statement can never pass as official, nor an official one as community.
  const crossed = { signed: valid.signed, keyId: valid.keyId, signature: sign(null, snapshotStatementBytes({ ...valid.signed }), official.privateKey).toString('base64') }
  for (const [envelope, code] of [[tampered, 'catalog_official_signature_untrusted'], [wrongKey, 'catalog_official_signature_untrusted'], [wrongDomain, 'catalog_official_invalid'], [wrongCatalog, 'catalog_official_invalid'], [crossed, 'catalog_official_signature_untrusted']]) {
    const f = fixture({ urls: only })
    f.feed(OFFICIAL_URL, envelope)
    await assert.rejects(f.service.list(), (e) => e.code === code, code)
    await assert.rejects(f.service.install({ key: 'custom.billing', version: '0.1.0' }), (e) => e.code === code)
    assert.deepEqual(f.counts(), { published: 0, installed: 0 })
  }
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes)], signer: official }))
  await assert.rejects(f.service.list(), (e) => e.code === 'catalog_v2_signature_untrusted', 'the official key never signs community snapshots')
  // A community-signed entry claiming official trust is never official.
  const g = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  const spoof = communityEntry(notes); spoof.trust = 'official'; spoof.publisher = null; spoof.signature = sign(null, signedPayload(spoof), community.privateKey).toString('base64')
  g.feed(COMMUNITY_URL, communityEnvelope({ entries: [spoof] }))
  const listed = (await g.service.list()).modules[0]
  assert.deepEqual([listed.trust, listed.official], ['untrusted', false])
})

test('official contract: content-addressed packages only (no traversal or arbitrary URLs)', () => {
  for (const packageUrl of ['../../../etc/passwd', 'https://evil.example/x.zip', 'packages/../x.zip', `packages/${'0'.repeat(64)}.zip`]) {
    const envelope = officialEnvelope({ modules: [officialModule(billing, { patch: { packageUrl } })] })
    assert.throws(() => validateOfficialEnvelope(envelope), /CATALOG_OFFICIAL_INVALID/, packageUrl)
  }
  assert.equal(validateOfficialEnvelope(officialEnvelope({ modules: [officialModule(billing)] })).signed.sequence, 1)
})

test('anti-rollback per trust domain: rollback, equivocation, mirrors; legitimate rollback is a newer sequence', async () => {
  const f = fixture({ urls: { 'catalog.official.url': OFFICIAL_URL } })
  const one = officialEnvelope({ modules: [officialModule(billing)] })
  const two = officialAfter(one, { sequence: 2, modules: [officialModule(billing2)] })
  f.feed(OFFICIAL_URL, one); await f.service.list()
  f.feed(OFFICIAL_URL, two); assert.equal((await f.service.list()).catalogs.official.sequence, 2)
  f.feed(OFFICIAL_URL, one)
  let list = await f.service.list()
  assert.deepEqual([list.alert, list.catalogs.official.sequence, list.modules[0].version], ['catalog_official_rollback', 2, '0.2.0'])
  await assert.rejects(f.service.install({ key: 'custom.billing', version: '0.2.0' }), (e) => e.code === 'catalog_official_rollback')
  f.feed(OFFICIAL_URL, officialAfter(one, { sequence: 2, modules: [officialModule(billing)], generatedAt: at(9000) }))
  assert.equal((await f.service.list()).alert, 'catalog_official_equivocation')
  // Hub rollback to the 0.1.0 content: a NEW snapshot, sequence 3, chained to 2.
  f.feed(OFFICIAL_URL, officialAfter(two, { sequence: 3, modules: [officialModule(billing)] }))
  list = await f.service.list()
  assert.deepEqual([list.alert, list.catalogs.official.sequence, list.modules[0].version], [null, 3, '0.1.0'])
  // Switching to a mirror URL never resets the domain high-water mark.
  const MIRROR = 'https://mirror.example/official.json'
  f.configs.set('catalog.official.url', MIRROR); f.feed(MIRROR, two)
  await assert.rejects(f.service.list(), (e) => e.code === 'catalog_official_rollback')
  assert.equal(sequenceDecision({ sequence: 5, sha256: 'a', generatedAt: at() }, { sequence: 9, sha256: 'b', previous: { sequence: 8, sha256: 'x' }, generatedAt: at(1) }), null, 'skipped sequences are allowed')
})

test('revoked installed release warns without uninstalling; install, reinstall and update to it are blocked', async () => {
  const f = fixture({ urls: { 'catalog.official.url': OFFICIAL_URL } })
  const first = officialEnvelope({ modules: [officialModule(billing)] })
  f.feed(OFFICIAL_URL, first)
  await f.service.install({ key: 'custom.billing', version: '0.1.0' })
  const revoked = { key: 'custom.billing', version: '0.1.0', sha256: sha256Of(billing.zip), reason: 'Vulnerabilidad confirmada', revoked_at: at(2000) }
  f.feed(OFFICIAL_URL, officialAfter(first, { sequence: 2, modules: [officialModule(billing2)], revocations: [revoked] }))
  const module = (await f.service.list()).modules.find((m) => m.key === 'custom.billing')
  assert.deepEqual([module.state, module.installedVersion, module.installedWarning.reason, module.installedNotice], ['update', '0.1.0', 'Vulnerabilidad confirmada', null])
  assert.match(module.installedWarning.message, /revocada/)
  assert.equal(f.modules.get('custom.billing').status, 'INSTALLED', 'never uninstalled automatically')
  await assert.rejects(f.service.install({ key: 'custom.billing', version: '0.1.0' }), (e) => ['already_installed', 'not_in_catalog'].includes(e.code))
  // Fresh instance: the revoked version cannot be (re)installed even if a feed still lists it.
  const g = fixture({ urls: { 'catalog.official.url': OFFICIAL_URL } })
  g.feed(OFFICIAL_URL, officialEnvelope({ modules: [officialModule(billing)], revocations: [revoked] }))
  await assert.rejects(g.service.install({ key: 'custom.billing', version: '0.1.0' }), (e) => e.code === 'catalog_release_revoked')
  // Update toward a revoked community version is blocked.
  const h = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL }, rows: [{ key: 'custom.notes', version: '0.1.0', status: 'INSTALLED' }] })
  const n2 = communityEntry(notes2)
  h.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes), n2], revocations: [{ type: 'release', target: { key: n2.key, version: n2.version, sha256: n2.sha256 }, reason: 'Regresión de seguridad', revokedAt: at(), sequence: 1, replacement: null }] }))
  const listed = (await h.service.list()).modules[0]
  assert.equal(listed.version, '0.1.0', 'a revoked version is never offered as the update')
  await assert.rejects(h.service.update({ key: n2.key, version: n2.version, acceptCommunity: true, confirmation: `acme-labs/${n2.key}@${n2.version}:${n2.sha256}` }), (e) => e.code === 'catalog_release_revoked')
})

test('withdrawn is not a security incident: installed copy keeps working, no new installs', async () => {
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  const live = communityEntry(notes)
  const first = communityEnvelope({ entries: [live] })
  f.feed(COMMUNITY_URL, first)
  const offered = (await f.service.list()).modules[0]
  await f.service.install({ key: offered.key, version: offered.version, ...consent(offered) })
  f.feed(COMMUNITY_URL, communityAfter(first, { sequence: 2, entries: [communityEntry(notes, { status: 'withdrawn', listed: false })] }))
  const module = (await f.service.list()).modules[0]
  assert.deepEqual([module.state, module.installedWarning, module.installedNotice.type, module.availability, module.revocation], ['installed', null, 'withdrawn', 'withdrawn', null])
  const g = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  g.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes, { status: 'withdrawn', listed: false })] }))
  assert.equal((await g.service.list()).modules.length, 0, 'withdrawn is not offered as a new installation')
  await assert.rejects(g.service.install({ key: 'custom.notes', version: '0.1.0', acceptCommunity: true, confirmation: offered.confirmation }), (e) => e.code === 'catalog_release_withdrawn' && e.status === 410)
})

test('built-in platform modules are never downloaded from a catalog', async () => {
  const f = fixture({ urls: { 'catalog.official.url': OFFICIAL_URL }, rows: [{ key: 'runly.inventory', version: '1.0.0', status: 'INSTALLED', core: false }] })
  const builtIn = officialModule(billing, { patch: { key: 'runly.inventory', version: '9.0.0' } })
  f.feed(OFFICIAL_URL, officialEnvelope({ modules: [builtIn] }))
  const module = (await f.service.list()).modules[0]
  assert.deepEqual([module.state, module.builtIn], ['built-in', true])
  await assert.rejects(f.service.update({ key: 'runly.inventory', version: '9.0.0' }), (e) => e.code === 'catalog_builtin_module')
  assert.equal(f.requested.filter((u) => u.includes('/packages/')).length, 0)
})

test('dependencies are declared, shown and enforced; spoofed dependency surface is rejected', async () => {
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  const dependent = communityEntry(notes, { patch: { dependencies: ['runly.core', 'custom.billing', 'custom.ghost', 'runly.unknownplatform'] } })
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [dependent, communityEntry(billing)] }))
  const module = (await f.service.list()).modules.find((m) => m.key === 'custom.notes')
  assert.deepEqual(module.compatibility.reasons, ['dependencies'])
  assert.deepEqual(module.compatibility.details.dependencies.map((d) => [d.key, d.status]), [['runly.core', 'satisfied'], ['custom.billing', 'install-first'], ['custom.ghost', 'missing'], ['runly.unknownplatform', 'missing']])
  await assert.rejects(f.service.install({ key: 'custom.notes', version: '0.1.0', ...consent(module) }), (e) => e.code === 'catalog_incompatible')
  assert.deepEqual(f.counts(), { published: 0, installed: 0 }, 'no dependency is installed implicitly')
  // The signed entry hides the ZIP dependency on runly.core.
  const g = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  g.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes, { patch: { dependencies: [] } })] }))
  const hidden = (await g.service.list()).modules[0]
  await assert.rejects(g.service.install({ key: 'custom.notes', version: '0.1.0', ...consent(hidden) }), (e) => e.code === 'catalog_metadata_mismatch' && e.details.phase === 'verifying')
})

test('artifact digest mismatch, substitution and malicious ZIP never reach the installer', async () => {
  for (const [label, prepare, code] of [
    ['digest mismatch', (f, e) => f.files.set(e.sha256, Buffer.concat([notes.zip, Buffer.from('x')])), 'package_not_authentic'],
    ['substitution', (f, e) => f.files.set(e.sha256, notes2.zip), 'package_not_authentic'],
  ]) {
    const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
    const e = communityEntry(notes)
    f.feed(COMMUNITY_URL, communityEnvelope({ entries: [e] }))
    prepare(f, e)
    const m = (await f.service.list()).modules[0]
    await assert.rejects(f.service.install({ key: m.key, version: m.version, ...consent(m) }), (error) => error.code === code && error.details.phase === 'verifying', label)
    assert.deepEqual(f.counts(), { published: 0, installed: 0 }, label)
  }
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  const malicious = communityEntry({ zip: evil, manifest: notes.manifest })
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [malicious] }))
  const m = (await f.service.list()).modules[0]
  assert.equal(inspectModuleZip(evil).valid, false)
  await assert.rejects(f.service.install({ key: m.key, version: m.version, ...consent(m) }), (error) => error.code === 'catalog_manifest_mismatch')
  assert.deepEqual(f.counts(), { published: 0, installed: 0 })
})

test('untrusted catalog URLs are rejected at configuration and at load', async () => {
  for (const url of ['http://hub.example/feed', 'https://user:pass@hub.example/feed', 'javascript:alert(1)', 'ftp://hub.example/feed', 'https://hub.example/feed#x', 'not a url'])
    assert.ok(catalogUrlProblem(url), url)
  for (const url of [OFFICIAL_URL, 'file:///srv/catalog/official.json', '']) assert.equal(catalogUrlProblem(url), null, url)
  const f = fixture({ urls: { 'catalog.official.url': 'http://hub.example/official' } })
  await assert.rejects(f.service.list(), (e) => e.code === 'catalog_url_rejected')
  await assert.rejects(f.service.configureSource({ communityUrl: 'http://evil.example/feed' }), (e) => e.code === 'catalog_url_rejected')
  const saved = await f.service.configureSource({ officialUrl: OFFICIAL_URL, policy: { maxCacheAgeDays: 7 } })
  assert.deepEqual([saved.officialUrl, saved.policy.maxCacheAgeDays], [OFFICIAL_URL, 7])
  assert.ok(saved.trust.every((k) => !('publicKey' in k)), 'trust view exposes ids and lifecycle only')
})

test('trust store: official/community separation, rotation windows and local revocation', async () => {
  assert.throws(() => createTrustStore({ official: [official.publicKey], community: [official.publicKey] }), /COMMUNITY_KEY_OVERLAPS_OFFICIAL/)
  const store = createTrustStore({ official: [{ publicKey: official.publicKey, state: 'retiring', notAfter: at(1500) }, nextOfficial.publicKey], community: [community.publicKey], managed: [official.publicKey, 'not-a-key', managed.publicKey] })
  assert.equal(store.categoryOf(keyIdOf(official.publicKey)), 'official', 'a managed copy of the official key stays official-only')
  assert.deepEqual(store.keys.managed, [keyIdOf(managed.publicKey)], 'invalid admin keys never verify')
  // Retiring key: verifies snapshots up to notAfter only; the new active key takes over.
  assert.equal(store.verifyOfficialSnapshot(officialEnvelope({ modules: [officialModule(billing)], generatedAt: at(1000) })).keyId, keyIdOf(official.publicKey))
  assert.throws(() => store.verifyOfficialSnapshot(officialEnvelope({ modules: [officialModule(billing)], generatedAt: at(2000) })), /CATALOG_OFFICIAL_SIGNATURE_UNTRUSTED/)
  assert.ok(store.verifyOfficialSnapshot(officialEnvelope({ modules: [officialModule(billing, { key: nextOfficial })], signer: nextOfficial, generatedAt: at(2000) })))
  // Community/managed keys can never sign an official snapshot.
  assert.throws(() => createTrustStore({ official: [official.publicKey], managed: [managed.publicKey] }).verifyOfficialSnapshot(officialEnvelope({ modules: [], signer: managed })), /CATALOG_OFFICIAL_SIGNATURE_UNTRUSTED/)
  assert.deepEqual(store.describeKeys().map((k) => [k.domain, k.state]), [['official', 'retiring'], ['official', 'active'], ['community', 'active'], ['managed', 'active']])

  // Administrators may revoke a pin locally (never re-trust or promote it).
  const f = fixture({ urls: { 'catalog.official.url': OFFICIAL_URL } })
  f.feed(OFFICIAL_URL, officialEnvelope({ modules: [officialModule(billing)] }))
  assert.equal((await f.service.list()).modules[0].official, true)
  await assert.rejects(f.service.configureSource({ revokeKeyIds: ['f'.repeat(64)] }), (e) => e.code === 'catalog_key_unknown')
  await assert.rejects(f.service.configureSource({ managedKeys: [official.publicKey] }), (e) => e.code === 'catalog_key_overlaps_pinned')
  await assert.rejects(f.service.configureSource({ managedKeys: ['bm90LWEta2V5'] }), (e) => e.code === 'catalog_key_invalid')
  const after = await f.service.configureSource({ revokeKeyIds: [keyIdOf(official.publicKey)] })
  assert.equal(after.trust.find((k) => k.domain === 'official').state, 'revoked')
  const list = await f.service.list()
  assert.equal(list.alert, 'catalog_official_signature_untrusted', 'content signed by a locally revoked key is no longer trusted')
  await assert.rejects(f.service.install({ key: 'custom.billing', version: '0.1.0' }), (e) => e.code === 'catalog_official_signature_untrusted')
})

test('preflight shows phases without side effects; install failures report the failing phase', async () => {
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes)] }))
  const check = await f.service.preflight({ key: 'custom.notes', version: '0.1.0' })
  assert.deepEqual([check.phases, check.action, check.scope, check.module.trust], [['downloading', 'verifying', 'preflight'], 'install', 'instance', 'community-verified'])
  assert.deepEqual(f.counts(), { published: 0, installed: 0 })
  const failing = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL }, publishZip: async () => { throw Object.assign(new Error('Decisiones de esquema requeridas.'), { statusCode: 409, code: 'MODULE_SCHEMA_DECISIONS_REQUIRED', details: { structure: [{ field: 'x' }] } }) } })
  failing.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes)] }))
  const m = (await failing.service.list()).modules[0]
  await assert.rejects(failing.service.install({ key: m.key, version: m.version, ...consent(m) }), (e) => e.code === 'MODULE_SCHEMA_DECISIONS_REQUIRED' && e.status === 409 && e.details.phase === 'preflight' && e.details.structure.length === 1)
})

test('freshness: a verified copy serves installs while fresh, needs acknowledgement when stale, never when too old', async () => {
  const HOUR = 3600000
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes), communityEntry(notes2), communityEntry(billing)] }))
  await f.service.list()
  f.feedDown(true)
  const cached = await f.service.list()
  assert.deepEqual([cached.offline, cached.catalogs.community.cachedView, cached.catalogs.community.freshness, cached.modules.length], [true, true, 'fresh', 2])
  const notesModule = cached.modules.find((m) => m.key === 'custom.notes')
  assert.equal((await f.service.install({ key: 'custom.notes', version: '0.1.0', ...consent({ confirmation: `acme-labs/custom.notes@0.1.0:${sha256Of(notes.zip)}` }) })).phases.at(-1), 'enabled', 'fresh verified copy: install allowed, bytes still verified')
  assert.ok(notesModule)
  f.tick(30 * HOUR)
  const billingModule = (await f.service.list()).modules.find((m) => m.key === 'custom.billing')
  assert.equal((await f.service.list()).catalogs.community.freshness, 'stale')
  await assert.rejects(f.service.install({ key: 'custom.billing', version: '0.1.0', ...consent(billingModule) }), (e) => e.code === 'catalog_stale_confirmation_required' && e.status === 428 && Boolean(e.details.verifiedAt))
  assert.equal((await f.service.install({ key: 'custom.billing', version: '0.1.0', ...consent(billingModule), acceptStale: true })).phases.at(-1), 'enabled')
  f.tick(50 * HOUR)
  const expired = await f.service.list()
  assert.equal(expired.catalogs.community.freshness, 'expired', 'still visible (maxCacheAgeDays) but marked')
  const update = expired.modules.find((m) => m.key === 'custom.notes')
  assert.equal(update.state, 'update')
  await assert.rejects(f.service.update({ key: 'custom.notes', version: '0.2.0', ...consent(update), acceptStale: true }), (e) => e.code === 'catalog_too_old')
  assert.equal(f.modules.get('custom.notes').status, 'INSTALLED', 'installed modules never depend on catalog freshness')
  f.feedDown(false); f.offline(true)
  await f.service.configureSource({ policy: { allowCachedView: false } })
  await assert.rejects(f.service.list(), (e) => e.code === 'catalog_unreachable')
  await f.service.configureSource({ policy: { allowCachedView: true, maxCacheAgeDays: 1 } })
  f.tick(2 * DAY)
  await assert.rejects(f.service.list(), (e) => e.code === 'catalog_unreachable', 'cache older than policy is not shown')
  // Without any verified copy, a timeout/unreachable catalog is an error, not an empty list.
  const g = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  g.offline(true)
  await assert.rejects(g.service.list(), (e) => e.code === 'catalog_unreachable')
})

test('marketplace metadata is data: markup in names and descriptions is returned verbatim, never interpreted', async () => {
  const f = fixture({ urls: { 'catalog.v2.url': COMMUNITY_URL } })
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
  f.feed(COMMUNITY_URL, communityEnvelope({ entries: [communityEntry(notes, { patch: { name: payload, description: payload, changelog: payload } })] }))
  const m = (await f.service.list()).modules[0]
  assert.deepEqual([m.name, m.description, m.changelog], [payload, payload, payload])
})

test('default source: new installations use the Runly catalog; existing ones keep their behaviour; changes are explicit', async () => {
  // New installation: no instance_config rows → Runly feeds, still fully verified (fail closed).
  const fresh = fixture({ urls: {} })
  await assert.rejects(fresh.service.list(), (e) => e.code === 'catalog_unreachable')
  assert.deepEqual([...new Set(fresh.requested)].sort(), ['https://devs.runly.mx/api/v1/marketplace/catalog/community', 'https://devs.runly.mx/api/v1/marketplace/catalog/official'])
  assert.equal((await fresh.service.source()).mode, 'runly')
  // Existing instance pinned by migration to 'disabled': no outbound catalog request.
  const existing = fixture({ urls: { 'catalog.source.mode': 'disabled' } })
  assert.deepEqual(await existing.service.list(), { enabled: false, sourceMode: 'disabled', modules: [] })
  assert.equal(existing.requested.length, 0)
  // Opting in to the Runly catalog clears custom URLs; explicit URLs mean custom.
  const custom = fixture({ urls: { 'catalog.official.url': OFFICIAL_URL } })
  assert.equal((await custom.service.source()).mode, 'custom')
  const switched = await custom.service.configureSource({ mode: 'runly' })
  assert.deepEqual([switched.mode, switched.officialUrl, switched.effective.officialUrl], ['runly', null, 'https://devs.runly.mx/api/v1/marketplace/catalog/official'])
  assert.equal((await custom.service.configureSource({ officialUrl: OFFICIAL_URL })).mode, 'custom')
  await assert.rejects(custom.service.configureSource({ mode: 'anything' }), (e) => e.code === 'catalog_source_invalid')
  await assert.rejects(custom.service.configureSource({ policy: { installFreshHours: 80, installMaxAgeHours: 24 } }), (e) => e.code === 'catalog_policy_invalid')
})
