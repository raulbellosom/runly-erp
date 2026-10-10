// /module-catalog — official module catalog (spec 2026-10-03-rme3-module-platform-v2 §12.5).
import { Hono } from "hono";
import { CatalogError, createCatalogService } from "../services/catalog/catalog-service.js";
import { CatalogVerificationError } from "../services/catalog/catalog-crypto.js";
import { createCatalogV2Service } from "../services/catalog/catalog-v2-service.js";
import { CatalogTrustError } from "../services/catalog/catalog-trust-store.js";

function fail(c, error, fallback) {
  if (error instanceof CatalogError || error instanceof CatalogVerificationError || error instanceof CatalogTrustError) {
    return c.json({ error: error.code, message: error.message, details: error.details ?? null }, error.status);
  }
  // Package pipeline errors (schema decisions, drift...) keep their status and details.
  if (error?.statusCode || error?.status) {
    return c.json({ error: error.code ?? "MODULE_PACKAGE_PUBLISH_FAILED", message: error.message, details: error.details ?? null }, error.statusCode ?? error.status);
  }
  console.error("[catalog]", error?.message ?? error);
  return c.json({ error: "catalog_error", message: fallback }, 500);
}

export function createCatalogRouter({ prisma, requirePermission, bundlerSvc = null, routeLoader = null, cacheDel = () => {}, catalogV2Service = null }) {
  const app = new Hono();
  const catalog = createCatalogService({ prisma, bundlerSvc, routeLoader, cacheDel });
  // Marketplace: signed official snapshot + community v2 feeds. v1 routes above are unchanged.
  const catalogV2 = catalogV2Service ?? createCatalogV2Service({ prisma, bundlerSvc, routeLoader, cacheDel });
  const actor = (c) => c.get("userContext")?.profile?.id ?? null;
  const body = async (c) => {
    const data = await c.req.json().catch(() => ({}));
    return {
      grants: Array.isArray(data?.grants) ? data.grants.map(String) : [],
      decisions: data?.decisions && typeof data.decisions === "object" && !Array.isArray(data.decisions) ? data.decisions : {},
    };
  };

  app.get("/module-catalog", requirePermission("core.modules.read"), async (c) => {
    try {
      return c.json({ data: await catalog.list() });
    } catch (error) {
      return fail(c, error, "No se pudo cargar el catálogo de módulos.");
    }
  });

  app.post("/module-catalog/:key/install", requirePermission("core.modules.manage"), async (c) => {
    try {
      return c.json({ data: await catalog.install({ key: c.req.param("key"), ...(await body(c)), actorId: actor(c) }) });
    } catch (error) {
      return fail(c, error, "No se pudo instalar el módulo.");
    }
  });

  app.post("/module-catalog/:key/update", requirePermission("core.modules.manage"), async (c) => {
    try {
      return c.json({ data: await catalog.update({ key: c.req.param("key"), ...(await body(c)), actorId: actor(c) }) });
    } catch (error) {
      return fail(c, error, "No se pudo actualizar el módulo.");
    }
  });

  // Installing, updating or re-pointing the catalog changes code for the whole
  // instance (RunlyModule is instance-global; companies only enable/disable it).
  // Same authority as other instance-level settings: system admin or the admin
  // of the active company (the owner on a single-company instance). A custom
  // role that merely holds core.modules.manage is not enough. Server-side check:
  // hidden buttons are never the control.
  const requireInstanceAuthority = async (c, next) => {
    const tenant = c.get("tenantContext");
    if (!tenant?.isSystemAdmin && !tenant?.isAdmin) {
      return c.json({ error: "instance_authority_required", message: "Sólo la administración de la instancia puede instalar, actualizar o configurar el catálogo de módulos." }, 403);
    }
    await next();
  };
  const v2Body = async (c) => {
    const data = await c.req.json().catch(() => ({}));
    return {
      version: typeof data?.version === "string" ? data.version : "",
      confirmation: typeof data?.confirmation === "string" ? data.confirmation : "",
      acceptCommunity: data?.acceptCommunity === true,
      acceptStale: data?.acceptStale === true,
      grants: Array.isArray(data?.grants) ? data.grants.map(String) : [],
      decisions: data?.decisions && typeof data.decisions === "object" && !Array.isArray(data.decisions) ? data.decisions : {},
    };
  };
  app.get("/module-catalog/v2", requirePermission("core.modules.read"), async (c) => {
    try {
      return c.json({ data: await catalogV2.list({ key: c.req.query("key") ?? null }) });
    } catch (error) {
      return fail(c, error, "No se pudo cargar el catálogo v2.");
    }
  });
  for (const action of ["install", "update"]) {
    app.post(`/module-catalog/v2/:key/${action}`, requirePermission("core.modules.manage"), requireInstanceAuthority, async (c) => {
      try {
        return c.json({ data: await catalogV2[action]({ key: c.req.param("key"), ...(await v2Body(c)), actorId: actor(c) }) });
      } catch (error) {
        return fail(c, error, action === "install" ? "No se pudo instalar el módulo." : "No se pudo actualizar el módulo.");
      }
    });
  }
  // Resolve + download + verify + compatibility, without installing anything.
  app.post("/module-catalog/v2/:key/preflight", requirePermission("core.modules.manage"), requireInstanceAuthority, async (c) => {
    try {
      const { version } = await v2Body(c);
      return c.json({ data: await catalogV2.preflight({ key: c.req.param("key"), version }) });
    } catch (error) {
      return fail(c, error, "No se pudo verificar el módulo.");
    }
  });
  app.get("/module-catalog/v2/source", requirePermission("core.modules.read"), requireInstanceAuthority, async (c) => {
    try {
      return c.json({ data: await catalogV2.source() });
    } catch (error) {
      return fail(c, error, "No se pudo leer la configuración del catálogo.");
    }
  });
  app.put("/module-catalog/v2/source", requirePermission("core.modules.manage"), requireInstanceAuthority, async (c) => {
    try {
      const data = await c.req.json().catch(() => null);
      if (!data || typeof data !== "object" || Array.isArray(data)) return c.json({ error: "catalog_source_invalid", message: "Configuración inválida." }, 422);
      const allowed = ["mode", "communityUrl", "officialUrl", "policy", "managedKeys", "revokeKeyIds"];
      return c.json({ data: await catalogV2.configureSource(Object.fromEntries(Object.entries(data).filter(([key]) => allowed.includes(key)))) });
    } catch (error) {
      return fail(c, error, "No se pudo guardar la configuración del catálogo.");
    }
  });

  return app;
}
