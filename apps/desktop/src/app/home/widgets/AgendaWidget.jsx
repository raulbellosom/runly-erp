import { useMemo } from "react";
import { runly } from "../../../lib/runly";
import { WidgetFrame, unwrap, useWidgetQuery } from "./WidgetFrame";

const MAX_EVENTS = 4;
const DAY_MS = 86_400_000;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayLabel(date, today) {
  const diff = Math.round((startOfDay(date) - today) / DAY_MS);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  const s = date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function timeLabel(ev) {
  if (ev.allDay) return "Todo el día";
  return new Date(ev.startAt).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
}

export function AgendaWidget({ module }) {
  // Range is fixed per mount: now -> +7 days.
  const range = useMemo(() => {
    const now = new Date();
    return { start: now.toISOString(), end: new Date(now.getTime() + 7 * DAY_MS).toISOString() };
  }, []);
  const query = useWidgetQuery(["agenda", range.start.slice(0, 13)], (token) =>
    runly.calendar.listEvents(token, range),
  );

  const events = useMemo(() => {
    const list = unwrap(query.data);
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list
      .filter((ev) => ev?.startAt && new Date(ev.endAt ?? ev.startAt).getTime() >= now)
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  }, [query.data]);

  const today = startOfDay(new Date());
  const shown = events.slice(0, MAX_EVENTS);
  let lastLabel = null;

  return (
    <WidgetFrame
      module={module}
      title="Agenda"
      subtitle="Próximos 7 días"
      query={query}
      isEmpty={events.length === 0}
      emptyText="Sin eventos en los próximos 7 días."
    >
      <ol className="space-y-1">
        {shown.map((ev) => {
          const start = new Date(ev.startAt);
          const label = dayLabel(start, today);
          const showLabel = label !== lastLabel;
          lastLabel = label;
          return (
            <li key={`${ev.id}-${ev.startAt}`}>
              {showLabel && (
                <p className="pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] first:pt-0">
                  {label}
                </p>
              )}
              <div className="flex items-center gap-2.5 py-0.5">
                <span
                  aria-hidden
                  className="h-7 w-1 shrink-0 rounded-full"
                  style={{ background: ev.calendar?.color ?? ev.color ?? "hsl(var(--muted-foreground))" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight text-[hsl(var(--foreground))]">
                    {ev.title || "Sin título"}
                  </p>
                  <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {timeLabel(ev)}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {events.length > MAX_EVENTS && (
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          +{events.length - MAX_EVENTS} eventos más
        </p>
      )}
    </WidgetFrame>
  );
}
