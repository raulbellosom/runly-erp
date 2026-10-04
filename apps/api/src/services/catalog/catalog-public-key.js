// Public keys whose signatures make a catalog package "oficial" (spec
// 2026-10-03-rme3-module-platform-v2 §15.3). Base64 SPKI DER of Ed25519 keys.
// The matching private key is kept by the Runly owner outside the repo
// (scripts/catalog/keygen.mjs). An instance admin can trust extra keys
// (InstanceConfig `catalog.publicKeys`) for a private catalog; only packages
// signed with these pinned keys are marked as official.
export const OFFICIAL_CATALOG_PUBLIC_KEYS = Object.freeze([
  'MCowBQYDK2VwAyEArvSedcdVX6Ldk6/0O0SdLShYt9TSdNcf/+lBL3ysJfM=',
])

export const DEFAULT_CATALOG_URL = 'https://runly.mx/catalog/v1/index.json'
