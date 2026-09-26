// packages/ui/src/components/FormFieldsCreatable.jsx
//
// CreatableComboboxField, CarColorPickerField (+ ColorOption/isLightColor
// helpers). Extracted from FormFields.jsx on 2026-09-25 to keep that file
// under the CLAUDE.md 1000-line limit — re-exported from FormFields.jsx
// unchanged so every existing import path (package index and sibling
// components) keeps working without edits.
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X, Check } from "lucide-react";
import { cn } from "../lib/utils.js";
import { useIsolatedScroll } from "../hooks/useIsolatedScroll.js";
import { useComboboxPopover, computeDropdownStyle } from "../hooks/useComboboxPopover.js";
import { fieldCls, InputIcon, FieldWrapper } from "./form-field-base.jsx";

// ─── CreatableComboboxField ───────────────────────────────────────────────────
// Same as ComboboxField but shows a "+ Crear «X»" option when the search term
// does not match any existing entry. Calls `onCreate(name)` when chosen.

export function CreatableComboboxField({
  label,
  id,
  required,
  error: externalError,
  hint,
  icon,
  options = [],
  value,
  onChange,
  onCreate,
  isCreating = false,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados",
  className,
}) {
  const {
    open, setOpen, search, setSearch, dropdownStyle,
    containerRef, dropdownRef, searchRef, handleOpen: handlePopoverOpen, close,
  } = useComboboxPopover({ dropHeight: 260, minWidth: 220 });
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected = options.find((o) => o.value === value);

  const filtered = options
    .filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 200);

  const trimmed = search.trim();
  const showCreate =
    typeof onCreate === "function" &&
    trimmed.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  function handleOpen() {
    handlePopoverOpen();
  }

  function handleSelect(opt) {
    onChange(opt.value);
    close();
  }

  function handleCreate() {
    if (!trimmed || isCreating) return;
    onCreate(trimmed);
    close();
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={externalError}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          type="button"
          id={id}
          onClick={handleOpen}
          className={cn(
            fieldCls(
              externalError,
              cn(
                "flex items-center justify-between text-left cursor-pointer",
                icon && "pl-9",
              ),
            ),
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <InputIcon icon={icon} />
          <span
            className={cn(
              "truncate",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={cn(
              "text-muted-foreground/60 shrink-0 ml-2 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>

        {open &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(dropdownStyle.flipped
                  ? { bottom: dropdownStyle.bottom }
                  : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
                pointerEvents: "auto",
              }}
              className={cn(
                "glass-shell rounded-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              <div className={cn(
                "flex items-center gap-2 px-3 py-2",
                dropdownStyle.flipped ? "border-t border-border" : "border-b border-border",
              )}>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && showCreate) {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto overscroll-contain" role="listbox">
                {filtered.length === 0 && !showCreate && (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {emptyText}
                  </p>
                )}
                {filtered.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    onClick={() => handleSelect(opt)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors duration-100",
                      opt.value === value
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted/50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
                {showCreate && (
                  <>
                    {filtered.length > 0 && (
                      <div className="mx-3 my-1 border-t border-border" />
                    )}
                    <button
                      type="button"
                      role="option"
                      disabled={isCreating}
                      onClick={handleCreate}
                      className="w-full text-left px-3 py-2 text-sm transition-colors duration-100 flex items-center gap-2 text-primary hover:bg-primary/5 disabled:opacity-50 disabled:cursor-wait font-medium"
                    >
                      <span className="text-base leading-none">+</span>
                      {isCreating ? (
                        <span>Creando...</span>
                      ) : (
                        <span>
                          Crear{" "}
                          <span className="text-foreground font-semibold">
                            &ldquo;{trimmed}&rdquo;
                          </span>
                        </span>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}

// ─── CarColorPickerField ──────────────────────────────────────────────────────
// Searchable color picker for vehicle colors.
// `colors` prop: [{ name, hex, group }]  — passed from the renderer.
// Stores the color NAME as value, not hex.

export function CarColorPickerField({
  label,
  id,
  required,
  error: externalError,
  hint,
  value,
  onChange,
  colors = [],
  clearable = true,
  placeholder = "Seleccionar color...",
  className,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected = colors.find((c) => c.name === value) ?? null;

  // resolve hex for any stored value (name or legacy #hex)
  function resolveHex(v) {
    if (!v) return null;
    if (String(v).startsWith("#")) return String(v);
    return colors.find((c) => c.name === v)?.hex ?? null;
  }
  const selectedHex = resolveHex(value);

  const groups = [...new Set(colors.map((c) => c.group))];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? colors.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.group.toLowerCase().includes(term),
      )
    : null;

  useEffect(() => {
    function handleOutside(e) {
      if (
        !containerRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function handleOpen() {
    if (!open && containerRef.current) {
      setDropdownStyle(
        computeDropdownStyle(containerRef.current, 320, 260, true),
      );
    }
    setOpen((o) => !o);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function handleSelect(color) {
    onChange(color.name);
    setOpen(false);
    setSearch("");
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange(null);
  }

  function isSelected(color) {
    return color.name === value || color.hex === value;
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={externalError}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          type="button"
          id={id}
          onClick={handleOpen}
          className={cn(
            fieldCls(
              externalError,
              "flex items-center gap-2.5 text-left cursor-pointer pr-3",
            ),
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {selectedHex ? (
            <span
              className="h-5 w-5 shrink-0 rounded-full border border-border/60 shadow-sm"
              style={{ backgroundColor: selectedHex }}
            />
          ) : (
            <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/30" />
          )}
          <span
            className={cn(
              "flex-1 truncate text-sm",
              selected || value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selected
              ? selected.name
              : value && !value.startsWith("#")
                ? value
                : placeholder}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {clearable && value && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="flex items-center justify-center h-4 w-4 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Limpiar color"
              >
                <X size={10} />
              </span>
            )}
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              className={cn(
                "text-muted-foreground/60 transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          </span>
        </button>

        {open &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(dropdownStyle.flipped
                  ? { bottom: dropdownStyle.bottom }
                  : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
              }}
              className={cn(
                "rounded-xl border border-border/80 bg-card text-foreground shadow-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              {/* Search */}
              <div className={cn(
                "flex items-center gap-2 px-3 py-2",
                dropdownStyle.flipped ? "border-t border-border" : "border-b border-border",
              )}>
                <Search
                  size={13}
                  className="text-muted-foreground shrink-0"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar color..."
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="flex items-center justify-center h-4 w-4 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto overscroll-contain" role="listbox">
                {/* Clear option */}
                {clearable && value && !term && (
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      onChange(null);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 border-b border-border/50"
                  >
                    <X size={11} />
                    Sin color
                  </button>
                )}

                {/* Filtered flat list */}
                {term ? (
                  filtered.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                      Sin resultados
                    </p>
                  ) : (
                    filtered.map((color) => (
                      <ColorOption
                        key={color.name}
                        color={color}
                        selected={isSelected(color)}
                        onSelect={handleSelect}
                      />
                    ))
                  )
                ) : (
                  /* Grouped list */
                  groups.map((group) => (
                    <div key={group}>
                      <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
                        {group}
                      </p>
                      {colors
                        .filter((c) => c.group === group)
                        .map((color) => (
                          <ColorOption
                            key={color.name}
                            color={color}
                            selected={isSelected(color)}
                            onSelect={handleSelect}
                          />
                        ))}
                    </div>
                  ))
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}

function ColorOption({ color, selected, onSelect }) {
  const isLight = isLightColor(color.hex);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(color)}
      className={cn(
        "w-full text-left px-3 py-1.5 text-sm transition-colors duration-100 flex items-center gap-2.5",
        selected
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "h-5 w-5 shrink-0 rounded-full border shadow-sm",
          isLight ? "border-border/80" : "border-transparent",
        )}
        style={{ backgroundColor: color.hex }}
      />
      <span className="flex-1 truncate">{color.name}</span>
      {selected && <Check size={13} className="shrink-0 text-primary" />}
    </button>
  );
}

function isLightColor(hex) {
  if (!hex || !hex.startsWith("#")) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 180;
}
