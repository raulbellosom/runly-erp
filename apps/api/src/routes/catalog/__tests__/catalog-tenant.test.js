// apps/api/src/routes/catalog/__tests__/catalog-tenant.test.js
//
// Tenant-safety coverage for atlas.catalog (2026-08-30 audit):
//   - createCategory / updateCategory / createProduct / updateProduct reject a
//     parent/category FK that belongs to another company
//   - recordStockMovement refuses a product that is not in the caller's company
//   - the public product endpoint never SELECTs internal columns
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCatalogProductService,
  CatalogRefError,
} from "../catalog-product-service.js";
import {
  createCatalogStockService,
  CatalogStockError,
} from "../catalog-stock-service.js";
import { createCatalogPublicService } from "../catalog-public-service.js";

const COMPANY = "01900000-0000-7000-8000-000000000001";

function sqlText(strings) {
  return (Array.isArray(strings) ? strings.join(" ? ") : String(strings))
    .replace(/\s+/g, " ")
    .trim();
}

// prisma stub: rules is [substringMatcher, rowsOrFn]; default [].
function fakePrisma(rules = [], capture) {
  const run = (strings, ...values) => {
    const text = sqlText(strings);
    if (capture) capture.push({ text, values });
    for (const [needle, out] of rules) {
      if (text.toLowerCase().includes(needle.toLowerCase())) {
        return Promise.resolve(typeof out === "function" ? out(values) : out);
      }
    }
    return Promise.resolve([]);
  };
  return {
    $queryRaw: run,
    $queryRawUnsafe: (sql, ...values) => run(sql, ...values),
    $transaction: async (fn) => fn({ $queryRaw: run }),
  };
}

describe("catalog-product-service — cross-company FK refs are rejected", () => {
  it("createCategory rejects a parent_id from another company", async () => {
    const svc = createCatalogProductService({
      prisma: fakePrisma([["from catalog_category where id = $1::uuid and company_id", []]]),
      supabaseAdmin: null,
    });
    await assert.rejects(
      () => svc.createCategory({ companyId: COMPANY, data: { name: "Sub", slug: "sub", parent_id: "foreign" } }),
      (e) => e instanceof CatalogRefError && e.status === 400,
    );
  });

  it("createProduct rejects a category_id from another company", async () => {
    const svc = createCatalogProductService({
      prisma: fakePrisma([["from catalog_category where id = $1::uuid and company_id", []]]),
      supabaseAdmin: null,
    });
    await assert.rejects(
      () => svc.createProduct({ companyId: COMPANY, data: { name: "P", slug: "p", category_id: "foreign" } }),
      (e) => e instanceof CatalogRefError && e.status === 400,
    );
  });

  it("createProduct allows a category_id that IS in the company", async () => {
    const seen = [];
    const svc = createCatalogProductService({
      prisma: fakePrisma(
        [
          ["from catalog_category where id = $1::uuid and company_id", [{ "?column?": 1 }]],
          ["insert into catalog_product", [{ id: "prod-1", company_id: COMPANY }]],
        ],
        seen,
      ),
      supabaseAdmin: null,
    });
    const row = await svc.createProduct({ companyId: COMPANY, data: { name: "P", slug: "p", category_id: "own-cat" } });
    assert.equal(row.id, "prod-1");
  });

  it("updateCategory rejects making a category its own parent", async () => {
    const svc = createCatalogProductService({ prisma: fakePrisma(), supabaseAdmin: null });
    await assert.rejects(
      () => svc.updateCategory({ companyId: COMPANY, id: "cat-1", data: { parent_id: "cat-1" } }),
      (e) => e instanceof CatalogRefError,
    );
  });
});

describe("catalog-stock-service — movement targets must be in the company", () => {
  it("throws 404 when the product is not in the caller's company", async () => {
    const svc = createCatalogStockService({
      prisma: fakePrisma([["select id from catalog_product where id", []]]),
    });
    await assert.rejects(
      () => svc.recordStockMovement({ companyId: COMPANY, productId: "foreign", quantityDelta: 5 }),
      (e) => e instanceof CatalogStockError && e.status === 404,
    );
  });

  it("proceeds (and stays company-scoped) when the product is in the company", async () => {
    const seen = [];
    const svc = createCatalogStockService({
      prisma: fakePrisma(
        [
          ["select id from catalog_product where id", [{ id: "prod-1" }]],
          ["insert into catalog_stock_movement", [{ id: "mov-1" }]],
        ],
        seen,
      ),
    });
    const mov = await svc.recordStockMovement({ companyId: COMPANY, productId: "prod-1", quantityDelta: 3 });
    assert.equal(mov.id, "mov-1");
    const stockUpdate = seen.find((q) => /update catalog_product set stock/i.test(q.text));
    assert.ok(stockUpdate && /company_id/i.test(stockUpdate.text), "stock update must be company-scoped");
  });
});

describe("catalog-public-service — getPublicProductBySlug projection", () => {
  it("selects only shopper-facing columns", async () => {
    const seen = [];
    const svc = createCatalogPublicService({
      prisma: fakePrisma([["from catalog_product p", [{ id: "p1", product_type: "SIMPLE", name: "X" }]]], seen),
    });
    await svc.getPublicProductBySlug({ companyId: COMPANY, slug: "x" });
    const q = seen[0].text.toLowerCase();
    const selectList = q.slice(q.indexOf("select"), q.indexOf(" from "));
    for (const forbidden of ["company_id", "meta_title", "meta_description", "sku", "barcode"]) {
      assert.ok(!selectList.includes(forbidden), `public product SELECT must not expose ${forbidden}`);
    }
    assert.ok(selectList.includes("p.name") && selectList.includes("p.price"));
  });

  it("resolves by slug OR raw id, since sdk.catalog.getProduct(idOrSlug) accepts either", async () => {
    const seen = [];
    const svc = createCatalogPublicService({
      prisma: fakePrisma([["from catalog_product p", [{ id: "p1", product_type: "SIMPLE", name: "X" }]]], seen),
    });
    await svc.getPublicProductBySlug({ companyId: COMPANY, slug: "01900000-0000-7000-8000-00000000abcd" });
    const q = seen[0].text.toLowerCase();
    assert.ok(q.includes("p.slug =") && q.includes("p.id::text ="), "must match against both slug and id");
  });
});
