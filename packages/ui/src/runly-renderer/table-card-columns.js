// Shared column roles + text formatting for RunlyTable's list ("cards") and
// grid views, so both pick the same title/photo/status columns.
import { stripMarkdown } from "./renderer-adapters.js";
import { formatTableDate } from "../lib/utils.js";

const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
  draft: "Borrador",
  finalized: "Finalizado",
};

export const isImageColumn = (col) => col?.type === "image" || col?.type === "image-asset";

export function getByPath(input, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), input);
}

// The title is the link column (the record's name), never the photo column —
// an image-asset column holds a file id, not something to read.
export function pickCardColumns(columns, subtitleField = null) {
  const image = columns.find(isImageColumn) ?? null;
  const color = columns.find((c) => c.type === "color") ?? null;
  const status = columns.find((c) => /^(status|estado|published)$/i.test(c.field)) ?? null;
  const reserved = new Set([image, color, status].filter(Boolean));
  const primary =
    columns.find((c) => c.isLink && !reserved.has(c)) ??
    columns.find((c) => !reserved.has(c)) ??
    null;
  if (primary) reserved.add(primary);
  const subtitle = subtitleField
    ? (columns.find((c) => c.field === subtitleField && !reserved.has(c)) ?? null)
    : null;
  if (subtitle) reserved.add(subtitle);
  const details = columns.filter((c) => !reserved.has(c));
  return { primary, subtitle, status, color, image, details };
}

function renderValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  return STATUS_LABELS[str.toLowerCase()] ?? str;
}

function formatCurrency(value, currencyCode = "MXN") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const code = currencyCode && /^[A-Z]{3}$/.test(String(currencyCode).toUpperCase())
    ? String(currencyCode).toUpperCase()
    : "MXN";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: code }).format(amount);
}

export function formatCellText(col, row) {
  const value = getByPath(row, col?.field);
  if (!col) return "—";
  if (col.type === "date") return formatTableDate(value, false);
  if (col.type === "datetime") return formatTableDate(value, true);
  if (col.type === "currency" || col.type === "decimal") return formatCurrency(value, row?.currency);
  if (col.type === "select" && col.options) {
    const opt = col.options.find((o) => String(o.value) === String(value ?? ""));
    return opt?.label ?? renderValue(value);
  }
  if (col.type === "markdown") return stripMarkdown(value);
  return renderValue(value);
}
