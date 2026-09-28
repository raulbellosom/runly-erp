import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, EmptyState, ErrorState, Skeleton, cn } from "@runly/ui";
import { ArrowUpRight, FileText, History, Ticket, TrendingUp } from "lucide-react";

const MODULE_META = {
  "runly.growth": { label: "Growth", icon: TrendingUp },
  "custom.dispatch": { label: "Despachos", icon: Ticket },
  "runly.files": { label: "Archivos", icon: FileText },
};

function dayKey(value) {
  return new Date(value).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function ContactActivityTab({ activity, isLoading, isError }) {
  const navigate = useNavigate();
  const [moduleFilter, setModuleFilter] = useState(null);
  const items = activity?.items ?? [];
  const modules = useMemo(() => [...new Set(items.map((item) => item.module))], [items]);

  const groups = useMemo(() => {
    const filtered = moduleFilter ? items.filter((item) => item.module === moduleFilter) : items;
    const map = new Map();
    for (const item of filtered) {
      const key = dayKey(item.occurredAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [items, moduleFilter]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }
  if (isError) return <ErrorState title="No se pudo cargar la actividad" />;
  if (!items.length) {
    return (
      <EmptyState
        icon={History}
        title="Aún no hay actividad con este contacto"
        description="Aquí aparecerán leads, vales y archivos relacionados."
      />
    );
  }

  return (
    <div className="space-y-5">
      {modules.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[null, ...modules].map((key) => (
            <button
              key={key ?? "all"}
              type="button"
              onClick={() => setModuleFilter(key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                moduleFilter === key
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
              )}
            >
              {key ? MODULE_META[key]?.label ?? key : "Todo"}
            </button>
          ))}
        </div>
      )}

      {groups.map(([day, dayItems]) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">{day}</h3>
          <ol className="relative space-y-2 border-l border-[hsl(var(--border))] pl-5">
            {dayItems.map((item) => {
              const meta = MODULE_META[item.module] ?? { label: item.module, icon: History };
              const Icon = meta.icon;
              const clickable = Boolean(item.url);
              return (
                <li key={item.id} className="relative">
                  <span className="absolute -left-[29px] top-3 flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
                  </span>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && navigate(item.url)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left",
                      clickable && "transition-colors hover:border-[hsl(var(--primary))]",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.meta && <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{item.meta}</p>}
                    </div>
                    <Badge variant="outline" className="hidden sm:inline-flex">{meta.label}</Badge>
                    <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
                      {new Date(item.occurredAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {clickable && <ArrowUpRight className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
