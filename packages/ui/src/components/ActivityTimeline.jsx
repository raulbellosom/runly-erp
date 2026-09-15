import {
  Activity,
  Info,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const SEVERITY_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertOctagon,
};

const SEVERITY_CLASSES = {
  info: "text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300",
  success:
    "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300",
  critical: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300",
};

function formatRelative(date) {
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "hace unos segundos";
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString("es-MX");
}

function actorLabel(actor) {
  if (!actor) return "Sistema";
  return (
    actor.displayName ||
    [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
    "Sistema"
  );
}

function actorInitials(actor) {
  const label = actorLabel(actor);
  return (
    label
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "S"
  );
}

function formatChangeValue(rawValue, fieldMeta) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";
  const type = fieldMeta?.type ?? "text";
  if (type === "select" && Array.isArray(fieldMeta?.options)) {
    const opt = fieldMeta.options.find((o) => String(o.value) === String(rawValue));
    if (opt?.label) return opt.label;
  }
  if (type === "date" || type === "datetime") {
    const d = new Date(rawValue);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("es-MX");
    return String(rawValue);
  }
  if (type === "currency") {
    const n = Number(rawValue);
    if (Number.isFinite(n)) {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
    }
  }
  const str = String(rawValue);
  if (type === "markdown" && str.length > 80) return `${str.slice(0, 80)}…`;
  return str;
}

function ActivityChanges({ changes, changeLabels }) {
  return (
    <ul className="mt-2 space-y-1 border-t border-[hsl(var(--border))] pt-2 pl-12">
      {changes.map((change) => {
        const meta = changeLabels?.[change.field];
        const label = meta?.label ?? change.field;
        return (
          <li
            key={change.field}
            className="break-words text-xs text-[hsl(var(--muted-foreground))]"
          >
            <span className="font-medium text-[hsl(var(--foreground))]">{label}:</span>{" "}
            {formatChangeValue(change.oldValue, meta)} → {formatChangeValue(change.newValue, meta)}
          </li>
        );
      })}
    </ul>
  );
}

function ActivityItem({ activity, onNavigate, onSelect, changeLabels }) {
  const Icon = SEVERITY_ICONS[activity.severity] ?? Info;
  const sevClass = SEVERITY_CLASSES[activity.severity] ?? SEVERITY_CLASSES.info;
  const navigable = Boolean(activity.link && onNavigate);
  const selectable = Boolean(onSelect);
  const clickable = navigable || selectable;
  const changes = Array.isArray(activity.payload?.changes) ? activity.payload.changes : [];
  const hasChanges = changes.length > 0;
  const [expanded, setExpanded] = useState(false);
  function handleClick() {
    if (selectable) {
      onSelect(activity);
      return;
    }
    if (navigable) onNavigate(activity.link);
  }
  return (
    <div className="w-full rounded-xl p-3 transition-colors hover:bg-[hsl(var(--muted))]">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={handleClick}
          disabled={!clickable}
          className={`flex flex-1 min-w-0 items-start gap-3 text-left ${
            clickable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${sevClass}`}
          >
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-[hsl(var(--foreground))] line-clamp-2">
              {activity.summary}
            </span>
            <span className="mt-1 flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[hsl(var(--muted))] text-[10px] font-semibold">
                {actorInitials(activity.actor)}
              </span>
              <span className="truncate">{actorLabel(activity.actor)}</span>
              <span>·</span>
              <span>{formatRelative(activity.createdAt)}</span>
            </span>
          </span>
        </button>
        {hasChanges ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Ocultar cambios" : "Ver cambios"}
            aria-expanded={expanded}
            className="mt-1 shrink-0 rounded-lg p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {hasChanges && expanded ? (
        <ActivityChanges changes={changes} changeLabels={changeLabels} />
      ) : null}
    </div>
  );
}

function groupByDay(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = new Map();
  for (const item of items) {
    const d = new Date(item.createdAt);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    let key;
    if (day.getTime() === today.getTime()) key = "Hoy";
    else if (day.getTime() === yesterday.getTime()) key = "Ayer";
    else
      key = day.toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "short",
      });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.entries());
}

/**
 * <ActivityTimeline />
 * Embeddable activity list. Filtered to an entity when entityType+entityId
 * are provided; otherwise shows the recent feed.
 *
 * Props:
 *  - sdk: instance of createRunlyClient
 *  - token: access token
 *  - entityType?: string
 *  - entityId?: string
 *  - limit?: number (default 50)
 *  - onNavigate?: (href: string) => void
 *  - newActivity?: object — when set, prepended to the list (used for realtime)
 *  - emptyMessage?: string
 *  - heightClass?: tailwind height class for the scroll container
 */
export function ActivityTimeline({
  sdk,
  token,
  entityType,
  entityId,
  limit = 50,
  onNavigate,
  onSelect,
  newActivity = null,
  refreshKey = 0,
  emptyMessage = "Sin actividad registrada.",
  heightClass = "max-h-[60dvh]",
  items: controlledItems,
  loading: controlledLoading,
  error: controlledError,
  changeLabels = null,
}) {
  const isControlled = Array.isArray(controlledItems);
  const [internalItems, setItems] = useState([]);
  const [internalLoading, setLoading] = useState(!isControlled);
  const [internalError, setError] = useState(null);
  const items = isControlled ? controlledItems : internalItems;
  const loading = isControlled ? Boolean(controlledLoading) : internalLoading;
  const error = isControlled ? (controlledError ?? null) : internalError;

  const fetchKey = `${entityType ?? "global"}:${entityId ?? "all"}:${limit}:${refreshKey}`;

  const fetcher = useMemo(() => {
    if (!sdk?.activity) return null;
    if (entityType && entityId) {
      return () =>
        sdk.activity.listForEntity(entityType, entityId, token, limit);
    }
    return () => sdk.activity.recent(token, limit);
  }, [sdk, token, entityType, entityId, limit]);

  async function load() {
    if (isControlled) return;
    if (!fetcher) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher();
      setItems(res?.data ?? []);
    } catch (err) {
      setError(err?.message || "No se pudo cargar la actividad.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isControlled) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, token, isControlled]);

  useEffect(() => {
    if (isControlled) return;
    if (!newActivity) return;
    if (entityType && entityId) {
      if (
        newActivity.entityType !== entityType ||
        newActivity.entityId !== entityId
      ) {
        return;
      }
    }
    setItems((prev) => {
      if (prev.some((p) => p.id === newActivity.id)) return prev;
      return [newActivity, ...prev].slice(0, limit);
    });
  }, [newActivity, entityType, entityId, limit]);

  if (loading && items.length === 0) {
    return (
      <div className={`overflow-y-auto p-2 space-y-2 ${heightClass}`}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 rounded-xl bg-[hsl(var(--muted))] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${heightClass}`}
      >
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No se pudo cargar la actividad.
        </p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--muted))]"
        >
          <RefreshCw size={14} /> Reintentar
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={`flex items-center justify-center p-6 text-center ${heightClass}`}
      >
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {emptyMessage}
        </p>
      </div>
    );
  }

  const groups = groupByDay(items);
  return (
    <div className={`overflow-y-auto ${heightClass}`}>
      {groups.map(([day, list]) => (
        <div key={day} className="px-2 pb-3">
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
            {day}
          </p>
          <div className="space-y-0.5">
            {list.map((a) => (
              <ActivityItem
                key={a.id}
                activity={a}
                onNavigate={onNavigate}
                onSelect={onSelect}
                changeLabels={changeLabels}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ActivityTimeline;
