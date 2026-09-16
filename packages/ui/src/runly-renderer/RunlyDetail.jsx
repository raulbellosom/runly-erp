import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BookOpen,
  CalendarDays,
  Car,
  ClipboardList,
  FileText,
  Hash,
  IdCard,
  Layers,
  Library,
  Link2,
  Loader2,
  Mail,
  Palette,
  Phone,
  Tag,
  Truck,
  UserCheck,
  Wrench,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { LoadingState } from "../components/LoadingState.jsx";
import { Alert, AlertDescription, AlertTitle } from "../components/Alert.jsx";
import { Button } from "../components/Button.jsx";
import { Avatar, AvatarImage, AvatarFallback } from "../components/Avatar.jsx";
import { AttachmentsPanel } from "../components/AttachmentsPanel.jsx";
import { MarkdownViewer } from "../components/MarkdownViewer.jsx";
import { normalizeSpanishLabel } from "./renderer-adapters.js";
import { resolveColorHex } from "./runly-form-utils.js";
import { CostsSummaryPanel } from "./CostsSummaryPanel.jsx";
import {
  resolveHeroModel,
  resolveKpis,
  splitSectionsByColumn,
  normalizeComponentSection,
  normalizeSectionColumn,
} from "./detail-presentation.js";
import {
  HeroContainer,
  fetchSignedUrl,
  fetchUserAvatarSignedUrl,
  initialsFromName,
} from "./runly-detail-hero.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { cn } from "../lib/utils.js";

const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
  draft: "Borrador",
  finalized: "Finalizado",
  available: "Disponible",
  assigned: "Asignado",
  lost: "Perdido",
  stolen: "Robado",
  disposed: "Desechado",
};

const STATUS_COLORS = {
  active: "bg-green-500/15 text-green-700 dark:text-green-400",
  inactive: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  maintenance: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  retired: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  pending: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  disabled: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  draft: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  finalized: "bg-green-500/15 text-green-700 dark:text-green-400",
  available: "bg-green-500/15 text-green-700 dark:text-green-400",
  assigned: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  lost: "bg-red-500/15 text-red-700 dark:text-red-400",
  stolen: "bg-red-500/15 text-red-700 dark:text-red-400",
  disposed: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
};

function formatDetailDate(value, includeTime = false) {
  if (!value) return "—";
  const str = String(value);
  const hasTime = str.includes("T");
  const datePart = hasTime ? str.slice(0, 10) : str;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return str;
  const dateFmt = `${day}/${month}/${year}`;
  if (!includeTime || !hasTime) return dateFmt;
  const timePart = str.slice(11, 16); // "HH:MM"
  if (!timePart || timePart === "00:00") return dateFmt;
  const [hStr, mStr] = timePart.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dateFmt} ${h12}:${m} ${ampm}`;
}

function formatDetailCurrency(value, currencyCode = "MXN") {
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

const ICON_MAP = {
  Activity,
  BookOpen,
  CalendarDays,
  Car,
  ClipboardList,
  FileText,
  Hash,
  IdCard,
  Layers,
  Library,
  Link2,
  Mail,
  Palette,
  Phone,
  Tag,
  Truck,
  UserCheck,
  Wrench,
};

const ICON_ALIAS_MAP = {
  badge: Hash,
  bookopen: BookOpen,
  clipboardlist: ClipboardList,
  library: Library,
  usercheck: UserCheck,
};

function matchesFieldRule(rule, record) {
  if (!rule || typeof rule !== "object") return true;
  const fieldName = String(rule.field ?? "").trim();
  if (!fieldName) return true;
  const value = record?.[fieldName];
  if (Object.prototype.hasOwnProperty.call(rule, "equals"))
    return value === rule.equals;
  if (Object.prototype.hasOwnProperty.call(rule, "notEquals"))
    return value !== rule.notEquals;
  if (Array.isArray(rule.in)) return rule.in.includes(value);
  if (Array.isArray(rule.notIn)) return !rule.notIn.includes(value);
  if (Object.prototype.hasOwnProperty.call(rule, "truthy"))
    return Boolean(value) === Boolean(rule.truthy);
  return true;
}

function normalizeField(fieldLike) {
  if (!fieldLike || typeof fieldLike !== "object") return null;
  const name = fieldLike.name ?? fieldLike.key ?? fieldLike.field ?? null;
  if (!name) return null;
  return {
    name: String(name),
    label: normalizeSpanishLabel(fieldLike.label ?? String(name)),
    type: fieldLike.type ?? "text",
    icon:
      typeof fieldLike.icon === "string" && fieldLike.icon.trim()
        ? fieldLike.icon.trim()
        : null,
    options: Array.isArray(fieldLike.options) ? fieldLike.options : null,
    visibleWhen: fieldLike.visibleWhen ?? null,
    hiddenWhen: fieldLike.hiddenWhen ?? null,
  };
}

function normalizeSectionField(item) {
  if (typeof item === "string") {
    const key = String(item).trim();
    if (!key) return null;
    // No default type: let normalizeSections preserve the existing type from fieldMap
    // (e.g. "markdown" from the form blueprint) instead of overwriting with "text".
    return {
      name: key,
      field: { name: key, label: key, icon: null },
    };
  }
  const normalized = normalizeField(item);
  if (!normalized) return null;
  return { name: normalized.name, field: normalized };
}

function normalizeFieldMap(fields) {
  const map = new Map();
  for (const entry of Array.isArray(fields) ? fields : []) {
    const normalized = normalizeField(entry);
    if (!normalized) continue;
    map.set(normalized.name, normalized);
  }
  return map;
}

function normalizeRelationCardConfig(config, sectionTitle) {
  if (!config || typeof config !== "object") return null;
  const subtitleFields = (
    Array.isArray(config.subtitleFields) ? config.subtitleFields : []
  )
    .map((field) => (typeof field === "string" ? field.trim() : ""))
    .filter(Boolean);

  const subtitleTypes = Array.isArray(config.subtitleTypes)
    ? config.subtitleTypes.map((t) => (typeof t === "string" ? t.trim() : ""))
    : [];

  return {
    idField:
      typeof config.idField === "string" && config.idField.trim()
        ? config.idField.trim()
        : null,
    titleField:
      typeof config.titleField === "string" && config.titleField.trim()
        ? config.titleField.trim()
        : null,
    subtitleFields,
    subtitleTypes,
    fallbackTitle: normalizeSpanishLabel(
      config.fallbackTitle ??
        `No hay ${sectionTitle?.toLowerCase() ?? "relación"}.`,
    ),
    hrefTemplate:
      typeof config.hrefTemplate === "string" && config.hrefTemplate.trim()
        ? config.hrefTemplate.trim()
        : null,
    icon:
      typeof config.icon === "string" && config.icon.trim()
        ? config.icon.trim()
        : null,
  };
}

function normalizeRelationListConfig(config) {
  if (!config || typeof config !== "object") return null;
  const subtitleFields = (
    Array.isArray(config.subtitleFields) ? config.subtitleFields : []
  )
    .map((field) => (typeof field === "string" ? field.trim() : ""))
    .filter(Boolean);

  const subtitleLabels = Array.isArray(config.subtitleLabels)
    ? config.subtitleLabels.map((l) => (typeof l === "string" ? l.trim() : ""))
    : [];

  const subtitleTypes = Array.isArray(config.subtitleTypes)
    ? config.subtitleTypes.map((t) => (typeof t === "string" ? t.trim() : ""))
    : [];

  return {
    apiPath:
      typeof config.apiPath === "string" && config.apiPath.trim()
        ? config.apiPath.trim()
        : null,
    idField:
      typeof config.idField === "string" && config.idField.trim()
        ? config.idField.trim()
        : "id",
    titleField:
      typeof config.titleField === "string" && config.titleField.trim()
        ? config.titleField.trim()
        : null,
    subtitleFields,
    subtitleLabels,
    subtitleTypes,
    hrefTemplate:
      typeof config.hrefTemplate === "string" && config.hrefTemplate.trim()
        ? config.hrefTemplate.trim()
        : null,
    icon:
      typeof config.icon === "string" && config.icon.trim()
        ? config.icon.trim()
        : null,
    emptyMessage: normalizeSpanishLabel(
      config.emptyMessage ?? "No hay registros relacionados.",
    ),
  };
}

function normalizeSections(schema, fieldMap) {
  let rawSections = Array.isArray(schema?.sections) ? schema.sections : [];

  // When no sections are defined (e.g. a TABLE blueprint used as detail fallback),
  // auto-generate a flat section from the `columns` definition so the detail renders
  // something meaningful instead of showing the "Detalle sin secciones" warning.
  if (
    rawSections.length === 0 &&
    Array.isArray(schema?.columns) &&
    schema.columns.length > 0
  ) {
    rawSections = [
      {
        fields: schema.columns
          .filter((col) => col.field && !col.hidden)
          .map((col) => ({
            name: col.field,
            label: col.label ?? col.field,
            type: col.type ?? "text",
          })),
      },
    ];
  }

  return rawSections
    .map((entry, sectionIndex) => {
      if (!entry || typeof entry !== "object") return null;
      const sectionType =
        typeof entry.type === "string" && entry.type.trim()
          ? entry.type.trim().toLowerCase()
          : "fields";

      const sectionTitle =
        (entry.title ?? entry.label)
          ? normalizeSpanishLabel(entry.title ?? entry.label)
          : null;

      const sectionIcon =
        typeof entry.icon === "string" && entry.icon.trim()
          ? entry.icon.trim()
          : null;

      if (sectionType === "documents" || sectionType === "attachments") {
        const attachmentsConfig =
          sectionType === "attachments"
            ? (entry.attachments ?? null)
            : (entry.documents ?? null);
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle,
          type: "attachments",
          icon: sectionIcon,
          column: normalizeSectionColumn(entry.column),
          attachments: attachmentsConfig,
        };
      }

      if (sectionType === "relation-card") {
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle,
          type: "relation-card",
          icon: sectionIcon,
          column: normalizeSectionColumn(entry.column),
          relationCard: normalizeRelationCardConfig(
            entry.relationCard,
            sectionTitle,
          ),
        };
      }

      if (sectionType === "relation-list") {
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle,
          type: "relation-list",
          icon: sectionIcon,
          column: normalizeSectionColumn(entry.column),
          relationList: normalizeRelationListConfig(entry.relationList),
        };
      }

      if (sectionType === "component") {
        return normalizeComponentSection(entry, sectionIndex, sectionTitle, sectionIcon);
      }

      const fieldDefs = (Array.isArray(entry.fields) ? entry.fields : [])
        .map((item) => normalizeSectionField(item))
        .filter(Boolean);

      const fieldNames = [];
      for (const fieldDef of fieldDefs) {
        const name = fieldDef.name;
        if (!fieldMap.has(name)) {
          fieldMap.set(name, fieldDef.field);
        } else {
          const existing = fieldMap.get(name);
          fieldMap.set(name, {
            ...existing,
            label: fieldDef.field.label ?? existing?.label ?? name,
            type: fieldDef.field.type ?? existing?.type ?? "text",
            icon: fieldDef.field.icon ?? existing?.icon ?? null,
            options: fieldDef.field.options ?? existing?.options ?? null,
          });
        }
        if (!fieldNames.includes(name)) fieldNames.push(name);
      }

      const cols = Number(entry.columns);
      const columns = cols === 1 ? 1 : cols === 2 ? 2 : "auto";

      return {
        id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
        title: sectionTitle,
        type: "fields",
        columns,
        icon: sectionIcon,
        column: normalizeSectionColumn(entry.column),
        fields: fieldNames,
      };
    })
    .filter(Boolean);
}

function renderValue(field, value, record = {}) {
  if (value === undefined || value === null || value === "") return "—";
  if (field?.type === "boolean") return value ? "Sí" : "No";

  if (field?.type === "date") return formatDetailDate(value, false);
  if (field?.type === "datetime") return formatDetailDate(value, true);

  if (field?.type === "currency" || field?.type === "decimal") {
    return formatDetailCurrency(value, record.currency);
  }

  if (field?.type === "number" || field?.type === "integer") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat("es-MX").format(n);
  }

  if (field?.type === "select" && Array.isArray(field?.options)) {
    const str = String(value);
    const opt = field.options.find((o) => String(o.value) === str);
    if (opt?.label) return opt.label;
  }

  if (field?.type === "color") {
    const colorStr = String(value);
    const hex = resolveColorHex(colorStr);
    const displayName = colorStr.startsWith("#") ? colorStr : colorStr;
    return (
      <span className="inline-flex items-center gap-2">
        {hex && (
          <span
            className="inline-block h-4 w-4 rounded-full border border-[hsl(var(--border))] shadow-sm shrink-0"
            style={{ backgroundColor: hex }}
          />
        )}
        <span>{displayName}</span>
      </span>
    );
  }

  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  const lower = str.toLowerCase();
  const label = STATUS_LABELS[lower];
  if (label) {
    const chipClass =
      STATUS_COLORS[lower] ??
      "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
    return (
      <span
        className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${chipClass}`}
      >
        {label}
      </span>
    );
  }
  return str;
}

function gridClass(columns) {
  if (columns === 1) return "grid gap-4";
  if (columns === 2) return "grid gap-4 md:grid-cols-2";
  return "grid gap-4 lg:grid-cols-2";
}

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path) return base;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function replacePathTokens(pathTemplate, tokenMap) {
  let path = String(pathTemplate ?? "");
  for (const [key, rawValue] of Object.entries(tokenMap ?? {})) {
    const safeValue = encodeURIComponent(String(rawValue ?? "").trim());
    path = path.replace(new RegExp(`:${key}\\b`, "g"), safeValue);
  }
  return path;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    return extractArrayPayload(payload.data);
  }
  return [];
}

function getByPath(value, path) {
  if (!path || typeof path !== "string") return undefined;
  return path
    .split(".")
    .reduce(
      (cursor, segment) =>
        cursor && typeof cursor === "object" ? cursor[segment] : undefined,
      value,
    );
}

function normalizeIconName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const raw = name.trim();
  if (ICON_MAP[raw]) return raw;
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (ICON_ALIAS_MAP[normalized]) return normalized;
  const pascal = raw
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
  if (ICON_MAP[pascal]) return pascal;
  return null;
}

function resolveIcon(name) {
  const normalized = normalizeIconName(name);
  if (!normalized) return null;
  return ICON_MAP[normalized] ?? ICON_ALIAS_MAP[normalized] ?? null;
}

function normalizeTextValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function RelationCardSection({ section, data, apiBaseUrl, token, companyId = null }) {
  const relationCard = section.relationCard;
  const [avatarUrl, setAvatarUrl] = useState(null);

  const relatedId = relationCard?.idField ? getByPath(data, relationCard.idField) : null;
  const hasRelatedId = Boolean(normalizeTextValue(relatedId));

  // avatarKind: 'user' resolves via the dedicated user-avatar route instead
  // of the generic files one — a user account's avatar isn't a
  // company-scoped file entity fetchSignedUrl can resolve (see
  // fetchUserAvatarSignedUrl's comment). It uses relatedId directly since
  // that route takes a user id, not a file id.
  const isUserAvatar = relationCard?.avatarKind === "user";
  const rawAvatarId = !isUserAvatar && relationCard?.avatarField
    ? getByPath(data, relationCard.avatarField)
    : null;
  const avatarAssetId = normalizeTextValue(rawAvatarId) || null;

  useEffect(() => {
    let cancelled = false;
    const id = isUserAvatar ? (hasRelatedId ? relatedId : null) : avatarAssetId;
    if (!id) {
      setAvatarUrl(null);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const url = isUserAvatar
        ? await fetchUserAvatarSignedUrl(apiBaseUrl, token, id, companyId)
        : await fetchSignedUrl(apiBaseUrl, token, id, companyId);
      if (!cancelled) setAvatarUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, token, companyId, isUserAvatar, avatarAssetId, hasRelatedId, relatedId]);

  if (!relationCard?.idField) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
        Configuración de relación no disponible.
      </div>
    );
  }

  const rawTitle = relationCard.titleField
    ? getByPath(data, relationCard.titleField)
    : null;
  const cleanTitle = normalizeTextValue(rawTitle);

  const title = hasRelatedId
    ? cleanTitle || "Registro relacionado"
    : relationCard.fallbackTitle;

  const subtitles = (relationCard.subtitleFields ?? [])
    .map((fieldKey, idx) => {
      const raw = getByPath(data, fieldKey);
      const type = relationCard.subtitleTypes?.[idx] ?? null;
      if (raw === undefined || raw === null || raw === "") return null;
      if (type === "date") return formatDetailDate(raw, false);
      if (type === "datetime") return formatDetailDate(raw, true);
      return normalizeTextValue(raw) || null;
    })
    .filter(Boolean);

  const href =
    hasRelatedId && relationCard.hrefTemplate
      ? replacePathTokens(relationCard.hrefTemplate, { id: relatedId })
      : null;

  const contactActions = (
    Array.isArray(relationCard.contactActions) ? relationCard.contactActions : []
  )
    .map((action, idx) => {
      if (!action || action.type !== "call" || !action.field) return null;
      const phone = normalizeTextValue(getByPath(data, action.field));
      if (!phone) return null;
      return {
        key: `${action.field}-${idx}`,
        phone,
        label: action.label || "Llamar",
      };
    })
    .filter(Boolean);

  const Icon = resolveIcon(relationCard.icon) ?? Link2;
  const showAvatar = (isUserAvatar || Boolean(relationCard.avatarField)) && hasRelatedId;

  const media = showAvatar ? (
    <Avatar className="mt-0.5 h-9 w-9 rounded-lg">
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt={title} className="rounded-lg" />
      ) : null}
      <AvatarFallback className="rounded-lg bg-[hsl(var(--muted))] text-xs text-[hsl(var(--muted-foreground))]">
        {initialsFromName(cleanTitle)}
      </AvatarFallback>
    </Avatar>
  ) : (
    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      <Icon size={16} />
    </span>
  );

  const inner = (
    <div className="min-w-0 space-y-1">
      <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
        {title}
      </p>
      {subtitles.length > 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
          {subtitles.join(" · ")}
        </p>
      ) : null}
      {href ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Ir al detalle relacionado
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 transition-colors hover:border-[hsl(var(--ring))]">
      <div className="flex items-start gap-3">
        {media}
        {href ? (
          <a href={href} className="block min-w-0 flex-1">
            {inner}
          </a>
        ) : (
          <div className="min-w-0 flex-1">{inner}</div>
        )}
      </div>
      {contactActions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-11">
          {contactActions.map((action) => (
            <Button key={action.key} asChild variant="outline" size="sm">
              <a href={`tel:${action.phone}`}>
                <Phone size={14} />
                {action.label}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RelationListSection({ section, data, apiBaseUrl, token, companyId = null }) {
  const relationList = section.relationList;
  const recordId = data?.id ?? null;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCancelled = false;

    async function fetchItems() {
      if (!recordId || !relationList?.apiPath) {
        setItems([]);
        setLoading(false);
        setError("");
        return;
      }

      setLoading(true);
      setError("");
      try {
        const endpointPath = replacePathTokens(relationList.apiPath, {
          id: recordId,
        });
        const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
          method: "GET",
          headers: buildApiHeaders(token, companyId),
        });
        const text = await response.text();
        const payload = parseJsonSafe(text);

        if (!response.ok) {
          throw new Error("No se pudieron cargar los registros relacionados.");
        }

        const rows = extractArrayPayload(payload);
        if (!isCancelled) setItems(rows);
      } catch {
        if (!isCancelled) {
          setItems([]);
          setError("No se pudieron cargar los registros relacionados.");
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    fetchItems();

    return () => {
      isCancelled = true;
    };
  }, [apiBaseUrl, token, recordId, relationList?.apiPath]);

  const Icon = resolveIcon(relationList?.icon) ?? Link2;

  if (!relationList?.apiPath) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
        Configuración de lista relacionada no disponible.
      </div>
    );
  }

  if (loading) {
    return <LoadingState variant="inline" message="Cargando relaciones..." />;
  }

  if (error) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
        <AlertCircle size={16} />
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        {relationList.emptyMessage || "No hay registros relacionados."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const itemId = getByPath(item, relationList.idField);
        const rawTitle = relationList.titleField
          ? getByPath(item, relationList.titleField)
          : null;
        const title = normalizeTextValue(rawTitle) || "Registro relacionado";
        const subtitles = relationList.subtitleFields
          .map((fieldKey, idx) => {
            const raw = getByPath(item, fieldKey);
            const label = relationList.subtitleLabels?.[idx] ?? null;
            const type = relationList.subtitleTypes?.[idx] ?? null;
            let formatted;
            if (raw === undefined || raw === null || raw === "") {
              formatted = "—";
            } else if (type === "date") {
              formatted = formatDetailDate(raw, false);
            } else if (type === "datetime") {
              formatted = formatDetailDate(raw, true);
            } else if (type === "currency") {
              formatted = formatDetailCurrency(raw, item.currency);
            } else if (type === "integer" || type === "number") {
              const n = Number(raw);
              formatted = Number.isFinite(n)
                ? new Intl.NumberFormat("es-MX").format(n)
                : String(raw);
            } else {
              formatted = normalizeTextValue(raw);
            }
            if (!formatted || formatted === "—") return null;
            return label ? `${label} ${formatted}` : formatted;
          })
          .filter(Boolean);
        const href =
          relationList.hrefTemplate && normalizeTextValue(itemId)
            ? replacePathTokens(relationList.hrefTemplate, { id: itemId })
            : null;

        const hasLabeledGrid =
          Array.isArray(relationList.subtitleLabels) &&
          relationList.subtitleLabels.length > 0;
        const labeledPairs = hasLabeledGrid
          ? relationList.subtitleFields
              .map((fieldKey, idx) => {
                const raw = getByPath(item, fieldKey);
                const label = relationList.subtitleLabels?.[idx] ?? null;
                const type = relationList.subtitleTypes?.[idx] ?? null;
                let formatted;
                if (raw === undefined || raw === null || raw === "") {
                  formatted = null;
                } else if (type === "date") {
                  formatted = formatDetailDate(raw, false);
                } else if (type === "datetime") {
                  formatted = formatDetailDate(raw, true);
                } else if (type === "currency") {
                  formatted = formatDetailCurrency(raw, item.currency) || null;
                } else {
                  formatted = normalizeTextValue(raw) || null;
                }
                return formatted ? { label, value: formatted } : null;
              })
              .filter(Boolean)
          : [];

        const content = (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 transition-colors hover:border-[hsl(var(--ring))]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
                  {title}
                </p>
                {hasLabeledGrid && labeledPairs.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {labeledPairs.map((pair, i) => (
                      <div
                        key={i}
                        className="flex items-baseline gap-1 text-xs"
                      >
                        {pair.label && (
                          <span className="shrink-0 font-medium text-[hsl(var(--foreground))]/60">
                            {pair.label}
                          </span>
                        )}
                        <span className="truncate text-[hsl(var(--muted-foreground))]">
                          {pair.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : subtitles.length > 0 ? (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                    {subtitles.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        );

        if (!href) return <div key={`${section.id}-${index}`}>{content}</div>;

        return (
          <a key={`${section.id}-${index}`} href={href} className="block">
            {content}
          </a>
        );
      })}
    </div>
  );
}

function FieldLabel({ field }) {
  const Icon = resolveIcon(field?.icon) ?? null;

  if (!Icon) {
    return <>{field.label}</>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={13} />
      {field.label}
    </span>
  );
}

export function RunlyDetail({
  blueprint,
  fields,
  data,
  onEdit,
  onBack,
  heroActions,
  token,
  apiBaseUrl,
  companyId = null,
  componentRegistry = null,
}) {
  const schema = blueprint?.schema ?? {};
  const fieldMap = useMemo(() => normalizeFieldMap(fields), [fields]);
  const sections = useMemo(
    () => normalizeSections(schema, fieldMap),
    [schema, fieldMap],
  );
  const heroModel = useMemo(
    () =>
      data && typeof data === "object"
        ? resolveHeroModel(schema, data, fieldMap)
        : null,
    [schema, data, fieldMap],
  );
  const kpiItems = useMemo(
    () => (data && typeof data === "object" ? resolveKpis(schema, data) : []),
    [schema, data],
  );
  const { twoColumn, main: mainSections, aside: asideSections } = useMemo(
    () => splitSectionsByColumn(sections, schema?.layout),
    [sections, schema?.layout],
  );

  if (!data || typeof data !== "object") {
    return (
      <Alert variant="warning">
        <AlertTitle>Sin información</AlertTitle>
        <AlertDescription>
          No hay datos para mostrar en el detalle.
        </AlertDescription>
      </Alert>
    );
  }

  const fallbackActions =
    onBack || onEdit ? (
      <>
        {onBack && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onBack?.()}
          >
            Volver
          </Button>
        )}
        {onEdit && (
          <Button type="button" size="sm" onClick={() => onEdit?.(data)}>
            Editar
          </Button>
        )}
      </>
    ) : null;

  const renderSection = (section) => (
    <div
      key={section.id}
      className={cn(
        "glass-shell rounded-xl px-5 py-4 space-y-4",
        section.type === "fields" &&
          "border-l-2 border-l-(--brand-primary) shadow-[inset_10px_0_16px_-14px_var(--brand-primary)]",
      )}
    >
      {section.title ? (
        <div className="pb-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
          {(() => {
            const SectionIcon = section.icon ? LucideIcons[section.icon] : null;
            return SectionIcon ? (
              <SectionIcon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : null;
          })()}
          <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
            {section.title}
          </h4>
        </div>
      ) : null}

      {section.type === "attachments" ? (
        <AttachmentsPanel
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
          recordId={data?.id ?? null}
          config={section.attachments ?? {}}
          context="detail"
          readOnly
          showHeading={false}
        />
      ) : null}

      {section.type === "relation-card" ? (
        <RelationCardSection
          section={section}
          data={data}
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
        />
      ) : null}

      {section.type === "relation-list" ? (
        <RelationListSection
          section={section}
          data={data}
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
        />
      ) : null}

      {section.type === "component" ? (() => {
        const Comp = componentRegistry?.resolve?.(section.component) ?? null;
        if (!Comp) {
          return (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
              Componente "{section.component}" no está registrado.
            </div>
          );
        }
        return (
          <Comp data={data} apiBaseUrl={apiBaseUrl} token={token} companyId={companyId} />
        );
      })() : null}

      {section.type === "fields" ? (
        <div className="space-y-4">
          <dl className={gridClass(section.columns)}>
            {section.fields.map((fieldName) => {
              const field = fieldMap.get(fieldName);
              if (!field) return null;
              if (
                field.visibleWhen &&
                !matchesFieldRule(field.visibleWhen, data)
              )
                return null;
              if (field.hiddenWhen && matchesFieldRule(field.hiddenWhen, data))
                return null;
              const value = data[field.name];
              const isMarkdown = field.type === "markdown";
              const strValue =
                value != null && value !== "" ? String(value) : null;
              return (
                <div
                  key={field.name}
                  className={`space-y-1.5${isMarkdown ? " col-span-full" : ""}`}
                >
                  <dt className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    <FieldLabel field={field} />
                  </dt>
                  <dd className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {isMarkdown ? (
                      strValue ? (
                        <MarkdownViewer value={strValue} />
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">
                          —
                        </span>
                      )
                    ) : (
                      renderValue(field, value, data)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {section.fields.includes("labor_cost") &&
          section.fields.includes("parts_cost") &&
          section.fields.includes("total_cost") ? (
            <CostsSummaryPanel
              laborCost={data.labor_cost ?? 0}
              partsCost={data.parts_cost ?? 0}
              totalCost={data.total_cost ?? 0}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {heroModel ? (
        <HeroContainer
          heroModel={heroModel}
          kpiItems={kpiItems}
          data={data}
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
          actions={heroActions ?? fallbackActions}
          renderValue={renderValue}
        />
      ) : (
        (onBack || onEdit) && (
          <div className="flex items-center justify-end gap-2">
            {onBack && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onBack?.()}
              >
                Volver
              </Button>
            )}
            {onEdit && (
              <Button type="button" onClick={() => onEdit?.(data)}>
                Editar
              </Button>
            )}
          </div>
        )
      )}

      {sections.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>Detalle sin secciones</AlertTitle>
          <AlertDescription>
            Esta vista no tiene <code>schema.sections</code> configurado.
          </AlertDescription>
        </Alert>
      )}

      {twoColumn ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            {mainSections.map(renderSection)}
          </div>
          <div className="min-w-0 space-y-6">
            {asideSections.map(renderSection)}
          </div>
        </div>
      ) : (
        <div className="space-y-6">{sections.map(renderSection)}</div>
      )}
    </div>
  );
}
