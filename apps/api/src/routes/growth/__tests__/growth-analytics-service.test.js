import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GrowthAnalyticsServiceError,
  createGrowthAnalyticsService,
} from "../growth-analytics-service.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_COMPANY_ID = "01900000-0000-7000-8000-000000000099";
const SITE_ID = "01900000-0000-7000-8000-000000000002";

function metric(date, dimensionType, dimensionKey, metrics) {
  return {
    companyId: COMPANY_ID,
    siteId: SITE_ID,
    metricDate: new Date(`${date}T00:00:00.000Z`),
    dimensionType,
    dimensionKey,
    metrics,
  };
}

function createPrisma() {
  const rows = [
    metric("2026-06-12", "site", "", {
      visitors: 5,
      newVisitors: 3,
      returningVisitors: 2,
      sessions: 6,
      engagedSessions: 3,
      pageviews: 8,
      visibleSeconds: 60,
      leads: 1,
      qualified: 1,
      converted: 0,
    }),
    metric("2026-06-13", "site", "", {
      visitors: 8,
      newVisitors: 5,
      returningVisitors: 3,
      sessions: 10,
      engagedSessions: 7,
      pageviews: 16,
      visibleSeconds: 180,
      leads: 3,
      qualified: 2,
      converted: 1,
    }),
    metric("2026-06-13", "source", "google|cpc|summer", {
      sessions: 6,
      engagedSessions: 5,
      conversions: 2,
      source: "google",
      medium: "cpc",
      campaign: "summer",
    }),
    metric("2026-06-13", "source", "direct|none|none", {
      sessions: 4,
      engagedSessions: 2,
      conversions: 1,
      source: "Directo",
      medium: "Sin medio",
      campaign: "Sin campaña",
    }),
    metric("2026-06-13", "landing", "/inicio", {
      sessions: 7,
      engagedSessions: 5,
      conversions: 2,
    }),
    metric("2026-06-13", "page", "/precios", {
      pageviews: 9,
      visitors: 6,
    }),
    metric("2026-06-13", "cta", "quote_click", {
      clicks: 4,
      visitors: 3,
      label: "Cotizar",
      placement: "hero",
    }),
    metric("2026-06-13", "form", "form-1", {
      views: 10,
      starts: 8,
      submits: 7,
    }),
    ...[
      ["form_view", 10],
      ["form_start", 8],
      ["form_submit", 7],
      ["lead_created", 6],
      ["qualified", 4],
      ["converted", 2],
    ].map(([step, count]) =>
      metric("2026-06-13", "funnel", step, { count }),
    ),
    metric("2026-06-12", "retention", "2026-06-12", {
      cohortVisitors: 10,
      d1: 4,
      d7: 2,
      d30: 1,
    }),
  ];

  const growthProperties = [];

  return {
    websiteSite: {
      findFirst: async ({ where }) =>
        where.companyId === COMPANY_ID && where.id === SITE_ID
          ? { id: SITE_ID, name: "Sitio principal", domain: "example.com" }
          : null,
      findMany: async ({ where }) =>
        where.companyId === COMPANY_ID
          ? [{ id: SITE_ID, name: "Sitio principal", domain: "example.com" }]
          : [],
    },
    growthProperty: {
      findFirst: async ({ where }) =>
        growthProperties.find(
          (p) =>
            p.companyId === where.companyId &&
            (!where.id || p.id === where.id) &&
            (where.enabled === undefined || p.enabled === where.enabled),
        ) ?? null,
      findMany: async ({ where }) =>
        growthProperties.filter(
          (p) => p.companyId === where.companyId && p.enabled === where.enabled,
        ),
      upsert: async ({ where, create }) => {
        const key = where.companyId_websiteSiteId;
        const existing = growthProperties.find(
          (p) => p.companyId === key.companyId && p.websiteSiteId === key.websiteSiteId,
        );
        if (existing) return existing;
        const created = { id: key.websiteSiteId, enabled: true, ...create };
        growthProperties.push(created);
        return created;
      },
    },
    instanceConfig: {
      findUnique: async () => ({ value: "2026-06-13" }),
    },
    growthDailyMetric: {
      findMany: async ({ where }) =>
        rows.filter(
          (row) =>
            row.companyId === where.companyId &&
            (!where.siteId || row.siteId === where.siteId) &&
            row.metricDate >= where.metricDate.gte &&
            row.metricDate < where.metricDate.lt,
        ),
    },
    $queryRaw: async () => [],
  };
}

describe("createGrowthAnalyticsService", () => {
  it("lists only enabled sites from the active company", async () => {
    const service = createGrowthAnalyticsService({ prisma: createPrisma() });
    const result = await service.listSites({ companyId: COMPANY_ID });

    assert.deepEqual(result, [
      {
        id: SITE_ID,
        name: "Sitio principal",
        domain: "example.com",
        kind: "website_module",
        status: "active",
      },
    ]);
  });

  it("returns overview totals with preceding-period comparison", async () => {
    const service = createGrowthAnalyticsService({
      prisma: createPrisma(),
      now: () => new Date("2026-06-14T12:00:00.000Z"),
    });

    const result = await service.getOverview({
      companyId: COMPANY_ID,
      query: {
        from: "2026-06-13",
        to: "2026-06-13",
        compare: true,
        siteId: SITE_ID,
      },
    });

    assert.equal(result.totals.sessions, 10);
    assert.equal(result.totals.engagedSessions, 7);
    assert.equal(result.totals.bounces, 3);
    assert.equal(result.totals.conversionRate, 10);
    assert.equal(result.comparisonTotals.sessions, 6);
    assert.equal(result.deltas.sessions.absolute, 4);
  });

  it("groups acquisition and landing performance", async () => {
    const service = createGrowthAnalyticsService({ prisma: createPrisma() });
    const result = await service.getAcquisition({
      companyId: COMPANY_ID,
      query: {
        from: "2026-06-13",
        to: "2026-06-13",
        siteId: SITE_ID,
      },
    });

    assert.equal(result.rows[0].source, "google");
    assert.equal(result.rows[0].sessions, 6);
    assert.equal(result.rows[0].conversionRate, 33.33);
    assert.equal(result.landingPages[0].path, "/inicio");
  });

  it("returns zero totals and empty series for ranges without data", async () => {
    const service = createGrowthAnalyticsService({ prisma: createPrisma() });
    const result = await service.getOverview({
      companyId: COMPANY_ID,
      query: {
        from: "2026-06-11",
        to: "2026-06-11",
        siteId: SITE_ID,
      },
    });

    assert.equal(result.totals.sessions, 0);
    assert.deepEqual(result.series, []);
  });

  it("returns page and CTA metrics with CTR", async () => {
    const service = createGrowthAnalyticsService({ prisma: createPrisma() });
    const result = await service.getContent({
      companyId: COMPANY_ID,
      query: {
        from: "2026-06-13",
        to: "2026-06-13",
        siteId: SITE_ID,
      },
    });

    assert.equal(result.rows[0].path, "/precios");
    assert.equal(result.ctas[0].key, "quote_click");
    assert.equal(result.ctas[0].ctr, 25);
  });

  it("returns the fixed funnel and retention cohorts", async () => {
    const service = createGrowthAnalyticsService({ prisma: createPrisma() });
    const conversions = await service.getConversions({
      companyId: COMPANY_ID,
      query: {
        from: "2026-06-13",
        to: "2026-06-13",
        siteId: SITE_ID,
      },
    });
    assert.deepEqual(
      conversions.funnel.map((step) => step.count),
      [10, 8, 7, 6, 4, 2],
    );
    assert.equal(conversions.campaigns[0].campaign, "summer");

    const retention = await service.getRetention({
      companyId: COMPANY_ID,
      query: {
        from: "2026-06-12",
        to: "2026-06-13",
        siteId: SITE_ID,
      },
    });
    assert.equal(retention.rows[0].d1Rate, 40);
    assert.equal(retention.rows[0].d30Rate, 10);
    assert.deepEqual(retention.series[0], {
      date: "2026-06-12",
      newVisitors: 3,
      returningVisitors: 2,
    });
    assert.equal(retention.cohortSeries[0].d7Rate, 20);
  });

  it("merges every analytics dimension from the raw tail after watermark", async () => {
    const prisma = createPrisma();
    prisma.$queryRaw = async () => [
      metric("2026-06-14", "site", "", {
        visitors: 3,
        sessions: 4,
        engagedSessions: 3,
        pageviews: 8,
      }),
      metric("2026-06-14", "source", "newsletter|email|june", {
        source: "newsletter",
        medium: "email",
        campaign: "june",
        sessions: 4,
        engagedSessions: 3,
        conversions: 1,
      }),
      metric("2026-06-14", "page", "/oferta", {
        pageviews: 8,
        visitors: 3,
      }),
      metric("2026-06-14", "cta", "offer_click", {
        label: "Ver oferta",
        placement: "hero",
        clicks: 2,
        visitors: 2,
      }),
      metric("2026-06-14", "funnel", "form_view", { count: 3 }),
      metric("2026-06-14", "funnel", "form_start", { count: 2 }),
      metric("2026-06-14", "funnel", "form_submit", { count: 1 }),
    ];
    const service = createGrowthAnalyticsService({ prisma });
    const query = {
      from: "2026-06-14",
      to: "2026-06-14",
      siteId: SITE_ID,
    };

    const acquisition = await service.getAcquisition({
      companyId: COMPANY_ID,
      query,
    });
    const content = await service.getContent({ companyId: COMPANY_ID, query });
    const conversions = await service.getConversions({
      companyId: COMPANY_ID,
      query,
    });

    assert.equal(acquisition.rows[0].source, "newsletter");
    assert.equal(content.rows[0].path, "/oferta");
    assert.equal(content.ctas[0].clicks, 2);
    assert.deepEqual(
      conversions.funnel.slice(0, 3).map((step) => step.count),
      [3, 2, 1],
    );
  });

  it("rejects a site outside the active company", async () => {
    const service = createGrowthAnalyticsService({ prisma: createPrisma() });
    await assert.rejects(
      () =>
        service.getOverview({
          companyId: OTHER_COMPANY_ID,
          query: {
            from: "2026-06-13",
            to: "2026-06-13",
            siteId: SITE_ID,
          },
        }),
      (error) =>
        error instanceof GrowthAnalyticsServiceError &&
        error.code === "analytics_site_not_found",
    );
  });
});
