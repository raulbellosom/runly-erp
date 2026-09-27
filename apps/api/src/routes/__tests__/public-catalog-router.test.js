// apps/api/src/routes/__tests__/public-catalog-router.test.js
//
// Regression coverage: the npm storefront-sdk (packages/storefront-sdk)
// always sends X-Runly-Company on every request, but createPublicCatalogRouter
// used to resolve the tenant purely by Host header (via dist-serve-service's
// resolveSiteForRequest), silently ignoring that header. Any consumer of
// sdk.catalog running from a domain that doesn't exactly match a published
// site's `website_site.domain` row — including the Website Builder's own
// in-editor block preview — got the wrong company's catalog, or none at all.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPublicCatalogRouter } from "../public-website.js";

function fakePrisma({ companiesBySlug = {} } = {}) {
  return {
    company: {
      findUnique: async ({ where }) => companiesBySlug[where.slug] ?? null,
    },
    instanceConfig: {
      // No primary company configured — the Host-based fallback resolves to
      // "no site found" rather than crashing, so tests stay deterministic.
      findUnique: async () => null,
    },
    $queryRaw: async (strings, ...values) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (/website_site/i.test(text)) return []; // domain-map lookup: no matches
      if (/catalog_category/i.test(text) && values.includes("company-acme")) {
        return [{ id: "cat-1", name: "Ropa", slug: "ropa", parent_id: null, cover_asset_id: null, position: 0, product_count: 3 }];
      }
      return [];
    },
  };
}

describe("createPublicCatalogRouter — company resolution", () => {
  it("resolves the tenant from X-Runly-Company when present, ignoring Host", async () => {
    const app = createPublicCatalogRouter({
      prisma: fakePrisma({ companiesBySlug: { acme: { id: "company-acme" } } }),
    });
    const res = await app.request("/categories", {
      headers: { "X-Runly-Company": "acme", Host: "unrelated-domain.example" },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].name, "Ropa");
  });

  it("returns empty data (not an error) for an unknown company slug", async () => {
    const app = createPublicCatalogRouter({ prisma: fakePrisma({ companiesBySlug: {} }) });
    const res = await app.request("/categories", {
      headers: { "X-Runly-Company": "does-not-exist" },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.data, []);
  });

  it("falls back to Host-based resolution when no header is sent", async () => {
    const app = createPublicCatalogRouter({
      prisma: fakePrisma({ companiesBySlug: { acme: { id: "company-acme" } } }),
    });
    const res = await app.request("/categories");
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.data, []); // no domain match, no primary company configured
  });
});
