import { Search, X } from "lucide-react";
import { cn } from "../lib/utils.js";

export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = "Buscar...",
  className,
  ...props
}) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-3 z-10 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="glass-subtle h-10 w-full rounded-lg border border-[hsl(var(--border))] pl-9 pr-8 text-base sm:h-9 sm:text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-1"
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={onClear ?? (() => onChange({ target: { value: "" } }))}
          className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
