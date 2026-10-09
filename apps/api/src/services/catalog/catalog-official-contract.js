// Official catalog snapshot consumer contract (Catalog Distribution). Byte
// formats mirror the Developer Hub producer (packages/contracts/official-snapshot.js):
// envelope {signed,keyId,signature}; Ed25519 over
//   runly.catalog.official.snapshot\n<sequence>:<sha256(canonical(signed))>
// Each module keeps its v1 signature over `key@version:sha256`. The envelope adds
// global integrity, sequence and official revocations; v1 index.json is unchanged.
import { canonicalBytes, sha256, validateCompatibility, SNAPSHOT_DOMAIN, RELEASE_DOMAIN } from './catalog-v2-contract.js'
import { validateCatalogIndex, SEMVER } from './catalog-schema.js'

export const OFFICIAL_SNAPSHOT_DOMAIN = 'runly.catalog.official.snapshot\n'
export const OFFICIAL_CATALOG_ID = 'runly-official'
export const OFFICIAL_TRUST_DOMAIN = 'OFFICIAL'
// Domain separation across every catalog statement Runly verifies.
if (new Set([OFFICIAL_SNAPSHOT_DOMAIN, SNAPSHOT_DOMAIN, RELEASE_DOMAIN]).size !== 3) throw new Error('CATALOG_DOMAIN_COLLISION')

export const officialSnapshotDigest = (signed) => sha256(canonicalBytes(signed))
export const officialSnapshotBytes = (signed) => Buffer.from(`${OFFICIAL_SNAPSHOT_DOMAIN}${signed.sequence}:${officialSnapshotDigest(signed)}`, 'utf8')

const HEX64 = /^[a-f0-9]{64}$/
const KEY = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const iso = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const reject = (code = 'CATALOG_OFFICIAL_INVALID') => { throw Object.assign(new Error(code), { code }) }

// Strict schema only; signature trust is decided by the trust store.
export function validateOfficialEnvelope(envelope) {
  if (!exact(envelope, ['signed', 'keyId', 'signature']) || !HEX64.test(envelope.keyId) || !SIGNATURE.test(envelope.signature)) reject()
  const signed = envelope.signed
  if (!exact(signed, ['schemaVersion', 'catalog', 'trustDomain', 'sequence', 'generatedAt', 'previous', 'modules', 'compatibility', 'revocations'])) reject()
  if (signed.schemaVersion !== 1) reject('CATALOG_OFFICIAL_SCHEMA_UNSUPPORTED')
  if (signed.catalog !== OFFICIAL_CATALOG_ID || signed.trustDomain !== OFFICIAL_TRUST_DOMAIN || !Number.isSafeInteger(signed.sequence) || signed.sequence < 1 || !iso(signed.generatedAt)) reject()
  if (signed.previous === null ? signed.sequence !== 1 : !exact(signed.previous, ['sequence', 'sha256']) || signed.previous.sequence !== signed.sequence - 1 || !HEX64.test(signed.previous.sha256)) reject()
  try { validateCatalogIndex({ schemaVersion: 1, generatedAt: signed.generatedAt, modules: signed.modules }) } catch { reject() }
  // Packages are content-addressed next to the feed: no arbitrary URLs, size always bound.
  for (const m of signed.modules) if (m.packageUrl !== `packages/${m.sha256}.zip` || !Number.isSafeInteger(m.size)) reject()
  if (!signed.compatibility || typeof signed.compatibility !== 'object' || Array.isArray(signed.compatibility) || Object.keys(signed.compatibility).length !== signed.modules.length) reject()
  for (const m of signed.modules) { try { validateCompatibility(signed.compatibility[`${m.key}@${m.version}`]) } catch { reject() } }
  if (!Array.isArray(signed.revocations) || signed.revocations.length > 2000) reject()
  for (const r of signed.revocations) {
    if (!exact(r, ['key', 'version', 'sha256', 'reason', 'revoked_at']) || !KEY.test(r.key) || !SEMVER.test(r.version) || !HEX64.test(r.sha256) || typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 400 || !iso(r.revoked_at)) reject()
  }
  if (canonicalBytes(signed).length > 4 * 1024 * 1024) reject('CATALOG_OFFICIAL_TOO_LARGE')
  return envelope
}
