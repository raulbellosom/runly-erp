import { forwardRef } from "react";
import { cn } from "../lib/utils.js";

const Input = forwardRef(function Input(
  { className, type, error, ...props },
  ref,
) {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border bg-transparent px-3 py-1 text-base sm:h-9 sm:text-sm shadow-sm transition-colors",
        "placeholder:text-[hsl(var(--muted-foreground))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        error
          ? "border-red-500 focus-visible:ring-red-500/40"
          : "border-[hsl(var(--input))]",
        "glass-subtle",
        className,
      )}
      {...props}
    />
  );
});

export { Input };
