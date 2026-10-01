// This is an explicit compatibility catalog, not a namespace-wide rewrite.
// Persistent identities remain unchanged until the data migration is ready.
export const OFFICIAL_MODULE_KEY_PAIRS = Object.freeze([
  'core', 'identity', 'files', 'company', 'contacts', 'hr', 'fleet',
  'ledger', 'pfm', 'website', 'growth', 'documents', 'calendar', 'activity',
  'notifications', 'catalog', 'pos', 'projects', 'inventory', 'purchases', 'chat', 'notes',
].map(name => Object.freeze({ legacy: `atlas.${name}`, current: `runly.${name}` })));

// Modules born after the Runly rename intentionally have no invented
// `atlas.*` identity. Keep them explicit so catalog completeness can be
// checked without creating aliases that never existed in stored data.
export const CURRENT_ONLY_OFFICIAL_MODULE_KEYS = Object.freeze(['runly.canvas']);

const counterparts = new Map(OFFICIAL_MODULE_KEY_PAIRS.flatMap(({ legacy, current }) => [[legacy, current], [current, legacy]]));

export function getModuleKeyAliases(key) {
  const counterpart = counterparts.get(key);
  return counterpart ? [key, counterpart] : [key];
}

export function getLegacyModuleKey(key) {
  return typeof key === 'string' && key.startsWith('runly.') ? counterparts.get(key) ?? key : key;
}

export function getCurrentModuleKey(key) {
  return typeof key === 'string' && key.startsWith('atlas.') ? counterparts.get(key) ?? key : key;
}

export function findModuleByKey(modules, key) {
  for (const candidate of getModuleKeyAliases(key)) {
    const module = modules.get(candidate);
    if (module !== undefined && module !== null) return module;
  }
  return undefined;
}

export function resolveModuleAliasPath(modules, pathname) {
  return pathname.replace(/^(\/app\/m\/)([^/?#]+)(?=[/?#]|$)/, (match, prefix, key) => {
    let decoded;
    try { decoded = decodeURIComponent(key); } catch { return match; }
    const module = findModuleByKey(modules, decoded);
    return module ? `${prefix}${module.key}` : match;
  });
}
