// Portable CUSTOM bundle responsibilities shared by the ERP shell and isolated
// hosts: bundle contract, component registry, digest-keyed load cache, view
// resolution and diagnostics. It never imports, fetches or authenticates by
// itself: the host injects importModule/stylesheet ports. Auth, active company,
// installation and the installed-bundle API stay in the ERP wrappers.
import { BUNDLE_EXTERNALS, MODULE_EXTERNALS_IMPORTMAP } from './externals.js';

export const CUSTOM_BUNDLE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  entry: 'components/index.js',
  registerExport: 'register',
  format: 'esm',
  jsx: 'automatic',
  // Same loaders the ERP bundler has always used; esbuild defaults cover CSS/JSON.
  loader: Object.freeze({ '.js': 'jsx', '.jsx': 'jsx' }),
  externals: BUNDLE_EXTERNALS,
  importMap: MODULE_EXTERNALS_IMPORTMAP,
  aliases: Object.freeze({ '@atlas/ui': '@runly/ui', '@atlas/sdk': '@runly/sdk', '@atlas/validators': '@runly/validators' }),
  componentKey: '<moduleKey>:<Component>',
  cssScopeAttribute: 'data-runly-module',
});

const KEY = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
const normalizeKey = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

export function customDiagnostic(code, message, details = {}) {
  return { code, message: String(message).slice(0, 500), severity: details.severity ?? 'error', ...details };
}

// The ERP's component registry semantics (alias catalog, active modules,
// idempotent re-registration). `aliases` is injected so this package stays free
// of @runly/core; `moduleKey` optionally fences registrations to one module.
export function createComponentRegistry({ aliases = (key) => [key], warn = () => {}, moduleKey = null } = {}) {
  const store = new Map(), activeModuleKeys = new Set(), knownModuleKeys = new Set(), listeners = new Set();
  let activeCatalogSet = false, version = 0, closed = false;
  const notify = () => { version += 1; for (const listener of listeners) { try { listener(); } catch { /* listener errors never break registration */ } } };
  return {
    register(key, component) {
      const normalizedKey = normalizeKey(key);
      if (closed) { warn('Registry closed; registration ignored.'); return; }
      if (!normalizedKey) { warn('Skipped registration with empty or invalid key.'); return; }
      if (moduleKey && (!KEY.test(normalizedKey) || normalizedKey.slice(0, normalizedKey.indexOf(':')) !== moduleKey)) {
        warn(`Registration "${normalizedKey.slice(0, 120)}" is outside module ${moduleKey}.`);
        return;
      }
      if (component == null) { warn(`Skipped registration for "${normalizedKey}" because component is nullish.`); return; }
      // Re-registering the same component (ESM cache on remount/StrictMode) is a no-op.
      if (store.get(normalizedKey) === component) return;
      if (store.has(normalizedKey)) warn(`Duplicate registration for "${normalizedKey}". Replacing previous component.`);
      store.set(normalizedKey, component);
      notify();
    },
    resolve(key) {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) return null;
      const separator = normalizedKey.indexOf(':');
      if (separator < 0) return store.get(normalizedKey) ?? null;
      const owner = normalizedKey.slice(0, separator), suffix = normalizedKey.slice(separator);
      const candidates = aliases(owner);
      const active = candidates.find((candidate) => knownModuleKeys.has(candidate));
      if (activeCatalogSet && (!active || !activeModuleKeys.has(active))) return null;
      for (const candidate of candidates) {
        if (activeCatalogSet && candidate !== active && knownModuleKeys.has(candidate)) continue;
        const component = store.get(`${candidate}${suffix}`);
        if (component != null) return component;
      }
      return null;
    },
    has(key) { const normalizedKey = normalizeKey(key); return normalizedKey ? store.has(normalizedKey) : false; },
    list() { return Array.from(store.keys()); },
    setActiveModules(moduleKeys, knownKeys = moduleKeys) {
      activeCatalogSet = true; activeModuleKeys.clear(); knownModuleKeys.clear();
      for (const key of Array.isArray(knownKeys) ? knownKeys : []) { const k = normalizeKey(key); if (k) knownModuleKeys.add(k); }
      for (const key of Array.isArray(moduleKeys) ? moduleKeys : []) { const k = normalizeKey(key); if (k) { activeModuleKeys.add(k); knownModuleKeys.add(k); } }
      notify();
    },
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion() { return version; },
    clear() { closed = true; store.clear(); listeners.clear(); },
  };
}

// One load per (module, bundle identity). A failed load is evicted so a later
// attempt can retry; the same identity never imports/registers twice.
export function createBundleLoader({ importModule, ensureStylesheet = null, onDiagnostic = () => {} } = {}) {
  if (typeof importModule !== 'function') throw new TypeError('Bundle loader requires importModule');
  const loads = new Map();
  function load({ key, version, url, cssUrl = null, registry }) {
    const cacheKey = `${key}@${String(version)}`;
    if (loads.has(cacheKey)) return loads.get(cacheKey);
    const stylesheet = cssUrl && ensureStylesheet ? ensureStylesheet(key, cssUrl) : null;
    const promise = (async () => {
      try {
        const mod = await importModule(url);
        if (typeof mod?.[CUSTOM_BUNDLE_CONTRACT.registerExport] === 'function') await mod[CUSTOM_BUNDLE_CONTRACT.registerExport](registry);
        else onDiagnostic(customDiagnostic('CUSTOM_REGISTER_MISSING', 'El bundle no exporta register(registry).', { severity: 'warning', module: key }));
        return { key, loaded: true, stylesheet };
      } catch (error) {
        loads.delete(cacheKey);
        onDiagnostic(customDiagnostic('CUSTOM_BUNDLE_LOAD_FAILED', error?.message ?? 'Error desconocido', { module: key }));
        return { key, loaded: false, error: String(error?.message ?? error).slice(0, 500), stylesheet };
      }
    })();
    loads.set(cacheKey, promise);
    return promise;
  }
  return { load, has: (key, version) => loads.has(`${key}@${String(version)}`), clear: () => loads.clear() };
}

// Shared CUSTOM view resolution: schema.component must belong to the module
// (or to the public shared contract) and be registered by its bundle.
export function resolveCustomView(view, registry, { moduleKey, publicComponents = [] } = {}) {
  const component = view?.schema?.component ?? view?.component ?? null;
  if (!component) return { component: null, diagnostic: customDiagnostic('CUSTOM_COMPONENT_MISSING', 'La vista CUSTOM no declara schema.component.') };
  const shared = publicComponents.includes(component);
  if (moduleKey && !shared && !String(component).startsWith(`${moduleKey}:`)) return { component: null, diagnostic: customDiagnostic('CUSTOM_COMPONENT_NAMESPACE', `${component} no pertenece a ${moduleKey}.`) };
  const resolved = registry?.resolve(component) ?? null;
  return resolved ? { component: resolved, diagnostic: null } : { component: null, diagnostic: customDiagnostic('CUSTOM_COMPONENT_NOT_REGISTERED', `El componente ${component} no está registrado en components/index.js.`, { component }) };
}

// Map a line of an unminified esbuild bundle back to its "// path" module marker.
export function bundleSourceMap(code) {
  const markers = [];
  String(code).split('\n').forEach((line, index) => {
    const match = /^\/\/ (?:[a-z0-9-]+:)?((?:components|views)\/[^\s]+)$/.exec(line);
    if (match) markers.push({ line: index + 1, file: match[1] });
  });
  return (line) => {
    let file = null;
    for (const marker of markers) { if (marker.line <= line) file = marker.file; else break; }
    return file;
  };
}
