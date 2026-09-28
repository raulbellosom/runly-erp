import { getModuleKeyAliases } from '@runly/core';

function normalizeKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length > 0 ? key : null;
}

export function createModuleComponentRegistry(options = {}) {
  const store = new Map();
  const activeModuleKeys = new Set();
  const knownModuleKeys = new Set();
  let activeCatalogSet = false;
  const listeners = new Set();
  let version = 0;
  const warn = typeof options.warn === "function" ? options.warn : () => {};

  function notify() {
    version += 1;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }

  return {
    register(key, component) {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) {
        warn("Skipped registration with empty or invalid key.");
        return;
      }
      if (component == null) {
        warn(
          `Skipped registration for "${normalizedKey}" because component is nullish.`,
        );
        return;
      }
      // Re-registering the same component (bundle re-imported from the ESM
      // cache on remount/StrictMode) is a no-op, not a conflict.
      if (store.get(normalizedKey) === component) return;
      if (store.has(normalizedKey)) {
        warn(
          `Duplicate registration for "${normalizedKey}". Replacing previous component.`,
        );
      }
      store.set(normalizedKey, component);
      notify();
    },

    resolve(key) {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) return null;
      const separator = normalizedKey.indexOf(':');
      if (separator < 0) return store.get(normalizedKey) ?? null;
      const moduleKey = normalizedKey.slice(0, separator);
      const suffix = normalizedKey.slice(separator);
      const aliases = getModuleKeyAliases(moduleKey);
      const owner = aliases.find(key => knownModuleKeys.has(key));
      if (activeCatalogSet && (!owner || !activeModuleKeys.has(owner))) return null;
      for (const candidate of aliases) {
        if (activeCatalogSet && candidate !== owner && knownModuleKeys.has(candidate)) continue;
        const component = store.get(`${candidate}${suffix}`);
        if (component != null) return component;
      }
      return null;
    },

    has(key) {
      const normalizedKey = normalizeKey(key);
      return normalizedKey ? store.has(normalizedKey) : false;
    },

    list() {
      return Array.from(store.keys());
    },

    setActiveModules(moduleKeys, knownKeys = moduleKeys) {
      activeCatalogSet = true;
      activeModuleKeys.clear();
      knownModuleKeys.clear();
      for (const key of Array.isArray(knownKeys) ? knownKeys : []) {
        const normalizedKey = normalizeKey(key);
        if (normalizedKey) knownModuleKeys.add(normalizedKey);
      }
      for (const key of Array.isArray(moduleKeys) ? moduleKeys : []) {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) continue;
        activeModuleKeys.add(normalizedKey);
        knownModuleKeys.add(normalizedKey);
      }
      notify();
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getVersion() {
      return version;
    },
  };
}
