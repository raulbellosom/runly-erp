import { cn } from "../../lib/utils.js";

// Record header for detail screens: icon tile, title, subtitle, badges and
// actions. Stacks on phones.
export function DetailHeader({ title, subtitle, icon: Icon, badges, actions, className }) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:p-5", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {Icon && (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
          {badges && <div className="flex flex-wrap gap-1.5 pt-0.5">{badges}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
