// Runly Marketplace consumer (Phase 7 + Catalog Distribution). Verifies the
// signed feeds Developer Hub exports and orchestrates the official package
// pipeline (publishZip + installModule); it never installs by itself, never
// auto-updates, never uninstalls and never deletes data.
//   catalog.v2.url        — community/managed v2 envelope (runly-v2)
//   catalog.official.url  — official snapshot envelope (runly-official)
// The v1 official catalog (catalog-service.js) keeps its behaviour and default.
// Community entries never come from v1 and never fall back to it.
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { inspectModuleZip } from '@runly/module-compiler/inspection'
import { RME3_CAPABILITIES } from '@runly/module-compiler/contracts'
import { resolveModulesDir } from '../module-upload-service.js'
import { createModulePackageWiring } from '../module-package-wiring-service.js'
import { invalidateModuleCaches } from '../module-cache-service.js'
import { isOfficialCoreModuleKey } from '../module-manifests-service.js'
import { consumedServiceKeys, createModuleServices } from '../module-services/module-services.js'
import { readCatalogBytes, CatalogDownloadError } from './catalog-download.js'
import { sha256Of } from './catalog-crypto.js'
import { compareVersions, CatalogError } from './catalog-service.js'
import { manifestCatalogMetadata } from './catalog-schema.js'
import { validateEnvelope, snapshotDigest, CATALOG_V2_ID } from './catalog-v2-contract.js'
import { validateOfficialEnvelope, officialSnapshotDigest, OFFICIAL_CATALOG_ID } from './catalog-official-contract.js'
import { createTrustStore, normalizePin, CatalogTrustError } from './catalog-trust-store.js'
import { createHighWaterStore, domainKey, sequenceDecision } from './catalog-sequence.js'
import rootPackage from '../../../../../package.json' with { type: 'json' }

const STATE_KEY = 'catalog.v2.state'
const OFFICIAL_STATE_KEY = 'catalog.official.state'
export const CONFIG_KEYS = Object.freeze({ sourceMode: 'catalog.source.mode', communityUrl: 'catalog.v2.url', officialUrl: 'catalog.official.url', managedKeys: 'catalog.v2.managedKeys', revokedKeyIds: 'catalog.trust.revokedKeyIds', policy: 'catalog.policy' })
// Freshness of the signed catalog used for installation, measured from the last
// successful verification of the cached copy (official snapshots have no
// validUntil; community snapshots also expire at their signed validUntil):
//   fresh  < installFreshHours       → install/update allowed from the verified copy
//   stale  < installMaxAgeHours      → allowed only after explicit acknowledgement
//   older                            → view only (up to maxCacheAgeDays), never install
// Installed modules are never blocked by catalog freshness.
export const DEFAULT_POLICY = Object.freeze({ allowCachedView: true, maxCacheAgeDays: 30, installFreshHours: 24, installMaxAgeHours: 72 })
// Source modes. New installations default to the Runly catalog (no instance_config
// row); instances that existed before this release were pinned by migration to
// their previous behaviour ('disabled' or 'custom'). Explicit URLs always win.
export const SOURCE_MODES = Object.freeze(['runly', 'custom', 'disabled'])
// Future default source. Never enabled implicitly: an administrator opts in, and
// until production keys are pinned in a Runly release these feeds fail closed.
export const RUNLY_CATALOG_SOURCE = Object.freeze({ officialUrl: 'https://devs.runly.mx/api/v1/marketplace/catalog/official', communityUrl: 'https://devs.runly.mx/api/v1/marketplace/catalog/community' })
export const INSTALL_PHASES = Object.freeze(['downloading', 'verifying', 'preflight', 'installing', 'enabled'])
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
export const TRUST_LABELS = Object.freeze({ official: 'Oficial Runly', 'community-verified': 'Publicador verificado · Comunidad', community: 'Comunidad · publicador no verificado', managed: 'Catálogo administrado', untrusted: 'No confiable' })
const DAY = 86400000
const HEX64 = /^[a-f0-9]{64}$/
// Platform namespaces ship inside the Runly image: never downloaded from a catalog.
export const isBuiltInKey = (key) => !String(key).startsWith('custom.')

// Only HTTPS (or an explicit local file:// catalog) may be configured.
export function catalogUrlProblem(value) {
  if (value === null || value === undefined || value === '') return null
  let url
  try { url = new URL(value) } catch { return 'catalog_url_invalid' }
  if (url.protocol === 'file:') return url.hostname || url.search || url.hash ? 'catalog_url_invalid' : null
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return 'catalog_url_rejected'
  return null
}

class PhaseError extends CatalogError {
  constructor(phase, error) {
    super(error.message, error.status ?? error.statusCode ?? 500, error.code ?? 'catalog_error', { ...(error.details && typeof error.details === 'object' ? error.details : {}), phase, cause: error.details ?? null })
    this.phase = phase
  }
}

export function createCatalogV2Service({ prisma, bundlerSvc = null, routeLoader = null, cacheDel = () => {}, readBytes = readCatalogBytes, trust = {}, packageWiring = null, now = () => Date.now(), runlyVersion = rootPackage.version, capabilities = RME3_CAPABILITIES }) {
  const wiring = packageWiring ?? createModulePackageWiring({ prisma, bundlerSvc, routeLoader, cacheDel })
  const moduleServices = createModuleServices({ prisma })
  const highWater = createHighWaterStore({ prisma })
  const config = async (key) => (await prisma.instanceConfig.findUnique({ where: { key } }))?.value ?? null
  const setConfig = (key, value) => prisma.instanceConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
  const jsonConfig = async (key, fallback) => { try { const value = JSON.parse((await config(key)) ?? 'null'); return value ?? fallback } catch { return fallback } }
  async function policy() {
    const value = await jsonConfig(CONFIG_KEYS.policy, {})
    const int = (name, min, max) => Number.isSafeInteger(value[name]) && value[name] >= min && value[name] <= max ? value[name] : DEFAULT_POLICY[name]
    const installFreshHours = int('installFreshHours', 1, 168)
    return { allowCachedView: typeof value.allowCachedView === 'boolean' ? value.allowCachedView : DEFAULT_POLICY.allowCachedView, maxCacheAgeDays: int('maxCacheAgeDays', 1, 365), installFreshHours, installMaxAgeHours: Math.max(installFreshHours, int('installMaxAgeHours', 1, 720)) }
  }
  async function sourceUrls() {
    const [mode, community, official] = await Promise.all([config(CONFIG_KEYS.sourceMode), config(CONFIG_KEYS.communityUrl), config(CONFIG_KEYS.officialUrl)])
    const effective = SOURCE_MODES.includes(mode) ? mode : community || official ? 'custom' : 'runly'
    const fallback = effective === 'runly' ? RUNLY_CATALOG_SOURCE : { communityUrl: null, officialUrl: null }
    return { mode: effective, communityUrl: community || fallback.communityUrl, officialUrl: official || fallback.officialUrl }
  }
  async function trustStore() {
    const managed = await jsonConfig(CONFIG_KEYS.managedKeys, [])
    const revoked = await jsonConfig(CONFIG_KEYS.revokedKeyIds, [])
    return createTrustStore({ ...trust, managed: Array.isArray(trust.managed) ? trust.managed : Array.isArray(managed) ? managed : [], localRevokedKeyIds: Array.isArray(revoked) ? revoked.filter((id) => HEX64.test(id)) : [] })
  }
  async function getBytes(url, indexUrl, maxBytes) {
    const base = new URL(indexUrl)
    const localRoot = base.protocol === 'file:' ? dirname(fileURLToPath(base)) : null
    return readBytes(url, { maxBytes, localRoot })
  }

  // Shared fetch → validate → verify → anti-rollback pipeline for one trust domain.
  // On any verification failure the last good, previously verified state is kept.
  async function loadDomain({ url, stateKey, prefix, validate, digestOf, verify, catalogId, store, rules }) {
    let state = await jsonConfig(stateKey, null)
    if (state?.url !== url) state = null
    const cached = await prisma.moduleCatalogCache.findUnique({ where: { url } })
    const lastGood = (alert, offline = false) => {
      const tooOld = state && Date.parse(state.fetchedAt) + rules.maxCacheAgeDays * DAY < now()
      if (!cached || !state || !rules.allowCachedView || tooOld) {
        if (alert) throw new CatalogError('El catálogo no superó la verificación y no hay una copia confiable previa.', 422, alert)
        throw new CatalogError('No se pudo conectar con el catálogo.', 502, 'catalog_unreachable')
      }
      const age = now() - Date.parse(state.fetchedAt)
      const freshness = age < rules.installFreshHours * 3600000 ? 'fresh' : age < rules.installMaxAgeHours * 3600000 ? 'stale' : 'expired'
      return { url, envelope: cached.payload, state, offline, alert, cachedView: true, freshness }
    }
    const urlProblem = catalogUrlProblem(url)
    if (urlProblem) throw new CatalogError('La URL del catálogo no es de un origen permitido (HTTPS o archivo local).', 422, urlProblem)
    let buffer, envelope
    try { ({ buffer } = await getBytes(url, url, 4 * 1024 * 1024)) }
    catch (error) {
      // Security rejections (private address, redirects, size) are alerts; any
      // other transport failure means offline: keep showing the last good sync.
      if (error instanceof CatalogDownloadError && error.code !== 'CATALOG_UNREACHABLE') return lastGood(`${prefix}_transport_rejected`)
      return lastGood(null, true)
    }
    try { envelope = validate(JSON.parse(buffer.toString('utf8'))) }
    catch (error) {
      if (error instanceof CatalogError) throw error
      return lastGood(error.code === 'downgrade' || /SCHEMA_UNSUPPORTED/.test(error.code ?? '') ? `${prefix}_downgrade` : `${prefix}_invalid`)
    }
    const signed = envelope.signed, sha256 = digestOf(signed)
    let signer
    try { signer = verify(envelope) } catch { return lastGood(`${prefix}_signature_untrusted`) }
    const domain = domainKey(signer.category, catalogId)
    // Instances upgraded from the per-URL state seed the domain mark from it.
    const accepted = await highWater.get(domain) ?? (state && (state.signer ?? 'community') === signer.category ? state : null)
    const decision = sequenceDecision(accepted, { sequence: signed.sequence, sha256, previous: signed.previous, generatedAt: signed.generatedAt })
    if (decision) return lastGood(`${prefix}_${decision}`)
    const next = { url, domain, sequence: signed.sequence, sha256, generatedAt: signed.generatedAt, validUntil: signed.validUntil ?? null, fetchedAt: new Date(now()).toISOString(), signer: signer.category, keyId: signer.keyId }
    await prisma.moduleCatalogCache.upsert({ where: { url }, update: { payload: envelope, etag: sha256, fetchedAt: new Date(now()) }, create: { url, payload: envelope, etag: sha256 } })
    await highWater.accept(domain, next)
    return { url, envelope, state: next, offline: false, alert: null, cachedView: false, freshness: 'fresh', persist: (extra) => setConfig(stateKey, JSON.stringify({ ...next, ...extra })), store }
  }

  async function loadCommunity(store, rules) {
    const url = (await sourceUrls()).communityUrl
    if (!url) return null
    const previous = await jsonConfig(STATE_KEY, null)
    const revokedKeyIds = new Set(previous?.url === url ? previous.revokedKeyIds ?? [] : [])
    const validate = (payload) => {
      if (payload?.schemaVersion === 1 || Array.isArray(payload?.modules) || payload?.signed?.schemaVersion === 1) throw Object.assign(new Error('downgrade'), { code: 'downgrade' })
      return validateEnvelope(payload)
    }
    const result = await loadDomain({ url, stateKey: STATE_KEY, prefix: 'catalog_v2', validate, digestOf: snapshotDigest, verify: (envelope) => store.verifySnapshot(envelope, { revokedKeyIds }), catalogId: CATALOG_V2_ID, store, rules })
    if (result.persist) {
      for (const key of result.envelope.signed.trust.keys) if (key.state === 'revoked') revokedKeyIds.add(key.keyId)
      for (const r of result.envelope.signed.revocations) if (r.type === 'key') revokedKeyIds.add(r.target.keyId)
      result.state = { ...result.state, revokedKeyIds: [...revokedKeyIds] }
      await result.persist({ revokedKeyIds: [...revokedKeyIds] })
    }
    return { ...result, store }
  }
  async function loadOfficial(store, rules) {
    const url = (await sourceUrls()).officialUrl
    if (!url) return null
    const result = await loadDomain({ url, stateKey: OFFICIAL_STATE_KEY, prefix: 'catalog_official', validate: validateOfficialEnvelope, digestOf: officialSnapshotDigest, verify: (envelope) => store.verifyOfficialSnapshot(envelope), catalogId: OFFICIAL_CATALOG_ID, store, rules })
    if (result.persist) await result.persist({})
    return { ...result, store }
  }
  // Each domain fails independently: a broken community feed never hides verified official data.
  async function loadSnapshots() {
    const [store, rules] = await Promise.all([trustStore(), policy()])
    const settle = async (load) => { try { return { value: await load(store, rules), error: null } } catch (error) { if (error instanceof CatalogError) return { value: null, error }; throw error } }
    const [community, official] = await Promise.all([settle(loadCommunity), settle(loadOfficial)])
    return { store, community: community.value, official: official.value, errors: { community: community.error, official: official.error } }
  }

  // Normalizes an official snapshot module (v1 fields) to the entry shape.
  const officialEntry = (m, signed, url) => ({
    trust: 'official', key: m.key, version: m.version, sha256: m.sha256, size: m.size, packageUrl: m.packageUrl, publisher: null, listed: true, status: 'published', publishedAt: signed.generatedAt,
    name: m.name ?? m.key, description: m.description ?? '', icon: m.icon ?? 'Boxes', color: m.color ?? '#2563EB', changelog: m.changelog ?? '',
    capabilities: m.capabilities ?? [], consumes: m.consumes ?? {}, events: m.events ?? [], connections: m.connections ?? [], dependencies: m.dependencies ?? [],
    compatibility: signed.compatibility[`${m.key}@${m.version}`], signature: m.signature, keyId: m.keyId ?? null, source: 'official', feedUrl: url,
  })
  function officialRevocationFor(entry, snapshots) {
    const r = snapshots.official?.envelope.signed.revocations.find((x) => x.key === entry.key && x.version === entry.version && x.sha256 === entry.sha256)
    return r ? { type: 'release', reason: r.reason, revokedAt: r.revoked_at, replacement: null } : null
  }
  function revocationFor(entry, snapshots) {
    if (entry.trust === 'official') return officialRevocationFor(entry, snapshots)
    const signed = snapshots.community?.envelope.signed
    if (!signed) return null
    const publisher = signed.publishers.find((p) => p.handle === entry.publisher)
    const release = signed.revocations.find((r) => r.type === 'release' && r.target.key === entry.key && r.target.version === entry.version && r.target.sha256 === entry.sha256)
    const byPublisher = publisher?.state === 'revoked' || signed.revocations.some((r) => r.type === 'publisher' && r.target.publisher === entry.publisher)
    const byKey = signed.revocations.some((r) => r.type === 'key' && r.target.keyId === entry.keyId)
    if (release) return { type: 'release', reason: release.reason, revokedAt: release.revokedAt, replacement: release.replacement }
    if (byPublisher) return { type: 'publisher', reason: publisher?.reason ?? signed.revocations.find((r) => r.type === 'publisher' && r.target.publisher === entry.publisher)?.reason, revokedAt: publisher?.revokedAt ?? null, replacement: null }
    if (byKey) return { type: 'key', reason: signed.revocations.find((r) => r.type === 'key' && r.target.keyId === entry.keyId).reason, revokedAt: null, replacement: null }
    return null
  }

  // Declared dependencies only; nothing hidden is installed. Platform modules come
  // with the image; custom modules must already be installed by the administrator.
  async function dependencyPlan(entry, catalogKeys) {
    if (!entry.dependencies.length) return []
    const rows = await prisma.runlyModule.findMany({ where: { key: { in: entry.dependencies } }, select: { key: true, status: true, version: true } })
    const byKey = new Map(rows.filter((row) => entry.dependencies.includes(row.key)).map((row) => [row.key, row]))
    return entry.dependencies.map((key) => {
      const row = byKey.get(key), builtIn = isBuiltInKey(key)
      if (row?.status === 'INSTALLED') return { key, builtIn, status: 'satisfied', installedVersion: row.version }
      // Core platform modules cannot be uninstalled: always present in a running instance.
      if (builtIn && isOfficialCoreModuleKey(key)) return { key, builtIn, status: 'satisfied', installedVersion: null }
      if (builtIn) return { key, builtIn, status: 'missing' }
      return { key, builtIn, status: catalogKeys.has(key) ? 'install-first' : 'missing' }
    })
  }
  async function compatibility(entry, catalogKeys) {
    const reasons = []
    const { runly, contracts } = entry.compatibility
    if (compareVersions(runlyVersion, runly.min) < 0 || (runly.max && compareVersions(runlyVersion, runly.max) > 0)) reasons.push('runly_version')
    if (contracts.engine !== capabilities.engine.schemaVersion || contracts.compiler !== capabilities.compiler.schemaVersion || contracts.runtime !== capabilities.runtime.schemaVersion || contracts.capabilities !== capabilities.schemaVersion) reasons.push('contracts')
    const services = moduleServices.describe(consumedServiceKeys(entry))
    if (services.some((service) => !service.known)) reasons.push('services')
    if (entry.events.some((event) => !capabilities.events.includes(event))) reasons.push('events')
    if (entry.connections.some((connection) => !capabilities.connectionTargets.includes(connection.target))) reasons.push('connections')
    const dependencies = await dependencyPlan(entry, catalogKeys)
    if (dependencies.some((d) => d.status !== 'satisfied')) reasons.push('dependencies')
    return { compatible: reasons.length === 0, reasons, details: { runly: { current: runlyVersion, min: runly.min, max: runly.max }, contracts: { required: contracts, available: { engine: capabilities.engine.schemaVersion, compiler: capabilities.compiler.schemaVersion, runtime: capabilities.runtime.schemaVersion, capabilities: capabilities.schemaVersion } }, unknownServices: services.filter((s) => !s.known).map((s) => s.key), dependencies } }
  }
  const stale = (domain) => Boolean(domain?.state.validUntil) && now() > Date.parse(domain.state.validUntil)

  async function describe(entry, snapshots, catalogKeys) {
    const signed = entry.source === 'official' ? snapshots.official.envelope.signed : snapshots.community.envelope.signed
    let trustResult
    if (entry.source === 'official') trustResult = snapshots.store.officialEntrySigned(entry, signed.generatedAt) ? { trust: 'official', official: true } : { trust: 'untrusted', official: false, reason: 'official_signature_invalid' }
    else trustResult = snapshots.store.classifyEntry(entry, signed, { revokedKeyIds: new Set(snapshots.community.state.revokedKeyIds ?? []) })
    if (trustResult.official && entry.trust !== 'official') throw new CatalogTrustError('COMMUNITY_CLAIMED_OFFICIAL')
    const publisher = entry.publisher ? signed.publishers.find((p) => p.handle === entry.publisher) : null
    const revocation = revocationFor(entry, snapshots)
    return {
      key: entry.key, version: entry.version, sha256: entry.sha256, size: entry.size, name: entry.name, description: entry.description, icon: entry.icon, color: entry.color, changelog: entry.changelog,
      capabilities: entry.capabilities, consumes: entry.consumes, events: entry.events, connections: entry.connections, dependencies: entry.dependencies, compatibilityRequirements: entry.compatibility,
      services: moduleServices.describe(consumedServiceKeys(entry)), status: entry.status, listed: entry.listed, publishedAt: entry.publishedAt, source: entry.source ?? 'community',
      trust: trustResult.trust, official: trustResult.official, trustLabel: TRUST_LABELS[trustResult.trust], trustReason: trustResult.reason ?? null,
      publisher: publisher ? { handle: publisher.handle, displayName: publisher.displayName, verified: publisher.verified && publisher.state === 'active', state: publisher.state } : null,
      revocation, availability: revocation ? 'revoked' : entry.status === 'withdrawn' ? 'withdrawn' : 'available', compatibility: await compatibility(entry, catalogKeys),
      confirmation: `${entry.publisher ?? 'runly'}/${entry.key}@${entry.version}:${entry.sha256}`,
    }
  }
  async function installedRecords(keys) {
    const rows = await prisma.runlyModule.findMany({ where: { key: { in: keys } }, select: { key: true, version: true, status: true, core: true } })
    const records = new Map()
    for (const row of rows.filter((r) => r.status === 'INSTALLED' && keys.includes(r.key))) {
      let record = null
      try { record = JSON.parse((await config(`catalog.installed.${row.key}`)) ?? 'null') } catch { record = null }
      records.set(row.key, { version: row.version, core: row.core === true, record })
    }
    return records
  }
  // Candidate entries per key; the official snapshot is authoritative for its domain.
  function candidates(snapshots) {
    const byKey = new Map()
    const add = (entry) => { const list = byKey.get(entry.key) ?? []; if (!list.some((e) => e.version === entry.version && e.sha256 === entry.sha256 && e.trust === entry.trust)) list.push(entry); byKey.set(entry.key, list) }
    if (snapshots.official) for (const m of snapshots.official.envelope.signed.modules) add(officialEntry(m, snapshots.official.envelope.signed, snapshots.official.url))
    if (snapshots.community) for (const e of snapshots.community.envelope.signed.entries) add({ ...e, source: 'community', feedUrl: snapshots.community.url })
    return byKey
  }
  const domainStatus = (domain, error) => domain ? { configured: true, sequence: domain.state.sequence, sha256: domain.state.sha256, generatedAt: domain.state.generatedAt, validUntil: domain.state.validUntil, lastSync: domain.state.fetchedAt, offline: domain.offline, alert: domain.alert, cachedView: domain.cachedView, freshness: domain.freshness, verifiedAt: domain.state.fetchedAt, stale: stale(domain), signer: domain.state.signer } : error ? { configured: true, error: error.code, message: error.message } : { configured: false }

  async function list({ key = null } = {}) {
    const source = await sourceUrls()
    if (!source.communityUrl && !source.officialUrl) return { enabled: false, sourceMode: source.mode, modules: [] }
    const snapshots = await loadSnapshots()
    // Without any verified data there is nothing safe to show; surface the error.
    if (!snapshots.community && !snapshots.official) throw snapshots.errors.community ?? snapshots.errors.official
    const byKey = candidates(snapshots)
    const catalogKeys = new Set(byKey.keys())
    const revokedReleaseKeys = [...(snapshots.community?.envelope.signed.revocations.filter((r) => r.type === 'release').map((r) => r.target.key) ?? []), ...(snapshots.official?.envelope.signed.revocations.map((r) => r.key) ?? [])]
    const installed = await installedRecords([...new Set([...byKey.keys(), ...revokedReleaseKeys])])
    const modules = []
    for (const [moduleKey, entries] of byKey) {
      const current = installed.get(moduleKey)
      const published = entries.filter((e) => e.status === 'published').sort((a, b) => compareVersions(b.version, a.version))
      const latest = published.find((e) => !revocationFor(e, snapshots)) ?? published[0]
      // Unlisted entries appear only when installed or requested by exact key.
      const visible = latest && (latest.listed || current || key === moduleKey)
      if (!visible && !current) continue
      const shown = latest ?? [...entries].sort((a, b) => compareVersions(b.version, a.version))[0]
      const description = await describe(shown, snapshots, catalogKeys)
      const builtIn = isBuiltInKey(moduleKey) || current?.core === true
      const installedEntry = current ? entries.find((e) => e.sha256 === current.record?.sha256) ?? null : null
      const installedRevocation = current ? (installedEntry ? revocationFor(installedEntry, snapshots) : null) ?? revokedInstalled(moduleKey, current, snapshots) : null
      const installedWithdrawn = !installedRevocation && installedEntry?.status === 'withdrawn'
      modules.push({
        ...description, builtIn, installedVersion: current?.version ?? null,
        state: builtIn ? 'built-in' : !current ? 'available' : compareVersions(shown.version, current.version) > 0 ? 'update' : 'installed',
        scope: 'instance',
        installedWarning: installedRevocation ? { type: installedRevocation.type ?? 'release', reason: installedRevocation.reason, replacement: installedRevocation.replacement ?? null, message: 'Esta versión fue revocada. No se desinstala automáticamente ni se borran datos; revisa la actualización recomendada.' } : null,
        installedNotice: installedWithdrawn ? { type: 'withdrawn', message: 'El publicador retiró esta versión. Puede seguir usándose; no está disponible para nuevas instalaciones.' } : null,
      })
    }
    // Installed modules whose release was revoked and removed from entries.
    for (const [moduleKey, current] of installed) {
      if (modules.some((m) => m.key === moduleKey) || !['v2', 'official'].includes(current.record?.source)) continue
      const revocation = revokedInstalled(moduleKey, current, snapshots)
      if (revocation) modules.push({ key: moduleKey, name: moduleKey, version: current.version, installedVersion: current.version, state: 'installed', scope: 'instance', builtIn: false, availability: 'revoked', trust: current.record.trust, official: current.record.official === true, trustLabel: TRUST_LABELS[current.record.trust] ?? '', revocation, installedWarning: { type: revocation.type, reason: revocation.reason, replacement: revocation.replacement ?? null, message: 'Esta versión fue revocada. No se desinstala automáticamente ni se borran datos.' }, installedNotice: null })
    }
    const community = snapshots.community, official = snapshots.official
    const primary = community ?? official
    return {
      enabled: true, sourceMode: (await sourceUrls()).mode, sequence: community?.state.sequence ?? null, generatedAt: primary.state.generatedAt, validUntil: community?.state.validUntil ?? null, lastSync: primary.state.fetchedAt,
      stale: stale(community), offline: Boolean(community?.offline || official?.offline), alert: community?.alert ?? official?.alert ?? null, catalogSigner: community?.state.signer ?? null,
      catalogs: { community: domainStatus(community, snapshots.errors.community), official: domainStatus(official, snapshots.errors.official) },
      modules,
    }
  }
  function revokedInstalled(moduleKey, current, snapshots) {
    const sha = current.record?.sha256
    if (!sha) return null
    const community = snapshots.community?.envelope.signed.revocations.find((r) => r.type === 'release' && r.target.key === moduleKey && r.target.sha256 === sha)
    if (community) return { type: 'release', reason: community.reason, revokedAt: community.revokedAt, replacement: community.replacement }
    const official = snapshots.official?.envelope.signed.revocations.find((r) => r.key === moduleKey && r.sha256 === sha)
    return official ? { type: 'release', reason: official.reason, revokedAt: official.revoked_at, replacement: null } : null
  }

  // Resolve → gate (trust, revocation, compatibility, consent) → download →
  // verify bytes and surface. Shared by preflight and install; never installs.
  async function resolveVerified({ key, version, confirmation, acceptCommunity, acceptStale = false, phases, requireConsent = true }) {
    const snapshots = await loadSnapshots()
    const entries = candidates(snapshots).get(key) ?? []
    const entry = entries.find((e) => e.version === version && e.trust === 'official') ?? entries.find((e) => e.version === version)
    const domain = entry?.source === 'official' ? snapshots.official : snapshots.community
    const fail = (message, status, code, details = null) => { throw new CatalogError(message, status, code, details) }
    if (!snapshots.community && !snapshots.official) throw snapshots.errors.community ?? snapshots.errors.official ?? new CatalogError('El Marketplace no está habilitado en esta instancia.', 409, 'catalog_v2_disabled')
    if (isBuiltInKey(key)) fail('Este módulo forma parte de Runly y no se instala desde el catálogo.', 409, 'catalog_builtin_module')
    if (!entry) fail('La versión no está publicada en el catálogo.', 404, 'not_in_catalog')
    if (domain.alert) fail('El catálogo no superó la verificación de secuencia/firma.', 409, domain.alert)
    // A previously verified copy may serve while the Hub is unavailable, within the policy window.
    if (domain.cachedView && domain.freshness === 'expired') fail('La última copia verificada del catálogo es demasiado antigua para instalar o actualizar; espera a que el catálogo vuelva a estar disponible.', 409, 'catalog_too_old', { verifiedAt: domain.state.fetchedAt })
    if (domain.cachedView && domain.freshness === 'stale' && acceptStale !== true) fail('El catálogo no responde y la copia verificada puede estar desactualizada (revocaciones recientes desconocidas). Confirma para continuar.', 428, 'catalog_stale_confirmation_required', { verifiedAt: domain.state.fetchedAt })
    if (stale(domain)) fail('La información del catálogo está vencida; no se puede confirmar el estado de revocaciones.', 409, 'catalog_v2_stale')
    if (entry.status === 'withdrawn') fail('El publicador retiró esta versión; no está disponible para nuevas instalaciones.', 410, 'catalog_release_withdrawn')
    if (entry.status !== 'published') fail('La versión no está publicada en el catálogo.', 404, 'not_in_catalog')
    const described = await describe(entry, snapshots, new Set(candidates(snapshots).keys()))
    if (described.trust === 'untrusted') fail('La firma de esta versión no es confiable.', 422, described.trustReason ?? 'catalog_untrusted')
    if (described.revocation) fail('Esta versión fue revocada.', 409, 'catalog_release_revoked', described.revocation)
    if (!described.compatibility.compatible) fail('La instancia no cumple los requisitos de compatibilidad.', 409, 'catalog_incompatible', described.compatibility)
    if (requireConsent && !described.official && (acceptCommunity !== true || confirmation !== described.confirmation)) fail('Instalar un módulo no oficial requiere aceptación explícita del administrador.', 428, 'community_consent_required', { confirmation: described.confirmation })

    phases.push('downloading')
    // Resolved strictly relative to the verified feed; content-addressed path.
    let buffer
    try { ({ buffer } = await getBytes(new URL(entry.packageUrl, domain.url).toString(), domain.url, 25 * 1024 * 1024)) }
    catch (error) {
      if (error instanceof CatalogDownloadError && error.code !== 'CATALOG_UNREACHABLE') throw new CatalogError('La descarga del paquete fue bloqueada por seguridad.', 422, 'catalog_package_rejected')
      throw new CatalogError('No se pudo descargar el paquete del catálogo. Inténtalo cuando el catálogo esté disponible.', 503, 'catalog_package_unreachable')
    }
    phases.push('verifying')
    if (buffer.length !== entry.size || sha256Of(buffer) !== entry.sha256) fail('El paquete no coincide con la huella firmada.', 422, 'package_not_authentic')
    const report = inspectModuleZip(buffer)
    const manifest = report.manifest
    if (!report.valid || manifest?.key !== key || manifest.version !== version) fail('La identidad del ZIP no coincide con el catálogo.', 422, 'catalog_manifest_mismatch')
    const surface = manifestCatalogMetadata(manifest)
    for (const field of ['capabilities', 'consumes', 'events', 'dependencies']) if (!same(surface[field], entry[field])) fail(`La metadata ${field} no coincide con el ZIP.`, 422, 'catalog_metadata_mismatch')
    if (!same(surface.connections.map(({ target, kind }) => ({ target, kind })), entry.connections.map(({ target, kind }) => ({ target, kind })))) fail('La metadata connections no coincide con el ZIP.', 422, 'catalog_metadata_mismatch')
    phases.push('preflight')
    return { entry, described, buffer, domain }
  }
  const phaseOf = (phases) => phases[phases.length - 1] ?? 'resolving'
  const withPhases = async (phases, run) => {
    try { return await run() }
    catch (error) { if (error instanceof PhaseError || !(error instanceof CatalogError || error instanceof CatalogTrustError || error instanceof CatalogDownloadError || error?.status || error?.statusCode)) throw error; throw new PhaseError(phaseOf(phases), error) }
  }

  // Everything an administrator must see before confirming, with no side effects.
  async function preflight({ key, version, confirmation, acceptCommunity = false }) {
    const phases = []
    return withPhases(phases, async () => {
      const current = await prisma.runlyModule.findUnique({ where: { key }, select: { status: true, version: true } })
      const { described } = await resolveVerified({ key, version, confirmation, acceptCommunity, acceptStale: true, phases, requireConsent: false })
      return { key, version, phases, module: described, action: current?.status === 'INSTALLED' ? 'update' : 'install', installedVersion: current?.status === 'INSTALLED' ? current.version : null, scope: 'instance', requestedGrants: described.services.map((s) => s.key) }
    })
  }

  async function apply({ key, version, confirmation, acceptCommunity = false, acceptStale = false, grants = [], decisions = {}, actorId = null, expect }) {
    const phases = []
    return withPhases(phases, async () => {
      const current = await prisma.runlyModule.findUnique({ where: { key }, select: { status: true, version: true } })
      const installed = current?.status === 'INSTALLED'
      if (expect === 'install' && installed) throw new CatalogError('El módulo ya está instalado.', 409, 'already_installed')
      if (expect === 'update' && (!installed || compareVersions(version, current.version) <= 0)) throw new CatalogError('No hay una versión más nueva para actualizar.', 409, 'no_update')
      const { entry, described, buffer, domain } = await resolveVerified({ key, version, confirmation, acceptCommunity, acceptStale, phases })
      const requested = new Set(consumedServiceKeys(entry))
      if (!Array.isArray(grants) || new Set(grants).size !== grants.length || grants.some((grant) => !requested.has(grant))) throw new CatalogError('Grant no solicitado por el ZIP verificado.', 422, 'catalog_unexpected_grant')
      const modulesDir = await resolveModulesDir()
      if (!modulesDir || !wiring.packageSvc) throw new CatalogError('Esta instancia no puede instalar paquetes de módulos.', 503, 'packages_unavailable')
      // The official package pipeline owns staging, schema preflight (409 decisions), backups and swap.
      const publishResult = await wiring.packageSvc.publishZip({ key, fileBuffer: buffer, modulesDir, actorId, decisions })
      phases.push('installing')
      const row = await prisma.runlyModule.findUnique({ where: { key } })
      let installedNow = false
      if (row && row.status !== 'INSTALLED') {
        await wiring.lifecycleSvc.installModule({ manifest: row.manifest, actorId, requestId: randomUUID() })
        if (routeLoader) await routeLoader.reloadModule(key).catch(() => null)
        if (bundlerSvc) await bundlerSvc.buildModuleBundle(key).catch(() => null)
        installedNow = true
      }
      await moduleServices.setGrants({ moduleKey: key, serviceKeys: grants, grantedBy: actorId })
      const source = entry.source === 'official' ? 'official' : 'v2'
      await setConfig(`catalog.installed.${key}`, JSON.stringify({ source, trust: described.trust, official: described.official, publisher: entry.publisher, version, sha256: entry.sha256, sequence: domain.state.sequence, at: new Date(now()).toISOString() }))
      await invalidateModuleCaches(cacheDel).catch(() => null)
      const after = await prisma.runlyModule.findUnique({ where: { key }, select: { status: true } })
      if (after?.status !== 'INSTALLED') throw new CatalogError('El paquete se publicó pero el módulo no quedó instalado.', 500, 'catalog_install_incomplete')
      phases.push('enabled')
      return { key, version, trust: described.trust, official: described.official, installed: installedNow, outcome: publishResult?.outcome ?? null, phases, scope: 'instance' }
    })
  }

  // ---- Catalog source configuration (instance administrators) ----
  async function source() {
    const [store, rules, communityUrl, officialUrl, marks] = await Promise.all([trustStore(), policy(), config(CONFIG_KEYS.communityUrl), config(CONFIG_KEYS.officialUrl), highWater.read()])
    const managed = await jsonConfig(CONFIG_KEYS.managedKeys, [])
    const effective = await sourceUrls()
    return { mode: effective.mode, effective: { communityUrl: effective.communityUrl, officialUrl: effective.officialUrl }, communityUrl: communityUrl || null, officialUrl: officialUrl || null, policy: rules, defaults: RUNLY_CATALOG_SOURCE, managedKeys: Array.isArray(managed) ? managed : [], trust: store.describeKeys(), highWater: marks }
  }
  async function configureSource(input = {}) {
    const fail = (code, message) => { throw new CatalogError(message, 422, code) }
    const updates = []
    for (const field of ['communityUrl', 'officialUrl']) {
      if (!(field in input)) continue
      const value = input[field] === null ? '' : input[field]
      if (typeof value !== 'string' || value.length > 2048) fail('catalog_url_invalid', 'URL inválida.')
      const problem = catalogUrlProblem(value)
      if (problem) fail(problem, 'Sólo se admiten catálogos HTTPS o un archivo local explícito (file://).')
      updates.push([CONFIG_KEYS[field], value])
    }
    // Mode: 'runly' (default Runly catalog), 'disabled', or 'custom' implied by explicit URLs.
    if ('mode' in input) {
      if (!SOURCE_MODES.includes(input.mode)) fail('catalog_source_invalid', 'Origen inválido.')
      updates.push([CONFIG_KEYS.sourceMode, input.mode])
      if (input.mode !== 'custom') updates.push([CONFIG_KEYS.communityUrl, ''], [CONFIG_KEYS.officialUrl, ''])
    } else if (('communityUrl' in input && input.communityUrl) || ('officialUrl' in input && input.officialUrl)) updates.push([CONFIG_KEYS.sourceMode, 'custom'])
    if ('policy' in input) {
      const p = input.policy
      const bounds = { maxCacheAgeDays: [1, 365], installFreshHours: [1, 168], installMaxAgeHours: [1, 720] }
      if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((k) => !['allowCachedView', ...Object.keys(bounds)].includes(k)) || ('allowCachedView' in p && typeof p.allowCachedView !== 'boolean') || Object.entries(bounds).some(([k, [min, max]]) => k in p && (!Number.isSafeInteger(p[k]) || p[k] < min || p[k] > max)) || ((p.installFreshHours ?? 0) > (p.installMaxAgeHours ?? Infinity))) fail('catalog_policy_invalid', 'Política inválida.')
      updates.push([CONFIG_KEYS.policy, JSON.stringify({ ...(await policy()), ...p })])
    }
    if ('managedKeys' in input) {
      if (!Array.isArray(input.managedKeys) || input.managedKeys.length > 20) fail('catalog_key_invalid', 'Lista de claves inválida.')
      const pinned = createTrustStore({ ...trust, managed: [] }).keys
      for (const value of input.managedKeys) {
        let pin
        try { pin = normalizePin(value, 'managed') } catch { fail('catalog_key_invalid', 'Cada clave debe ser una clave pública Ed25519 (SPKI DER en base64).') }
        // An instance can never re-label a Runly official/community key as its own.
        if (pinned.official.includes(pin.keyId) || pinned.community.includes(pin.keyId)) fail('catalog_key_overlaps_pinned', 'Esa clave ya pertenece a un dominio de confianza de Runly.')
      }
      updates.push([CONFIG_KEYS.managedKeys, JSON.stringify(input.managedKeys)])
    }
    if ('revokeKeyIds' in input) {
      // Local revocation only grows: an administrator can distrust a key, never re-trust or promote one.
      if (!Array.isArray(input.revokeKeyIds) || input.revokeKeyIds.some((id) => !HEX64.test(id))) fail('catalog_key_invalid', 'Identificador de clave inválido.')
      const known = new Set((await trustStore()).describeKeys().map((k) => k.keyId))
      if (input.revokeKeyIds.some((id) => !known.has(id))) fail('catalog_key_unknown', 'La clave no está en el trust store.')
      const current = await jsonConfig(CONFIG_KEYS.revokedKeyIds, [])
      updates.push([CONFIG_KEYS.revokedKeyIds, JSON.stringify([...new Set([...(Array.isArray(current) ? current : []), ...input.revokeKeyIds])])])
    }
    for (const [key, value] of updates) await setConfig(key, value)
    return source()
  }

  return {
    list, preflight, source, configureSource,
    install: (args) => apply({ ...args, expect: 'install' }),
    update: (args) => apply({ ...args, expect: 'update' }),
  }
}
