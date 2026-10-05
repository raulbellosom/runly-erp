// Catalog v2 consumer (Phase 7): parallel, opt-in feed (InstanceConfig
// `catalog.v2.url`). The v1 official catalog (catalog-service.js) keeps its
// behaviour and default. Community entries never come from v1 and never fall
// back to it. No auto-update, no remote uninstall, no data deletion.
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { inspectModuleZip } from '@runly/module-compiler/inspection'
import { RME3_CAPABILITIES } from '@runly/module-compiler/contracts'
import { resolveModulesDir } from '../module-upload-service.js'
import { createModulePackageWiring } from '../module-package-wiring-service.js'
import { invalidateModuleCaches } from '../module-cache-service.js'
import { consumedServiceKeys, createModuleServices } from '../module-services/module-services.js'
import { readCatalogBytes, CatalogDownloadError } from './catalog-download.js'
import { sha256Of } from './catalog-crypto.js'
import { compareVersions, CatalogError } from './catalog-service.js'
import { manifestCatalogMetadata } from './catalog-schema.js'
import { validateEnvelope, snapshotDigest } from './catalog-v2-contract.js'
import { createTrustStore, CatalogTrustError } from './catalog-trust-store.js'
import rootPackage from '../../../../../package.json' with { type: 'json' }

const STATE_KEY = 'catalog.v2.state'
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
export const TRUST_LABELS = Object.freeze({ official: 'Oficial Runly', 'community-verified': 'Publicador verificado · Comunidad', community: 'Comunidad · publicador no verificado', managed: 'Catálogo administrado', untrusted: 'No confiable' })

export function createCatalogV2Service({ prisma, bundlerSvc = null, routeLoader = null, cacheDel = () => {}, readBytes = readCatalogBytes, trust = {}, packageWiring = null, now = () => Date.now(), runlyVersion = rootPackage.version, capabilities = RME3_CAPABILITIES }) {
  const wiring = packageWiring ?? createModulePackageWiring({ prisma, bundlerSvc, routeLoader, cacheDel })
  const moduleServices = createModuleServices({ prisma })
  const config = async (key) => (await prisma.instanceConfig.findUnique({ where: { key } }))?.value ?? null
  const setConfig = (key, value) => prisma.instanceConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
  async function trustStore() {
    let managed = []
    try { managed = JSON.parse((await config('catalog.v2.managedKeys')) ?? '[]') } catch { managed = [] }
    return createTrustStore({ ...trust, managed: Array.isArray(trust.managed) ? trust.managed : Array.isArray(managed) ? managed : [] })
  }
  async function getBytes(url, indexUrl, maxBytes) {
    const base = new URL(indexUrl)
    const localRoot = base.protocol === 'file:' ? dirname(fileURLToPath(base)) : null
    return readBytes(url, { maxBytes, localRoot })
  }

  // Fetch + verify, enforcing monotonic sequence, chain, no equivocation and no
  // v2→v1 downgrade. On any verification failure the last good state is kept.
  async function loadSnapshot() {
    const url = await config('catalog.v2.url')
    if (!url) return { enabled: false }
    const store = await trustStore()
    let state = null
    try { state = JSON.parse((await config(STATE_KEY)) ?? 'null') } catch { state = null }
    if (state?.url !== url) state = null
    const cached = await prisma.moduleCatalogCache.findUnique({ where: { url } })
    const lastGood = (alert, offline = false) => {
      if (!cached || !state) {
        if (alert) throw new CatalogError('El catálogo v2 no superó la verificación y no hay una copia confiable previa.', 422, alert)
        throw new CatalogError('No se pudo conectar con el catálogo v2.', 502, 'catalog_unreachable')
      }
      return { enabled: true, url, envelope: cached.payload, state, offline, alert, store }
    }
    let envelope, buffer
    try { ({ buffer } = await getBytes(url, url, 4 * 1024 * 1024)) }
    catch (error) {
      // Security rejections (private address, redirects, size) are alerts; any
      // other transport failure means offline: keep showing the last good sync.
      if (error instanceof CatalogDownloadError && error.code !== 'CATALOG_UNREACHABLE') return lastGood('catalog_v2_transport_rejected')
      return lastGood(null, true)
    }
    try {
      const payload = JSON.parse(buffer.toString('utf8'))
      if (payload?.schemaVersion === 1 || Array.isArray(payload?.modules) || payload?.signed?.schemaVersion === 1) return lastGood('catalog_v2_downgrade')
      envelope = validateEnvelope(payload)
    } catch (error) {
      if (error instanceof CatalogError) throw error
      return lastGood(error.code === 'CATALOG_V2_SCHEMA_UNSUPPORTED' ? 'catalog_v2_downgrade' : 'catalog_v2_invalid')
    }
    const signed = envelope.signed, sha256 = snapshotDigest(signed)
    const revokedKeyIds = new Set(state?.revokedKeyIds ?? [])
    let signer
    try { signer = store.verifySnapshot(envelope, { revokedKeyIds }) } catch { return lastGood('catalog_v2_signature_untrusted') }
    if (state) {
      if (signed.sequence < state.sequence) return lastGood('catalog_v2_rollback')
      if (signed.sequence === state.sequence && sha256 !== state.sha256) return lastGood('catalog_v2_equivocation')
      if (signed.sequence === state.sequence + 1 && signed.previous?.sha256 !== state.sha256) return lastGood('catalog_v2_chain_broken')
      if (Date.parse(signed.generatedAt) < Date.parse(state.generatedAt)) return lastGood('catalog_v2_rollback')
    }
    for (const key of signed.trust.keys) if (key.state === 'revoked') revokedKeyIds.add(key.keyId)
    for (const r of signed.revocations) if (r.type === 'key') revokedKeyIds.add(r.target.keyId)
    const next = { url, sequence: signed.sequence, sha256, generatedAt: signed.generatedAt, validUntil: signed.validUntil, fetchedAt: new Date(now()).toISOString(), signer: signer.category, revokedKeyIds: [...revokedKeyIds] }
    await prisma.moduleCatalogCache.upsert({ where: { url }, update: { payload: envelope, etag: sha256, fetchedAt: new Date(now()) }, create: { url, payload: envelope, etag: sha256 } })
    await setConfig(STATE_KEY, JSON.stringify(next))
    return { enabled: true, url, envelope, state: next, offline: false, alert: null, store }
  }

  function revocationFor(entry, signed) {
    const publisher = signed.publishers.find((p) => p.handle === entry.publisher)
    const release = signed.revocations.find((r) => r.type === 'release' && r.target.key === entry.key && r.target.version === entry.version && r.target.sha256 === entry.sha256)
    const byPublisher = entry.trust === 'community' && (publisher?.state === 'revoked' || signed.revocations.some((r) => r.type === 'publisher' && r.target.publisher === entry.publisher))
    const byKey = entry.trust === 'community' && signed.revocations.some((r) => r.type === 'key' && r.target.keyId === entry.keyId)
    // A community snapshot key cannot revoke official modules: those follow v1.
    if (entry.trust === 'official') return null
    if (release) return { type: 'release', reason: release.reason, revokedAt: release.revokedAt, replacement: release.replacement }
    if (byPublisher) return { type: 'publisher', reason: publisher?.reason ?? signed.revocations.find((r) => r.type === 'publisher' && r.target.publisher === entry.publisher)?.reason, revokedAt: publisher?.revokedAt ?? null, replacement: null }
    if (byKey) return { type: 'key', reason: signed.revocations.find((r) => r.type === 'key' && r.target.keyId === entry.keyId).reason, revokedAt: null, replacement: null }
    return null
  }
  async function compatibility(entry) {
    const reasons = []
    const { runly, contracts } = entry.compatibility
    if (compareVersions(runlyVersion, runly.min) < 0 || (runly.max && compareVersions(runlyVersion, runly.max) > 0)) reasons.push('runly_version')
    if (contracts.engine !== capabilities.engine.schemaVersion || contracts.compiler !== capabilities.compiler.schemaVersion || contracts.runtime !== capabilities.runtime.schemaVersion || contracts.capabilities !== capabilities.schemaVersion) reasons.push('contracts')
    if (moduleServices.describe(consumedServiceKeys(entry)).some((service) => !service.known)) reasons.push('services')
    if (entry.events.some((event) => !capabilities.events.includes(event))) reasons.push('events')
    if (entry.connections.some((connection) => !capabilities.connectionTargets.includes(connection.target))) reasons.push('connections')
    // Platform modules (runly.*/atlas.*) are provided by the ERP; custom.* must be installed.
    const customDependencies = entry.dependencies.filter((key) => key.startsWith('custom.'))
    if (customDependencies.length) {
      const installed = await prisma.runlyModule.findMany({ where: { key: { in: customDependencies }, status: 'INSTALLED' }, select: { key: true } })
      if (installed.length !== customDependencies.length) reasons.push('dependencies')
    }
    return { compatible: reasons.length === 0, reasons }
  }
  const stale = (snapshot) => now() > Date.parse(snapshot.envelope.signed.validUntil)

  async function describe(entry, snapshot) {
    const signed = snapshot.envelope.signed
    const trustResult = snapshot.store.classifyEntry(entry, signed, { revokedKeyIds: new Set(snapshot.state.revokedKeyIds) })
    if (trustResult.official && entry.trust !== 'official') throw new CatalogTrustError('COMMUNITY_CLAIMED_OFFICIAL')
    const publisher = entry.publisher ? signed.publishers.find((p) => p.handle === entry.publisher) : null
    return {
      key: entry.key, version: entry.version, sha256: entry.sha256, size: entry.size, name: entry.name, description: entry.description, icon: entry.icon, color: entry.color, changelog: entry.changelog,
      capabilities: entry.capabilities, consumes: entry.consumes, events: entry.events, connections: entry.connections, dependencies: entry.dependencies, compatibilityRequirements: entry.compatibility,
      services: moduleServices.describe(consumedServiceKeys(entry)), status: entry.status, listed: entry.listed, publishedAt: entry.publishedAt,
      trust: trustResult.trust, official: trustResult.official, trustLabel: TRUST_LABELS[trustResult.trust], trustReason: trustResult.reason ?? null,
      publisher: publisher ? { handle: publisher.handle, displayName: publisher.displayName, verified: publisher.verified && publisher.state === 'active', state: publisher.state } : null,
      revocation: revocationFor(entry, signed), compatibility: await compatibility(entry),
      confirmation: `${entry.publisher ?? 'runly'}/${entry.key}@${entry.version}:${entry.sha256}`,
    }
  }
  async function installedRecords(keys) {
    const rows = await prisma.runlyModule.findMany({ where: { key: { in: keys } }, select: { key: true, version: true, status: true } })
    const records = new Map()
    for (const row of rows.filter((r) => r.status === 'INSTALLED')) {
      let record = null
      try { record = JSON.parse((await config(`catalog.installed.${row.key}`)) ?? 'null') } catch { record = null }
      records.set(row.key, { version: row.version, record })
    }
    return records
  }

  async function list({ key = null } = {}) {
    const snapshot = await loadSnapshot()
    if (!snapshot.enabled) return { enabled: false, modules: [] }
    const signed = snapshot.envelope.signed
    const revokedOrInstalled = new Set()
    const installed = await installedRecords([...new Set(signed.entries.map((e) => e.key).concat(signed.revocations.filter((r) => r.type === 'release').map((r) => r.target.key)))])
    const modules = []
    const byKey = new Map()
    for (const entry of signed.entries) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry])
    for (const [moduleKey, entries] of byKey) {
      const current = installed.get(moduleKey)
      const latest = entries.filter((e) => e.status === 'published').sort((a, b) => compareVersions(b.version, a.version))[0]
      // Unlisted entries appear only when installed or requested by exact key.
      const visible = latest && (latest.listed || current || key === moduleKey)
      if (!visible && !current) continue
      const shown = latest ?? entries.sort((a, b) => compareVersions(b.version, a.version))[0]
      const description = await describe(shown, snapshot)
      const installedEntry = current ? entries.find((e) => e.sha256 === current.record?.sha256) ?? null : null
      const installedRevocation = current ? (installedEntry ? revocationFor(installedEntry, signed) : signed.revocations.find((r) => r.type === 'release' && r.target.key === moduleKey && r.target.sha256 === current.record?.sha256) ?? null) : null
      revokedOrInstalled.add(moduleKey)
      modules.push({
        ...description, installedVersion: current?.version ?? null,
        state: !current ? 'available' : compareVersions(shown.version, current.version) > 0 ? 'update' : 'installed',
        installedWarning: installedRevocation ? { type: installedRevocation.type ?? 'release', reason: installedRevocation.reason, replacement: installedRevocation.replacement ?? null, message: 'La versión instalada fue revocada. No se desinstala automáticamente; revisa la actualización recomendada.' } : null,
      })
    }
    // Installed modules whose release was revoked and removed from entries.
    for (const [moduleKey, current] of installed) {
      if (revokedOrInstalled.has(moduleKey) || current.record?.source !== 'v2') continue
      const revocation = signed.revocations.find((r) => r.type === 'release' && r.target.key === moduleKey && r.target.sha256 === current.record.sha256)
      if (revocation) modules.push({ key: moduleKey, version: current.version, installedVersion: current.version, state: 'installed', trust: current.record.trust, official: false, trustLabel: TRUST_LABELS[current.record.trust] ?? '', installedWarning: { type: 'release', reason: revocation.reason, replacement: revocation.replacement, message: 'La versión instalada fue revocada. No se desinstala automáticamente.' } })
    }
    return { enabled: true, sequence: signed.sequence, generatedAt: signed.generatedAt, validUntil: signed.validUntil, lastSync: snapshot.state.fetchedAt, stale: stale(snapshot), offline: snapshot.offline, alert: snapshot.alert, catalogSigner: snapshot.state.signer, modules }
  }

  async function apply({ key, version, confirmation, acceptCommunity = false, grants = [], decisions = {}, actorId = null, expect }) {
    const snapshot = await loadSnapshot()
    if (!snapshot.enabled) throw new CatalogError('El catálogo v2 no está habilitado en esta instancia.', 409, 'catalog_v2_disabled')
    if (snapshot.offline) throw new CatalogError('Sin conexión con el catálogo v2: se muestra la última sincronización; no se puede instalar.', 503, 'catalog_offline')
    if (snapshot.alert) throw new CatalogError('El catálogo v2 no superó la verificación de secuencia/firma.', 409, snapshot.alert)
    if (stale(snapshot)) throw new CatalogError('La información del catálogo v2 está vencida; no se puede confirmar el estado de revocaciones.', 409, 'catalog_v2_stale')
    const entry = snapshot.envelope.signed.entries.find((e) => e.key === key && e.version === version)
    if (!entry || entry.status !== 'published') throw new CatalogError('La versión no está publicada en el catálogo v2.', 404, 'not_in_catalog')
    const described = await describe(entry, snapshot)
    if (described.trust === 'untrusted') throw new CatalogError('La firma de esta versión no es confiable.', 422, described.trustReason ?? 'catalog_untrusted')
    if (described.revocation) throw new CatalogError('Esta versión fue revocada.', 409, 'catalog_release_revoked', described.revocation)
    if (!described.compatibility.compatible) throw new CatalogError('La instancia no cumple los requisitos de compatibilidad.', 409, 'catalog_incompatible', described.compatibility)
    if (!described.official && (acceptCommunity !== true || confirmation !== described.confirmation)) throw new CatalogError('Instalar un módulo no oficial requiere aceptación explícita del administrador.', 428, 'community_consent_required', { confirmation: described.confirmation })
    const current = await prisma.runlyModule.findUnique({ where: { key }, select: { status: true, version: true } })
    const installed = current?.status === 'INSTALLED'
    if (expect === 'install' && installed) throw new CatalogError('El módulo ya está instalado.', 409, 'already_installed')
    if (expect === 'update' && (!installed || compareVersions(version, current.version) <= 0)) throw new CatalogError('No hay una versión más nueva para actualizar.', 409, 'no_update')

    // Bytes must match the signed entry; the ZIP's own manifest must match the signed surface.
    const { buffer } = await getBytes(new URL(entry.packageUrl, snapshot.url).toString(), snapshot.url, 25 * 1024 * 1024)
    if (buffer.length !== entry.size || sha256Of(buffer) !== entry.sha256) throw new CatalogError('El paquete no coincide con la huella firmada.', 422, 'package_not_authentic')
    const report = inspectModuleZip(buffer)
    const manifest = report.manifest
    if (!report.valid || manifest?.key !== key || manifest.version !== version) throw new CatalogError('La identidad del ZIP no coincide con el catálogo.', 422, 'catalog_manifest_mismatch')
    const surface = manifestCatalogMetadata(manifest)
    for (const field of ['capabilities', 'consumes', 'events', 'dependencies']) if (!same(surface[field], entry[field])) throw new CatalogError(`La metadata ${field} no coincide con el ZIP.`, 422, 'catalog_metadata_mismatch')
    if (!same(surface.connections.map(({ target, kind }) => ({ target, kind })), entry.connections.map(({ target, kind }) => ({ target, kind })))) throw new CatalogError('La metadata connections no coincide con el ZIP.', 422, 'catalog_metadata_mismatch')
    const requested = new Set(consumedServiceKeys(entry))
    if (!Array.isArray(grants) || new Set(grants).size !== grants.length || grants.some((grant) => !requested.has(grant))) throw new CatalogError('Grant no solicitado por el ZIP verificado.', 422, 'catalog_unexpected_grant')
    const modulesDir = await resolveModulesDir()
    if (!modulesDir || !wiring.packageSvc) throw new CatalogError('Esta instancia no puede instalar paquetes de módulos.', 503, 'packages_unavailable')
    const publishResult = await wiring.packageSvc.publishZip({ key, fileBuffer: buffer, modulesDir, actorId, decisions })
    const row = await prisma.runlyModule.findUnique({ where: { key } })
    let installedNow = false
    if (row && row.status !== 'INSTALLED') {
      await wiring.lifecycleSvc.installModule({ manifest: row.manifest, actorId, requestId: randomUUID() })
      if (routeLoader) await routeLoader.reloadModule(key).catch(() => null)
      if (bundlerSvc) await bundlerSvc.buildModuleBundle(key).catch(() => null)
      installedNow = true
    }
    await moduleServices.setGrants({ moduleKey: key, serviceKeys: grants, grantedBy: actorId })
    await setConfig(`catalog.installed.${key}`, JSON.stringify({ source: 'v2', trust: described.trust, official: described.official, publisher: entry.publisher, version, sha256: entry.sha256, sequence: snapshot.state.sequence, at: new Date(now()).toISOString() }))
    await invalidateModuleCaches(cacheDel).catch(() => null)
    return { key, version, trust: described.trust, official: described.official, installed: installedNow, outcome: publishResult?.outcome ?? null }
  }

  return {
    list,
    install: (args) => apply({ ...args, expect: 'install' }),
    update: (args) => apply({ ...args, expect: 'update' }),
  }
}
