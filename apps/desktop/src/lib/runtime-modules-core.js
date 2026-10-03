import { findModuleByKey, getModuleKeyAliases, resolveModuleAliasPath } from '@runly/core';

const STATUS_ORDER = {
  INSTALLED: 0,
  DISABLED: 1,
  UNINSTALLED: 2,
  ERROR: 3,
};

function computeMigrationSignature(manifestLike) {
  const migrations = Array.isArray(manifestLike?.migrations)
    ? manifestLike.migrations
    : [];
  const normalized = migrations.map((entry) => ({
    path: typeof entry?.path === "string" ? entry.path.trim() : "",
    checksum:
      typeof entry?.checksum === "string"
        ? entry.checksum.trim().toLowerCase()
        : "",
    unsafe: entry?.unsafe === true,
  }));
  return JSON.stringify(normalized);
}

export { CATEGORY_LABELS, getSortedDisplay } from './sortModules.js';

function normalizeApiRows(raw) {
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  return [];
}

function normalizeLayoutMode(value) {
  if (value === "no-sidebar" || value === "custom" || value === "default") {
    return value;
  }
  return "default";
}

function normalizeModuleNavigationPath(moduleKey, path, modules) {
  const rawPath = String(path ?? "").trim();
  if (!rawPath) return "";
  if (rawPath === "/") return "/";

  const withSlash = resolveModuleAliasPath(modules, rawPath.startsWith("/") ? rawPath : `/${rawPath}`);
  const modulePrefix = `/app/m/${moduleKey}`;

  if (withSlash === modulePrefix) return "/";
  if (withSlash.startsWith(`${modulePrefix}?`) || withSlash.startsWith(`${modulePrefix}#`)) return `/${withSlash.slice(modulePrefix.length)}`;
  if (withSlash.startsWith(`${modulePrefix}/`)) {
    const relative = withSlash.slice(modulePrefix.length);
    return relative.startsWith("/") ? relative : `/${relative}`;
  }

  return withSlash;
}

function normalizeModuleNavigation(moduleKey, navigation, modules) {
  const rows = Array.isArray(navigation) ? navigation : [];
  return rows
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      return {
        ...item,
        path: normalizeModuleNavigationPath(moduleKey, item.path, modules),
        ...(Array.isArray(item.children) ? { children: normalizeModuleNavigation(moduleKey, item.children, modules) } : {}),
      };
    })
    .filter(Boolean);
}

export function mergeRuntimeModules(rawApiModules, options = {}) {
  const { includeManifestFallback = true, manifests = [], preferApiNavigation = false } = options;
  const manifestsByKey = new Map(manifests.map(manifest => [manifest.key, manifest]));
  const apiRows = normalizeApiRows(rawApiModules);
  const apiByKey = new Map(apiRows.map((row) => [row.key, row]));
  const allKeys = new Set(apiByKey.keys());
  if (includeManifestFallback) {
    for (const key of manifestsByKey.keys()) {
      if (!findModuleByKey(apiByKey, key)) allKeys.add(key);
    }
  }
  const identities = new Map([...allKeys].map(key => [key, { key }]));

  const merged = Array.from(allKeys).map((key) => {
    const [, counterpart] = getModuleKeyAliases(key);
    // An exact persisted counterpart owns its own manifest; do not borrow it
    // across a catalog collision.
    const manifest = manifestsByKey.get(key) ?? (apiByKey.has(counterpart) ? null : manifestsByKey.get(counterpart)) ?? null;
    const apiRow = apiByKey.get(key) ?? null;

    // Use || so a false DB column doesn't block a true value in the manifest JSON (stale seed data)
    const core = Boolean(manifest?.core || apiRow?.manifest?.core || apiRow?.core);
    const uninstallable =
      apiRow?.uninstallable ?? manifest?.uninstallable ?? !core;
    const status = apiRow?.status ?? (core ? "INSTALLED" : "UNINSTALLED");
    const enabled =
      typeof apiRow?.enabled === "boolean" ? apiRow.enabled : core;

    const manifestFallback = apiRow?.manifest ?? {};
    // The API reads custom packages from disk on every list; the bundled
    // manifest is frozen at build/dev-server start and goes stale after an
    // uploaded update, so it only decides when the API sent no disk version.
    const diskVersion =
      typeof apiRow?.diskVersion === "string" ? apiRow.diskVersion.trim() : null;
    const localVersion =
      diskVersion ?? (typeof manifest?.version === "string" ? manifest.version.trim() : null);
    const dbVersion =
      typeof apiRow?.version === "string"
        ? apiRow.version.trim()
        : typeof manifestFallback?.version === "string"
          ? manifestFallback.version.trim()
          : null;
    const localSignature = computeMigrationSignature(manifest);
    const persistedSignature = computeMigrationSignature(manifestFallback);
    const updateVersionMismatch =
      Boolean(localVersion) && Boolean(dbVersion) && localVersion !== dbVersion;
    const updateMigrationMismatch =
      !diskVersion &&
      Boolean(localSignature) &&
      Boolean(persistedSignature) &&
      localSignature !== persistedSignature;
    const updateAvailable =
      (key.startsWith("custom.") || apiRow?.lifecycleConfig?.discovery?.source === "custom") &&
      (updateVersionMismatch || updateMigrationMismatch);

    const navigationSource = preferApiNavigation && apiRow
      ? manifestFallback.navigation ?? []
      : manifest?.navigation ?? manifestFallback.navigation ?? [];
    const navigation = normalizeModuleNavigation(key, navigationSource, identities);

    const layoutMode = normalizeLayoutMode(
      manifest?.layoutMode ?? manifestFallback.layoutMode,
    );
    const description =
      apiRow?.description ??
      manifest?.description ??
      manifestFallback.description ??
      null;
    const summary =
      manifest?.summary ??
      manifestFallback.summary ??
      description ??
      "";

    return {
      id: apiRow?.id ?? null,
      key,
      name: apiRow?.name ?? manifest?.name ?? key,
      description,
      summary,
      icon: manifest?.icon ?? manifestFallback.icon ?? "Box",
      logoUrl: manifest?.logoUrl ?? manifestFallback.logoUrl ?? null,
      color:
        manifest?.color ?? manifestFallback.color ?? "var(--brand-primary)",
      category: manifest?.category ?? manifestFallback.category ?? "general",
      navigation,
      dependencies:
        manifest?.dependencies ?? manifestFallback.dependencies ?? [],
      layoutMode,
      version: apiRow?.version ?? manifest?.version ?? "0.0.0",
      localVersion,
      dbVersion,
      kind: apiRow?.kind ?? manifest?.kind ?? "FEATURE",
      core: Boolean(core),
      uninstallable: Boolean(uninstallable),
      status,
      enabled: Boolean(enabled),
      manifest: manifest ?? apiRow?.manifest ?? null,
      installedAt: apiRow?.installedAt ?? null,
      updatedAt: apiRow?.updatedAt ?? null,
      compatibility: apiRow?.compatibility ?? [],
      compatibilityStatus: apiRow?.compatibilityStatus ?? "OK",
      compatibilityBlocking: apiRow?.compatibilityBlocking ?? [],
      lifecycleConfig: apiRow?.lifecycleConfig ?? null,
      lastError: apiRow?.lifecycleConfig?.lastError ?? null,
      fullscreenPaths: (Array.isArray(manifest?.fullscreenPaths)
        ? manifest.fullscreenPaths
        : Array.isArray(manifestFallback.fullscreenPaths)
          ? manifestFallback.fullscreenPaths
          : []).map(value => normalizeModuleNavigationPath(key, value, identities)),
      updateAvailable,
      updateReason: updateAvailable
        ? updateVersionMismatch && updateMigrationMismatch
          ? "version+migrations"
          : updateVersionMismatch
            ? "version"
            : "migrations"
        : null,
    };
  });

  return merged.sort((a, b) => {
    if (a.core !== b.core) return a.core ? -1 : 1;
    const byStatus =
      (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (byStatus !== 0) return byStatus;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

export function isModuleAvailable(module) {
  return module?.status === "INSTALLED" && module?.enabled === true;
}

export function getAvailableModules(modules) {
  return (modules ?? []).filter(isModuleAvailable);
}

export function groupModulesByCategory(modules) {
  const groups = {};
  for (const module of modules ?? []) {
    const category = module.category ?? "general";
    if (!groups[category]) groups[category] = [];
    groups[category].push(module);
  }
  return groups;
}

export function getModuleLaunchPath(module) {
  const firstNav = module?.navigation?.[0];
  if (!module) return "/app/home";
  if (firstNav?.path && firstNav.path !== "/") {
    return firstNav.path.startsWith('/app/m/') ? firstNav.path : `/app/m/${module.key}${firstNav.path}`;
  }
  return `/app/m/${module.key}`;
}

export function getModuleByKey(modules, key) {
  return findModuleByKey(new Map((modules ?? []).map(module => [module.key, module])), key) ?? null;
}

export function getLayoutMode(module) {
  return normalizeLayoutMode(module?.layoutMode);
}

/**
 * Returns true if the given normalized sub-path matches any of the module's
 * fullscreenPaths patterns (e.g. '/accounts/:id').
 * Patterns support :param segments (match a single path segment) and * (wildcard).
 */
export function matchesFullscreenPath(module, normalizedSubPath) {
  const patterns = Array.isArray(module?.fullscreenPaths) ? module.fullscreenPaths : [];
  if (patterns.length === 0 || !normalizedSubPath) return false;
  return patterns.some((pattern) => {
    const regexStr = `^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')}$`;
    return new RegExp(regexStr).test(normalizedSubPath);
  });
}
