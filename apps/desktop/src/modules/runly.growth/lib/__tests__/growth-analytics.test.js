import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAnalyticsQuery,
  resolveAnalyticsFilters,
} from "../growth-analytics.js";

describe("growth analytics filters", () => {
  it("defaults to the last 30 complete UTC days", () => {
    const filters = resolveAnalyticsFilters(
      new URLSearchParams(),
      new Date("2026-06-14T18:00:00.000Z"),
    );

    assert.deepEqual(filters, {
      tab: "overview",
      range: "30",
      from: "2026-05-15",
      to: "2026-06-13",
      siteId: "",
      compare: false,
    });
  });

  it("resolves 'today' to a single-day range in the current UTC day", () => {
    const filters = resolveAnalyticsFilters(
      new URLSearchParams("range=today"),
      new Date("2026-06-14T18:00:00.000Z"),
    );

    assert.equal(filters.range, "today");
    assert.equal(filters.from, "2026-06-14");
    assert.equal(filters.to, "2026-06-14");
  });

  it("keeps valid custom filters and rejects unsupported tabs", () => {
    const filters = resolveAnalyticsFilters(
      new URLSearchParams(
        "tab=unknown&range=custom&from=2026-06-01&to=2026-06-10&siteId=site-1&compare=true",
      ),
      new Date("2026-06-14T18:00:00.000Z"),
    );

    assert.equal(filters.tab, "overview");
    assert.equal(filters.range, "custom");
    assert.equal(filters.from, "2026-06-01");
    assert.equal(filters.to, "2026-06-10");
    assert.equal(filters.siteId, "site-1");
    assert.equal(filters.compare, true);
  });

  it("builds the API query without empty site filters", () => {
    assert.deepEqual(
      buildAnalyticsQuery({
        from: "2026-06-01",
        to: "2026-06-13",
        siteId: "",
        compare: true,
      }),
      {
        from: "2026-06-01",
        to: "2026-06-13",
        compare: true,
      },
    );
  });
});
