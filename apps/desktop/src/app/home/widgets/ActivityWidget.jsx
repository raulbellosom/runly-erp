import { PersonAvatar } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { WidgetFrame, unwrap, useWidgetQuery } from "./WidgetFrame";

const rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto", style: "short" });

function timeAgo(iso) {
  const secs = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(secs);
  if (abs < 60) return "ahora";
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(secs / 3600), "hour");
  return rtf.format(Math.round(secs / 86_400), "day");
}

export function ActivityWidget({ module }) {
  const query = useWidgetQuery(["activity-recent"], (token) => runly.activity.recent(token, 4));
  const items = unwrap(query.data) ?? [];

  return (
    <WidgetFrame
      module={module}
      title="Actividad reciente"
      query={query}
      isEmpty={items.length === 0}
      emptyText="Sin actividad reciente."
    >
      <ul className="space-y-2">
        {items.slice(0, 4).map((item) => (
          <li key={item.id} className="flex items-start gap-2.5">
            <PersonAvatar
              name={item.actor?.displayName ?? "Sistema"}
              src={item.actor?.avatarUrl ?? null}
              size="sm"
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-xs leading-snug text-[hsl(var(--foreground))]">
                {item.summary}
              </p>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{timeAgo(item.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
