const DAY_MS = 24 * 60 * 60 * 1000;

export const ANALYTICS_TABS = [
  { value: "overview", label: "Resumen" },
  { value: "acquisition", label: "Adquisicion" },
  { value: "content", label: "Contenido y CTA" },
  { value: "conversions", label: "Conversiones" },
  { value: "retention", label: "Retencion D1/D7/D30" },
];

export const ANALYTICS_RANGE_OPTIONS = [
  { value: "today", label: "Hoy" },
  { value: "7", label: "Ultimos 7 dias" },
  { value: "30", label: "Ultimos 30 dias" },
  { value: "90", label: "Ultimos 90 dias" },
  { value: "custom", label: "Rango personalizado" },
];

const TAB_KEYS = new Set(ANALYTICS_TABS.map((tab) => tab.value));
const RANGE_KEYS = new Set(ANALYTICS_RANGE_OPTIONS.map((range) => range.value));

function dateKey(value) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: growth analytics buckets by UTC day (matches the backend workers/service)
  return value.toISOString().slice(0, 10);
}

function presetDates(days, now) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const to = new Date(today.getTime() - DAY_MS);
  return {
    from: dateKey(new Date(to.getTime() - (days - 1) * DAY_MS)),
    to: dateKey(to),
  };
}

// Unlike the 7/30/90-day presets (which deliberately end yesterday, so
// trend charts never mix in a still-accumulating day), "today" exists
// specifically to check whether events are landing right now.
function todayDates(now) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const key = dateKey(today);
  return { from: key, to: key };
}

export function resolveAnalyticsFilters(searchParams, now = new Date()) {
  const requestedRange = searchParams.get("range") ?? "30";
  const range = RANGE_KEYS.has(requestedRange) ? requestedRange : "30";
  const defaults =
    range === "today"
      ? todayDates(now)
      : presetDates(range === "custom" ? 30 : Number(range), now);
  const requestedTab = searchParams.get("tab") ?? "overview";

  return {
    tab: TAB_KEYS.has(requestedTab) ? requestedTab : "overview",
    range,
    from:
      range === "custom"
        ? searchParams.get("from") || defaults.from
        : defaults.from,
    to:
      range === "custom"
        ? searchParams.get("to") || defaults.to
        : defaults.to,
    siteId: searchParams.get("siteId") ?? "",
    compare: searchParams.get("compare") === "true",
  };
}

export function buildAnalyticsQuery(filters) {
  return {
    from: filters.from,
    to: filters.to,
    compare: Boolean(filters.compare),
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
  };
}

export function formatAnalyticsNumber(value) {
  return Number(value ?? 0).toLocaleString("es-MX");
}

export function formatAnalyticsPercent(value) {
  return `${Number(value ?? 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  })}%`;
}
