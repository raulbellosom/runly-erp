import { CatalogVerificationError } from './catalog-crypto.js'

const KEY = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const FIELDS = new Set(['key', 'name', 'description', 'icon', 'color', 'version', 'packageUrl', 'size', 'sha256', 'signature', 'dependencies', 'consumes', 'events', 'connections', 'changelog', 'capabilities', 'keyId'])
const validText = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
const reject = () => { throw new CatalogVerificationError('Índice v1 inválido.', 'catalog_index_invalid') }
export function validateCatalogIndex(payload) {
  if (!payload || Object.keys(payload).some(key => !['schemaVersion', 'generatedAt', 'modules'].includes(key)) || payload.schemaVersion !== 1 || !Array.isArray(payload.modules) || payload.modules.length > 1000 || !validText(payload.generatedAt, 40) || !Number.isFinite(Date.parse(payload.generatedAt))) reject()
  const identities = new Set()
  for (const entry of payload.modules) {
    if (!entry || !validText(entry.key,160) || !validText(entry.version,128) || entry.key.trim()!==entry.key || entry.version.trim()!==entry.version || typeof entry.sha256!=='string' || entry.sha256.length!==64) reject()
    if (!entry || Array.isArray(entry) || Object.keys(entry).some(key => !FIELDS.has(key)) || !KEY.test(entry.key) || !SEMVER.test(entry.version) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(entry.signature) || Buffer.from(entry.signature, 'base64').length !== 64 || Buffer.from(entry.signature, 'base64').toString('base64') !== entry.signature || !validText(entry.packageUrl, 2048) || !entry.packageUrl || (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 25 * 1024 * 1024))) reject()
    let url
    try { url = new URL(entry.packageUrl, 'https://catalog.example/v1/index.json') } catch { reject() }
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password || url.hash) reject()
    for (const key of ['name', 'description', 'icon', 'color', 'changelog', 'keyId']) if (entry[key] !== undefined && !validText(entry[key], key === 'description' || key === 'changelog' ? 4000 : 160)) reject()
    for (const key of ['dependencies', 'events', 'connections', 'capabilities']) if (entry[key] !== undefined && (!Array.isArray(entry[key]) || entry[key].length > 200)) reject()
    for (const key of ['dependencies', 'events', 'capabilities']) if (entry[key]?.some(value => !validText(value,160) || !value)) reject()
    if (entry.connections?.some(value => !value || Array.isArray(value) || Object.keys(value).some(key => !['target','kind','label'].includes(key)) || !validText(value.target,160) || !validText(value.kind,160) || !validText(value.label,160))) reject()
    if (entry.consumes !== undefined && (!entry.consumes || typeof entry.consumes !== 'object' || Array.isArray(entry.consumes) || Object.keys(entry.consumes).length > 100)) reject()
    if (entry.consumes && Object.entries(entry.consumes).some(([key,values]) => !KEY.test(key) || !Array.isArray(values) || values.length>200 || values.some(value=>!validText(value,160) || !value))) reject()
    const identity = `${entry.key}@${entry.version}`
    if (identities.has(identity)) reject()
    identities.add(identity)
  }
  if (Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024) reject()
  return payload
}

export function manifestCatalogMetadata(manifest) {
  return {
    dependencies: (manifest.dependencies ?? []).map(value => value.key ?? value),
    consumes: manifest.consumes ?? {}, events: manifest.events?.subscribes ?? [],
    connections: (manifest.connections ?? []).map(({ target, kind, label }) => ({ target, kind, label })),
    capabilities: manifest.capabilities ?? [],
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export function verifyCatalogManifest(entry, report) {
  const manifest = report?.manifest
  if (!report.valid || !manifest || manifest.key !== entry.key || manifest.version !== entry.version) throw new CatalogVerificationError('La identidad del ZIP no coincide con el catálogo.', 'catalog_manifest_mismatch')
  const metadata = manifestCatalogMetadata(manifest)
  for (const [key, value] of Object.entries(metadata)) if (entry[key] !== undefined && JSON.stringify(canonical(entry[key])) !== JSON.stringify(canonical(value))) throw new CatalogVerificationError(`La metadata ${key} no coincide con el ZIP.`, 'catalog_metadata_mismatch')
  return { ...entry, ...metadata, name: manifest.name, description: manifest.description ?? '', icon: manifest.icon ?? 'Boxes', color: manifest.color ?? '#2563EB', changelog: manifest.changelog ?? '' }
}
