import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  Info,
  MessageSquare,
  Paperclip,
  Pencil,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { cn } from "../lib/utils.js";
import { PersonAvatar } from "./PersonAvatar.jsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./Sheet.jsx";
import {
  actorDisplayName,
  fieldMetaFor,
  formatAuditValue,
  formatRelativeTime,
  plainPreview,
  splitSummary,
} from "./audit-trail-format.js";
import { AuditEntryDialog } from "./AuditEntryDialog.jsx";

// Record audit trail (spec 2026-10-03-audit-trail-design): who changed what
// and when, with the field-level diff inline. Reads
// GET /activity/entity/:entityType/:entityId (cursor-paginated, category and
// actor filters). The card shows the latest entries; "Ver historial
// completo" opens a Sheet with filters by person and "Cargar más".
//
// Props: apiBaseUrl, token, companyId, entityType, entityId,
//   changeLabels ({ [field]: { label, type, options } }), limit (card, 8),
//   refreshKey (bump to refetch), emptyMessage.

const CATEGORY_META = {
  created: { label: "Creación", Icon: PlusCircle, cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" },
  updated: { label: "Ediciones", Icon: Pencil, cls: "text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300" },
  status: { label: "Estado", Icon: ShieldCheck, cls: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300" },
  assignment: { label: "Asignaciones", Icon: UserCheck, cls: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300" },
  comment: { label: "Comentarios", Icon: MessageSquare, cls: "text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300" },
  file: { label: "Archivos", Icon: Paperclip, cls: "text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-300" },
  other: { label: "Otros", Icon: Info, cls: "text-slate-600 bg-slate-100 dark:bg-slate-800/60 dark:text-slate-300" },
};
const FILTERS = ["all", "updated", "status", "assignment", "comment", "file", "created"];
const VISIBLE_CHANGES = 2;

function joinUrl(base, path) {
  return `${String(base ?? "").replace(/\/+$/, "")}${path}`;
}

function useAuditEntries({ apiBaseUrl, token, companyId, entityType, entityId, pageSize, category, actorId, refreshKey, enabled = true }) {
  const [state, setState] = useState({ items: [], nextCursor: null, loading: true, error: null });
  const requestRef = useRef(0);

  const fetchPage = useCallback(
    async (before = null) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (before) params.set("before", before);
      if (category && category !== "all") params.set("category", category);
      if (actorId) params.set("actorId", actorId);
      const res = await fetch(
        joinUrl(apiBaseUrl, `/activity/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?${params}`),
        { headers: buildApiHeaders(token, companyId) },
      );
      if (!res.ok) throw new Error("No se pudo cargar el historial.");
      const json = await res.json();
      return { items: Array.isArray(json?.data) ? json.data : [], nextCursor: json?.nextCursor ?? null };
    },
    [apiBaseUrl, token, companyId, entityType, entityId, pageSize, category, actorId],
  );

  const reload = useCallback(async () => {
    if (!enabled || !token || !entityType || !entityId) return;
    const requestId = ++requestRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const page = await fetchPage();
      if (requestId === requestRef.current) setState({ ...page, loading: false, error: null });
    } catch (err) {
      if (requestId === requestRef.current) setState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, [enabled, token, entityType, entityId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor) return;
    const requestId = requestRef.current;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const page = await fetchPage(state.nextCursor);
      if (requestId === requestRef.current) {
        setState((prev) => ({ items: [...prev.items, ...page.items], nextCursor: page.nextCursor, loading: false, error: null }));
      }
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, [fetchPage, state.nextCursor]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  // Other users edit the record too: refresh when the tab regains focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  return { ...state, reload, loadMore };
}

function ChangeRow({ change, changeLabels }) {
  const meta = fieldMetaFor(changeLabels, change.field);
  const oldText = plainPreview(formatAuditValue(change.oldValue, meta));
  const newText = plainPreview(formatAuditValue(change.newValue, meta));
  return (
    <li className="flex min-w-0 items-center gap-1 text-xs leading-5">
      <span className="shrink-0 font-medium text-[hsl(var(--muted-foreground))]">{meta.label}:</span>
      <span className="min-w-0 max-w-[40%] truncate text-[hsl(var(--muted-foreground))] line-through decoration-[hsl(var(--muted-foreground))]/50">{oldText}</span>
      <ArrowRight className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-semibold text-[hsl(var(--foreground))]">{newText}</span>
    </li>
  );
}

// One compact row per entry: at most VISIBLE_CHANGES one-line diffs; the
// whole row opens AuditEntryDialog with the complete change.
function AuditEntry({ entry, changeLabels, onOpen }) {
  const meta = CATEGORY_META[entry.category] ?? CATEGORY_META.other;
  const name = actorDisplayName(entry.actor);
  const changes = Array.isArray(entry.payload?.changes) ? entry.payload.changes : [];
  const shown = changes.slice(0, VISIBLE_CHANGES);
  const hidden = changes.length - shown.length;
  const created = new Date(entry.createdAt);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="group relative flex w-full gap-3 rounded-xl px-1.5 py-3 text-left transition-colors hover:bg-[hsl(var(--muted))]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <div className="relative shrink-0">
          <PersonAvatar name={name} src={entry.actor?.avatarUrl ?? null} size="md" />
          <span className={cn("absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full ring-2 ring-[hsl(var(--card))]", meta.cls)}>
            <meta.Icon className="h-2.5 w-2.5" aria-hidden />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-5 text-[hsl(var(--foreground))]">
            <span className="font-semibold">{name}</span> {splitSummary(entry.summary, name)}
          </p>
          <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]" title={created.toLocaleString("es-MX")}>
            {formatRelativeTime(created)} · {meta.label === "Otros" ? "Actividad" : meta.label}
          </p>
          {shown.length > 0 ? (
            <ul className="mt-2 space-y-0.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-2.5 py-1.5">
              {shown.map((change) => <ChangeRow key={change.field} change={change} changeLabels={changeLabels} />)}
            </ul>
          ) : null}
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-(--brand-primary) opacity-80 group-hover:opacity-100">
            {hidden > 0 ? `+${hidden} ${hidden === 1 ? "cambio" : "cambios"} · ` : ""}Ver detalle
            <ChevronRight className="h-3 w-3" aria-hidden />
          </p>
        </div>
      </button>
    </li>
  );
}

function FilterChips({ value, onChange }) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {FILTERS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            value === key
              ? "border-(--brand-primary) bg-(--brand-soft) text-(--brand-primary)"
              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
          )}
        >
          {key === "all" ? "Todo" : CATEGORY_META[key].label}
        </button>
      ))}
    </div>
  );
}

function EntryList({ query, changeLabels, emptyMessage }) {
  const [openEntry, setOpenEntry] = useState(null);
  if (query.loading && query.items.length === 0) {
    return (
      <div className="space-y-3 py-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />)}
      </div>
    );
  }
  if (query.error && query.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No se pudo cargar el historial.</p>
        <button type="button" onClick={query.reload} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))]">
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </button>
      </div>
    );
  }
  if (query.items.length === 0) {
    return <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">{emptyMessage}</p>;
  }
  return (
    <>
      <ul className="divide-y divide-[hsl(var(--border))]/60">
        {query.items.map((entry) => <AuditEntry key={entry.id} entry={entry} changeLabels={changeLabels} onOpen={setOpenEntry} />)}
      </ul>
      <AuditEntryDialog
        entry={openEntry}
        open={Boolean(openEntry)}
        onOpenChange={(open) => { if (!open) setOpenEntry(null); }}
        changeLabels={changeLabels}
        categoryLabel={openEntry ? (CATEGORY_META[openEntry.category] ?? CATEGORY_META.other).label : ""}
      />
    </>
  );
}

function FullHistorySheet({ open, onOpenChange, baseProps, changeLabels, emptyMessage }) {
  const [category, setCategory] = useState("all");
  const [actorId, setActorId] = useState(null);
  const [actors, setActors] = useState([]);
  const query = useAuditEntries({ ...baseProps, pageSize: 25, category, actorId, enabled: open });

  // People seen so far stay selectable even after filtering by one of them.
  useEffect(() => {
    setActors((prev) => {
      const map = new Map(prev.map((a) => [a.id, a]));
      for (const item of query.items) if (item.actor?.id && !map.has(item.actor.id)) map.set(item.actor.id, item.actor);
      return map.size === prev.length ? prev : [...map.values()];
    });
  }, [query.items]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-3 border-b border-[hsl(var(--border))] px-5 pb-4 pr-12">
          <div>
            <SheetTitle>Historial de cambios</SheetTitle>
            <SheetDescription>Quién cambió qué y cuándo en este registro.</SheetDescription>
          </div>
          <FilterChips value={category} onChange={setCategory} />
          {actors.length > 1 ? (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
              <button
                type="button"
                onClick={() => setActorId(null)}
                className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs", !actorId ? "border-(--brand-primary) text-(--brand-primary)" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]")}
              >
                Todas las personas
              </button>
              {actors.map((actor) => (
                <button
                  key={actor.id}
                  type="button"
                  onClick={() => setActorId(actor.id === actorId ? null : actor.id)}
                  className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs", actor.id === actorId ? "border-(--brand-primary) text-(--brand-primary)" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]")}
                >
                  <PersonAvatar name={actorDisplayName(actor)} src={actor.avatarUrl ?? null} size="xs" />
                  {actorDisplayName(actor)}
                </button>
              ))}
            </div>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          <EntryList query={query} changeLabels={changeLabels} emptyMessage={emptyMessage} />
          {query.nextCursor ? (
            <div className="py-3 text-center">
              <button
                type="button"
                onClick={query.loadMore}
                disabled={query.loading}
                className="rounded-lg border border-[hsl(var(--border))] px-4 py-1.5 text-sm hover:bg-[hsl(var(--muted))] disabled:opacity-60"
              >
                {query.loading ? "Cargando..." : "Cargar más"}
              </button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AuditTrail({
  apiBaseUrl,
  token,
  companyId = null,
  entityType,
  entityId,
  changeLabels = null,
  limit = 8,
  refreshKey = 0,
  emptyMessage = "Sin cambios registrados todavía.",
}) {
  const [category, setCategory] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const baseProps = useMemo(
    () => ({ apiBaseUrl, token, companyId, entityType, entityId, refreshKey }),
    [apiBaseUrl, token, companyId, entityType, entityId, refreshKey],
  );
  const query = useAuditEntries({ ...baseProps, pageSize: limit, category });

  return (
    <div className="space-y-2">
      <FilterChips value={category} onChange={setCategory} />
      <EntryList query={query} changeLabels={changeLabels} emptyMessage={emptyMessage} />
      {query.items.length > 0 ? (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="w-full rounded-lg border border-[hsl(var(--border))] py-1.5 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
        >
          Ver historial completo
        </button>
      ) : null}
      <FullHistorySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        baseProps={baseProps}
        changeLabels={changeLabels}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

export default AuditTrail;
