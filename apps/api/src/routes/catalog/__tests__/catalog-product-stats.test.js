// apps/api/src/routes/catalog/__tests__/catalog-product-stats.test.js
//
// Coverage for the KPI stats endpoint and the stockStatus filter added to
// listProducts (CatalogProductsScreen redesign, 2026-09-26):
//   - getProductStats maps the aggregate row and stays company-scoped
//   - listProducts wires the stockStatus param into both the data and count queries
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCatalogProductService } from "../catalog-product-service.js";

const COMPANY = "01900000-0000-7000-8000-000000000001";

function sqlText(strings) {
  return (Array.isArray(strings) ? strings.join(" ? ") : String(strings))
    .replace(/\s+/g, " ")
    .trim();
}

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
  return { $queryRaw: run, $queryRawUnsafe: (sql, ...values) => run(sql, ...values) };
}

describe("catalog-product-service — getProductStats", () => {
  it("maps the aggregate row and scopes by company", async () => {
    const seen = [];
    const svc = createCatalogProductService({
      prisma: fakePrisma(
        [["from catalog_product", [{ total: 12, published: 9, draft: 3, out_of_stock: 1, low_stock: 2 }]]],
        seen,
      ),
    });
    const stats = await svc.getProductStats({ companyId: COMPANY });
    assert.deepEqual(stats, {
      total: 12, published: 9, draft: 3, outOfStock: 1, lowStock: 2, lowStockThreshold: 10,
    });
    assert.ok(seen[0].text.toLowerCase().includes("company_id ="), "must scope by company_id");
    assert.ok(seen[0].values.includes(COMPANY), "companyId must be bound as a query param");
  });

  it("returns zeros when the company has no products", async () => {
    const svc = createCatalogProductService({ prisma: fakePrisma([]) });
    const stats = await svc.getProductStats({ companyId: COMPANY });
    assert.equal(stats.total, 0);
    assert.equal(stats.outOfStock, 0);
  });
});

describe("catalog-product-service — listCategories product_count", () => {
  it("includes a real product_count per category (CatalogCategoriesScreen redesign)", async () => {
    const seen = [];
    const svc = createCatalogProductService({
      prisma: fakePrisma(
        [["from catalog_category c", [{ id: "cat-1", name: "Calzado", product_count: 7 }]]],
        seen,
      ),
    });
    const rows = await svc.listCategories({ companyId: COMPANY });
    assert.equal(rows[0].product_count, 7);
    assert.ok(seen[0].text.toLowerCase().includes("left join catalog_product"), "must join products to count them");
    assert.ok(seen[0].text.toLowerCase().includes("group by"), "must group by category to aggregate the count");
  });
});

describe("catalog-product-service — listProducts stockStatus filter", () => {
  it("passes a valid stockStatus through to both the data and count queries", async () => {
    const seen = [];
    const svc = createCatalogProductService({
      prisma: fakePrisma(
        [
          ["select p.id", []],
          ["select count(*)", [{ total: 0 }]],
        ],
        seen,
      ),
    });
    await svc.listProducts({ companyId: COMPANY, stockStatus: "low" });
    assert.equal(seen.length, 2);
    for (const call of seen) {
      assert.ok(call.text.toLowerCase().includes("track_stock"), "query must reference track_stock");
      assert.ok(call.values.includes("low"), "stockStatus param must be forwarded");
    }
  });

  it("ignores an unrecognized stockStatus value (passes null, not the raw string)", async () => {
    const seen = [];
    const svc = createCatalogProductService({
      prisma: fakePrisma([["select p.id", []], ["select count(*)", [{ total: 0 }]]], seen),
    });
    await svc.listProducts({ companyId: COMPANY, stockStatus: "bogus" });
    for (const call of seen) {
      assert.ok(!call.values.includes("bogus"), "unrecognized stockStatus must not reach the query");
    }
  });
});
