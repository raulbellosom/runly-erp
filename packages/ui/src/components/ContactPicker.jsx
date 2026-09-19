import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./Input.jsx";
import { FieldWrapper } from "./FormFields.jsx";
import { Button } from "./Button.jsx";
import { Search, UserRound, X } from "lucide-react";

export function ContactPicker({
  label = "Contacto",
  value = null,
  onChange,
  searchContacts,
  placeholder = "Buscar contacto...",
  hint,
  error,
  disabled = false,
  minQueryLength = 1,
  emptyText = "Sin resultados",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState([]);
  const rootRef = useRef(null);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    return value.name ?? value.label ?? "";
  }, [value]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!open || typeof searchContacts !== "function") return;

    const q = query.trim();
    if (q.length < minQueryLength) {
      setOptions([]);
      return;
    }

    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchContacts(q);
        if (!active) return;
        setOptions(Array.isArray(result) ? result : []);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [minQueryLength, open, query, searchContacts]);

  function clearSelection() {
    onChange?.(null);
    setQuery("");
    setOpen(false);
  }

  function pick(option) {
    onChange?.(option);
    setQuery("");
    setOpen(false);
  }

  return (
    <FieldWrapper label={label} error={error} hint={hint}>
      <div ref={rootRef} className="relative">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={open ? query : selectedLabel}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            className="pl-8 pr-20 h-11"
          />
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 px-2"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {open && !disabled && (
          <div className="absolute z-50 mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              {query.trim().length < minQueryLength ? (
                <p className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                  Escribe al menos {minQueryLength} caracter{minQueryLength > 1 ? "es" : ""}.
                </p>
              ) : loading ? (
                <p className="px-3 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                  Buscando...
                </p>
              ) : options.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                  {emptyText}
                </p>
              ) : (
                options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="w-full px-3 py-2.5 text-left hover:bg-[hsl(var(--muted))/0.6] transition-colors"
                    onClick={() => pick(option)}
                  >
                    <div className="flex items-start gap-2">
                      <UserRound className="h-4 w-4 mt-0.5 text-[hsl(var(--muted-foreground))]" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{option.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                          {option.email || option.phone || option.taxId || "Sin datos adicionales"}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </FieldWrapper>
  );
}
