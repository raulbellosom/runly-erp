export const CATEGORY_LABELS = {
  sistema: 'Sistema',
  operaciones: 'Operaciones',
  contabilidad: 'Contabilidad',
  general: 'General',
};

/**
 * Returns an ordered array of { label, modules } sections based on view preferences.
 * @param {Array} modules - available (installed+enabled) modules
 * @param {{ sortMode: 'az'|'groups', favorites: string[], favoritesFirst: boolean }} opts
 * @returns {Array<{ label: string|null, modules: Array }>}
 */
export function getSortedDisplay(modules, { sortMode, favorites, favoritesFirst }) {
  const sorted = [...modules].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  );

  const sections = [];
  const shownKeys = new Set();

  if (favoritesFirst && favorites.length > 0) {
    const favModules = sorted.filter((m) => favorites.includes(m.key));
    if (favModules.length > 0) {
      sections.push({ label: 'Favoritos', kind: 'favorites', modules: favModules });
      favModules.forEach((m) => shownKeys.add(m.key));
    }
  }

  const remaining = sorted.filter((m) => !shownKeys.has(m.key));

  if (sortMode === 'groups') {
    const groups = {};
    for (const m of remaining) {
      const cat = m.category ?? 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    }
    const categoryOrder = Object.keys(CATEGORY_LABELS);
    const orderedCats = Object.keys(groups).sort(
      (a, b) =>
        (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a)) -
        (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b)),
    );
    for (const cat of orderedCats) {
      sections.push({ label: CATEGORY_LABELS[cat] ?? cat, modules: groups[cat] });
    }
  } else {
    if (remaining.length > 0) {
      sections.push({ label: null, modules: remaining });
    }
  }

  return sections;
}
