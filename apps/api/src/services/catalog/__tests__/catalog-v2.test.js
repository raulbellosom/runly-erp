import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { compileModule, archiveModule, createStarterDefinition } from '@runly/module-compiler/server'
import { inspectModuleZip } from '@runly/module-compiler/inspection'
import { RME3_CAPABILITIES } from '@runly/module-compiler/contracts'
import { sha256Of, signedPayload } from '../catalog-crypto.js'
import { manifestCatalogMetadata } from '../catalog-schema.js'
import { releaseStatementBytes, snapshotStatementBytes, snapshotDigest, keyIdOf } from '../catalog-v2-contract.js'
import { createTrustStore, COMMUNITY_CATALOG_PUBLIC_KEYS } from '../catalog-trust-store.js'
import { OFFICIAL_CATALOG_PUBLIC_KEYS } from '../catalog-public-key.js'
import { createCatalogV2Service } from '../catalog-v2-service.js'

// Synthetic keys only; the pinned production official key is never used to sign.
const pair = () => { const k = generateKeyPairSync('ed25519'); return { privateKey: k.privateKey, publicKey: k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') } }
const official = pair(), community = pair(), rotated = pair(), managed = pair()
const at = (offset = 0) => new Date(Date.parse('2026-10-05T00:00:00.000Z') + offset).toISOString()
const DAY = 86400000
async function moduleZip(key, version = '0.1.0') {
  const definition = createStarterDefinition({ key, name: 'Synthetic community' })
  definition.version = version
  const zip = await archiveModule(compileModule(definition))
  return { zip, manifest: inspectModuleZip(zip).manifest }
}
const communityZip = await moduleZip('custom.communitytest')
const communityZip2 = await moduleZip('custom.communitytest', '0.2.0')
const officialZip = await moduleZip('custom.officialtest')
const contracts = { engine: RME3_CAPABILITIES.engine.schemaVersion, compiler: RME3_CAPABILITIES.compiler.schemaVersion, runtime: RME3_CAPABILITIES.runtime.schemaVersion, capabilities: RME3_CAPABILITIES.schemaVersion }
function entryFor({ zip, manifest }, { trust = 'community', publisher = 'acme-labs', key = community, publishedAt = at(), runly = { min: '0.1.0', max: null }, patch = {} } = {}) {
  const surface = manifestCatalogMetadata(manifest)
  const entry = {
    trust, key: manifest.key, version: manifest.version, sha256: sha256Of(zip), size: zip.length, packageUrl: `packages/${sha256Of(zip)}.zip`, publisher: trust === 'official' ? null : publisher, listed: true, status: 'published', publishedAt,
    name: manifest.name, description: '', icon: 'Boxes', color: '#2563EB', changelog: '',
    capabilities: surface.capabilities, consumes: surface.consumes, events: surface.events, connections: surface.connections.map(({ target, kind, label }) => ({ target, kind, label: label ?? '' })), dependencies: surface.dependencies,
    compatibility: { runly, contracts }, provenance: { evidenceSha256: 'b'.repeat(64), toolchainId: 'c'.repeat(64) }, signature: '', keyId: keyIdOf(key.publicKey), ...patch,
  }
  entry.signature = (trust === 'official' ? sign(null, signedPayload(entry), key.privateKey) : sign(null, releaseStatementBytes(entry), key.privateKey)).toString('base64')
  return entry
}
function envelope({ sequence = 1, previous = null, entries, publishers = [{ handle: 'acme-labs', displayName: 'Acme Labs', verified: true, state: 'active', reason: null, revokedAt: null }], revocations = [], keys = [{ key: community, state: 'active', since: at(-DAY), until: null, reason: null }], signer = community, generatedAt = at(sequence * 1000) } = {}) {
  const signed = { schemaVersion: 2, catalog: 'runly-v2', sequence, generatedAt, validUntil: new Date(Date.parse(generatedAt) + 7 * DAY).toISOString(), previous,
    trust: { keys: keys.map(({ key, ...rest }) => ({ keyId: keyIdOf(key.publicKey), publicKey: key.publicKey, role: 'community', ...rest })) }, publishers, entries, revocations }
  return { signed, signatures: [{ keyId: keyIdOf(signer.publicKey), signature: sign(null, snapshotStatementBytes(signed), signer.privateKey).toString('base64') }] }
}
const envelopeAfter = (prev, options) => envelope({ ...options, previous: { sequence: prev.signed.sequence, sha256: snapshotDigest(prev.signed) } })

function fixture({ trust = { official: [official.publicKey], community: [community.publicKey, rotated.publicKey] }, clock = Date.parse(at(DAY)) } = {}) {
  const configs = new Map([['catalog.v2.url', 'https://catalog.example/v2/index.json']]), cache = new Map()
  let feed = null, offline = false, current = null, published = 0, installed = 0, time = clock
  const files = new Map([[sha256Of(communityZip.zip), communityZip.zip], [sha256Of(communityZip2.zip), communityZip2.zip], [sha256Of(officialZip.zip), officialZip.zip]])
  const grant = { deleteMany: async () => {}, findMany: async () => [], create: async () => {} }
  const prisma = {
    instanceConfig: { findUnique: async ({ where }) => configs.has(where.key) ? { value: configs.get(where.key) } : null, upsert: async ({ where, update }) => { configs.set(where.key, update.value) } },
    moduleCatalogCache: { findUnique: async ({ where }) => cache.get(where.url) ?? null, upsert: async ({ where, create, update }) => { cache.set(where.url, { ...(cache.get(where.url) ?? create), ...update, payload: update.payload ?? create.payload }) } },
    runlyModule: { findMany: async ({ where }) => current && (!where?.key?.in || where.key.in.includes(current.key)) && (!where?.status || where.status === current.status) && current.status === 'INSTALLED' ? [current] : [], findUnique: async () => current },
    moduleServiceGrant: grant, $transaction: async (fn) => fn({ moduleServiceGrant: grant }),
  }
  const service = createCatalogV2Service({ prisma, trust, now: () => time, readBytes: async (url) => {
    if (offline) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    if (url.endsWith('index.json')) return { status: 200, buffer: Buffer.from(JSON.stringify(feed)) }
    const sha = /packages\/([a-f0-9]{64})\.zip$/.exec(url)?.[1]
    return { status: 200, buffer: files.get(sha) }
  }, packageWiring: { packageSvc: { publishZip: async ({ fileBuffer }) => { published++; const m = inspectModuleZip(fileBuffer).manifest; current = { key: m.key, version: m.version, status: current?.status === 'INSTALLED' ? 'INSTALLED' : 'PUBLISHED', manifest: m }; return { outcome: 'published' } } }, lifecycleSvc: { installModule: async () => { installed++; current.status = 'INSTALLED' } } } })
  return { service, configs, files, set: (value) => { feed = value }, offline: (value) => { offline = value }, tick: (ms) => { time += ms }, counts: () => ({ published, installed }), installed: () => current }
}
const confirmationOf = (e) => `${e.publisher ?? 'runly'}/${e.key}@${e.version}:${e.sha256}`

test('v1 official trust anchor is untouched and community keys can never overlap it', () => {
  assert.deepEqual(OFFICIAL_CATALOG_PUBLIC_KEYS, ['MCowBQYDK2VwAyEArvSedcdVX6Ldk6/0O0SdLShYt9TSdNcf/+lBL3ysJfM='])
  assert.deepEqual(COMMUNITY_CATALOG_PUBLIC_KEYS, [], 'no production community key is pinned yet')
  assert.throws(() => createTrustStore({ official: [official.publicKey], community: [official.publicKey] }), /COMMUNITY_KEY_OVERLAPS_OFFICIAL/)
  const store = createTrustStore({ official: [official.publicKey], community: [community.publicKey], managed: [official.publicKey, managed.publicKey] })
  assert.equal(store.categoryOf(keyIdOf(official.publicKey)), 'official', 'a managed copy of the official key stays official-only')
  assert.equal(store.categoryOf(keyIdOf(managed.publicKey)), 'managed')
})

test('v2 official and community entries get distinct trust; community never yields official', async () => {
  const f = fixture()
  const officialEntry = entryFor(officialZip, { trust: 'official', key: official })
  const verified = entryFor(communityZip)
  // A community key signing the official v1 payload and claiming trust "official".
  const spoof = entryFor(await moduleZip('custom.spooftest'), { trust: 'official', key: community })
  f.set(envelope({ entries: [officialEntry, verified, spoof] }))
  const list = await f.service.list()
  const byKey = Object.fromEntries(list.modules.map((m) => [m.key, m]))
  assert.equal(byKey['custom.officialtest'].trust, 'official'); assert.equal(byKey['custom.officialtest'].official, true); assert.equal(byKey['custom.officialtest'].trustLabel, 'Oficial Runly')
  assert.equal(byKey['custom.communitytest'].trust, 'community-verified'); assert.equal(byKey['custom.communitytest'].official, false); assert.equal(byKey['custom.communitytest'].trustLabel, 'Publicador verificado · Comunidad')
  assert.equal(byKey['custom.spooftest'].trust, 'untrusted'); assert.equal(byKey['custom.spooftest'].official, false)
  assert.ok(list.modules.every((m) => m.official === (m.trust === 'official')))
  // Unverified publisher → community without the verified mark; managed key → managed.
  const g = fixture({ trust: { official: [official.publicKey], community: [community.publicKey], managed: [managed.publicKey] } })
  g.set(envelope({ entries: [entryFor(communityZip, { key: managed })], publishers: [{ handle: 'acme-labs', displayName: 'Acme Labs', verified: false, state: 'active', reason: null, revokedAt: null }] }))
  const managedList = await g.service.list()
  assert.equal(managedList.modules[0].trust, 'managed'); assert.equal(managedList.modules[0].trustLabel, 'Catálogo administrado')
  const h = fixture()
  h.set(envelope({ entries: [verified], publishers: [{ handle: 'acme-labs', displayName: 'Acme Labs', verified: false, state: 'active', reason: null, revokedAt: null }] }))
  assert.equal((await h.service.list()).modules[0].trust, 'community')
})

test('community installs need explicit admin consent and exact confirmation; official does not; no auto-update', async () => {
  const f = fixture()
  const e1 = entryFor(communityZip)
  f.set(envelope({ entries: [e1] }))
  await assert.rejects(f.service.install({ key: e1.key, version: e1.version }), (e) => e.code === 'community_consent_required')
  await assert.rejects(f.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: 'other' }), (e) => e.code === 'community_consent_required')
  assert.deepEqual(f.counts(), { published: 0, installed: 0 })
  const result = await f.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) })
  assert.equal(result.trust, 'community-verified'); assert.equal(result.official, false)
  assert.equal(JSON.parse(f.configs.get('catalog.installed.custom.communitytest')).source, 'v2')
  const e2 = entryFor(communityZip2)
  f.set(envelopeAfter(envelope({ entries: [e1] }), { sequence: 2, entries: [e1, e2] }))
  const list = await f.service.list()
  assert.equal(list.modules[0].state, 'update'); assert.equal(f.installed().version, '0.1.0', 'listing never installs')
  await assert.rejects(f.service.update({ key: e2.key, version: e2.version }), (e) => e.code === 'community_consent_required')
  assert.equal((await f.service.update({ key: e2.key, version: e2.version, acceptCommunity: true, confirmation: confirmationOf(e2) })).version, '0.2.0')
  const o = fixture(), oe = entryFor(officialZip, { trust: 'official', key: official })
  o.set(envelope({ entries: [oe] }))
  assert.equal((await o.service.install({ key: oe.key, version: oe.version })).official, true)
})

test('replay, rollback, equivocation, broken chain and v2→v1 downgrade keep the last good snapshot', async () => {
  const f = fixture()
  const e1 = entryFor(communityZip)
  const first = envelope({ entries: [e1] }), second = envelopeAfter(first, { sequence: 2, entries: [e1, entryFor(communityZip2)] })
  f.set(first); await f.service.list()
  f.set(second); assert.equal((await f.service.list()).sequence, 2)
  f.set(first); let list = await f.service.list()
  assert.equal(list.alert, 'catalog_v2_rollback'); assert.equal(list.sequence, 2, 'old snapshot never replaces state')
  await assert.rejects(f.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) }), (e) => e.code === 'catalog_v2_rollback')
  f.set(envelopeAfter(first, { sequence: 2, entries: [e1], generatedAt: at(5000) }))
  assert.equal((await f.service.list()).alert, 'catalog_v2_equivocation')
  f.set(envelope({ sequence: 3, previous: { sequence: 2, sha256: 'f'.repeat(64) }, entries: [e1] }))
  assert.equal((await f.service.list()).alert, 'catalog_v2_chain_broken')
  f.set({ schemaVersion: 1, generatedAt: at(), modules: [] })
  assert.equal((await f.service.list()).alert, 'catalog_v2_downgrade')
  f.set(second); list = await f.service.list()
  assert.equal(list.alert, null); assert.equal(list.sequence, 2, 'identical replay is harmless')
  const tampered = structuredClone(second); tampered.signed.entries[0].description = 'altered'
  f.set(tampered); assert.equal((await f.service.list()).alert, 'catalog_v2_signature_untrusted')
})

test('stale metadata and offline mode show the last sync and block installs', async () => {
  const f = fixture()
  const e1 = entryFor(communityZip)
  f.set(envelope({ entries: [e1] }))
  const fresh = await f.service.list()
  assert.equal(fresh.stale, false); assert.ok(fresh.lastSync)
  f.offline(true)
  const offline = await f.service.list()
  assert.equal(offline.offline, true); assert.equal(offline.lastSync, fresh.lastSync); assert.equal(offline.modules.length, 1)
  await assert.rejects(f.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) }), (e) => e.code === 'catalog_offline')
  f.offline(false); f.tick(8 * DAY)
  const stale = await f.service.list()
  assert.equal(stale.stale, true)
  await assert.rejects(f.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) }), (e) => e.code === 'catalog_v2_stale')
})

test('compatibility and signed metadata are enforced against the instance and the ZIP', async () => {
  const f = fixture()
  const tooNew = entryFor(communityZip, { runly: { min: '9.0.0', max: null } })
  f.set(envelope({ entries: [tooNew] }))
  const listed = (await f.service.list()).modules[0]
  assert.equal(listed.compatibility.compatible, false); assert.deepEqual(listed.compatibility.reasons, ['runly_version'])
  await assert.rejects(f.service.install({ key: tooNew.key, version: tooNew.version, acceptCommunity: true, confirmation: confirmationOf(tooNew) }), (e) => e.code === 'catalog_incompatible')
  const g = fixture(), wrongContract = entryFor(communityZip, { patch: { compatibility: { runly: { min: '0.1.0', max: null }, contracts: { ...contracts, compiler: 99 } } } })
  g.set(envelope({ entries: [wrongContract] }))
  assert.deepEqual((await g.service.list()).modules[0].compatibility.reasons, ['contracts'])
  const h = fixture(), forged = entryFor(communityZip, { patch: { capabilities: ['forged.capability'] } })
  h.set(envelope({ entries: [forged] }))
  await assert.rejects(h.service.install({ key: forged.key, version: forged.version, acceptCommunity: true, confirmation: confirmationOf(forged) }), (e) => e.code === 'catalog_metadata_mismatch')
  const i = fixture(), e1 = entryFor(communityZip)
  i.files.set(e1.sha256, Buffer.concat([communityZip.zip, Buffer.from('x')]))
  i.set(envelope({ entries: [e1] }))
  await assert.rejects(i.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) }), (e) => e.code === 'package_not_authentic')
  const j = fixture(), mismatch = entryFor(communityZip, { patch: { version: '0.9.0' } })
  j.set(envelope({ entries: [mismatch] }))
  await assert.rejects(j.service.install({ key: mismatch.key, version: '0.9.0', acceptCommunity: true, confirmation: confirmationOf(mismatch) }), (e) => e.code === 'catalog_manifest_mismatch')
})

test('revoked release, publisher and key block installs and warn without uninstalling', async () => {
  const f = fixture()
  const e1 = entryFor(communityZip)
  const first = envelope({ entries: [e1] })
  f.set(first)
  await f.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) })
  const revoked = envelopeAfter(first, { sequence: 2, entries: [entryFor(communityZip2)], revocations: [{ type: 'release', target: { key: e1.key, version: e1.version, sha256: e1.sha256 }, reason: 'Vulnerabilidad', revokedAt: at(), sequence: 2, replacement: { key: e1.key, version: '0.2.0' } }] })
  f.set(revoked)
  const module = (await f.service.list()).modules.find((m) => m.key === e1.key)
  assert.equal(module.installedWarning.type, 'release'); assert.deepEqual(module.installedWarning.replacement, { key: e1.key, version: '0.2.0' })
  assert.equal(f.installed().status, 'INSTALLED', 'never uninstalled automatically')
  const g = fixture()
  g.set(envelope({ entries: [e1], revocations: [{ type: 'release', target: { key: e1.key, version: e1.version, sha256: e1.sha256 }, reason: 'Vulnerabilidad', revokedAt: at(), sequence: 1, replacement: null }] }))
  await assert.rejects(g.service.install({ key: e1.key, version: e1.version, acceptCommunity: true, confirmation: confirmationOf(e1) }), (e) => e.code === 'catalog_release_revoked')
  const p = fixture()
  p.set(envelope({ entries: [e1], publishers: [{ handle: 'acme-labs', displayName: 'Acme Labs', verified: true, state: 'revoked', reason: 'Suplantación', revokedAt: at() }], revocations: [{ type: 'publisher', target: { publisher: 'acme-labs' }, reason: 'Suplantación', revokedAt: at(), sequence: 1, replacement: null }] }))
  assert.equal((await p.service.list()).modules[0].revocation.type, 'publisher')
  const k = fixture()
  k.set(envelope({ entries: [e1], keys: [{ key: community, state: 'revoked', since: at(-DAY), until: at(), reason: 'Filtrada' }, { key: rotated, state: 'active', since: at(), until: null, reason: null }], signer: rotated,
    revocations: [{ type: 'key', target: { keyId: keyIdOf(community.publicKey) }, reason: 'Filtrada', revokedAt: at(), sequence: 1, replacement: null }] }))
  const keyList = (await k.service.list()).modules[0]
  assert.equal(keyList.trust, 'untrusted'); assert.equal(keyList.trustReason, 'signing_key_revoked')
})

test('key rotation: retired keys verify releases published before retirement; snapshot from new key', async () => {
  const f = fixture()
  const before = entryFor(communityZip, { publishedAt: at(-1000) })
  const after = entryFor(communityZip2, { publishedAt: at(5000) })
  f.set(envelope({ entries: [before, after], keys: [{ key: community, state: 'retired', since: at(-DAY), until: at(), reason: null }, { key: rotated, state: 'active', since: at(), until: null, reason: null }], signer: rotated }))
  const list = await f.service.list()
  assert.equal(list.modules[0].version, '0.2.0'); assert.equal(list.modules[0].trust, 'untrusted'); assert.equal(list.modules[0].trustReason, 'signing_key_retired')
  const store = createTrustStore({ official: [official.publicKey], community: [community.publicKey, rotated.publicKey] })
  const rotatedSnapshot = envelope({ entries: [before], keys: [{ key: community, state: 'retired', since: at(-DAY), until: at(), reason: null }, { key: rotated, state: 'active', since: at(), until: null, reason: null }], signer: rotated }).signed
  assert.equal(store.classifyEntry(before, rotatedSnapshot).trust, 'community-verified')
  const g = fixture({ trust: { official: [official.publicKey], community: [community.publicKey] } })
  g.set(envelope({ entries: [before], signer: rotated, keys: [{ key: rotated, state: 'active', since: at(), until: null, reason: null }] }))
  await assert.rejects(g.service.list(), (e) => e.code === 'catalog_v2_signature_untrusted', 'an unpinned rotated key needs a Runly update first')
})
