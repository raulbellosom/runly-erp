// Official module catalog (spec 2026-10-03-rme3-module-platform-v2 §12.5, plan
// Task 6.4): fetch the signed index (ETag-cached, served from cache when the
// instance is offline), list entries with their install state, and install or
// update a module: download, verify size + SHA-256 + Ed25519 signature, then
// the regular package pipeline (publish + install) and the admin's service
// grants. "Oficial" comes from the verified signature, never from the manifest.
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { inspectModuleZip } from '@runly/module-compiler/inspection'
import { randomUUID } from 'node:crypto'
import { resolveModulesDir } from '../module-upload-service.js'
import { createModulePackageWiring } from '../module-package-wiring-service.js'
import { invalidateModuleCaches } from '../module-cache-service.js'
import { consumedServiceKeys, createModuleServices } from '../module-services/module-services.js'
import { CatalogVerificationError, verifyPackage } from './catalog-crypto.js'
import { DEFAULT_CATALOG_URL, OFFICIAL_CATALOG_PUBLIC_KEYS } from './catalog-public-key.js'
import { readCatalogBytes, CatalogDownloadError } from './catalog-download.js'
import { validateCatalogIndex, verifyCatalogManifest } from './catalog-schema.js'

export class CatalogError extends Error {
  constructor(message, status = 400, code = 'catalog_error', details = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}


export function compareVersions(a, b) {
  const parse = (value) => String(value ?? '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  const prerelease = value => String(value).split('+')[0].split('-').slice(1).join('-')
  const ap = prerelease(a), bp = prerelease(b)
  if (!ap || !bp) return ap === bp ? 0 : ap ? -1 : 1
  const aa = ap.split('.'), bb = bp.split('.')
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === bb[i]) continue
    if (aa[i] === undefined || bb[i] === undefined) return aa[i] === undefined ? -1 : 1
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i])
    if (an && bn) return Number(aa[i]) - Number(bb[i])
    if (an !== bn) return an ? -1 : 1
    return aa[i] < bb[i] ? -1 : 1
  }
  return 0
}

export function installState(entry, installed) {
  if (!installed || installed.status !== 'INSTALLED') return 'available'
  return compareVersions(entry.version, installed.version) > 0 ? 'update' : 'installed'
}

function sanitizeEntries(payload) {
  const latest = new Map()
  for (const entry of validateCatalogIndex(payload).modules) if (!latest.has(entry.key) || compareVersions(entry.version, latest.get(entry.key).version) > 0) latest.set(entry.key, entry)
  return [...latest.values()]
}

export function createCatalogService({ prisma, bundlerSvc = null, routeLoader = null, cacheDel = () => {}, readBytes = readCatalogBytes, officialKeys = OFFICIAL_CATALOG_PUBLIC_KEYS, packageWiring = null }) {
  const wiring = packageWiring ?? createModulePackageWiring({ prisma, bundlerSvc, routeLoader, cacheDel })
  const moduleServices = createModuleServices({ prisma })
  const verified = new Map()

  async function config(key) {
    return (await prisma.instanceConfig.findUnique({ where: { key } }))?.value ?? null
  }
  async function catalogUrl() {
    return (await config('catalog.url')) || process.env.RUNLY_CATALOG_URL || DEFAULT_CATALOG_URL
  }
  async function trustedKeys() {
    let extra = []
    try { extra = JSON.parse((await config('catalog.publicKeys')) ?? '[]') } catch { extra = [] }
    return { official: [...officialKeys], all: [...officialKeys, ...(Array.isArray(extra) ? extra : [])] }
  }

  // file:// URLs are allowed so an instance can use a local or mounted catalog.
  async function getBytes(url, headers = {}, maxBytes = 25 * 1024 * 1024) {
    const configured = new URL(await catalogUrl())
    const localRoot = configured.protocol === 'file:' ? dirname(fileURLToPath(configured)) : null
    return readBytes(url, { headers, maxBytes, localRoot })
  }

  async function loadIndex() {
    const url = await catalogUrl()
    const cached = await prisma.moduleCatalogCache.findUnique({ where: { url } })
    try {
      const result = await getBytes(url, cached?.etag ? { 'If-None-Match': cached.etag } : {}, 1024 * 1024)
      if (result.status === 304 && cached) {
        await prisma.moduleCatalogCache.update({ where: { url }, data: { fetchedAt: new Date() } })
        return { url, payload: validateCatalogIndex(cached.payload), offline: false, fetchedAt: new Date() }
      }
      const payload = validateCatalogIndex(JSON.parse(result.buffer.toString('utf8')))
      await prisma.moduleCatalogCache.upsert({ where: { url }, update: { payload, etag: result.etag, fetchedAt: new Date() }, create: { url, payload, etag: result.etag } })
      return { url, payload, offline: false, fetchedAt: new Date() }
    } catch (error) {
      if (error instanceof CatalogVerificationError || (error instanceof CatalogDownloadError && error.code !== 'CATALOG_UNREACHABLE') || error instanceof SyntaxError) throw error
      if (cached) return { url, payload: validateCatalogIndex(cached.payload), offline: true, fetchedAt: cached.fetchedAt }
      throw error instanceof CatalogError ? error : new CatalogError('No se pudo conectar con el catálogo de módulos.', 502, 'catalog_unreachable')
    }
  }

  async function list() {
    const index = await loadIndex()
    const entries = sanitizeEntries(index.payload)
    const installed = await prisma.runlyModule.findMany({ where: { key: { in: entries.map((entry) => entry.key) } }, select: { key: true, version: true, status: true } })
    const byKey = new Map(installed.map((row) => [row.key, row]))
    const data = []
    const deadline = Date.now() + 30_000
    for (const entry of entries) {
      const keys = await trustedKeys()
      const identity = JSON.stringify([index.url, entry.key, entry.version, entry.sha256, entry.signature, keys])
      let evidence = verified.get(identity)
      if (!index.offline && (!evidence || evidence.expires < Date.now())) {
        try {
          if (Date.now() > deadline) throw new CatalogError('Verificación pendiente.',503,'catalog_verification_pending')
          evidence = await downloadVerified(entry, index.url); verified.set(identity, { metadata: evidence.metadata, official: evidence.official, expires: Date.now() + 60_000 }); if (verified.size > 1000) verified.delete(verified.keys().next().value)
        }
        catch (error) { data.push({ key: entry.key, version: entry.version, name: entry.key, state: installState(entry, byKey.get(entry.key)), verified: false, official: false, error: error.code ?? 'catalog_unreachable', services: [], consumes: {}, events: [], connections: [] }); continue }
      }
      const metadata = evidence?.metadata ?? { key: entry.key, version: entry.version, name: entry.key, description: 'Paquete pendiente de verificación.', consumes: {}, events: [], connections: [] }
      data.push({
      ...metadata,
      state: installState(entry, byKey.get(entry.key)),
      installedVersion: byKey.get(entry.key)?.version ?? null,
      official: evidence?.official === true, verified: Boolean(evidence),
      services: evidence ? moduleServices.describe(consumedServiceKeys(metadata)) : [],
      })
    }
    return { modules: data, offline: index.offline, fetchedAt: index.fetchedAt }
  }

  async function downloadVerified(entry, indexUrl) {
    const packageUrl = new URL(entry.packageUrl, indexUrl).toString()
    const { buffer } = await getBytes(packageUrl)
    const keys = await trustedKeys()
    verifyPackage({ buffer, entry, publicKeys: keys.all })
    let official = false
    try { verifyPackage({ buffer, entry, publicKeys: keys.official }); official = true } catch { official = false }
    const report = inspectModuleZip(buffer)
    const metadata = verifyCatalogManifest(entry, report)
    return { buffer, official, metadata }
  }

  // install and update share the flow; `expect` guards against the wrong action.
  async function apply({ key, grants = [], decisions = {}, actorId = null, expect }) {
    const index = await loadIndex()
    if (index.offline) throw new CatalogError('Sin conexión con el catálogo: no se puede descargar el módulo ahora.', 503, 'catalog_offline')
    const entry = sanitizeEntries(index.payload).find((item) => item.key === key)
    if (!entry) throw new CatalogError('El módulo no está en el catálogo.', 404, 'not_in_catalog')
    const current = await prisma.runlyModule.findUnique({ where: { key }, select: { status: true, version: true, manifest: true } })
    const state = installState(entry, current)
    if (expect === 'install' && state !== 'available') throw new CatalogError('El módulo ya está instalado.', 409, 'already_installed')
    if (expect === 'update' && state !== 'update') throw new CatalogError('No hay una versión más nueva para actualizar.', 409, 'no_update')

    const { buffer, official, metadata } = await downloadVerified(entry, index.url)
    const requested = new Set(consumedServiceKeys(metadata))
    if (!Array.isArray(grants) || new Set(grants).size !== grants.length || grants.some(grant => !requested.has(grant)) || moduleServices.describe(grants).some(service=>!service.known)) throw new CatalogError('Grant no solicitado por el ZIP verificado.', 422, 'catalog_unexpected_grant')
    const modulesDir = await resolveModulesDir()
    if (!modulesDir || !wiring.packageSvc) throw new CatalogError('Esta instancia no puede instalar paquetes de módulos.', 503, 'packages_unavailable')
    const publishResult = await wiring.packageSvc.publishZip({ key, fileBuffer: buffer, modulesDir, actorId, decisions })
    let installed = false
    const row = await prisma.runlyModule.findUnique({ where: { key } })
    if (row && row.status !== 'INSTALLED') {
      await wiring.lifecycleSvc.installModule({ manifest: row.manifest, actorId, requestId: randomUUID() })
      if (routeLoader) await routeLoader.reloadModule(key).catch(() => null)
      if (bundlerSvc) await bundlerSvc.buildModuleBundle(key).catch(() => null)
      installed = true
    }
    // Only services the manifest asks for can be granted.
    await moduleServices.setGrants({ moduleKey: key, serviceKeys: grants, grantedBy: actorId })
    await prisma.instanceConfig.upsert({
      where: { key: `catalog.installed.${key}` },
      update: { value: JSON.stringify({ official, version: entry.version, sha256: entry.sha256, at: new Date().toISOString() }) },
      create: { key: `catalog.installed.${key}`, value: JSON.stringify({ official, version: entry.version, sha256: entry.sha256, at: new Date().toISOString() }) },
    })
    await invalidateModuleCaches(cacheDel).catch(() => null)
    return { key, version: entry.version, official, installed, outcome: publishResult?.outcome ?? null }
  }

  return {
    list,
    install: (args) => apply({ ...args, expect: 'install' }),
    update: (args) => apply({ ...args, expect: 'update' }),
  }
}

export { CatalogVerificationError }
