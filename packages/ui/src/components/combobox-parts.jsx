// packages/ui/src/components/combobox-parts.jsx
//
// Shared pieces behind ComboboxField, RelationSelectField and
// CreatableComboboxField: keyboard navigation (ArrowUp/Down, Tab/Shift+Tab,
// Home/End, Enter, Escape), the dropdown panel/option styling (same glass
// surface as Popover/DateField so every picker reads as one family) and the
// inline "Crear «X»" row shown only once the typed text has no exact match.
import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { cn } from "../lib/utils.js";

export const dropdownPanelCls = "glass-strong rounded-xl shadow-lg overflow-hidden";

export function optionCls({ active, selected, disabled }) {
  return cn(
    "w-full text-left px-2.5 py-2 text-sm rounded-md transition-colors duration-100 flex items-center gap-2 outline-none",
    selected ? "text-foreground font-medium" : "text-foreground/90",
    active
      ? "bg-foreground/10"
      : selected
        ? "bg-foreground/[0.06]"
        : "hover:bg-foreground/[0.06]",
    disabled && "opacity-50 cursor-not-allowed pointer-events-none",
  );
}

// True when the typed text should offer a "Crear" row: non-empty and not an
// exact (case-insensitive) match of an existing option label.
export function shouldOfferCreate(search, options) {
  const term = search.trim().toLowerCase();
  if (!term) return false;
  return !options.some((o) => String(o.label ?? "").trim().toLowerCase() === term);
}

// `count` = number of navigable rows (options + optional create row).
// `onPick(index)` runs on Enter. Rows must render `data-nav-index={i}` so the
// active one can be scrolled into view.
export function useListboxNav({ open, count, initialIndex = 0, onPick, onClose, listRef }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    if (open) setActiveIndex(count > 0 ? Math.min(Math.max(initialIndex, 0), count - 1) : -1);
    // Only on open: typing resets explicitly via resetActive().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Options can arrive after opening (remote search) or shrink while typing.
  useEffect(() => {
    if (!open) return;
    setActiveIndex((i) => (count === 0 ? -1 : i < 0 ? 0 : Math.min(i, count - 1)));
  }, [open, count]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef?.current) return;
    const el = listRef.current.querySelector(`[data-nav-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listRef]);

  function move(delta) {
    const n = countRef.current;
    if (n === 0) return;
    setActiveIndex((i) => (i < 0 ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n));
  }

  function onKeyDown(e) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Tab":
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
        break;
      case "Home":
        if (countRef.current > 0) { e.preventDefault(); setActiveIndex(0); }
        break;
      case "End":
        if (countRef.current > 0) { e.preventDefault(); setActiveIndex(countRef.current - 1); }
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < countRef.current) onPick(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        break;
      default:
    }
  }

  function resetActive(nextCount) {
    setActiveIndex(nextCount > 0 ? 0 : -1);
  }

  return { activeIndex, setActiveIndex, onKeyDown, resetActive };
}

// Opens the dropdown from the closed trigger with ArrowDown/ArrowUp.
export function triggerKeyDown(open, openFn) {
  return (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      openFn();
    }
  };
}

export function SearchRow({ inputRef, value, onChange, onClear, onKeyDown, placeholder, flipped, activeId }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5",
        flipped ? "border-t border-foreground/10" : "border-b border-foreground/10",
      )}
    >
      <Search size={13} className="text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onClear}
          aria-label="Limpiar búsqueda"
          className="flex items-center justify-center h-4 w-4 rounded-full bg-foreground/10 hover:bg-foreground/20 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

export function CreateOption({ id, index, active, term, text, isCreating, disabled, onClick, onHover }) {
  return (
    <button
      id={id}
      type="button"
      tabIndex={-1}
      role="option"
      aria-selected={active}
      data-nav-index={index}
      disabled={disabled || isCreating}
      onClick={onClick}
      onMouseEnter={onHover}
      className={cn(
        "w-full text-left px-2.5 py-2 text-sm rounded-md transition-colors duration-100 flex items-center gap-2.5 outline-none",
        active ? "bg-primary/20" : "bg-primary/10 hover:bg-primary/20",
        (disabled || isCreating) && "opacity-50 cursor-not-allowed",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Plus size={12} strokeWidth={2.5} />
      </span>
      {isCreating ? (
        <span className="text-foreground">Creando...</span>
      ) : text ? (
        <span className="min-w-0 truncate text-foreground font-medium">{text}</span>
      ) : (
        <span className="min-w-0 truncate text-foreground">
          Crear <span className="font-semibold">&ldquo;{term}&rdquo;</span>
        </span>
      )}
    </button>
  );
}
