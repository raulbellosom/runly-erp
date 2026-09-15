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
//   bare: when true, renders as flat divided columns with no per-tile Card,
//         for callers (HeroContainer) that place this beneath a `bare`
//         DetailHero inside one shared outer card.
export function StatStrip({ items, className, bare = false }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return null;

  if (bare) {
    return (
      <div
        className={cn(
          "grid grid-cols-2 divide-x divide-y divide-[hsl(var(--border))] border-t border-[hsl(var(--border))] sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6",
          className,
        )}
      >
        {list.map((item) => {
          const body = (
            <div className="flex h-full flex-col justify-center gap-1 px-4 py-3 sm:px-5">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                <StatIcon name={item.icon} className="h-3 w-3 shrink-0" />
                {item.label}
              </span>
              <span className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                {item.value}
              </span>
            </div>
          );

          if (item.href) {
            return (
              <a
                key={item.key}
                href={item.href}
                className="block transition-colors hover:bg-[hsl(var(--muted))]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-inset"
              >
                {body}
              </a>
            );
          }
          return <div key={item.key}>{body}</div>;
        })}
      </div>
    );
  }

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
            variant="shell"
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
