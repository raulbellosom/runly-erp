import { Check } from "lucide-react";
import { cn } from "../lib/utils.js";

// Horizontal step tracker for multi-stage AI flows (capture -> read -> review
// -> confirm), so the user always knows where they are in the flow instead of
// facing a single long form with no sense of progress.
export function AIFlowSteps({ steps, activeIndex = 0, className }) {
  return (
    <ol className={cn("flex flex-wrap items-start gap-x-1 gap-y-3", className)} aria-label="Progreso del flujo">
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={step.key ?? index} className="flex items-start">
            <div className="flex items-start gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  !done && !active && "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
                  active && "ring-2 ring-offset-2 ring-offset-[hsl(var(--background))]",
                )}
                style={
                  done || active
                    ? { background: "var(--brand-primary)", color: "var(--brand-primary-foreground)", "--tw-ring-color": "var(--brand-primary)" }
                    : undefined
                }
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="max-w-[9rem] leading-tight">
                <p className={cn("text-xs font-medium", !active && !done && "text-[hsl(var(--muted-foreground))]")}>{step.label}</p>
                {step.description && (
                  <p className="hidden text-[10px] text-[hsl(var(--muted-foreground))] sm:block">{step.description}</p>
                )}
              </div>
            </div>
            {index < steps.length - 1 && <span className="mx-2 mt-3.5 hidden h-px w-8 bg-[hsl(var(--border))] sm:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
