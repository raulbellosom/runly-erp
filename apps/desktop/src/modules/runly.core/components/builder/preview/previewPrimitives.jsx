// Shared building blocks for the Module Builder preview: type-aware value
// rendering (so a preview reads like the real screen instead of raw JSON),
// plus the caption/frame chrome every preview view sits in.
import { Badge } from "@runly/ui";
import { Check, Link2, Minus, Paperclip, X } from "lucide-react";
import { FIELD_TYPE_ICONS, DEFAULT_FIELD_ICON } from "../../../lib/builderFieldIcons";

const currency = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const integer = new Intl.NumberFormat("es-MX");
const dateFmt = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const NUMERIC_TYPES = new Set(["number", "decimal"]);
export const WIDE_TYPES = new Set(["textarea", "markdown", "richtext", "json", "file"]);

export function fieldIcon(type) {
  return FIELD_TYPE_ICONS[type] ?? DEFAULT_FIELD_ICON;
}

export function optionLabel(field, value) {
  const option = (field.options ?? []).find((o) => (typeof o === "string" ? o : o.value) === value);
  if (!option) return String(value);
  return typeof option === "string" ? option : option.label ?? option.value;
}

// "YYYY-MM-DD" must be parsed as a local date; new Date(string) would read
// it as UTC midnight and can render the previous day.
function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
}

function plainText(value) {
  return String(value).replace(/<[^>]+>/g, " ").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
}

// Plain-string rendering, used where only text fits (kanban titles, lists).
export function formatPlain(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  switch (field?.type) {
    case "boolean": return value ? "Sí" : "No";
    case "decimal": return currency.format(Number(value));
    case "number": return integer.format(Number(value));
    case "date": return dateFmt.format(parseLocalDate(value));
    case "datetime": return dateTimeFmt.format(new Date(value));
    case "select": return optionLabel(field, value);
    case "multiselect": return (value ?? []).map((v) => optionLabel(field, v)).join(", ");
    case "relation": return value.label ?? String(value.id ?? "");
    case "markdown":
    case "richtext": return plainText(value);
    case "json": return JSON.stringify(value);
    default: return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

export function FieldValue({ field, value, compact = false }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    if (field.type === "file") {
      return (
        <span className="inline-flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
          <Paperclip className="h-3.5 w-3.5" />
          Sin archivo
        </span>
      );
    }
    return <Minus className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-label="Vacío" />;
  }

  switch (field.type) {
    case "boolean":
      return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${value ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
          {value ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          {value ? "Sí" : "No"}
        </span>
      );
    case "select":
      return <Badge variant="secondary" className="font-medium">{optionLabel(field, value)}</Badge>;
    case "multiselect":
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((v) => <Badge key={v} variant="secondary">{optionLabel(field, v)}</Badge>)}
        </span>
      );
    case "decimal":
    case "number":
      return <span className="tabular-nums">{formatPlain(field, value)}</span>;
    case "color":
      return (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 rounded-md border border-[hsl(var(--border))]" style={{ backgroundColor: value }} />
          <span className="font-mono text-xs">{value}</span>
        </span>
      );
    case "email":
      return <span className="text-(--brand-primary) truncate">{value}</span>;
    case "relation":
      return (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[hsl(var(--muted))] px-2 py-0.5 text-xs">
          <Link2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{formatPlain(field, value)}</span>
        </span>
      );
    case "json":
      return <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-xs">{JSON.stringify(value)}</code>;
    case "textarea":
    case "markdown":
    case "richtext":
      return <span className={compact ? "line-clamp-1" : "line-clamp-3"}>{formatPlain(field, value)}</span>;
    default:
      return <span className={compact ? "truncate" : "break-words"}>{formatPlain(field, value)}</span>;
  }
}

// One-line explanation of where this view appears in the installed module,
// so users understand what they are looking at.
export function PreviewCaption({ icon: Icon, title, children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-[hsl(var(--muted))]/60 px-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
      <div className="min-w-0 text-xs leading-relaxed">
        <p className="font-medium text-[hsl(var(--foreground))]">{title}</p>
        <p className="text-[hsl(var(--muted-foreground))]">{children}</p>
      </div>
    </div>
  );
}

// Surface the rendered view sits on: an opaque card so the preview reads as
// a real screen on top of the sheet's glass background.
export function PreviewSurface({ children, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function recordTitle(entity, row) {
  const titleField = (entity?.fields ?? []).find((f) => f.type === "text") ?? entity?.fields?.[0];
  return titleField ? formatPlain(titleField, row?.[titleField.key]) : entity?.label ?? "Registro";
}
