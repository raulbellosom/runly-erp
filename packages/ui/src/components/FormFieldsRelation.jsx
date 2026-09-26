// packages/ui/src/components/FormFieldsRelation.jsx
//
// ComboboxField, RelationSelectField. Extracted from FormFields.jsx on
// 2026-09-25 to keep that file under the CLAUDE.md 1000-line limit —
// re-exported from FormFields.jsx unchanged so every existing import path
// (package index and sibling components) keeps working without edits.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X, Check, Plus } from "lucide-react";
import { cn } from "../lib/utils.js";
import { useIsolatedScroll } from "../hooks/useIsolatedScroll.js";
import { useComboboxPopover } from "../hooks/useComboboxPopover.js";
import { LoadingState } from "./LoadingState.jsx";
import { fieldCls, InputIcon, FieldWrapper } from "./form-field-base.jsx";

// ─── ComboboxField ────────────────────────────────────────────────────────────

export function ComboboxField({
  label,
  id,
  required,
  error: externalError,
  hint,
  icon,
  options = [],
  value,
  onChange,
  onValueChange,
  onSearchChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados",
  minSearchLength = 0,
  className,
}) {
  const handleChange = onChange ?? onValueChange;
  const {
    open, setOpen, search, setSearch, dropdownStyle,
    containerRef, dropdownRef, searchRef, handleOpen: handlePopoverOpen, close,
  } = useComboboxPopover({ dropHeight: 260, minWidth: 220 });
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected = options.find((o) => o.value === value);

  const filtered =
    search.length >= minSearchLength
      ? options
          .filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 200)
      : minSearchLength > 0
        ? []
        : options.slice(0, 200);

  function handleOpen() {
    handlePopoverOpen(() => {
      if (options.length === 0) onSearchChange?.("");
    });
  }

  function handleSelect(opt) {
    handleChange(opt.value);
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
                <Search
                  size={13}
                  className="text-muted-foreground shrink-0"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
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
              <div className="max-h-52 overflow-y-auto overscroll-contain" role="listbox">
                {search.length < minSearchLength ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    Escribe al menos {minSearchLength} letras para buscar
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {emptyText}
                  </p>
                ) : (
                  filtered.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={opt.value === value}
                      onClick={() => handleSelect(opt)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm transition-colors duration-100 flex items-center gap-2",
                        opt.value === value
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground hover:bg-muted/50",
                      )}
                    >
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.value === value && (
                        <Check size={13} className="shrink-0 text-primary" />
                      )}
                    </button>
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

// ─── RelationSelectField ──────────────────────────────────────────────────────
// Combobox for relation fields loaded from a remote API or static list.
// Supports loading/error/clear states and remote search via onSearchChange.

export function RelationSelectField({
  label,
  id,
  required,
  error: externalError,
  hint,
  icon,
  options = [],
  value,
  onChange,
  loading = false,
  loadError = null,
  onRetry,
  onSearchChange,
  clearable = false,
  createActionLabel = "Crear nuevo",
  createActionMode = "always",
  createFromSearch = false,
  createDisabled = false,
  isCreating = false,
  onCreate,
  placeholder = "Seleccionar...",
  className,
}) {
  const {
    open, setOpen, search, setSearch, dropdownStyle,
    containerRef, dropdownRef, searchRef, handleOpen: handlePopoverOpen, close,
  } = useComboboxPopover({ dropHeight: 260, minWidth: 220 });
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected =
    value != null && value !== ""
      ? options.find((o) => String(o.value) === String(value))
      : undefined;

  // Extra behavior beyond the shared hook's outside-click handling: reset the
  // remote search query when the user clicks away without selecting, so the
  // next open starts from the full option list instead of a stale filter.
  useEffect(() => {
    function handleOutsideSearchReset(e) {
      const inContainer = containerRef.current?.contains(e.target);
      const inDropdown = dropdownRef.current?.contains(e.target);
      if (!inContainer && !inDropdown && search) {
        onSearchChange?.("");
      }
    }
    document.addEventListener("mousedown", handleOutsideSearchReset);
    return () => document.removeEventListener("mousedown", handleOutsideSearchReset);
  }, [search, onSearchChange]);

  function handleOpen() {
    handlePopoverOpen(() => {
      if (options.length === 0 && !loading) onSearchChange?.("");
    });
  }

  function handleSearchChange(e) {
    const term = e.target.value;
    setSearch(term);
    onSearchChange?.(term);
  }

  function handleSelect(opt) {
    if (opt.disabled) return;
    onChange?.(opt.value);
    close();
  }

  function handleCreate() {
    if (createDisabled || typeof onCreate !== "function") return;
    const searchText = search.trim();
    onCreate(searchText);
    close();
  }

  const displayLabel =
    value != null && value !== ""
      ? selected
        ? selected.label
        : !loading
          ? "Registro no disponible"
          : null
      : null;
  const selectedMeta = selected?.meta ?? null;

  const filtered = search
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const trimmedSearch = search.trim();
  const canShowCreate =
    typeof onCreate === "function" &&
    (createActionMode === "always" ||
      (createActionMode === "empty-search" && trimmedSearch.length === 0) ||
      (createActionMode === "has-search" && trimmedSearch.length > 0));
  const createLabel = (() => {
    if (createFromSearch && trimmedSearch.length > 0)
      return `Crear "${trimmedSearch}"`;
    return createActionLabel || "Crear nuevo";
  })();

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
                "flex items-center justify-between text-left cursor-pointer gap-2",
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
              "flex-1 truncate text-sm",
              !displayLabel && !loading && "text-muted-foreground",
              displayLabel === "Registro no disponible" &&
                "text-muted-foreground italic",
            )}
          >
            {loading && value != null && value !== ""
              ? "Cargando opciones..."
              : (displayLabel ?? placeholder)}
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            {clearable && value != null && value !== "" && !loading && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Limpiar selección"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange?.(null);
                }}
                className="flex items-center justify-center h-4 w-4 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
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
                <Search
                  size={13}
                  className="text-muted-foreground shrink-0"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={handleSearchChange}
                  placeholder="Buscar..."
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      onSearchChange?.("");
                    }}
                    className="flex items-center justify-center h-4 w-4 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto overscroll-contain" role="listbox">
                {loading ? (
                  <LoadingState size="sm" message="Cargando opciones..." />
                ) : loadError ? (
                  <div className="px-3 py-4 text-center space-y-2">
                    <p className="text-xs text-destructive">
                      No se pudieron cargar las opciones
                    </p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
                      >
                        Reintentar
                      </button>
                    )}
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {options.length === 0
                      ? "Sin opciones disponibles"
                      : "Sin resultados"}
                  </p>
                ) : (
                  filtered.map((opt) => {
                    const isSelected = String(opt.value) === String(value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(opt)}
                        disabled={opt.disabled}
                        className={cn(
                          "w-full text-left px-3 transition-colors duration-100 flex items-center gap-2",
                          opt.meta ? "py-2.5" : "py-2",
                          isSelected
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover:bg-muted/50",
                          opt.disabled &&
                            "opacity-50 cursor-not-allowed pointer-events-none",
                        )}
                      >
                        {opt.meta ? (
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {opt.meta.badge ? (
                                <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary shrink-0">
                                  {opt.meta.badge}
                                </span>
                              ) : null}
                              {opt.meta.title ? (
                                <span
                                  className={cn(
                                    "text-sm font-medium truncate",
                                    isSelected
                                      ? "text-primary"
                                      : "text-foreground",
                                  )}
                                >
                                  {opt.meta.title}
                                </span>
                              ) : null}
                            </div>
                            {opt.meta.subtitle ? (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                                {opt.meta.subtitle}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="flex-1 truncate text-sm">
                            {opt.label}
                          </span>
                        )}
                        {isSelected && (
                          <Check size={13} className="shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })
                )}
                {canShowCreate && (
                  <>
                    <div className="mx-3 my-1 border-t border-border" />
                    <button
                      type="button"
                      role="option"
                      onClick={handleCreate}
                      disabled={createDisabled || isCreating}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm transition-colors duration-100 flex items-center gap-2",
                        "text-primary hover:bg-primary/5",
                        (createDisabled || isCreating) &&
                          "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Plus size={14} className="shrink-0" />
                      <span className="font-medium">
                        {isCreating ? "Creando..." : createLabel}
                      </span>
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
