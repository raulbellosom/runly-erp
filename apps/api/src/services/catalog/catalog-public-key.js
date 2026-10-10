// Public keys whose signatures make a catalog package "oficial" (spec
// 2026-10-03-rme3-module-platform-v2 §15.3). Base64 SPKI DER of Ed25519 keys.
// An instance admin can trust extra keys (InstanceConfig `catalog.publicKeys`)
// for a private catalog; only packages signed with these pinned keys are
// marked as official.
//
// LEGACY / NOT FOR NEW SIGNING (decision D2, Production Catalog Activation):
// this v1 identity has no demonstrable private-key custody. Developer Hub never
// signs new production content with it (it is refused by the Hub trust
// registry). It stays pinned unchanged for compatibility until the release that
// distributes the new Official identity, which pins the new key as `active` and
// moves this one to `{ state: 'retiring', notAfter }` or `revoked` (the pin
// format accepted by catalog-trust-store.js). Never re-activate it.
export const LEGACY_OFFICIAL_PUBLIC_KEY = 'MCowBQYDK2VwAyEArvSedcdVX6Ldk6/0O0SdLShYt9TSdNcf/+lBL3ysJfM='

export const OFFICIAL_CATALOG_PUBLIC_KEYS = Object.freeze([
  LEGACY_OFFICIAL_PUBLIC_KEY,
])

// Catalog v1 compatibility endpoint (Modules > Disponibles). v1 is a projection
// derived from the signed Official snapshot; the Marketplace (v2/official
// snapshot) is the source of truth.
export const DEFAULT_CATALOG_URL = 'https://runly.mx/catalog/v1/index.json'
