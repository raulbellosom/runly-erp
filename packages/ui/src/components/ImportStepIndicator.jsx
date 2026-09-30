import { Check } from "lucide-react";
import { cn } from "../lib/utils.js";

// Shared step rail for multi-step import wizards (runly.ledger's AI and
// manual CSV/XLSX importers). Renders as a narrow vertical rail on desktop
// so wizard chrome doesn't eat width from the step's own content (a review
// table), and collapses to a single compact horizontal strip on mobile.
// `layout="bar"`: a horizontal stepper with connectors, for wizards that live
// in a dialog where the step content sits below instead of beside the steps.
export function ImportStepIndicator({ steps, current, className, layout = "rail" }) {
  const currentIdx = steps.findIndex((s) => s.key === current);

  if (layout === "bar") {
    return (
      <ol className={cn("flex items-center gap-2", className)}>
        {steps.map((step, idx) => {
          const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
          return (
            <li key={step.key} className={cn("flex min-w-0 items-center gap-2", idx < steps.length - 1 && "flex-1")}>
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  state === "active" && "bg-(--brand-primary) text-(--brand-primary-foreground) ring-4 ring-(--brand-soft)",
                  state === "done" && "bg-(--brand-soft) text-(--brand-primary)",
                  state === "pending" && "border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
                )}
              >
                {state === "done" ? <Check size={14} strokeWidth={2.5} /> : idx + 1}
              </span>
              <span
                className={cn(
                  "truncate text-sm",
                  state === "active" ? "font-semibold text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]",
                  state !== "active" && "hidden sm:inline",
                )}
              >
                {step.label}
              </span>
              {idx < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn("mx-1 h-px min-w-4 flex-1", idx < currentIdx ? "bg-(--brand-primary)" : "bg-[hsl(var(--border))]")}
                />
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2 sm:w-56 sm:shrink-0 sm:flex-col sm:gap-2",
        "flex-row flex-wrap",
        className,
      )}
    >
      {steps.map((step, idx) => {
        const Icon = step.icon;
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
        return (
          <div
            key={step.key}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2",
              "sm:min-w-0",
              state === "active" && "border-(--brand-primary) bg-(--brand-soft)",
              state === "done" && "border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)]",
              state === "pending" && "border-[hsl(var(--border))] bg-transparent opacity-60",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                state === "active" && "bg-(--brand-primary) text-(--brand-primary-foreground)",
                state === "done" && "bg-[hsl(var(--muted-foreground)/0.25)] text-[hsl(var(--foreground))]",
                state === "pending" && "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
              )}
            >
              {state === "done" ? <Check size={13} /> : idx + 1}
            </span>
            {/* Full label block on desktop rail; icon-only on the mobile strip */}
            <div className="min-w-0 hidden sm:block">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Paso {idx + 1}
              </div>
              <div className="text-xs font-medium truncate flex items-center gap-1">
                <Icon size={12} className="shrink-0" />
                {step.label}
              </div>
            </div>
            <Icon size={13} className="shrink-0 sm:hidden" />
          </div>
        );
      })}
    </div>
  );
}
