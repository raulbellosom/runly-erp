import {
  GrowthPropertyServiceError,
  createGrowthPropertyService,
} from "./growth-property-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 762;
const FUNNEL_STEPS = [
  ["form_view", "Vista de formulario"],
  ["form_start", "Inicio de formulario"],
  ["form_submit", "Envío de formulario"],
  ["lead_created", "Lead creado"],
  ["qualified", "Calificado"],
  ["converted", "Convertido"],
];

export class GrowthAnalyticsServiceError extends Error {
  constructor(message, status = 400, code = "growth_analytics_error") {
    super(message);
    this.name = "GrowthAnalyticsServiceError";
    this.status = status;
    this.code = code;
  }
}

function utcDate(value, endOfDay = false) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new GrowthAnalyticsServiceError(
      "Rango de fechas inválido.",
      400,
      "analytics_invalid_range",
    );
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new GrowthAnalyticsServiceError(
      "Rango de fechas inválido.",
      400,
      "analytics_invalid_range",
    );
  }
  return endOfDay ? new Date(date.getTime() + DAY_MS) : date;
}

function startOfUtcDay(value) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function parseWatermark(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: growth analytics buckets by UTC day (consistent across workers + service)
  return new Date(value).toISOString().slice(0, 10);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function rate(numerator, denominator) {
  return denominator > 0 ? round((numerator / denominator) * 100) : 0;
}

function numeric(value) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return {};
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );
}

function normalizeRange(query, now) {
  const today = startOfUtcDay(now);
  const defaultTo = new Date(today.getTime() - DAY_MS);
  const toText = query?.to ?? dateKey(defaultTo);
  const fromText =
    query?.from ??
    dateKey(new Date(utcDate(toText).getTime() - 29 * DAY_MS));
  const from = utcDate(fromText);
  const toExclusive = utcDate(toText, true);
  const days = Math.round((toExclusive - from) / DAY_MS);
  if (days < 1 || days > MAX_RANGE_DAYS) {
    throw new GrowthAnalyticsServiceError(
      "El rango debe contener entre 1 día y 25 meses.",
      400,
      "analytics_invalid_range",
    );
  }
  const comparisonFrom = new Date(from.getTime() - days * DAY_MS);
  return {
    from,
    toExclusive,
    range: { from: dateKey(from), to: dateKey(new Date(toExclusive - 1)) },
    comparisonFrom,
    comparisonRange: {
      from: dateKey(comparisonFrom),
      to: dateKey(new Date(from.getTime() - 1)),
    },
  };
}

function mergeByDimension(rows, dimensionType) {
  const grouped = new Map();
  for (const row of rows) {
    if (row.dimensionType !== dimensionType) continue;
    const key = row.dimensionKey ?? "";
    const current = grouped.get(key) ?? {};
    const metrics = normalizeMetrics(row.metrics);
    const next = { ...current };
    for (const [metricKey, value] of Object.entries(metrics)) {
      if (typeof value === "number" || typeof value === "bigint") {
        next[metricKey] = numeric(next[metricKey]) + numeric(value);
      } else if (value != null && value !== "") {
        next[metricKey] = value;
      }
    }
    grouped.set(key, next);
  }
  return grouped;
}

function siteTotals(rows) {
  const totals = [...mergeByDimension(rows, "site").values()].reduce(
    (result, metrics) => {
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === "number") {
          result[key] = numeric(result[key]) + value;
        }
      }
      return result;
    },
    {},
  );
  const sessions = numeric(totals.sessions);
  const engagedSessions = numeric(totals.engagedSessions);
  return {
    visitors: numeric(totals.visitors),
    sessions,
    engagedSessions,
    bounces: Math.max(0, sessions - engagedSessions),
    bounceRate: rate(Math.max(0, sessions - engagedSessions), sessions),
    pageviews: numeric(totals.pageviews),
    visibleSeconds: numeric(totals.visibleSeconds),
    leads: numeric(totals.leads),
    qualified: numeric(totals.qualified),
    converted: numeric(totals.converted),
    conversionRate: rate(numeric(totals.converted), sessions),
  };
}

function deltas(current, previous) {
  const result = {};
  for (const [key, value] of Object.entries(current)) {
    if (typeof value !== "number") continue;
    const prior = numeric(previous[key]);
    result[key] = {
      absolute: round(value - prior),
      percent: prior === 0 ? null : round(((value - prior) / prior) * 100),
    };
  }
  return result;
}

export function createGrowthAnalyticsService({
  prisma,
  now = () => new Date(),
  growthPropertyService = createGrowthPropertyService({ prisma }),
}) {
  async function listSites({ companyId }) {
    const properties = await growthPropertyService.listProperties({ companyId });
    return properties.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      kind: p.kind,
      status: p.status,
    }));
  }

  async function assertSite({ companyId, siteId }) {
    if (!siteId) return;
    try {
      await growthPropertyService.assertProperty({ companyId, propertyId: siteId });
    } catch (error) {
      if (error instanceof GrowthPropertyServiceError) {
        throw new GrowthAnalyticsServiceError(
          "Sitio web no encontrado.",
          404,
          "analytics_site_not_found",
        );
      }
      throw error;
    }
  }

  async function loadTailRows({
    companyId,
    siteId,
    from,
    toExclusive,
  }) {
    if (from >= toExclusive) return [];
    const rows = await prisma.$queryRaw`
      WITH
      sessions AS (
        SELECT *, started_at::date AS metric_date
        FROM growth_session
        WHERE company_id = ${companyId}::uuid
          AND (${siteId ?? null}::uuid IS NULL OR site_id = ${siteId ?? null}::uuid)
          AND started_at >= ${from} AND started_at < ${toExclusive}
      ),
      events AS (
        SELECT *, server_received_at::date AS metric_date
        FROM growth_event
        WHERE company_id = ${companyId}::uuid
          AND (${siteId ?? null}::uuid IS NULL OR site_id = ${siteId ?? null}::uuid)
          AND server_received_at >= ${from}
          AND server_received_at < ${toExclusive}
          AND consent_state <> 'denied'
      ),
      leads AS (
        SELECT *, created_at::date AS metric_date
        FROM growth_lead
        WHERE company_id = ${companyId}::uuid
          AND (${siteId ?? null}::uuid IS NULL OR site_id = ${siteId ?? null}::uuid)
          AND created_at >= ${from}
          AND created_at < ${toExclusive}
          AND enabled = true
      ),
      site_keys AS (
        SELECT company_id, site_id, metric_date FROM sessions
        UNION
        SELECT company_id, site_id, metric_date FROM events
        UNION
        SELECT company_id, site_id, metric_date FROM leads
      ),
      site_rows AS (
        SELECT
          site_keys.company_id AS "companyId",
          site_keys.site_id AS "siteId",
          site_keys.metric_date AS "metricDate",
          'site'::text AS "dimensionType",
          ''::text AS "dimensionKey",
          jsonb_build_object(
            'visitors', (
              SELECT COUNT(DISTINCT visitor_id) FROM events event
              WHERE event.site_id = site_keys.site_id
                AND event.metric_date = site_keys.metric_date
            ),
            'newVisitors', (
              SELECT COUNT(*) FROM growth_visitor visitor
              WHERE visitor.company_id = ${companyId}::uuid
                AND visitor.site_id = site_keys.site_id
                AND visitor.first_seen_at::date = site_keys.metric_date
                AND visitor.consent_state <> 'denied'
            ),
            'returningVisitors', (
              SELECT COUNT(DISTINCT event.visitor_id)
              FROM events event
              JOIN growth_visitor visitor ON visitor.id = event.visitor_id
              WHERE event.site_id = site_keys.site_id
                AND event.metric_date = site_keys.metric_date
                AND visitor.first_seen_at::date < site_keys.metric_date
            ),
            'sessions', (
              SELECT COUNT(*) FROM sessions session
              WHERE session.site_id = site_keys.site_id
                AND session.metric_date = site_keys.metric_date
            ),
            'engagedSessions', (
              SELECT COUNT(*) FROM sessions session
              WHERE session.site_id = site_keys.site_id
                AND session.metric_date = site_keys.metric_date
                AND session.engaged = true
            ),
            'pageviews', (
              SELECT COUNT(*) FROM events event
              WHERE event.site_id = site_keys.site_id
                AND event.metric_date = site_keys.metric_date
                AND event.event_name = 'page_view'
            ),
            'visibleSeconds', (
              SELECT COALESCE(SUM(visible_seconds), 0) FROM sessions session
              WHERE session.site_id = site_keys.site_id
                AND session.metric_date = site_keys.metric_date
            ),
            'leads', (
              SELECT COUNT(*) FROM leads lead
              WHERE lead.site_id = site_keys.site_id
                AND lead.metric_date = site_keys.metric_date
            ),
            'qualified', (
              SELECT COUNT(*) FROM growth_lead lead
              WHERE lead.company_id = ${companyId}::uuid
                AND lead.site_id = site_keys.site_id
                AND lead.qualified_at::date = site_keys.metric_date
            ),
            'converted', (
              SELECT COUNT(*) FROM growth_lead lead
              WHERE lead.company_id = ${companyId}::uuid
                AND lead.site_id = site_keys.site_id
                AND lead.converted_at::date = site_keys.metric_date
            )
          ) AS metrics
        FROM site_keys
      ),
      source_rows AS (
        SELECT
          company_id AS "companyId",
          site_id AS "siteId",
          metric_date AS "metricDate",
          'source'::text AS "dimensionType",
          CONCAT_WS('|',
            COALESCE(NULLIF(utm_source, ''), 'direct'),
            COALESCE(NULLIF(utm_medium, ''), 'none'),
            COALESCE(NULLIF(utm_campaign, ''), 'none')
          ) AS "dimensionKey",
          jsonb_build_object(
            'sessions', COUNT(*),
            'engagedSessions', COUNT(*) FILTER (WHERE engaged = true),
            'conversions', COUNT(*) FILTER (WHERE has_conversion = true),
            'source', COALESCE(NULLIF(utm_source, ''), 'Directo'),
            'medium', COALESCE(NULLIF(utm_medium, ''), 'Sin medio'),
            'campaign', COALESCE(NULLIF(utm_campaign, ''), 'Sin campana')
          ) AS metrics
        FROM sessions
        GROUP BY
          company_id, site_id, metric_date,
          utm_source, utm_medium, utm_campaign
      ),
      landing_rows AS (
        SELECT
          company_id AS "companyId",
          site_id AS "siteId",
          metric_date AS "metricDate",
          'landing'::text AS "dimensionType",
          COALESCE(NULLIF(landing_path, ''), '/') AS "dimensionKey",
          jsonb_build_object(
            'sessions', COUNT(*),
            'engagedSessions', COUNT(*) FILTER (WHERE engaged = true),
            'conversions', COUNT(*) FILTER (WHERE has_conversion = true)
          ) AS metrics
        FROM sessions
        GROUP BY
          company_id, site_id, metric_date,
          COALESCE(NULLIF(landing_path, ''), '/')
      ),
      page_rows AS (
        SELECT
          company_id AS "companyId",
          site_id AS "siteId",
          metric_date AS "metricDate",
          'page'::text AS "dimensionType",
          COALESCE(NULLIF(path, ''), '/') AS "dimensionKey",
          jsonb_build_object(
            'pageviews', COUNT(*),
            'visitors', COUNT(DISTINCT visitor_id)
          ) AS metrics
        FROM events
        WHERE event_name = 'page_view'
        GROUP BY
          company_id, site_id, metric_date,
          COALESCE(NULLIF(path, ''), '/')
      ),
      cta_rows AS (
        SELECT
          company_id AS "companyId",
          site_id AS "siteId",
          metric_date AS "metricDate",
          'cta'::text AS "dimensionType",
          event_name AS "dimensionKey",
          jsonb_build_object(
            'clicks', COUNT(*),
            'visitors', COUNT(DISTINCT visitor_id),
            'label', MAX(properties->>'label'),
            'placement', MAX(properties->>'placement')
          ) AS metrics
        FROM events
        WHERE event_name NOT IN (
          'page_view', 'visible_time', 'form_view', 'form_start',
          'form_submit', 'form_submit_error', 'lead_created',
          'qualified', 'converted'
        )
        GROUP BY company_id, site_id, metric_date, event_name
      ),
      form_rows AS (
        SELECT
          company_id AS "companyId",
          site_id AS "siteId",
          metric_date AS "metricDate",
          'form'::text AS "dimensionType",
          form_id::text AS "dimensionKey",
          jsonb_build_object(
            'views', COUNT(*) FILTER (WHERE event_name = 'form_view'),
            'starts', COUNT(*) FILTER (WHERE event_name = 'form_start'),
            'submits', COUNT(*) FILTER (WHERE event_name = 'form_submit')
          ) AS metrics
        FROM events
        WHERE form_id IS NOT NULL
          AND event_name IN ('form_view', 'form_start', 'form_submit')
        GROUP BY company_id, site_id, metric_date, form_id
      ),
      funnel_events AS (
        SELECT
          company_id,
          site_id,
          metric_date,
          event_name AS step,
          COUNT(*) AS count
        FROM events
        WHERE event_name IN (
          'form_view', 'form_start', 'form_submit', 'lead_created'
        )
        GROUP BY company_id, site_id, metric_date, event_name
        UNION ALL
        SELECT
          company_id,
          site_id,
          qualified_at::date,
          'qualified',
          COUNT(*)
        FROM growth_lead
        WHERE company_id = ${companyId}::uuid
          AND (${siteId ?? null}::uuid IS NULL OR site_id = ${siteId ?? null}::uuid)
          AND qualified_at >= ${from}
          AND qualified_at < ${toExclusive}
        GROUP BY company_id, site_id, qualified_at::date
        UNION ALL
        SELECT
          company_id,
          site_id,
          converted_at::date,
          'converted',
          COUNT(*)
        FROM growth_lead
        WHERE company_id = ${companyId}::uuid
          AND (${siteId ?? null}::uuid IS NULL OR site_id = ${siteId ?? null}::uuid)
          AND converted_at >= ${from}
          AND converted_at < ${toExclusive}
        GROUP BY company_id, site_id, converted_at::date
      ),
      funnel_rows AS (
        SELECT
          company_id AS "companyId",
          site_id AS "siteId",
          metric_date AS "metricDate",
          'funnel'::text AS "dimensionType",
          step AS "dimensionKey",
          jsonb_build_object('count', SUM(count)) AS metrics
        FROM funnel_events
        GROUP BY company_id, site_id, metric_date, step
      ),
      retention_rows AS (
        SELECT
          visitor.company_id AS "companyId",
          visitor.site_id AS "siteId",
          visitor.first_seen_at::date AS "metricDate",
          'retention'::text AS "dimensionType",
          visitor.first_seen_at::date::text AS "dimensionKey",
          jsonb_build_object(
            'cohortVisitors', COUNT(DISTINCT visitor.id),
            'd1', COUNT(DISTINCT visitor.id) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM growth_session session
                WHERE session.visitor_id = visitor.id
                  AND session.started_at::date =
                    visitor.first_seen_at::date + 1
              )
            ),
            'd7', COUNT(DISTINCT visitor.id) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM growth_session session
                WHERE session.visitor_id = visitor.id
                  AND session.started_at::date =
                    visitor.first_seen_at::date + 7
              )
            ),
            'd30', COUNT(DISTINCT visitor.id) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM growth_session session
                WHERE session.visitor_id = visitor.id
                  AND session.started_at::date =
                    visitor.first_seen_at::date + 30
              )
            )
          ) AS metrics
        FROM growth_visitor visitor
        WHERE visitor.company_id = ${companyId}::uuid
          AND (${siteId ?? null}::uuid IS NULL OR visitor.site_id = ${siteId ?? null}::uuid)
          AND visitor.first_seen_at >= ${from}
          AND visitor.first_seen_at < ${toExclusive}
          AND visitor.consent_state <> 'denied'
        GROUP BY
          visitor.company_id,
          visitor.site_id,
          visitor.first_seen_at::date
      )
      SELECT * FROM site_rows
      UNION ALL SELECT * FROM source_rows
      UNION ALL SELECT * FROM landing_rows
      UNION ALL SELECT * FROM page_rows
      UNION ALL SELECT * FROM cta_rows
      UNION ALL SELECT * FROM form_rows
      UNION ALL SELECT * FROM funnel_rows
      UNION ALL SELECT * FROM retention_rows
    `;
    return rows.map((row) => ({
      ...row,
      metricDate: new Date(row.metricDate),
      metrics: normalizeMetrics(row.metrics),
    }));
  }

  async function loadRows({ companyId, query, rangeOverride }) {
    const normalized = rangeOverride ?? normalizeRange(query, now());
    await assertSite({ companyId, siteId: query?.siteId });
    const watermarkRow = await prisma.instanceConfig.findUnique({
      where: { key: "growth.analytics.watermark" },
    });
    const watermark = parseWatermark(watermarkRow?.value);
    const aggregateEnd = watermark
      ? new Date(
          Math.min(
            normalized.toExclusive.getTime(),
            watermark.getTime() + DAY_MS,
          ),
        )
      : normalized.from;
    const aggregateRows =
      aggregateEnd > normalized.from
        ? await prisma.growthDailyMetric.findMany({
            where: {
              companyId,
              ...(query?.siteId ? { siteId: query.siteId } : {}),
              metricDate: {
                gte: normalized.from,
                lt: aggregateEnd,
              },
            },
            orderBy: [
              { metricDate: "asc" },
              { dimensionType: "asc" },
              { dimensionKey: "asc" },
            ],
          })
        : [];
    const tailStart = new Date(
      Math.max(normalized.from.getTime(), aggregateEnd.getTime()),
    );
    const tailRows = await loadTailRows({
      companyId,
      siteId: query?.siteId,
      from: tailStart,
      toExclusive: normalized.toExclusive,
    });
    return {
      normalized,
      rows: [...aggregateRows, ...tailRows],
    };
  }

  function seriesFor(rows) {
    const byDate = new Map();
    for (const row of rows) {
      if (row.dimensionType !== "site") continue;
      const key = dateKey(row.metricDate);
      const current = byDate.get(key) ?? { date: key };
      for (const [metricKey, value] of Object.entries(
        normalizeMetrics(row.metrics),
      )) {
        if (typeof value === "number") {
          current[metricKey] = numeric(current[metricKey]) + value;
        }
      }
      byDate.set(key, current);
    }
    return [...byDate.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
  }

  async function getOverview({ companyId, query = {} }) {
    const current = await loadRows({ companyId, query });
    const totals = siteTotals(current.rows);
    const result = {
      range: current.normalized.range,
      totals,
      series: seriesFor(current.rows),
      rows: [],
    };
    if (query.compare === true || query.compare === "true") {
      const previousToExclusive = current.normalized.from;
      const previous = await loadRows({
        companyId,
        query: { ...query, compare: false },
        rangeOverride: {
          from: current.normalized.comparisonFrom,
          toExclusive: previousToExclusive,
          range: current.normalized.comparisonRange,
        },
      });
      result.comparisonRange = current.normalized.comparisonRange;
      result.comparisonTotals = siteTotals(previous.rows);
      result.deltas = deltas(totals, result.comparisonTotals);
    }
    return result;
  }

  async function getAcquisition({ companyId, query = {} }) {
    const loaded = await loadRows({ companyId, query });
    const rows = [...mergeByDimension(loaded.rows, "source")]
      .map(([key, metrics]) => ({
        key,
        source: metrics.source ?? "Directo",
        medium: metrics.medium ?? "Sin medio",
        campaign: metrics.campaign ?? "Sin campaña",
        sessions: numeric(metrics.sessions),
        engagedSessions: numeric(metrics.engagedSessions),
        conversions: numeric(metrics.conversions),
        conversionRate: rate(metrics.conversions, metrics.sessions),
      }))
      .sort((left, right) => right.sessions - left.sessions);
    const landingPages = [...mergeByDimension(loaded.rows, "landing")]
      .map(([path, metrics]) => ({
        path,
        sessions: numeric(metrics.sessions),
        engagedSessions: numeric(metrics.engagedSessions),
        conversions: numeric(metrics.conversions),
        conversionRate: rate(metrics.conversions, metrics.sessions),
      }))
      .sort((left, right) => right.sessions - left.sessions);
    return {
      range: loaded.normalized.range,
      totals: siteTotals(loaded.rows),
      series: seriesFor(loaded.rows),
      rows,
      landingPages,
    };
  }

  async function getContent({ companyId, query = {} }) {
    const loaded = await loadRows({ companyId, query });
    const totals = siteTotals(loaded.rows);
    const rows = [...mergeByDimension(loaded.rows, "page")]
      .map(([path, metrics]) => ({
        path,
        pageviews: numeric(metrics.pageviews),
        visitors: numeric(metrics.visitors),
      }))
      .sort((left, right) => right.pageviews - left.pageviews);
    const ctas = [...mergeByDimension(loaded.rows, "cta")]
      .map(([key, metrics]) => ({
        key,
        label: metrics.label ?? key,
        placement: metrics.placement ?? null,
        clicks: numeric(metrics.clicks),
        visitors: numeric(metrics.visitors),
        ctr: rate(metrics.clicks, totals.pageviews),
      }))
      .sort((left, right) => right.clicks - left.clicks);
    return {
      range: loaded.normalized.range,
      totals,
      series: seriesFor(loaded.rows),
      rows,
      ctas,
    };
  }

  async function getConversions({ companyId, query = {} }) {
    const loaded = await loadRows({ companyId, query });
    const funnelMetrics = mergeByDimension(loaded.rows, "funnel");
    let eligible = Number.POSITIVE_INFINITY;
    const funnel = FUNNEL_STEPS.map(([key, label]) => {
      const rawCount = numeric(funnelMetrics.get(key)?.count);
      const count = Math.min(eligible, rawCount);
      eligible = count;
      return { key, label, count };
    });
    const rows = [...mergeByDimension(loaded.rows, "form")]
      .map(([formId, metrics]) => ({
        formId,
        views: numeric(metrics.views),
        starts: numeric(metrics.starts),
        submits: numeric(metrics.submits),
        completionRate: rate(metrics.submits, metrics.starts),
      }))
      .sort((left, right) => right.views - left.views);
    const campaigns = [...mergeByDimension(loaded.rows, "source")]
      .map(([key, metrics]) => ({
        key,
        source: metrics.source ?? "Directo",
        campaign: metrics.campaign ?? "Sin campana",
        sessions: numeric(metrics.sessions),
        conversions: numeric(metrics.conversions),
        conversionRate: rate(metrics.conversions, metrics.sessions),
      }))
      .filter((row) => row.conversions > 0)
      .sort((left, right) => right.conversions - left.conversions);
    return {
      range: loaded.normalized.range,
      totals: siteTotals(loaded.rows),
      series: seriesFor(loaded.rows),
      rows,
      funnel,
      campaigns,
    };
  }

  async function getRetention({ companyId, query = {} }) {
    const loaded = await loadRows({ companyId, query });
    const rows = [...mergeByDimension(loaded.rows, "retention")]
      .map(([cohortDate, metrics]) => ({
        cohortDate,
        cohortVisitors: numeric(metrics.cohortVisitors),
        d1: numeric(metrics.d1),
        d7: numeric(metrics.d7),
        d30: numeric(metrics.d30),
        d1Rate: rate(metrics.d1, metrics.cohortVisitors),
        d7Rate: rate(metrics.d7, metrics.cohortVisitors),
        d30Rate: rate(metrics.d30, metrics.cohortVisitors),
      }))
      .sort((left, right) => left.cohortDate.localeCompare(right.cohortDate));
    return {
      range: loaded.normalized.range,
      totals: {
        cohorts: rows.length,
        visitors: rows.reduce(
          (sum, row) => sum + row.cohortVisitors,
          0,
        ),
      },
      series: seriesFor(loaded.rows).map((row) => ({
        date: row.date,
        newVisitors: numeric(row.newVisitors),
        returningVisitors: numeric(row.returningVisitors),
      })),
      cohortSeries: rows.map((row) => ({
        date: row.cohortDate,
        d1Rate: row.d1Rate,
        d7Rate: row.d7Rate,
        d30Rate: row.d30Rate,
      })),
      rows,
    };
  }

  return {
    listSites,
    getOverview,
    getAcquisition,
    getContent,
    getConversions,
    getRetention,
  };
}
