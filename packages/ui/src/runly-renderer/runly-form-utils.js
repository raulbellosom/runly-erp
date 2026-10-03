import { normalizeSpanishLabel } from "./renderer-adapters.js";

export const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
  // Financial transaction / category kind
  income: "Ingreso",
  expense: "Egreso",
  both: "Ambos",
};

export const PRESET_COLORS = [
  { label: "Azul", value: "#2563eb" },
  { label: "Rojo", value: "#dc2626" },
  { label: "Verde", value: "#16a34a" },
  { label: "Amarillo", value: "#ca8a04" },
  { label: "Gris", value: "#6b7280" },
  { label: "Negro", value: "#111827" },
  { label: "Blanco", value: "#f9fafb" },
];

export const CAR_COLORS = [
  // Blancos
  { name: "Blanco Puro",      hex: "#ffffff", group: "Blancos" },
  { name: "Blanco Perla",     hex: "#f1f5f9", group: "Blancos" },
  { name: "Marfil",           hex: "#fef9c3", group: "Blancos" },
  { name: "Crema",            hex: "#fef3c7", group: "Blancos" },
  // Platas y Grises
  { name: "Plata Metalico",   hex: "#cbd5e1", group: "Platas" },
  { name: "Gris Plata",       hex: "#94a3b8", group: "Platas" },
  { name: "Gris Titanio",     hex: "#64748b", group: "Platas" },
  { name: "Gris Acero",       hex: "#475569", group: "Platas" },
  { name: "Grafito",          hex: "#334155", group: "Platas" },
  // Negros
  { name: "Gris Oscuro",      hex: "#1e293b", group: "Negros" },
  { name: "Negro Carbon",     hex: "#0f172a", group: "Negros" },
  { name: "Negro Intenso",    hex: "#020617", group: "Negros" },
  // Rojos
  { name: "Rojo Vivo",        hex: "#ef4444", group: "Rojos" },
  { name: "Rojo Escarlata",   hex: "#dc2626", group: "Rojos" },
  { name: "Rojo Cereza",      hex: "#b91c1c", group: "Rojos" },
  { name: "Rojo Granate",     hex: "#991b1b", group: "Rojos" },
  { name: "Borgona",          hex: "#7f1d1d", group: "Rojos" },
  // Naranjas
  { name: "Naranja Fuego",    hex: "#f97316", group: "Naranjas" },
  { name: "Naranja Oxidado",  hex: "#ea580c", group: "Naranjas" },
  // Dorados y Amarillos
  { name: "Amarillo Solar",   hex: "#facc15", group: "Dorados" },
  { name: "Dorado Metalico",  hex: "#d97706", group: "Dorados" },
  { name: "Champagne",        hex: "#b45309", group: "Dorados" },
  // Marrones
  { name: "Cafe Tostado",     hex: "#92400e", group: "Marrones" },
  { name: "Marron Tierra",    hex: "#78350f", group: "Marrones" },
  { name: "Chocolate",        hex: "#451a03", group: "Marrones" },
  // Verdes
  { name: "Verde Esmeralda",  hex: "#22c55e", group: "Verdes" },
  { name: "Verde Bosque",     hex: "#16a34a", group: "Verdes" },
  { name: "Verde Oliva",      hex: "#166534", group: "Verdes" },
  { name: "Verde Cazador",    hex: "#14532d", group: "Verdes" },
  // Azules
  { name: "Azul Cielo",       hex: "#38bdf8", group: "Azules" },
  { name: "Azul Pacifico",    hex: "#0ea5e9", group: "Azules" },
  { name: "Azul Zafiro",      hex: "#3b82f6", group: "Azules" },
  { name: "Azul Real",        hex: "#2563eb", group: "Azules" },
  { name: "Azul Marino",      hex: "#1d4ed8", group: "Azules" },
  { name: "Azul Noche",       hex: "#1e40af", group: "Azules" },
  { name: "Azul Profundo",    hex: "#1e3a8a", group: "Azules" },
  // Morados
  { name: "Violeta",          hex: "#8b5cf6", group: "Morados" },
  { name: "Morado",           hex: "#7c3aed", group: "Morados" },
  { name: "Ciruela",          hex: "#6d28d9", group: "Morados" },
  { name: "Uva",              hex: "#5b21b6", group: "Morados" },
  // Rosas
  { name: "Rosa",             hex: "#f472b6", group: "Rosas" },
  { name: "Rosa Fucsia",      hex: "#ec4899", group: "Rosas" },
];

export const CAR_COLORS_HEX_MAP = Object.fromEntries(
  CAR_COLORS.map((c) => [c.name.toLowerCase(), c.hex])
);

export function resolveColorHex(value) {
  if (!value) return null;
  if (String(value).startsWith("#")) return String(value);
  return CAR_COLORS_HEX_MAP[String(value).toLowerCase()] ?? null;
}

export function resolveColorName(value) {
  if (!value) return null;
  if (!String(value).startsWith("#")) return String(value);
  const lower = String(value).toLowerCase();
  return CAR_COLORS.find((c) => c.hex.toLowerCase() === lower)?.name ?? null;
}

export const TEXT_TYPES = new Set(["text", "email", "phone", "textarea", "markdown"]);

export function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

export function resolveRelationLabel(row, descriptor) {
  const { labelField, labelSeparator, valueField } = descriptor;
  if (Array.isArray(labelField)) {
    const parts = labelField.map((f) => (row[f] != null ? String(row[f]) : "")).filter(Boolean);
    return parts.length > 0 ? parts.join(labelSeparator) : String(row[valueField] ?? "");
  }
  return row[labelField] != null ? String(row[labelField]) : String(row[valueField] ?? "");
}

function resolveOptionLabel(rawLabel) {
  return STATUS_LABELS[String(rawLabel).toLowerCase()] ?? normalizeSpanishLabel(String(rawLabel));
}

export function normalizeOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const value = entry.value ?? entry.key ?? entry.id ?? entry.code;
        if (value === undefined || value === null) return null;
        return { value: String(value), label: resolveOptionLabel(entry.label ?? entry.name ?? value) };
      }
      return { value: String(entry), label: resolveOptionLabel(entry) };
    })
    .filter(Boolean);
}

export function buildInitialValues(fieldMap, initialData) {
  const values = {};
  for (const field of fieldMap.values()) {
    const currentValue = initialData?.[field.name];
    if (currentValue === undefined || currentValue === null) {
      if (field.default !== undefined) {
        values[field.name] = field.default;
      } else {
        values[field.name] = field.type === "boolean" ? false : "";
      }
    } else if (field.type === "date" && typeof currentValue === "string" && currentValue.includes("T")) {
      values[field.name] = currentValue.slice(0, 10);
    } else {
      values[field.name] = currentValue;
    }
  }
  return values;
}

export function castValueByType(value, type) {
  if (type === "boolean") return Boolean(value);
  if (value === "" || value === null || value === undefined) {
    return TEXT_TYPES.has(type) ? "" : null;
  }
  if (type === "number") {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === "decimal") {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === "currency") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

export function resolveRecordId(initialData) {
  return initialData?.id ?? initialData?.recordId ?? initialData?.uuid ?? initialData?.ID ?? null;
}

export function extractBlueprintRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

export function extractFieldsFromBlueprint(blueprint) {
  if (Array.isArray(blueprint?.fields) && blueprint.fields.length > 0) return blueprint.fields;
  if (Array.isArray(blueprint?.schema?.fields) && blueprint.schema.fields.length > 0) {
    return blueprint.schema.fields;
  }
  return [];
}

export function extractCreatedRecord(result) {
  if (result && typeof result === "object" && result.data && typeof result.data === "object") {
    return result.data;
  }
  if (result && typeof result === "object") return result;
  return null;
}

function collectFieldDefinitionsFromSchema(schema) {
  const fields = [];
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  for (const section of sections) {
    const sectionFields = Array.isArray(section?.fields) ? section.fields : [];
    for (const entry of sectionFields) {
      if (!entry || typeof entry !== "object") continue;
      const name = entry.name ?? entry.key ?? entry.field ?? null;
      if (!name) continue;
      fields.push({
        name: String(name),
        type: String(entry.type ?? "text").toLowerCase(),
      });
    }
  }
  return fields;
}

export function buildInlineCreatePrefill({ nestedBlueprint, searchText, descriptor }) {
  const trimmed = String(searchText ?? "").trim();
  if (!descriptor?.create?.prefillFromSearch || !trimmed) return {};

  const defs = collectFieldDefinitionsFromSchema(nestedBlueprint?.schema);
  if (defs.length === 0) return {};

  const preferredKeys = ["name", "title", "nombre", "titulo"];
  const preferred = defs.find(
    (field) => preferredKeys.includes(field.name.toLowerCase()) && field.type === "text",
  );
  if (preferred) return { [preferred.name]: trimmed };

  const firstCompatible = defs.find((field) => field.type === "text" || field.type === "textarea");
  if (!firstCompatible) return {};
  return { [firstCompatible.name]: trimmed };
}

export function toMoney(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Number(parsed.toFixed(2));
}

export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function normalizePartItem(item) {
  const quantity = Math.max(1, toInt(item?.quantity, 1));
  const unitCost = Math.max(0, toMoney(item?.unit_cost, 0));
  return {
    name: String(item?.name ?? "").trim(),
    quantity,
    unit_cost: unitCost,
    notes: String(item?.notes ?? "").trim(),
    subtotal: Number((quantity * unitCost).toFixed(2)),
  };
}

export function normalizeReportParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map(normalizePartItem);
}

export function computePartsCost(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return 0;
  return Number(
    parts.reduce((acc, item) => acc + Number(item?.subtotal ?? 0), 0).toFixed(2),
  );
}

// True when `values` differs from `base` in any field outside `ignore`
// (empty string, null, undefined and [] all count as the same "empty").
export function formValuesChanged(base, values, ignore = new Set()) {
  const a0 = base ?? {};
  const b0 = values ?? {};
  const empty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  for (const key of new Set([...Object.keys(a0), ...Object.keys(b0)])) {
    if (ignore.has(key)) continue;
    const a = a0[key];
    const b = b0[key];
    if (a === b || (empty(a) && empty(b))) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}
