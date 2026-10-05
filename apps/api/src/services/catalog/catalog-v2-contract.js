// Catalog v2 consumer contract (Phase 7). Byte formats and schema mirror the
// Developer Hub producer (packages/contracts/catalog-v2.js); the Hub suites
// verify its exported snapshots with this consumer. v1 is unchanged and separate.
import { createHash } from 'node:crypto';
import { SEMVER } from './catalog-schema.js';

export const CATALOG_V2_SCHEMA = 2;
export const CATALOG_V2_ID = 'runly-v2';
// Domain separation: a community signature can never equal the official v1
// payload `key@version:sha256`, nor a snapshot signature a release signature.
export const RELEASE_DOMAIN = 'runly.catalog.v2.community-release\n';
export const SNAPSHOT_DOMAIN = 'runly.catalog.v2.snapshot\n';
export const SNAPSHOT_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
export const MODULE_KEY = /^custom\.[a-z][a-z0-9_]{1,39}$/;
export const PUBLISHER_HANDLE = /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/;
// Identity terms reserved to Runly/Racoon Devs and trust wording. Compared on
// an accent-free, separator-free lowercase form to resist trivial spoofing.
export const RESERVED_TERMS = Object.freeze(['runly', 'racoon', 'atlas', 'official', 'oficial', 'verified', 'verificado', 'admin', 'staff', 'support', 'soporte', 'system', 'sistema']);
const DISPLAY_NAME = /^[A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü][A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü .,&'()-]{1,78}[A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü.)]$/;
const HEX64 = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;

export const fold = (value) => String(value).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const leet = (value) => value.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
export const reservedIdentity = (value) => { const folded = fold(value); return RESERVED_TERMS.some((term) => folded.includes(term) || leet(folded).includes(term)); };
export const validPublisherHandle = (handle) => typeof handle === 'string' && PUBLISHER_HANDLE.test(handle) && !handle.includes('--') && !reservedIdentity(handle);
export const validDisplayName = (name) => typeof name === 'string' && DISPLAY_NAME.test(name) && !/\s{2}/.test(name) && !reservedIdentity(name);
export const validCommunityKey = (key) => typeof key === 'string' && MODULE_KEY.test(key) && !reservedIdentity(key.slice('custom.'.length));

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const canonicalBytes = (value) => Buffer.from(JSON.stringify(canonical(value)), 'utf8');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const keyIdOf = (publicKey) => sha256(Buffer.from(publicKey, 'base64'));

// Fields a community signature binds: publisher identity, module identity,
// artifact, declared security surface, compatibility and provenance.
export function releaseStatement(entry) {
  return {
    publisher: entry.publisher, key: entry.key, version: entry.version, sha256: entry.sha256, size: entry.size,
    capabilities: entry.capabilities, consumes: entry.consumes, events: entry.events, connections: entry.connections,
    dependencies: entry.dependencies, compatibility: entry.compatibility, provenance: entry.provenance,
  };
}
export const releaseStatementBytes = (entry) => Buffer.concat([Buffer.from(RELEASE_DOMAIN), canonicalBytes(releaseStatement(entry))]);
export const snapshotDigest = (signed) => sha256(canonicalBytes(signed));
// The isolated signer receives only `sequence:digest`, never the whole index.
export const snapshotStatementBytes = (signed) => Buffer.from(`${SNAPSHOT_DOMAIN}${signed.sequence}:${snapshotDigest(signed)}`, 'utf8');
export const envelopeBytes = (envelope) => Buffer.from(JSON.stringify(envelope, null, 2) + '\n');

// eslint-disable-next-line no-control-regex -- Reject unsafe ASCII controls in catalog text.
const text = (value, max, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const iso = (value) => text(value, 40, 20) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const reject = (code = 'CATALOG_V2_INVALID') => { throw Object.assign(new Error(code), { code }); };
const stringList = (value, max = 200) => Array.isArray(value) && value.length <= max && value.every((item) => text(item, 160, 1)) && new Set(value).size === value.length;
const ENTRY_KEYS = ['trust', 'key', 'version', 'sha256', 'size', 'packageUrl', 'publisher', 'listed', 'status', 'publishedAt', 'name', 'description', 'icon', 'color', 'changelog', 'capabilities', 'consumes', 'events', 'connections', 'dependencies', 'compatibility', 'provenance', 'signature', 'keyId'];

export function validateCompatibility(value) {
  if (!exact(value, ['runly', 'contracts']) || !exact(value.runly, ['min', 'max']) || !exact(value.contracts, ['engine', 'compiler', 'runtime', 'capabilities'])) reject();
  if (!SEMVER.test(value.runly.min) || (value.runly.max !== null && !SEMVER.test(value.runly.max))) reject();
  if (Object.values(value.contracts).some((v) => !Number.isSafeInteger(v) || v < 1 || v > 1000)) reject();
  return value;
}
function validateEntry(entry, publishers) {
  if (!exact(entry, ENTRY_KEYS) || !['official', 'community'].includes(entry.trust) || !MODULE_KEY.test(entry.key) || !text(entry.version, 128) || !SEMVER.test(entry.version)) reject();
  if (!HEX64.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 25 * 1024 * 1024 || entry.packageUrl !== `packages/${entry.sha256}.zip`) reject();
  if (typeof entry.listed !== 'boolean' || !['published', 'withdrawn'].includes(entry.status) || !iso(entry.publishedAt)) reject();
  if (!text(entry.name, 160, 1) || !text(entry.description, 4000) || !text(entry.icon, 160) || !text(entry.color, 160) || !text(entry.changelog, 4000)) reject();
  if (!stringList(entry.capabilities) || !stringList(entry.events) || !stringList(entry.dependencies)) reject();
  if (!entry.consumes || typeof entry.consumes !== 'object' || Array.isArray(entry.consumes) || Object.keys(entry.consumes).length > 100 || Object.entries(entry.consumes).some(([k, v]) => !/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(k) || !stringList(v))) reject();
  if (!Array.isArray(entry.connections) || entry.connections.length > 200 || entry.connections.some((c) => !exact(c, ['target', 'kind', 'label']) || !text(c.target, 160, 1) || !text(c.kind, 160, 1) || !text(c.label, 160))) reject();
  validateCompatibility(entry.compatibility);
  if (!exact(entry.provenance, ['evidenceSha256', 'toolchainId']) || !HEX64.test(entry.provenance.evidenceSha256) || !HEX64.test(entry.provenance.toolchainId)) reject();
  if (!SIGNATURE.test(entry.signature) || Buffer.from(entry.signature, 'base64').length !== 64 || !HEX64.test(entry.keyId)) reject();
  // Official entries carry no publisher; community entries name a listed publisher.
  if (entry.trust === 'official' ? entry.publisher !== null : !publishers.has(entry.publisher)) reject();
}
export function validateSignedSnapshot(signed) {
  if (!exact(signed, ['schemaVersion', 'catalog', 'sequence', 'generatedAt', 'validUntil', 'previous', 'trust', 'publishers', 'entries', 'revocations'])) reject();
  if (signed.schemaVersion !== CATALOG_V2_SCHEMA) reject('CATALOG_V2_SCHEMA_UNSUPPORTED');
  if (signed.catalog !== CATALOG_V2_ID || !Number.isSafeInteger(signed.sequence) || signed.sequence < 1 || !iso(signed.generatedAt) || !iso(signed.validUntil) || Date.parse(signed.validUntil) <= Date.parse(signed.generatedAt)) reject();
  if (signed.previous !== null && (!exact(signed.previous, ['sequence', 'sha256']) || signed.previous.sequence !== signed.sequence - 1 || !HEX64.test(signed.previous.sha256))) reject();
  if (signed.previous === null && signed.sequence !== 1) reject();
  if (!exact(signed.trust, ['keys']) || !Array.isArray(signed.trust.keys) || signed.trust.keys.length < 1 || signed.trust.keys.length > 20) reject();
  for (const key of signed.trust.keys) if (!exact(key, ['keyId', 'publicKey', 'role', 'state', 'since', 'until', 'reason']) || key.role !== 'community' || !['active', 'retired', 'revoked'].includes(key.state) || !HEX64.test(key.keyId) || keyIdOf(key.publicKey) !== key.keyId || !iso(key.since) || (key.until !== null && !iso(key.until)) || (key.reason !== null && !text(key.reason, 400))) reject();
  if (!Array.isArray(signed.publishers) || signed.publishers.length > 1000) reject();
  const publishers = new Set();
  for (const p of signed.publishers) {
    if (!exact(p, ['handle', 'displayName', 'verified', 'state', 'reason', 'revokedAt']) || !PUBLISHER_HANDLE.test(p.handle) || !text(p.displayName, 80, 2) || typeof p.verified !== 'boolean' || !['active', 'revoked'].includes(p.state) || publishers.has(p.handle)) reject();
    if (p.state === 'revoked' ? !text(p.reason, 400, 1) || !iso(p.revokedAt) : p.reason !== null || p.revokedAt !== null) reject();
    publishers.add(p.handle);
  }
  if (!Array.isArray(signed.entries) || signed.entries.length > 2000) reject();
  const identities = new Set();
  for (const entry of signed.entries) {
    validateEntry(entry, publishers);
    const identity = `${entry.key}@${entry.version}`;
    if (identities.has(identity)) reject();
    identities.add(identity);
  }
  if (!Array.isArray(signed.revocations) || signed.revocations.length > 2000) reject();
  for (const r of signed.revocations) {
    if (!exact(r, ['type', 'target', 'reason', 'revokedAt', 'sequence', 'replacement']) || !text(r.reason, 400, 1) || !iso(r.revokedAt) || !Number.isSafeInteger(r.sequence) || r.sequence < 1 || r.sequence > signed.sequence) reject();
    if (r.type === 'release' ? !exact(r.target, ['key', 'version', 'sha256']) || !MODULE_KEY.test(r.target.key) || !SEMVER.test(r.target.version) || !HEX64.test(r.target.sha256)
      : r.type === 'publisher' ? !exact(r.target, ['publisher']) || !PUBLISHER_HANDLE.test(r.target.publisher)
        : r.type === 'key' ? !exact(r.target, ['keyId']) || !HEX64.test(r.target.keyId) : true) reject();
    if (!['release', 'publisher', 'key'].includes(r.type)) reject();
    if (r.replacement !== null && (!exact(r.replacement, ['key', 'version']) || !MODULE_KEY.test(r.replacement.key) || !SEMVER.test(r.replacement.version))) reject();
  }
  if (canonicalBytes(signed).length > 4 * 1024 * 1024) reject('CATALOG_V2_TOO_LARGE');
  return signed;
}
export function validateEnvelope(envelope) {
  if (!exact(envelope, ['signed', 'signatures']) || !Array.isArray(envelope.signatures) || envelope.signatures.length < 1 || envelope.signatures.length > 4) reject();
  for (const s of envelope.signatures) if (!exact(s, ['keyId', 'signature']) || !HEX64.test(s.keyId) || !SIGNATURE.test(s.signature)) reject();
  validateSignedSnapshot(envelope.signed);
  return envelope;
}
