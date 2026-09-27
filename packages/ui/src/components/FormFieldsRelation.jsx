// packages/ui/src/components/FormFieldsRelation.jsx
//
// ComboboxField, RelationSelectField. Extracted from FormFields.jsx on
// 2026-09-25 to keep that file under the CLAUDE.md 1000-line limit —
// re-exported from FormFields.jsx unchanged so every existing import path
// (package index and sibling components) keeps working without edits.
import { useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X, Check } from "lucide-react";
import { cn } from "../lib/utils.js";
import { useIsolatedScroll } from "../hooks/useIsolatedScroll.js";
import { useComboboxPopover } from "../hooks/useComboboxPopover.js";
import { LoadingState } from "./LoadingState.jsx";
import { fieldCls, InputIcon, FieldWrapper } from "./form-field-base.jsx";
import {
  dropdownPanelCls,
  optionCls,
  shouldOfferCreate,
  useListboxNav,
  triggerKeyDown,
  SearchRow,
  CreateOption,
} from "./combobox-parts.jsx";

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

  const listRef = useRef(null);
  const listId = useId();
  const nav = useListboxNav({
    open,
    count: filtered.length,
    initialIndex: Math.max(0, filtered.findIndex((o) => o.value === value)),
    onPick: (i) => handleSelect(filtered[i]),
    onClose: close,
    listRef,
  });

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
          onKeyDown={triggerKeyDown(open, handleOpen)}
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
                dropdownPanelCls,
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              <SearchRow
                inputRef={searchRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  nav.resetActive(1);
                }}
                onClear={() => setSearch("")}
                onKeyDown={nav.onKeyDown}
                placeholder={searchPlaceholder}
                flipped={dropdownStyle.flipped}
                activeId={nav.activeIndex >= 0 ? `${listId}-${nav.activeIndex}` : undefined}
              />
              <div ref={listRef} className="max-h-52 overflow-y-auto overscroll-contain p-1" role="listbox">
                {search.length < minSearchLength ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    Escribe al menos {minSearchLength} letras para buscar
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {emptyText}
                  </p>
                ) : (
                  filtered.map((opt, i) => (
                    <button
                      key={opt.value}
                      id={`${listId}-${i}`}
                      data-nav-index={i}
                      type="button"
                      tabIndex={-1}
                      role="option"
                      aria-selected={opt.value === value}
                      onClick={() => handleSelect(opt)}
                      onMouseEnter={() => nav.setActiveIndex(i)}
                      className={optionCls({
                        active: nav.activeIndex === i,
                        selected: opt.value === value,
                      })}
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
  // The create row only appears once the user has typed something that does
  // not already exist ("empty-search" keeps the legacy open-a-blank-form row).
  const canShowCreate =
    typeof onCreate === "function" &&
    !loading &&
    !loadError &&
    (createActionMode === "empty-search"
      ? trimmedSearch.length === 0
      : shouldOfferCreate(search, options));
  const createFixedText =
    createActionMode === "empty-search" ? createActionLabel || "Crear nuevo" : null;

  const listRef = useRef(null);
  const listId = useId();
  const listOptions = loading || loadError ? [] : filtered;
  const navCount = listOptions.length + (canShowCreate ? 1 : 0);
  const nav = useListboxNav({
    open,
    count: navCount,
    initialIndex: Math.max(
      0,
      listOptions.findIndex((o) => String(o.value) === String(value)),
    ),
    onPick: (i) => {
      if (i < listOptions.length) handleSelect(listOptions[i]);
      else handleCreate();
    },
    onClose: close,
    listRef,
  });

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
          onKeyDown={triggerKeyDown(open, handleOpen)}
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
                dropdownPanelCls,
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              <SearchRow
                inputRef={searchRef}
                value={search}
                onChange={(e) => {
                  handleSearchChange(e);
                  nav.resetActive(1);
                }}
                onClear={() => {
                  setSearch("");
                  onSearchChange?.("");
                }}
                onKeyDown={nav.onKeyDown}
                placeholder="Buscar..."
                flipped={dropdownStyle.flipped}
                activeId={nav.activeIndex >= 0 ? `${listId}-${nav.activeIndex}` : undefined}
              />
              <div ref={listRef} className="max-h-52 overflow-y-auto overscroll-contain p-1" role="listbox">
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
                  !canShowCreate && (
                    <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                      {options.length === 0
                        ? typeof onCreate === "function"
                          ? "Escribe para crear un nuevo valor"
                          : "Sin opciones disponibles"
                        : "Sin resultados"}
                    </p>
                  )
                ) : (
                  filtered.map((opt, i) => {
                    const isSelected = String(opt.value) === String(value);
                    return (
                      <button
                        key={opt.value}
                        id={`${listId}-${i}`}
                        data-nav-index={i}
                        type="button"
                        tabIndex={-1}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(opt)}
                        onMouseEnter={() => nav.setActiveIndex(i)}
                        disabled={opt.disabled}
                        className={cn(
                          optionCls({
                            active: nav.activeIndex === i,
                            selected: isSelected,
                            disabled: opt.disabled,
                          }),
                          opt.meta && "py-2.5",
                        )}
                      >
                        {opt.meta ? (
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {opt.meta.badge ? (
                                <span className="inline-flex items-center rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-foreground shrink-0">
                                  {opt.meta.badge}
                                </span>
                              ) : null}
                              {opt.meta.title ? (
                                <span className="text-sm font-medium truncate text-foreground">
                                  {opt.meta.title}
                                </span>
                              ) : null}
                            </div>
                            {opt.meta.subtitle ? (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
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
                          <Check size={14} strokeWidth={2.5} className="shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })
                )}
                {canShowCreate && (
                  <div className={cn(filtered.length > 0 && "mt-1 pt-1 border-t border-foreground/10")}>
                    <CreateOption
                      index={listOptions.length}
                      id={`${listId}-${listOptions.length}`}
                      active={nav.activeIndex === listOptions.length}
                      term={trimmedSearch}
                      text={createFixedText}
                      isCreating={isCreating}
                      disabled={createDisabled}
                      onClick={handleCreate}
                      onHover={() => nav.setActiveIndex(listOptions.length)}
                    />
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}
