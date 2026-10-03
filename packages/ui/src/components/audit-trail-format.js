// Pure helpers for AuditTrail: field labels, value formatting and summary
// splitting (spec 2026-10-03-audit-trail-design §4). No React here so they
// can be unit-tested with node --test.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

// "warrantyExpiry" / "warranty_expiry" -> "Warranty expiry".
export function humanizeField(field) {
  const words = String(field ?? "")
    .replace(/__label$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Campo";
}

export function fieldMetaFor(changeLabels, field) {
  const meta = changeLabels?.[field] ?? changeLabels?.[`${field}__label`] ?? null;
  return { label: meta?.label ?? humanizeField(field), type: meta?.type ?? null, options: meta?.options ?? null };
}

function formatDate(value, withTime) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  // A bare YYYY-MM-DD is a calendar date: render it without timezone shift.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split("-");
    return `${day}/${m}/${y}`;
  }
  return withTime
    ? d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
    : d.toLocaleDateString("es-MX");
}

export function formatAuditValue(value, meta = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const type = meta?.type ?? null;
  if (type === "select" && Array.isArray(meta.options)) {
    const option = meta.options.find((o) => String(o.value) === String(value));
    if (option?.label) return option.label;
  }
  if (type === "boolean" || typeof value === "boolean") {
    if (value === true || value === "true") return "Sí";
    if (value === false || value === "false") return "No";
  }
  if (type === "currency") {
    const n = Number(value);
    if (Number.isFinite(n)) return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
  }
  if (type === "date" || type === "datetime") return formatDate(value, type === "datetime");
  const str = String(value);
  if (UUID_RE.test(str)) return "otro registro";
  if (!type && ISO_DATE_RE.test(str)) return formatDate(str, str.includes("T") && !/T00:00:00(\.0+)?Z$/.test(str));
  return str;
}

export function actorDisplayName(actor) {
  if (!actor) return "Sistema";
  return actor.displayName || [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() || "Sistema";
}

// Summaries start with the actor name ("Raul actualizó el activo X"); the
// trail renders the name bold, so it is split off when present.
export function splitSummary(summary, actorName) {
  const text = String(summary ?? "").trim();
  if (actorName && text.toLowerCase().startsWith(actorName.toLowerCase())) {
    return text.slice(actorName.length).trim();
  }
  return text;
}

export function formatRelativeTime(date, now = Date.now()) {
  const d = date instanceof Date ? date : new Date(date);
  const sec = Math.round((now - d.getTime()) / 1000);
  if (sec < 60) return "hace unos segundos";
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

// One-line plain preview of a value that may hold markdown: drops headings,
// list/task markers, emphasis and link syntax, and collapses whitespace.
export function plainPreview(text) {
  return String(text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/\[[ xX]\]\s*/g, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Long or markdown-looking text renders as markdown in the detail modal.
export function isRichValue(value, meta = {}) {
  if (meta?.type === "markdown" || meta?.type === "textarea" || meta?.type === "richtext") return true;
  const str = String(value ?? "");
  return str.includes("\n") || /(^|\s)(#{1,6}\s|[-*+]\s|\d+\.\s|\[[ xX]\]|\*\*)/.test(str);
}
