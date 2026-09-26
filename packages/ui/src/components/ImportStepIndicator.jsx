import { Check } from "lucide-react";
import { cn } from "../lib/utils.js";

// Shared step rail for multi-step import wizards (runly.ledger's AI and
// manual CSV/XLSX importers). Renders as a narrow vertical rail on desktop
// so wizard chrome doesn't eat width from the step's own content (a review
// table), and collapses to a single compact horizontal strip on mobile.
export function ImportStepIndicator({ steps, current, className }) {
  const currentIdx = steps.findIndex((s) => s.key === current);

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
