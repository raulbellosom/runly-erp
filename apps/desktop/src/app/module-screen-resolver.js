import { getCurrentModuleKey } from '@runly/core';

export function hasBuiltInModule(screenMap, key) {
  const moduleKey = getCurrentModuleKey(key);
  return Object.keys(screenMap).some(entry => entry.startsWith(`${key}:`) || entry.startsWith(`${moduleKey}:`));
}

export function isPathAllowedByNavigation(module, subPath) {
  const navigation = module?.navigation ?? [];
  if (!navigation.length) return subPath === '/';
  if (subPath === '/') return true;

  const modulePrefix = `/app/m/${module.key}`;

  function pathMatches(navPath) {
    if (!navPath) return false;
    // Normalize full paths to relative
    const pathname = navPath.split(/[?#]/)[0];
    const rel = pathname === modulePrefix || pathname.startsWith(`${modulePrefix}/`)
      ? (pathname.slice(modulePrefix.length) || '/')
      : pathname;
    // Root nav items authorize direct single-segment children (e.g. /:id detail pages).
    // Deeper paths (e.g. /categories/sub) are covered by their own nav entries.
    if (rel === '/') {
      const extra = subPath.slice(1); // strip leading /
      return extra.length > 0 && !extra.includes('/');
    }
    return subPath === rel || subPath.startsWith(`${rel}/`);
  }

  function itemAllows(item) {
    if (pathMatches(item?.path)) return true;
    return (item?.children ?? []).some(itemAllows);
  }

  return navigation.some(itemAllows);
}

export function resolveScreen(screenMap, requestedModuleKey, subPath, blueprintScreen) {
  const requested = screenMap[`${requestedModuleKey}:${subPath}`];
  if (requested) return requested;
  const moduleKey = getCurrentModuleKey(requestedModuleKey);
  const exact = screenMap[`${moduleKey}:${subPath}`];
  if (exact) return exact;
  if (
    moduleKey === "runly.identity" &&
    subPath.startsWith("/identity/roles/")
  ) {
    return screenMap["runly.identity:/identity/roles/:id"] ?? null;
  }
  if (
    moduleKey === "runly.identity" &&
    subPath.startsWith("/identity/users/")
  ) {
    if (subPath === "/identity/users/new") {
      return screenMap["runly.identity:/identity/users/new"] ?? null;
    }
    if (subPath.endsWith("/edit")) {
      return screenMap["runly.identity:/identity/users/:id/edit"] ?? null;
    }
    return screenMap["runly.identity:/identity/users/:id"] ?? null;
  }
  if (moduleKey === "runly.files" && subPath.startsWith("/files/")) {
    if (/^\/files\/[^/]+\/edit\/?$/.test(subPath)) return screenMap["runly.files:/files/:id/edit"];
    return screenMap["runly.files:/files/:id"] ?? null;
  }
  if (moduleKey === "runly.hr" && subPath.startsWith("/hr/employees/")) {
    return screenMap["runly.hr:/hr/employees/:id"] ?? null;
  }
  if (moduleKey === "runly.contacts" && subPath.startsWith("/contacts/")) {
    return screenMap["runly.contacts:/contacts/:id"] ?? null;
  }
  if (moduleKey === "runly.fleet") {
    if (subPath === "/vehicles" || subPath === "/vehicles/new") return screenMap["runly.fleet:/vehicles"] ?? null;
    if (subPath.startsWith("/vehicles/")) return screenMap["runly.fleet:/vehicles/:id"] ?? null;
    if (subPath === "/drivers" || subPath === "/drivers/new") return screenMap["runly.fleet:/drivers"] ?? null;
    if (subPath.startsWith("/drivers/")) return screenMap["runly.fleet:/drivers/:id"] ?? null;
    if (subPath === "/insurance" || subPath === "/insurance/new") return screenMap["runly.fleet:/insurance"] ?? null;
    if (subPath.startsWith("/insurance/")) return screenMap["runly.fleet:/insurance/:id"] ?? null;
    if (/^\/reports\/(maintenance|service|repair|other)\/new$/.test(subPath)) return screenMap["runly.fleet:/reports/:type/new"] ?? null;
    if (/^\/reports\/(maintenance|service|repair|other)\/[^/]+\/edit$/.test(subPath)) return screenMap["runly.fleet:/reports/:type/new"] ?? null;
    if (/^\/reports\/(maintenance|service|repair|other)$/.test(subPath)) return screenMap["runly.fleet:/reports/:type"] ?? null;
    if (/^\/reports\/[^/]+$/.test(subPath)) return screenMap["runly.fleet:/reports/:id"] ?? null;
    if (/^\/catalogs\/(vehicle-types|vehicle-brands|vehicle-models)$/.test(subPath)) return screenMap["runly.fleet:/catalogs/:section"] ?? null;
    if (subPath === "/catalogs") return screenMap["runly.fleet:/catalogs/:section"] ?? null;
    return null;
  }
  if (moduleKey === "runly.ledger") {
    if (subPath === "/import-ai") return screenMap["runly.ledger:/import-ai"] ?? null;
    if (subPath === "/accounts" || subPath === "/accounts/new") return screenMap["runly.ledger:/accounts"] ?? null;
    if (subPath.endsWith("/import")) return screenMap["runly.ledger:/accounts/:id/import"] ?? null;
    if (subPath.startsWith("/accounts/") && !subPath.endsWith("/new")) return screenMap["runly.ledger:/accounts/:id"] ?? null;
    if (/^\/groups\/[^/]+$/.test(subPath)) return screenMap["runly.ledger:/groups/:id"] ?? null;
    if (subPath === "/groups") return screenMap["runly.ledger:/groups"] ?? null;
    if (subPath === "/memberships") return screenMap["runly.ledger:/memberships"] ?? null;
    if (subPath === "/categories" || subPath === "/categories/new") return screenMap["runly.ledger:/categories"] ?? null;
    if (subPath.startsWith("/categories/")) return screenMap["runly.ledger:/categories/:id"] ?? null;
    if (subPath === "/types" || subPath === "/types/new") return screenMap["runly.ledger:/types"] ?? null;
    if (subPath.startsWith("/types/")) return screenMap["runly.ledger:/types/:id"] ?? null;
    return null;
  }
  if (moduleKey === "runly.pfm") {
    if (subPath === "/" || subPath === "/overview") return screenMap["runly.pfm:/overview"] ?? null;
    if (subPath === "/wallets" || subPath === "/wallets/new") return screenMap["runly.pfm:/wallets"] ?? null;
    if (subPath.startsWith("/wallets/")) return screenMap["runly.pfm:/wallets/:id"] ?? null;
    if (subPath === "/recurring") return screenMap["runly.pfm:/recurring"] ?? null;
    if (subPath === "/receipts") return screenMap["runly.pfm:/receipts"] ?? null;
    if (subPath === "/categories") return screenMap["runly.pfm:/categories"] ?? null;
    if (subPath === "/budgets") return screenMap["runly.pfm:/budgets"] ?? null;
    return null;
  }
  if (moduleKey === "runly.website") {
    if (/^\/pages\/[^/]+\/editor$/.test(subPath)) {
      return screenMap["runly.website:/pages/:id/editor"] ?? null;
    }
    if (/^\/blog\/[^/]+\/editor$/.test(subPath)) {
      return screenMap["runly.website:/blog/:id/editor"] ?? null;
    }
    if (/^\/templates\/[^/]+\/detail$/.test(subPath)) {
      return screenMap["runly.website:/templates/:id/detail"] ?? null;
    }
    if (/^\/templates\/[^/]+\/preview$/.test(subPath)) {
      return screenMap["runly.website:/templates/:id/preview"] ?? null;
    }
    return screenMap[`runly.website:${subPath}`] ?? null;
  }
  if (moduleKey === "runly.documents") {
    if (subPath === "/templates") return screenMap["runly.documents:/templates"] ?? null;
    if (subPath === "/generated") return screenMap["runly.documents:/generated"] ?? null;
    if (/^\/templates\/[^/]+\/editor$/.test(subPath)) return screenMap["runly.documents:/templates/:id/editor"] ?? null;
    return null;
  }
  if (moduleKey === "runly.growth") {
    if (subPath === "/") {
      return screenMap["runly.growth:/"] ?? null;
    }
    if (subPath === "/leads") {
      return screenMap["runly.growth:/leads"] ?? null;
    }
    if (/^\/leads\/[^/]+$/.test(subPath)) {
      return screenMap["runly.growth:/leads/:id"] ?? null;
    }
    return null;
  }
  if (moduleKey === "runly.catalog") {
    if (subPath === "/") return screenMap["runly.catalog:/"] ?? null;
    if (subPath.startsWith("/categories"))
      return screenMap["runly.catalog:/categories"] ?? null;
    if (subPath === "/inventory")
      return screenMap["runly.catalog:/inventory"] ?? null;
    // Any remaining subpath like /:id is the product detail screen
    return screenMap["runly.catalog:/:id"] ?? null;
  }
  if (moduleKey === "runly.pos") {
    if (subPath === "/" || subPath === "/pos/terminal") return screenMap["runly.pos:/pos/terminal"] ?? null;
    if (subPath === "/pos/tables") return screenMap["runly.pos:/pos/tables"] ?? null;
    if (subPath === "/pos/floor-planner") return screenMap["runly.pos:/pos/floor-planner"] ?? null;
    if (subPath === "/pos/stations") return screenMap["runly.pos:/pos/stations"] ?? null;
    if (subPath === "/pos/orders") return screenMap["runly.pos:/pos/orders"] ?? null;
    if (subPath === "/pos/sessions") return screenMap["runly.pos:/pos/sessions"] ?? null;
    if (subPath === "/pos/settings") return screenMap["runly.pos:/pos/settings"] ?? null;
    if (/^\/pos\/comandero\/mesa\/[^/]+$/.test(subPath)) return screenMap["runly.pos:/pos/comandero/mesa/:tableId"] ?? null;
    return null;
  }
  if (moduleKey === "runly.inventory") {
    if (subPath === "/" || subPath === "/inventory") return screenMap["runly.inventory:/inventory"] ?? null;
    if (subPath === "/inventory/new") return screenMap["runly.inventory:/inventory/new"] ?? null;
    if (subPath === "/inventory/assignments") return screenMap["runly.inventory:/inventory/assignments"] ?? null;
    if (subPath === "/inventory/catalogs") return screenMap["runly.inventory:/inventory/catalogs"] ?? null;
    // Parameterized routes — must come after all static path checks
    if (/^\/inventory\/[^/]+\/edit$/.test(subPath)) return screenMap["runly.inventory:/inventory/new"] ?? null;
    if (/^\/inventory\/[^/]+$/.test(subPath)) return screenMap["runly.inventory:/inventory/:id"] ?? null;
    return null;
  }
  if (moduleKey === "runly.chat") {
    if (subPath === "/" || subPath === "/chat/inbox") return screenMap["runly.chat:/chat/inbox"] ?? null;
    if (/^\/chat\/attachment\/[^/]+\/edit\/?$/.test(subPath)) return screenMap["runly.chat:/chat/attachment/:id/edit"] ?? null;
    if (subPath.startsWith("/chat/inbox/")) return screenMap["runly.chat:/chat/inbox"] ?? null;
    if (subPath === "/chat/external") return screenMap["runly.chat:/chat/external"] ?? null;
    if (subPath === "/chat/templates") return screenMap["runly.chat:/chat/templates"] ?? null;
    return null;
  }
  if (moduleKey === "runly.notes") {
    if (subPath === "/" || subPath === "/notes") return screenMap["runly.notes:/notes"] ?? null;
    if (subPath === "/notes/recent") return screenMap["runly.notes:/notes/recent"] ?? null;
    if (subPath === "/notes/shared") return screenMap["runly.notes:/notes/shared"] ?? null;
    if (subPath === "/notes/trash")  return screenMap["runly.notes:/notes/trash"]  ?? null;
    return null;
  }
  if (subPath === "/") return screenMap[`${moduleKey}:/`] ?? null;
  if (!hasBuiltInModule(screenMap, moduleKey)) return blueprintScreen;
  return null;
}

