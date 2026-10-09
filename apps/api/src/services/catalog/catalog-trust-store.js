// Catalog trust store (Phase 7 + Catalog Distribution). Three categories that never mix:
//   official  — Runly official key(s) pinned in catalog-public-key.js (v1 payload + official snapshot)
//   community — Runly community key(s) pinned here (domain-separated v2 statements)
//   managed   — keys an instance admin configured for a private/managed catalog
// Only `official` can ever yield `official: true`. A key may belong to exactly
// one category; overlaps are rejected at load and when admins add keys.
//
// Each pin has a lifecycle so keys rotate without a flag day:
//   active   — verifies new content
//   retiring — verifies content dated up to `notAfter` (rotation window); never newer content
//   revoked  — verifies nothing; content it signed becomes untrusted
// Pins ship with Runly releases. An instance admin may only revoke a pin locally
// (catalog.trust.revokedKeyIds), never promote or add official/community keys.
// This store holds public keys only; private keys never reach Runly.
import { createPublicKey, verify } from 'node:crypto'
import { OFFICIAL_CATALOG_PUBLIC_KEYS } from './catalog-public-key.js'
import { releaseStatementBytes, snapshotStatementBytes, keyIdOf } from './catalog-v2-contract.js'
import { officialSnapshotBytes } from './catalog-official-contract.js'
import { signedPayload } from './catalog-crypto.js'

// The production community key has not been generated yet. Until it is
// provisioned and pinned here (with a Runly release), community trust only
// exists in tests that inject keys; admins may add managed keys instead.
export const COMMUNITY_CATALOG_PUBLIC_KEYS = Object.freeze([])
export const KEY_STATES = Object.freeze(['active', 'retiring', 'revoked'])

export class CatalogTrustError extends Error {
  constructor(code) { super(code); this.code = code; this.status = 422 }
}

function ed25519(base64) {
  const key = createPublicKey({ key: Buffer.from(String(base64), 'base64'), format: 'der', type: 'spki' })
  if (key.asymmetricKeyType !== 'ed25519') throw new CatalogTrustError('CATALOG_KEY_NOT_ED25519')
  return key
}
const verifySafely = (bytes, publicKey, signature) => { try { return verify(null, bytes, ed25519(publicKey), Buffer.from(signature, 'base64')) } catch { return false } }

// A pin is a base64 SPKI string (active) or { publicKey, state, notAfter }.
export function normalizePin(value, domain) {
  const pin = typeof value === 'string' ? { publicKey: value, state: 'active', notAfter: null } : { publicKey: value?.publicKey, state: value?.state ?? 'active', notAfter: value?.notAfter ?? null }
  if (typeof pin.publicKey !== 'string' || !KEY_STATES.includes(pin.state) || (pin.notAfter !== null && !Number.isFinite(Date.parse(pin.notAfter)))) throw new CatalogTrustError('CATALOG_TRUST_PIN_INVALID')
  try { ed25519(pin.publicKey) } catch (error) { throw error instanceof CatalogTrustError ? error : new CatalogTrustError('CATALOG_TRUST_PIN_INVALID') }
  return { ...pin, domain, keyId: keyIdOf(pin.publicKey) }
}

export function createTrustStore({ official = OFFICIAL_CATALOG_PUBLIC_KEYS, community = COMMUNITY_CATALOG_PUBLIC_KEYS, managed = [], localRevokedKeyIds = [] } = {}) {
  const load = (values, domain) => new Map(values.map((value) => normalizePin(value, domain)).map((pin) => [pin.keyId, pin]))
  const sets = { official: load(official, 'official'), community: load(community, 'community') }
  for (const id of sets.community.keys()) if (sets.official.has(id)) throw new CatalogTrustError('COMMUNITY_KEY_OVERLAPS_OFFICIAL')
  // A managed copy of a pinned key stays in its pinned category only. Invalid
  // admin-provided keys are rejected when saved; at load they simply never verify.
  const managedPins = managed.flatMap((value) => { try { return [normalizePin(value, 'managed')] } catch { return [] } })
  sets.managed = new Map(managedPins.filter((pin) => !sets.official.has(pin.keyId) && !sets.community.has(pin.keyId)).map((pin) => [pin.keyId, pin]))
  const locallyRevoked = new Set(localRevokedKeyIds)
  const categoryOf = (keyId) => sets.official.has(keyId) ? 'official' : sets.community.has(keyId) ? 'community' : sets.managed.has(keyId) ? 'managed' : null
  const pinOf = (keyId) => sets[categoryOf(keyId)]?.get(keyId) ?? null
  const stateOf = (pin) => locallyRevoked.has(pin.keyId) ? 'revoked' : pin.state
  // `at` is the signed date of the content (snapshot generatedAt or release publishedAt).
  function usable(pin, at) {
    const state = stateOf(pin)
    if (state === 'revoked') return false
    if (state === 'retiring' && pin.notAfter && !(Date.parse(at) <= Date.parse(pin.notAfter))) return false
    return true
  }

  // Snapshot signatures: only community or managed keys sign a v2 snapshot. The
  // official key never signs v2 snapshots and a snapshot key never makes entries official.
  function verifySnapshot(envelope, { revokedKeyIds = new Set() } = {}) {
    const signed = envelope.signed
    for (const signature of envelope.signatures) {
      const category = categoryOf(signature.keyId)
      if (!['community', 'managed'].includes(category) || revokedKeyIds.has(signature.keyId)) continue
      const pin = pinOf(signature.keyId)
      if (!usable(pin, signed.generatedAt)) continue
      const announced = signed.trust.keys.find((key) => key.keyId === signature.keyId)
      if (announced && (announced.state === 'revoked' || (announced.state === 'retired' && announced.until && Date.parse(announced.until) < Date.parse(signed.generatedAt)))) continue
      if (verifySafely(snapshotStatementBytes(signed), pin.publicKey, signature.signature)) return { category, keyId: signature.keyId }
    }
    throw new CatalogTrustError('CATALOG_V2_SIGNATURE_UNTRUSTED')
  }

  // Official snapshot: only a usable official pin, over the domain-separated statement.
  function verifyOfficialSnapshot(envelope) {
    const pin = categoryOf(envelope.keyId) === 'official' ? pinOf(envelope.keyId) : null
    if (!pin || !usable(pin, envelope.signed.generatedAt) || !verifySafely(officialSnapshotBytes(envelope.signed), pin.publicKey, envelope.signature)) throw new CatalogTrustError('CATALOG_OFFICIAL_SIGNATURE_UNTRUSTED')
    return { category: 'official', keyId: pin.keyId }
  }

  // v1 payload `key@version:sha256` with a usable official pin.
  const officialEntrySigned = (entry, at) => [...sets.official.values()].some((pin) => usable(pin, at) && verifySafely(signedPayload(entry), pin.publicKey, entry.signature))

  // Entry trust: official only through a pinned official key over the exact v1
  // payload; community/managed only through a domain-separated release statement.
  function classifyEntry(entry, signed, { revokedKeyIds = new Set() } = {}) {
    if (entry.trust === 'official') {
      return officialEntrySigned(entry, entry.publishedAt ?? signed.generatedAt) ? { trust: 'official', official: true } : { trust: 'untrusted', official: false, reason: 'official_signature_invalid' }
    }
    const category = categoryOf(entry.keyId)
    if (!['community', 'managed'].includes(category)) return { trust: 'untrusted', official: false, reason: 'unknown_signing_key' }
    const pin = pinOf(entry.keyId)
    const announced = signed.trust.keys.find((key) => key.keyId === entry.keyId)
    if (revokedKeyIds.has(entry.keyId) || announced?.state === 'revoked' || stateOf(pin) === 'revoked') return { trust: 'untrusted', official: false, reason: 'signing_key_revoked' }
    if ((announced?.state === 'retired' && announced.until && Date.parse(entry.publishedAt) > Date.parse(announced.until)) || !usable(pin, entry.publishedAt)) return { trust: 'untrusted', official: false, reason: 'signing_key_retired' }
    if (!verifySafely(releaseStatementBytes(entry), pin.publicKey, entry.signature)) return { trust: 'untrusted', official: false, reason: 'community_signature_invalid' }
    if (category === 'managed') return { trust: 'managed', official: false }
    const publisher = signed.publishers.find((p) => p.handle === entry.publisher)
    return { trust: publisher?.verified && publisher.state === 'active' ? 'community-verified' : 'community', official: false }
  }

  // Administrator view: key ids, domains and lifecycle. Public data only.
  const describeKeys = () => ['official', 'community', 'managed'].flatMap((domain) => [...sets[domain].values()].map((pin) => ({ keyId: pin.keyId, domain, state: stateOf(pin), notAfter: pin.notAfter, source: domain === 'managed' ? 'instance' : 'runly-release', locallyRevoked: locallyRevoked.has(pin.keyId) })))

  return { categoryOf, verifySnapshot, verifyOfficialSnapshot, officialEntrySigned, classifyEntry, describeKeys, keys: { official: [...sets.official.keys()], community: [...sets.community.keys()], managed: [...sets.managed.keys()] } }
}
