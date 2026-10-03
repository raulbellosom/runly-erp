// Relation sections of RunlyDetail ("relation-card" and "relation-list")
// plus the icon/path helpers they share with it. Extracted from
// RunlyDetail.jsx to keep that file under the repo file-size limit.
import { useEffect, useState } from "react";
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
  Mail,
  Palette,
  Phone,
  Tag,
  Truck,
  UserCheck,
  Wrench,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "../components/Avatar.jsx";
import { lucideByName } from "./field-icons.js";
import { Button } from "../components/Button.jsx";
import { LoadingState } from "../components/LoadingState.jsx";
import { fetchSignedUrl, fetchUserAvatarSignedUrl, initialsFromName } from "./runly-detail-hero.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";

export function formatDetailDate(value, includeTime = false) {
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

export function formatDetailCurrency(value, currencyCode = "MXN") {
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

export function getByPath(value, path) {
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

export function resolveIcon(name) {
  const normalized = normalizeIconName(name);
  if (normalized) return ICON_MAP[normalized] ?? ICON_ALIAS_MAP[normalized] ?? null;
  // Any other lucide name the blueprint uses (MapPin, Receipt, Building2...).
  return lucideByName(name);
}

export function normalizeTextValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function RelationCardSection({ section, data, apiBaseUrl, token, companyId = null }) {
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
        ? await fetchUserAvatarSignedUrl(apiBaseUrl, token, id, companyId, "card")
        : await fetchSignedUrl(apiBaseUrl, token, id, companyId, undefined, "card");
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

export function RelationListSection({ section, data, apiBaseUrl, token, companyId = null }) {
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
