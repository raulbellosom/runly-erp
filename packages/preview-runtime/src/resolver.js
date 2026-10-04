import { normalizeSpanishLabel } from '@runly/ui/renderer-adapters';
export function normalizePath(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text === '/') return '/'
  const withSlash = text.startsWith('/') ? text : `/${text}`
  return withSlash.replace(/\/+$/, '')
}

function normalizeKind(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function getBlueprintKind(row) {
  return normalizeKind(row?.kind ?? row?.type);
}

function getLastSegment(path) {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return "";
  const parts = normalized.split("/").filter(Boolean);
  return String(parts.at(-1) ?? "").toLowerCase();
}

function collapseWildcardPath(moduleKey, wildcard) {
  const raw = String(wildcard ?? "").trim();
  const normalized = raw.replace(/^\/+/, "");
  const duplicatedPrefixes = [
    `app/m/${moduleKey}/`,
    `m/${moduleKey}/`,
    `${moduleKey}/`,
  ];
  let collapsed = normalized;
  for (const prefix of duplicatedPrefixes) {
    if (collapsed.startsWith(prefix)) {
      collapsed = collapsed.slice(prefix.length);
      break;
    }
  }
  return collapsed.replace(/^\/+/, "");
}

function parseModeFromSegments(segments) {
  let initialMode = "list";
  let recordId = null;

  if (segments[0] === "new") {
    initialMode = "create";
  } else if (segments[0] && segments[1] === "edit") {
    initialMode = "edit";
    recordId = segments[0];
  } else if (segments[0]) {
    initialMode = "detail";
    recordId = segments[0];
  }

  return { initialMode, recordId };
}

function parseFallbackRouteInfo(moduleKey, wildcard) {
  const cleanPath = collapseWildcardPath(moduleKey, wildcard);
  const segments = cleanPath.split("/").filter(Boolean);
  const second = String(segments[1] ?? "").toLowerCase();
  const isCrudToken = second === "new" || second === "edit";
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      second,
    );
  const hasNestedCollection = segments.length >= 2 && !isCrudToken && !isUuid;
  const collectionPath = hasNestedCollection
    ? `${String(segments[0] ?? "").toLowerCase()}/${String(segments[1] ?? "").toLowerCase()}`
    : String(segments[0] ?? "").toLowerCase();
  const modeSegments = hasNestedCollection ? segments.slice(2) : segments.slice(1);
  const { initialMode, recordId } = parseModeFromSegments(modeSegments);
  const moduleRoutePath = collectionPath
    ? `/app/m/${moduleKey}/${collectionPath}`
    : `/app/m/${moduleKey}`;

  return {
    entitySegment: getLastSegment(collectionPath),
    collectionPath,
    moduleRoutePath,
    initialMode,
    recordId,
    pageMatch: null,
  };
}

function getPagePath(row) {
  return normalizePath(row?.schema?.path ?? row?.schema?.page?.path);
}

function resolveRouteInfo({ moduleKey, wildcard, pathname, moduleRows }) {
  const fallback = parseFallbackRouteInfo(moduleKey, wildcard);
  const normalizedPathname = normalizePath(pathname);
  if (!normalizedPathname || !moduleKey) return fallback;

  const pageMatches = moduleRows
    .filter((row) => getBlueprintKind(row) === "PAGE")
    .map((row) => ({ row, path: getPagePath(row) }))
    .filter(({ path }) => path)
    .filter(
      ({ path }) =>
        normalizedPathname === path || normalizedPathname.startsWith(`${path}/`),
    )
    .sort((a, b) => b.path.length - a.path.length);

  const bestMatch = pageMatches[0];
  if (!bestMatch) return fallback;

  const moduleRoot = normalizePath(`/app/m/${moduleKey}`);
  const collectionPath = bestMatch.path
    .slice(moduleRoot.length)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const suffix = normalizedPathname
    .slice(bestMatch.path.length)
    .replace(/^\/+/, "");
  const { initialMode, recordId } = parseModeFromSegments(
    suffix.split("/").filter(Boolean),
  );

  return {
    entitySegment: getLastSegment(collectionPath),
    collectionPath,
    moduleRoutePath: bestMatch.path,
    initialMode,
    recordId,
    pageMatch: bestMatch.row,
  };
}

function matchesEntity(blueprint, entitySegment) {
  if (!entitySegment) return false;
  const schema = blueprint?.schema ?? {};
  const apiPath = normalizePath(schema.apiPath);
  const apiLastSegment = getLastSegment(apiPath);
  const entity = String(schema.entity ?? "")
    .trim()
    .toLowerCase();
  if (apiLastSegment && apiLastSegment === entitySegment) return true;
  if (apiPath && apiPath.includes(`/${entitySegment}`)) return true;
  if (entity && (entity === entitySegment || `${entity}s` === entitySegment))
    return true;
  return false;
}

function matchesCollectionPath(blueprint, collectionPath) {
  if (!collectionPath) return false;
  const normalizedCollection = String(collectionPath).trim().toLowerCase();
  const schema = blueprint?.schema ?? {};
  const apiPath = normalizePath(schema.apiPath).toLowerCase();
  if (apiPath.endsWith(`/${normalizedCollection}`)) return true;
  if (apiPath.includes(`/${normalizedCollection}/`)) return true;
  return false;
}

function selectBlueprints({ moduleRows, routeInfo }) {
  const tableRows = moduleRows.filter(
    (row) => getBlueprintKind(row) === "TABLE",
  );
  const formRows = moduleRows.filter(
    (row) => getBlueprintKind(row) === "FORM",
  );
  const detailRows = moduleRows.filter(
    (row) => getBlueprintKind(row) === "DETAIL",
  );
  const pageMatch = routeInfo.pageMatch;

  const findByKey = (key) =>
    moduleRows.find(
      (row) => String(row?.key ?? "").trim() === String(key ?? "").trim(),
    ) ?? null;

  const findSiblingBySuffix = (baseBlueprint, suffix) => {
    const baseKey = String(baseBlueprint?.key ?? "").trim();
    if (!baseKey || !baseKey.includes(".")) return null;
    const normalizedSuffix = String(suffix ?? "").trim();
    if (!normalizedSuffix) return null;
    const siblingKey = baseKey.replace(/\.[^.]+$/, `.${normalizedSuffix}`);
    return findByKey(siblingKey);
  };

  let tableBlueprint = null;
  const pageViewKey = pageMatch?.schema?.view ?? pageMatch?.schema?.page?.view;
  if (pageViewKey) tableBlueprint = findByKey(pageViewKey);
  const pageTableKey =
    pageMatch?.schema?.table ?? pageMatch?.schema?.page?.table;
  if (!tableBlueprint && pageTableKey) tableBlueprint = findByKey(pageTableKey);
  if (!tableBlueprint) {
    tableBlueprint =
      tableRows.find((row) =>
        matchesCollectionPath(row, routeInfo.collectionPath),
      ) ?? null;
  }
  if (!tableBlueprint) {
    tableBlueprint =
      tableRows.find((row) => matchesEntity(row, routeInfo.entitySegment)) ??
      null;
  }

  if (!tableBlueprint) {
    return { tableBlueprint: null, formBlueprint: null, detailBlueprint: null };
  }

  const tableApiPath = normalizePath(tableBlueprint.schema?.apiPath);
  const tableEntity = String(tableBlueprint.schema?.entity ?? "")
    .trim()
    .toLowerCase();
  const matchesTable = (row) => {
    const candidateApiPath = normalizePath(row?.schema?.apiPath);
    const candidateEntity = String(row?.schema?.entity ?? "")
      .trim()
      .toLowerCase();
    if (tableApiPath && candidateApiPath && tableApiPath === candidateApiPath)
      return true;
    if (tableEntity && candidateEntity && tableEntity === candidateEntity)
      return true;
    return false;
  };

  const formBlueprint =
    findSiblingBySuffix(tableBlueprint, "form") ??
    formRows.find(matchesTable) ??
    formRows.find((row) =>
      matchesCollectionPath(row, routeInfo.collectionPath),
    ) ??
    formRows.find((row) => matchesEntity(row, routeInfo.entitySegment)) ??
    null;
  const detailBlueprint =
    findSiblingBySuffix(tableBlueprint, "detail") ??
    detailRows.find(matchesTable) ??
    detailRows.find((row) =>
      matchesCollectionPath(row, routeInfo.collectionPath),
    ) ??
    detailRows.find((row) => matchesEntity(row, routeInfo.entitySegment)) ??
    null;

  return { tableBlueprint, formBlueprint, detailBlueprint };
}

// Shared with the module runtime (@runly/ui extractBlueprintFields).


function resolveNavItem(module, moduleRoutePath, collectionPath, entitySegment) {
  const nav = module?.navigation ?? module?.manifest?.navigation ?? [];
  if (!Array.isArray(nav) || nav.length === 0) return null;
  const normalizedRoute = normalizePath(moduleRoutePath);

  // Check children first (absolute paths from manifest, most specific match)
  for (const item of nav) {
    if (!Array.isArray(item.children)) continue;
    const childMatch = item.children.find(
      (child) => normalizePath(child?.path ?? "") === normalizedRoute,
    );
    if (childMatch) return childMatch;
  }

  // Top-level exact match (relative paths after normalizeModuleNavigation)
  const exact = nav.find(
    (item) => normalizePath(item?.path ?? "") === normalizedRoute,
  );
  if (exact) return exact;

  if (collectionPath) {
    const normalizedCollection = normalizePath(`/${collectionPath}`);
    for (const item of nav) {
      if (!Array.isArray(item.children)) continue;
      const childMatch = item.children.find((child) =>
        normalizePath(child?.path ?? "").endsWith(normalizedCollection),
      );
      if (childMatch) return childMatch;
    }
    const byCollection = nav.find((item) =>
      normalizePath(item?.path ?? "").endsWith(normalizedCollection),
    );
    if (byCollection) return byCollection;
  }

  if (entitySegment) {
    for (const item of nav) {
      if (!Array.isArray(item.children)) continue;
      const childMatch = item.children.find((child) =>
        normalizePath(child?.path ?? "")
          .split("/")
          .includes(entitySegment),
      );
      if (childMatch) return childMatch;
    }
    const partial = nav.find((item) =>
      normalizePath(item?.path ?? "")
        .split("/")
        .includes(entitySegment),
    );
    if (partial) return partial;
  }

  return null;
}

function resolvePageTitle(tableBlueprint, navItem) {
  const blueprintTitle =
    tableBlueprint?.schema?.title ?? tableBlueprint?.title ?? null;
  if (blueprintTitle) return blueprintTitle;
  if (navItem?.label) return navItem.label;
  return "Registros";
}

function resolveEmptyLabel(entitySegment, navItem) {
  if (navItem?.label) return navItem.label;
  if (entitySegment)
    return entitySegment.charAt(0).toUpperCase() + entitySegment.slice(1);
  return null;
}

function resolvePageDescription(tableBlueprint, module, navItem) {
  const blueprintDesc =
    tableBlueprint?.schema?.description ?? tableBlueprint?.description ?? null;
  if (blueprintDesc) return blueprintDesc;
  // When a specific navItem was resolved (especially a child), the module
  // description is too generic — omit it so the title stands on its own.
  if (navItem) return null;
  return module?.description ?? module?.manifest?.description ?? null;
}

function getModuleRootPath(moduleKey) {
  return normalizePath(`/app/m/${moduleKey}`);
}

function resolveGroupSegment(collectionPath) {
  const normalized = String(collectionPath ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!normalized) return null;
  return normalized.split("/").filter(Boolean)[0] ?? null;
}

function resolveCollectionPathFromPagePath(moduleKey, pagePath) {
  const normalizedPagePath = normalizePath(pagePath);
  const moduleRoot = getModuleRootPath(moduleKey);
  if (!normalizedPagePath || !moduleRoot) return "";
  if (!normalizedPagePath.startsWith(moduleRoot)) return "";
  return normalizedPagePath
    .slice(moduleRoot.length)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function resolveGroupedTabs({ moduleRows, moduleKey, routeInfo, pathname }) {
  const groupSegment = resolveGroupSegment(routeInfo.collectionPath);
  if (!groupSegment) return null;

  const pageEntries = moduleRows
    .filter((row) => getBlueprintKind(row) === "PAGE")
    .map((row, index) => {
      const path = getPagePath(row);
      const collectionPath = resolveCollectionPathFromPagePath(moduleKey, path);
      const tabOrderRaw = row?.schema?.tabOrder;
      const tabOrder =
        Number.isFinite(tabOrderRaw) || typeof tabOrderRaw === "number"
          ? Number(tabOrderRaw)
          : Number.POSITIVE_INFINITY;
      const label =
        row?.schema?.tabLabel ??
        row?.schema?.title ??
        row?.title ??
        row?.name ??
        collectionPath;
      return {
        index,
        path,
        collectionPath,
        groupSegment: resolveGroupSegment(collectionPath),
        tabOrder,
        label: normalizeSpanishLabel(String(label ?? "").trim()),
      };
    })
    .filter((entry) => entry.path && entry.collectionPath);

  const tabs = pageEntries
    .filter(
      (entry) =>
        entry.groupSegment === groupSegment && entry.collectionPath !== groupSegment,
    )
    .sort((a, b) => {
      if (a.tabOrder !== b.tabOrder) return a.tabOrder - b.tabOrder;
      return a.index - b.index;
    });

  if (tabs.length <= 1) return null;

  const moduleRoot = getModuleRootPath(moduleKey);
  const basePath = normalizePath(`${moduleRoot}/${groupSegment}`);
  const normalizedPathname = normalizePath(pathname);
  const activeTab =
    tabs.find(
      (tab) =>
        normalizedPathname === tab.path ||
        normalizedPathname.startsWith(`${tab.path}/`),
    ) ?? tabs[0];

  return {
    basePath,
    defaultPath: tabs[0].path,
    shouldRedirect: normalizedPathname === basePath,
    activePath: activeTab.path,
    tabs: tabs.map((tab) => ({ path: tab.path, label: tab.label })),
  };
}

function isNamespacedComponentKey(value) {
  if (typeof value !== "string") return false;
  return /^[a-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(value.trim());
}

function collectNamespacedComponentKeys(input, found = new Set()) {
  if (Array.isArray(input)) {
    for (const value of input) collectNamespacedComponentKeys(value, found);
    return found;
  }
  if (!input || typeof input !== "object") {
    if (isNamespacedComponentKey(input)) found.add(String(input).trim());
    return found;
  }

  for (const value of Object.values(input)) {
    if (isNamespacedComponentKey(value)) {
      found.add(String(value).trim());
      continue;
    }
    if (value && typeof value === "object") {
      collectNamespacedComponentKeys(value, found);
    }
  }

  return found;
}

function collectMissingComponentReferences({ blueprints, registry }) {
  const missing = new Map();
  if (!registry || !Array.isArray(blueprints)) return [];

  for (const blueprint of blueprints) {
    const componentKeys = collectNamespacedComponentKeys(blueprint?.schema ?? {});
    for (const componentKey of componentKeys) {
      if (registry.resolve(componentKey)) continue;
      if (!missing.has(componentKey)) {
        missing.set(componentKey, new Set());
      }
      missing.get(componentKey).add(blueprint?.key ?? "unknown");
    }
  }

  return [...missing.entries()].map(([componentKey, blueprintKeys]) => ({
    componentKey,
    blueprintKeys: [...blueprintKeys],
  }));
}


export { normalizeKind, getBlueprintKind, getLastSegment, collapseWildcardPath, parseModeFromSegments, parseFallbackRouteInfo, getPagePath, resolveRouteInfo, matchesEntity, matchesCollectionPath, selectBlueprints, resolveNavItem, resolvePageTitle, resolveEmptyLabel, resolvePageDescription, getModuleRootPath, resolveGroupSegment, resolveCollectionPathFromPagePath, resolveGroupedTabs, isNamespacedComponentKey, collectNamespacedComponentKeys, collectMissingComponentReferences };
