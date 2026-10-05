// Catalog trust store (Phase 7). Three categories that never mix:
//   official  — Runly official key pinned in catalog-public-key.js (v1 payload)
//   community — Runly community key(s) pinned here (domain-separated v2 statements)
//   managed   — keys an instance admin configured for a private/managed catalog
// Only `official` can ever yield `official: true`. A key may belong to exactly
// one category; overlaps are rejected at load and when admins add keys.
import { createPublicKey, verify } from 'node:crypto'
import { OFFICIAL_CATALOG_PUBLIC_KEYS } from './catalog-public-key.js'
import { releaseStatementBytes, snapshotStatementBytes, keyIdOf } from './catalog-v2-contract.js'
import { signedPayload } from './catalog-crypto.js'

// The production community key has not been generated yet. Until it is
// provisioned and pinned here (with a Runly release), community trust only
// exists in tests that inject keys; admins may add managed keys instead.
export const COMMUNITY_CATALOG_PUBLIC_KEYS = Object.freeze([])

export class CatalogTrustError extends Error {
  constructor(code) { super(code); this.code = code; this.status = 422 }
}

function ed25519(base64) {
  const key = createPublicKey({ key: Buffer.from(String(base64), 'base64'), format: 'der', type: 'spki' })
  if (key.asymmetricKeyType !== 'ed25519') throw new CatalogTrustError('CATALOG_KEY_NOT_ED25519')
  return key
}
const verifySafely = (bytes, publicKey, signature) => { try { return verify(null, bytes, ed25519(publicKey), Buffer.from(signature, 'base64')) } catch { return false } }

export function createTrustStore({ official = OFFICIAL_CATALOG_PUBLIC_KEYS, community = COMMUNITY_CATALOG_PUBLIC_KEYS, managed = [] } = {}) {
  const ids = (keys) => new Map(keys.map((key) => [keyIdOf(key), key]))
  const sets = { official: ids(official), community: ids(community), managed: ids(managed.filter((key) => !official.includes(key) && !community.includes(key))) }
  for (const id of sets.community.keys()) if (sets.official.has(id)) throw new CatalogTrustError('COMMUNITY_KEY_OVERLAPS_OFFICIAL')
  const categoryOf = (keyId) => sets.official.has(keyId) ? 'official' : sets.community.has(keyId) ? 'community' : sets.managed.has(keyId) ? 'managed' : null

  // Snapshot signatures: only community or managed keys sign a v2 snapshot. The
  // official key never signs snapshots and a snapshot key never makes entries official.
  function verifySnapshot(envelope, { revokedKeyIds = new Set() } = {}) {
    const signed = envelope.signed
    for (const signature of envelope.signatures) {
      const category = categoryOf(signature.keyId)
      if (!['community', 'managed'].includes(category) || revokedKeyIds.has(signature.keyId)) continue
      const announced = signed.trust.keys.find((key) => key.keyId === signature.keyId)
      if (announced && (announced.state === 'revoked' || (announced.state === 'retired' && announced.until && Date.parse(announced.until) < Date.parse(signed.generatedAt)))) continue
      const publicKey = (category === 'community' ? sets.community : sets.managed).get(signature.keyId)
      if (verifySafely(snapshotStatementBytes(signed), publicKey, signature.signature)) return { category, keyId: signature.keyId }
    }
    throw new CatalogTrustError('CATALOG_V2_SIGNATURE_UNTRUSTED')
  }

  // Entry trust: official only through the pinned official key over the exact v1
  // payload; community/managed only through a domain-separated release statement.
  function classifyEntry(entry, signed, { revokedKeyIds = new Set() } = {}) {
    if (entry.trust === 'official') {
      const ok = [...sets.official.values()].some((key) => verifySafely(signedPayload(entry), key, entry.signature))
      return ok ? { trust: 'official', official: true } : { trust: 'untrusted', official: false, reason: 'official_signature_invalid' }
    }
    const category = categoryOf(entry.keyId)
    if (!['community', 'managed'].includes(category)) return { trust: 'untrusted', official: false, reason: 'unknown_signing_key' }
    const announced = signed.trust.keys.find((key) => key.keyId === entry.keyId)
    if (revokedKeyIds.has(entry.keyId) || announced?.state === 'revoked') return { trust: 'untrusted', official: false, reason: 'signing_key_revoked' }
    if (announced?.state === 'retired' && announced.until && Date.parse(entry.publishedAt) > Date.parse(announced.until)) return { trust: 'untrusted', official: false, reason: 'signing_key_retired' }
    const publicKey = (category === 'community' ? sets.community : sets.managed).get(entry.keyId)
    if (!verifySafely(releaseStatementBytes(entry), publicKey, entry.signature)) return { trust: 'untrusted', official: false, reason: 'community_signature_invalid' }
    if (category === 'managed') return { trust: 'managed', official: false }
    const publisher = signed.publishers.find((p) => p.handle === entry.publisher)
    return { trust: publisher?.verified && publisher.state === 'active' ? 'community-verified' : 'community', official: false }
  }
  return { categoryOf, verifySnapshot, classifyEntry, keys: { official: [...sets.official.keys()], community: [...sets.community.keys()], managed: [...sets.managed.keys()] } }
}
