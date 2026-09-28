import { Card } from "./Card.jsx";
import { cn } from "../lib/utils.js";

// A titled card — standardizes the repeated "heading + action + body"
// container pattern. `variant` passes through to Card ('default' = solid).
export function SectionCard({
  title,
  description,
  action,
  children,
  variant = "default",
  className,
  bodyClassName,
  padded = true,
}) {
  return (
    <Card variant={variant} className={cn(padded && "p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h3 className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}
