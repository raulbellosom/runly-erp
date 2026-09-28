import { useId, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "../lib/utils.js";

// Multi-value creatable tag input. `suggestions` are existing tags; the user
// can pick one or create a new tag with Enter / comma. Matching is
// case-insensitive so "Mayorista" and "mayorista" never both get added.
export function TagsComboboxField({
  label,
  value = [],
  onChange,
  suggestions = [],
  onSearchChange,
  placeholder = "Buscar o crear...",
  maxTags = 20,
  maxLength = 40,
  disabled = false,
  error,
  hint,
  className,
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const taken = useMemo(() => new Set(value.map((tag) => tag.toLowerCase())), [value]);
  const trimmed = query.trim();

  const matches = useMemo(
    () =>
      suggestions
        .filter((tag) => !taken.has(tag.toLowerCase()))
        .filter((tag) => !trimmed || tag.toLowerCase().includes(trimmed.toLowerCase()))
        .slice(0, 8),
    [suggestions, taken, trimmed],
  );
  const canCreate = trimmed && !taken.has(trimmed.toLowerCase())
    && !matches.some((tag) => tag.toLowerCase() === trimmed.toLowerCase());

  function add(tag) {
    const clean = tag.trim().slice(0, maxLength);
    if (!clean || taken.has(clean.toLowerCase()) || value.length >= maxTags) return;
    onChange?.([...value, clean]);
    setQuery("");
    onSearchChange?.("");
  }

  function remove(tag) {
    onChange?.(value.filter((item) => item !== tag));
  }

  function handleKeyDown(event) {
    if ((event.key === "Enter" || event.key === ",") && trimmed) {
      event.preventDefault();
      add(matches.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) ?? trimmed);
    } else if (event.key === "Backspace" && !query && value.length) {
      remove(value[value.length - 1]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showMenu = open && !disabled && (matches.length > 0 || canCreate);

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-[hsl(var(--foreground))]">
          {label}
        </label>
      )}
      <div className="relative">
        <div
          className={cn(
            "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-[hsl(var(--background))] px-2 py-1.5",
            "focus-within:ring-2 focus-within:ring-[hsl(var(--ring))]",
            error ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--input))]",
            disabled && "opacity-60",
          )}
        >
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/10 px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--primary))]"
            >
              {tag}
              {!disabled && (
                <button type="button" onClick={() => remove(tag)} aria-label={`Quitar ${tag}`} className="rounded-full hover:opacity-70">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          <input
            id={inputId}
            value={query}
            disabled={disabled || value.length >= maxTags}
            onChange={(event) => {
              setQuery(event.target.value);
              onSearchChange?.(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={handleKeyDown}
            placeholder={value.length ? "" : placeholder}
            className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          />
        </div>
        {showMenu && (
          <ul
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1 shadow-lg"
          >
            {matches.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(tag)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[hsl(var(--accent))]"
                >
                  {tag}
                </button>
              </li>
            ))}
            {canCreate && (
              <li>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(trimmed)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))]"
                >
                  <Plus className="h-3.5 w-3.5" /> Crear «{trimmed}»
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {error ? (
        <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
      ) : null}
    </div>
  );
}
