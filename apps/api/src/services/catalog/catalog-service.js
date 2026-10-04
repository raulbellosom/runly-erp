// Official module catalog (spec 2026-10-03-rme3-module-platform-v2 §12.5, plan
// Task 6.4): fetch the signed index (ETag-cached, served from cache when the
// instance is offline), list entries with their install state, and install or
// update a module: download, verify size + SHA-256 + Ed25519 signature, then
// the regular package pipeline (publish + install) and the admin's service
// grants. "Oficial" comes from the verified signature, never from the manifest.
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { resolveModulesDir } from '../module-upload-service.js'
import { createModulePackageWiring } from '../module-package-wiring-service.js'
import { invalidateModuleCaches } from '../module-cache-service.js'
import { consumedServiceKeys, createModuleServices } from '../module-services/module-services.js'
import { CatalogVerificationError, verifyPackage } from './catalog-crypto.js'
import { DEFAULT_CATALOG_URL, OFFICIAL_CATALOG_PUBLIC_KEYS } from './catalog-public-key.js'

export class CatalogError extends Error {
  constructor(message, status = 400, code = 'catalog_error', details = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const KEY_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024

export function compareVersions(a, b) {
  const parse = (value) => String(value ?? '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

export function installState(entry, installed) {
  if (!installed || installed.status !== 'INSTALLED') return 'available'
  return compareVersions(entry.version, installed.version) > 0 ? 'update' : 'installed'
}

function sanitizeEntries(payload) {
  const modules = Array.isArray(payload?.modules) ? payload.modules : []
  return modules.filter((entry) => KEY_RE.test(entry?.key ?? '') && /^\d+\.\d+\.\d+$/.test(entry?.version ?? '') && /^[0-9a-f]{64}$/i.test(entry?.sha256 ?? '') && entry?.signature && entry?.packageUrl)
}

export function createCatalogService({ prisma, bundlerSvc = null, routeLoader = null, cacheDel = () => {}, fetchImpl = globalThis.fetch }) {
  const wiring = createModulePackageWiring({ prisma, bundlerSvc, routeLoader, cacheDel })
  const moduleServices = createModuleServices({ prisma })

  async function config(key) {
    return (await prisma.instanceConfig.findUnique({ where: { key } }))?.value ?? null
  }
  async function catalogUrl() {
    return (await config('catalog.url')) || process.env.RUNLY_CATALOG_URL || DEFAULT_CATALOG_URL
  }
  async function trustedKeys() {
    let extra = []
    try { extra = JSON.parse((await config('catalog.publicKeys')) ?? '[]') } catch { extra = [] }
    return { official: [...OFFICIAL_CATALOG_PUBLIC_KEYS], all: [...OFFICIAL_CATALOG_PUBLIC_KEYS, ...(Array.isArray(extra) ? extra : [])] }
  }

  // file:// URLs are allowed so an instance can use a local or mounted catalog.
  async function getBytes(url, headers = {}) {
    if (url.startsWith('file://')) {
      const buffer = await fs.readFile(fileURLToPath(url))
      return { status: 200, buffer, etag: null }
    }
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) })
    if (response.status === 304) return { status: 304 }
    if (!response.ok) throw new CatalogError(`El catálogo respondió ${response.status}.`, 502, 'catalog_unreachable')
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_PACKAGE_BYTES) throw new CatalogError('El paquete es demasiado grande.', 422, 'package_too_large')
    return { status: 200, buffer: Buffer.from(await response.arrayBuffer()), etag: response.headers.get('etag') }
  }

  async function loadIndex() {
    const url = await catalogUrl()
    const cached = await prisma.moduleCatalogCache.findUnique({ where: { url } })
    try {
      const result = await getBytes(url, cached?.etag ? { 'If-None-Match': cached.etag } : {})
      if (result.status === 304 && cached) {
        await prisma.moduleCatalogCache.update({ where: { url }, data: { fetchedAt: new Date() } })
        return { url, payload: cached.payload, offline: false, fetchedAt: new Date() }
      }
      const payload = JSON.parse(result.buffer.toString('utf8'))
      await prisma.moduleCatalogCache.upsert({ where: { url }, update: { payload, etag: result.etag, fetchedAt: new Date() }, create: { url, payload, etag: result.etag } })
      return { url, payload, offline: false, fetchedAt: new Date() }
    } catch (error) {
      if (cached) return { url, payload: cached.payload, offline: true, fetchedAt: cached.fetchedAt }
      throw error instanceof CatalogError ? error : new CatalogError('No se pudo conectar con el catálogo de módulos.', 502, 'catalog_unreachable')
    }
  }

  async function officialRecord(key) {
    try { return JSON.parse((await config(`catalog.installed.${key}`)) ?? 'null') } catch { return null }
  }

  async function list() {
    const index = await loadIndex()
    const entries = sanitizeEntries(index.payload)
    const installed = await prisma.runlyModule.findMany({ where: { key: { in: entries.map((entry) => entry.key) } }, select: { key: true, version: true, status: true } })
    const byKey = new Map(installed.map((row) => [row.key, row]))
    const data = await Promise.all(entries.map(async (entry) => ({
      ...entry,
      state: installState(entry, byKey.get(entry.key)),
      installedVersion: byKey.get(entry.key)?.version ?? null,
      official: Boolean((await officialRecord(entry.key))?.official),
      services: moduleServices.describe(consumedServiceKeys({ consumes: entry.consumes })),
    })))
    return { modules: data, offline: index.offline, fetchedAt: index.fetchedAt }
  }

  async function downloadVerified(entry, indexUrl) {
    const packageUrl = new URL(entry.packageUrl, indexUrl).toString()
    const { buffer } = await getBytes(packageUrl)
    const keys = await trustedKeys()
    verifyPackage({ buffer, entry, publicKeys: keys.all })
    let official = false
    try { verifyPackage({ buffer, entry, publicKeys: keys.official }); official = true } catch { official = false }
    return { buffer, official }
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

    const { buffer, official } = await downloadVerified(entry, index.url)
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
    const requested = new Set(consumedServiceKeys(row?.manifest ?? {}))
    await moduleServices.setGrants({ moduleKey: key, serviceKeys: grants.filter((grant) => requested.has(grant)), grantedBy: actorId })
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
