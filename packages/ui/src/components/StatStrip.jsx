import * as LucideIcons from "lucide-react";
import { Card } from "./Card.jsx";
import { cn } from "../lib/utils.js";

function StatIcon({ name, className }) {
  const Icon = name && LucideIcons[name];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" />;
}

// Responsive key-figures strip.
//   items: [{ key, label, value (ReactNode), icon (lucide name), href }]
// Mobile: horizontal snap-scroll carousel. sm+: 3-up grid. lg+: 6-up grid.
export function StatStrip({ items, className }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return null;

  return (
    <div
      className={cn(
        "flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6",
        className,
      )}
    >
      {list.map((item) => {
        const body = (
          <Card
            variant="default"
            className="flex h-full min-w-[150px] snap-start flex-col justify-between gap-2 p-3 sm:min-w-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {item.label}
              </span>
              <StatIcon
                name={item.icon}
                className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
              />
            </div>
            <span className="block truncate text-sm font-semibold text-[hsl(var(--foreground))]">
              {item.value}
            </span>
          </Card>
        );

        if (item.href) {
          return (
            <a
              key={item.key}
              href={item.href}
              className="block shrink-0 snap-start rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] sm:shrink"
            >
              {body}
            </a>
          );
        }
        return (
          <div key={item.key} className="shrink-0 snap-start sm:shrink">
            {body}
          </div>
        );
      })}
    </div>
  );
}
