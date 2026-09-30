// Pure helpers behind RunlyTable.jsx (column/filter normalization, row keys,
// URL tokens, cell formatting). Split out to keep RunlyTable under the
// 1000-line file limit.
import { normalizeSpanishLabel } from "./renderer-adapters.js";
import { resolveColorHex } from "./runly-form-utils.js";

export const DEFAULT_PAGE_SIZE = 20;

export function inferRowActionKind(label) {
  const normalized = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "unknown";
  if (
    normalized.includes("desactivar") ||
    normalized.includes("eliminar") ||
    normalized.includes("borrar") ||
    normalized.includes("inactivar") ||
    normalized.includes("disable") ||
    normalized.includes("delete") ||
    normalized.includes("remove")
  ) {
    return "delete";
  }
  if (
    normalized.includes("editar") ||
    normalized.includes("modificar") ||
    normalized.includes("actualizar") ||
    normalized.includes("edit") ||
    normalized.includes("update")
  ) {
    return "edit";
  }
  if (
    normalized.includes("activar") ||
    normalized.includes("reactivar") ||
    normalized.includes("habilitar") ||
    normalized.includes("enable")
  ) {
    return "toggle";
  }
  if (
    normalized.includes("ver") ||
    normalized.includes("detalle") ||
    normalized.includes("view") ||
    normalized.includes("detail")
  ) {
    return "view";
  }
  return "unknown";
}

export function getRowId(row, index) {
  if (row?.__runlyRowKey != null) return String(row.__runlyRowKey);
  return row?.id != null ? String(row.id) : `row-${index}`;
}

export function withUniqueRowKeys(rows) {
  const seen = new Map();
  return rows.map((row, index) => {
    const baseId = row?.id != null ? String(row.id) : `row-${index}`;
    const nextCount = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, nextCount);
    if (nextCount === 1) {
      return { ...row, __runlyRowKey: baseId };
    }
    return { ...row, __runlyRowKey: `${baseId}__dup${nextCount - 1}` };
  });
}

export function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

export function replacePathTokens(pathTemplate, tokenMap) {
  let path = String(pathTemplate ?? "");
  for (const [key, rawValue] of Object.entries(tokenMap ?? {})) {
    const safeValue = encodeURIComponent(String(rawValue ?? "").trim());
    path = path.replace(new RegExp(`:${key}\\b`, "g"), safeValue);
  }
  return path;
}

export function hasUnresolvedPathToken(path) {
  return /:[a-zA-Z0-9_.-]+\b/.test(String(path ?? ""));
}

export function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

export function getByPath(input, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), input);
}

export function normalizeColumns(schema) {
  const rawColumns = Array.isArray(schema?.columns) ? schema.columns : [];
  const primaryFieldName =
    schema?.primaryField ?? schema?.recordTitleField ?? null;

  const cols = rawColumns
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          key: entry,
          field: entry,
          label: entry,
          component: null,
          sortable: false,
          isLink: primaryFieldName === entry,
        };
      }
      if (!entry || typeof entry !== "object") return null;
      const field = entry.field ?? entry.key ?? entry.name ?? null;
      if (!field) return null;
      const fieldStr = String(field);
      const isLink =
        Boolean(entry.primary) ||
        Boolean(entry.link) ||
        (primaryFieldName !== null && fieldStr === primaryFieldName);
      return {
        key: fieldStr,
        field: fieldStr,
        label: normalizeSpanishLabel(entry.label ?? entry.title ?? fieldStr),
        component: entry.component ?? null,
        type: entry.type ?? null,
        options: Array.isArray(entry.options) ? entry.options : null,
        hrefTemplate:
          typeof entry.hrefTemplate === "string" && entry.hrefTemplate.trim()
            ? entry.hrefTemplate.trim()
            : null,
        sortable: Boolean(entry.sortable),
        defaultVisible: entry.defaultVisible !== false,
        isLink,
        // type: "image-asset" (ImageAssetCell) options — see its own doc
        // comment for what each does.
        imagesApiPath:
          typeof entry.imagesApiPath === "string" && entry.imagesApiPath.trim()
            ? entry.imagesApiPath.trim()
            : null,
        avatarUserField:
          typeof entry.avatarUserField === "string" && entry.avatarUserField.trim()
            ? entry.avatarUserField.trim()
            : null,
        avatarLabelField:
          typeof entry.avatarLabelField === "string" && entry.avatarLabelField.trim()
            ? entry.avatarLabelField.trim()
            : null,
        // type: "image" (UserAvatarCell): full-res photo route, :id = row id.
        avatarSignedUrlPath:
          typeof entry.avatarSignedUrlPath === "string" && entry.avatarSignedUrlPath.trim()
            ? entry.avatarSignedUrlPath.trim()
            : null,
      };
    })
    .filter(Boolean);

  if (cols.length > 0 && !cols.some((c) => c.isLink)) {
    const idx = Math.max(0, cols.findIndex((c) => c.type !== "image" && c.type !== "image-asset"));
    cols[idx] = { ...cols[idx], isLink: true };
  }

  return cols;
}

export function normalizeFilters(schema) {
  const rawFilters = schema?.filters;
  if (Array.isArray(rawFilters)) {
    return rawFilters
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const key = entry.field ?? entry.key ?? entry.name ?? null;
        if (!key) return null;
        if (entry.type === "daterange") {
          // Sends `${key}From` / `${key}To` (YYYY-MM-DD) unless overridden.
          return {
            key: String(key),
            label: normalizeSpanishLabel(entry.label ?? entry.title ?? String(key)),
            type: "daterange",
            fromKey: entry.fromKey ?? `${key}From`,
            toKey: entry.toKey ?? `${key}To`,
            options: [],
          };
        }
        return {
          key: String(key),
          label: normalizeSpanishLabel(
            entry.label ?? entry.title ?? String(key),
          ),
          type: entry.type === "select" ? "select" : "text",
          options: Array.isArray(entry.options) ? entry.options : [],
        };
      })
      .filter(Boolean);
  }
  if (rawFilters && typeof rawFilters === "object") {
    return Object.entries(rawFilters)
      .map(([key, value]) => {
        if (value && typeof value === "object") {
          return {
            key,
            label: value.label ?? value.title ?? key,
            type: value.type === "select" ? "select" : "text",
            options: Array.isArray(value.options) ? value.options : [],
          };
        }
        return { key, label: key, type: "text", options: [] };
      })
      .filter(Boolean);
  }
  return [];
}

export function readPagination(payload, fallbackPage, fallbackPageSize, dataLength) {
  const pagination = payload?.pagination ?? {};
  const page = Number.isFinite(Number(pagination.page))
    ? Number(pagination.page)
    : fallbackPage;
  const pageSize = Number.isFinite(Number(pagination.pageSize))
    ? Number(pagination.pageSize)
    : fallbackPageSize;
  const total = Number.isFinite(Number(pagination.total))
    ? Number(pagination.total)
    : dataLength;
  return {
    page: Math.max(1, page),
    pageSize: Math.max(1, pageSize),
    total: Math.max(0, total),
  };
}

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


export function formatTableCurrency(value, currencyCode = "MXN") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const code = currencyCode && /^[A-Z]{3}$/.test(String(currencyCode).toUpperCase())
    ? String(currencyCode).toUpperCase()
    : "MXN";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: code,
  }).format(amount);
}

export function renderValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  return STATUS_LABELS[str.toLowerCase()] ?? str;
}

export function ColorCell({ value }) {
  if (!value || value === "—")
    return <span className="text-muted-foreground">—</span>;
  const hex = resolveColorHex(value);
  const displayName = value.startsWith("#") ? value : value;
  return (
    <span className="flex items-center gap-1.5">
      {hex && (
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border shadow-sm"
          style={{ backgroundColor: hex }}
        />
      )}
      <span>{displayName}</span>
    </span>
  );
}

