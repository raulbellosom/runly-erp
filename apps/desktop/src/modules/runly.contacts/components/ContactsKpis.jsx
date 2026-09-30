import { Skeleton, cn } from "@runly/ui";
import { TYPE_OPTIONS, TYPE_COLOR } from "../constants.js";

// KPI strip: active total, one tile per contact type and the inactive count.
// `onSelect(value)` filters the list by a tile ("all", a type, or "inactive");
// `active` highlights the current filter.
export function ContactsKpis({ summary, isLoading, active = null, onSelect = null }) {
  const total = summary?.total ?? 0;
  const tiles = [
    { value: "all", label: "Activos", count: total, color: null },
    ...TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label, count: summary?.byType?.[t.value] ?? 0, color: TYPE_COLOR[t.value] })),
    { value: "inactive", label: "Inactivos", count: summary?.inactive ?? 0, color: "#94a3b8" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => {
        const share = total && TYPE_COLOR[tile.value] ? Math.round((tile.count / total) * 100) : null;
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag
            key={tile.value}
            type={onSelect ? "button" : undefined}
            onClick={onSelect ? () => onSelect(tile.value) : undefined}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition-colors",
              active === tile.value ? "border-(--brand-primary) bg-(--brand-soft)" : "border-[hsl(var(--border))]",
              onSelect && "hover:bg-[hsl(var(--muted))]/40",
            )}
          >
            <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              {tile.color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tile.color }} /> : null}
              {tile.label}
            </p>
            {isLoading ? <Skeleton className="mt-1.5 h-6 w-12" /> : (
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">{tile.count}</span>
                {share !== null ? <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{share}%</span> : null}
              </p>
            )}
          </Tag>
        );
      })}
    </div>
  );
}
