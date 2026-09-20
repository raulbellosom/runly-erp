import { ArrowLeft } from "lucide-react";
import { cn } from "../lib/utils.js";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  compact,
  onBack,
  backLabel = "Volver",
  loading,
  className,
}) {
  const backButton = onBack && (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] mb-1.5 transition-colors"
    >
      <ArrowLeft size={11} />
      {backLabel}
    </button>
  );

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-4 pb-4",
          className,
        )}
      >
        <div className="min-w-0">
          {backButton}
          {eyebrow && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5 truncate">
              {eyebrow}
            </p>
          )}
          {loading ? (
            <div className="h-6 w-40 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
          ) : (
            <h1 className="text-xl font-semibold tracking-tight text-[hsl(var(--foreground))] truncate">
              {title}
            </h1>
          )}
        </div>
        {actions && (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 [&>*]:min-w-0">
            {actions}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {backButton}
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
            {eyebrow}
          </p>
        )}
        {loading ? (
          <div className="space-y-1.5">
            <div className="h-7 w-44 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
            <div className="h-4 w-56 rounded bg-[hsl(var(--muted))] animate-pulse opacity-70" />
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">
              {title}
            </h1>
            {description && (
              <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                {description}
              </p>
            )}
          </>
        )}
      </div>
      {actions && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:min-w-0">
          {actions}
        </div>
      )}
    </div>
  );
}
