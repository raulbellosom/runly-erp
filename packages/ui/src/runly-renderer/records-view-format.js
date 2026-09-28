// Value formatting for the records views (CARDS / CALENDAR / TIMELINE /
// REPORT), driven by the `fields` display metadata the records-view query
// returns (name, label, type, options).

const currency = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

export function fieldMap(fields) {
  return new Map((fields ?? []).map((field) => [field.name, field]));
}

// "YYYY-MM-DD" (date columns) must be read as a LOCAL day; new Date(str)
// would parse it as UTC midnight and shift it to the previous day in MX.
export function toLocalDate(value) {
  if (value == null || value === "") return null;
  const str = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.slice(0, 10));
  if (match && str.length <= 10) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function optionLabel(field, value) {
  const option = (field?.options ?? []).find((o) => String(typeof o === "object" && o !== null ? o.value : o) === String(value));
  if (option == null) return String(value);
  return typeof option === "object" ? option.label ?? String(option.value) : String(option);
}

export function formatFieldValue(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  switch (field?.type) {
    case "boolean": return value ? "Sí" : "No";
    case "decimal": return currency.format(Number(value));
    case "number": return number.format(Number(value));
    case "date": { const d = toLocalDate(value); return d ? dateFmt.format(d) : String(value); }
    case "datetime": { const d = toLocalDate(value); return d ? `${dateFmt.format(d)} ${timeFmt.format(d)}` : String(value); }
    case "select": return optionLabel(field, value);
    case "multiselect": return (Array.isArray(value) ? value : [value]).map((v) => optionLabel(field, v)).join(", ");
    case "markdown":
    case "richtext": return String(value).replace(/<[^>]+>/g, " ").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
    default: return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

export function formatMeasure(measure, field, value) {
  if (value === null || value === undefined) return "—";
  if (measure.aggregate === "count") return number.format(Number(value));
  if (field?.type === "decimal") return currency.format(Number(value));
  return number.format(Number(value));
}

// Stable accent per select option / boolean so a value keeps its color
// across calendar chips, badges and legends.
const ACCENTS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

export function accentFor(field, value) {
  if (value === null || value === undefined) return "#94a3b8";
  if (field?.type === "boolean") return value ? ACCENTS[1] : "#94a3b8";
  const index = (field?.options ?? []).findIndex((o) => String(typeof o === "object" && o !== null ? o.value : o) === String(value));
  return ACCENTS[(index < 0 ? 0 : index) % ACCENTS.length];
}
