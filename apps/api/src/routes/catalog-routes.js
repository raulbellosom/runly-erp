// /module-catalog — official module catalog (spec 2026-10-03-rme3-module-platform-v2 §12.5).
import { Hono } from "hono";
import { CatalogError, createCatalogService } from "../services/catalog/catalog-service.js";
import { CatalogVerificationError } from "../services/catalog/catalog-crypto.js";

function fail(c, error, fallback) {
  if (error instanceof CatalogError || error instanceof CatalogVerificationError) {
    return c.json({ error: error.code, message: error.message, details: error.details ?? null }, error.status);
  }
  // Package pipeline errors (schema decisions, drift...) keep their status and details.
  if (error?.statusCode || error?.status) {
    return c.json({ error: error.code ?? "MODULE_PACKAGE_PUBLISH_FAILED", message: error.message, details: error.details ?? null }, error.statusCode ?? error.status);
  }
  console.error("[catalog]", error?.message ?? error);
  return c.json({ error: "catalog_error", message: fallback }, 500);
}

export function createCatalogRouter({ prisma, requirePermission, bundlerSvc = null, routeLoader = null, cacheDel = () => {} }) {
  const app = new Hono();
  const catalog = createCatalogService({ prisma, bundlerSvc, routeLoader, cacheDel });
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

  return app;
}
