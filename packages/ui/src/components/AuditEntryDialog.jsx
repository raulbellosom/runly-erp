import { ArrowDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./Dialog.jsx";
import { MarkdownViewer } from "./MarkdownViewer.jsx";
import { PersonAvatar } from "./PersonAvatar.jsx";
import { cn } from "../lib/utils.js";
import { actorDisplayName, fieldMetaFor, formatAuditValue, isRichValue, splitSummary } from "./audit-trail-format.js";

// Full detail of one audit-trail entry: who, when, what happened and every
// changed field with its complete before/after value (markdown rendered).
// Header stays fixed; only the change list scrolls.

function ValueBlock({ label, value, meta, tone }) {
  const empty = value === null || value === undefined || value === "";
  const rich = !empty && isRichValue(value, meta);
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5",
        tone === "old"
          ? "border-rose-200/70 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20"
          : "border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20",
      )}
    >
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
      {empty ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">—</p>
      ) : rich ? (
        <MarkdownViewer value={String(value)} className="text-sm" />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--foreground))]">{formatAuditValue(value, meta)}</p>
      )}
    </div>
  );
}

export function AuditEntryDialog({ entry, open, onOpenChange, changeLabels = null, categoryLabel = "" }) {
  if (!entry) return null;
  const name = actorDisplayName(entry.actor);
  const changes = Array.isArray(entry.payload?.changes) ? entry.payload.changes : [];
  const created = new Date(entry.createdAt);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-full max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4 pr-12">
          <div className="flex items-start gap-3">
            <PersonAvatar name={name} src={entry.actor?.avatarUrl ?? null} size="md" />
            <div className="min-w-0">
              <DialogTitle className="text-base leading-6">
                <span className="font-semibold">{name}</span>{" "}
                <span className="font-normal">{splitSummary(entry.summary, name)}</span>
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {created.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" })}
                {categoryLabel ? ` · ${categoryLabel}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {changes.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Este movimiento no tiene cambios de campos registrados.</p>
          ) : (
            changes.map((change) => {
              const meta = fieldMetaFor(changeLabels, change.field);
              return (
                <section key={change.field} className="space-y-2">
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{meta.label}</h3>
                  <div className="grid gap-2">
                    <ValueBlock label="Antes" value={change.oldValue} meta={meta} tone="old" />
                    <ArrowDown className="mx-auto h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden />
                    <ValueBlock label="Después" value={change.newValue} meta={meta} tone="new" />
                  </div>
                </section>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AuditEntryDialog;
