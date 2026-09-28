import { forwardRef } from "react";
import { cn } from "../lib/utils.js";

const Textarea = forwardRef(function Textarea(
  { className, error, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-xl border bg-transparent px-3 py-2 text-base sm:text-sm shadow-sm transition-colors resize-y",
        "placeholder:text-[hsl(var(--muted-foreground))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error
          ? "border-red-500 focus-visible:ring-red-500/40"
          : "border-[hsl(var(--input))] focus-visible:ring-indigo-500/40",
        "glass-subtle",
        className,
      )}
      {...props}
    />
  );
});

export { Textarea };
