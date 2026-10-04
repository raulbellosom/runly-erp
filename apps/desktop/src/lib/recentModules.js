// Per-device "recently opened apps" list for the Home "Continuar" row.
// Browser storage only: a convenience, never authoritative state.
const STORAGE_KEY = "runly.home.recentModules";
export const MAX_RECENT_MODULES = 8;

export function pushRecentKey(keys, key, max = MAX_RECENT_MODULES) {
  if (!key) return keys;
  return [key, ...keys.filter((k) => k !== key)].slice(0, max);
}

export function readRecentModuleKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentModule(key) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(pushRecentKey(readRecentModuleKeys(), key)),
    );
  } catch {
    // Storage unavailable (private window, blocked site data): skip silently.
  }
}

// Case/accent-insensitive match over name, summary and key.
export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function filterModulesByQuery(modules, query) {
  const q = normalizeSearchText(query).trim();
  if (!q) return modules;
  const terms = q.split(/\s+/);
  return modules
    .map((m) => {
      const name = normalizeSearchText(m.name);
      const haystack = `${name} ${normalizeSearchText(m.summary || m.description)} ${normalizeSearchText(m.key)}`;
      if (!terms.every((t) => haystack.includes(t))) return null;
      const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
      return { m, rank };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.m.name.localeCompare(b.m.name, "es"))
    .map(({ m }) => m);
}
