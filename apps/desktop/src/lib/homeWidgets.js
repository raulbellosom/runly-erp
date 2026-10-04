// Pure helpers for the Home widget board (kept React-free for unit tests).

// Widgets whose module the user can open, in catalog order.
export function availableWidgets(catalog, availableModuleKeys) {
  const keys = new Set(availableModuleKeys);
  return catalog.filter((w) => keys.has(w.moduleKey));
}

export function visibleWidgets(catalog, availableModuleKeys, hidden = []) {
  const hiddenSet = new Set(hidden);
  return availableWidgets(catalog, availableModuleKeys).filter((w) => !hiddenSet.has(w.id));
}

export function toggleHidden(hidden = [], id) {
  return hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
}
