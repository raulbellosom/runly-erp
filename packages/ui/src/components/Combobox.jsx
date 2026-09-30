// packages/ui/src/components/Combobox.jsx
//
// The single select/combobox engine of @runly/ui. SelectField, ComboboxField,
// CreatableComboboxField, RelationSelectField and CarColorPickerField are thin
// presets over it — adapt behaviour through props instead of forking a new
// dropdown.
//
// Options: string | {
//   value, label, disabled?,
//   group?,                        // section header ("Recientes", "Todos")
//   icon?,                         // lucide component or React element
//   avatar?,                       // URL | { src?, name? } (initials fallback)
//   color?,                        // CSS color → round swatch
//   description?, hint?, badge?,   // 2nd line, trailing muted text, pill
//   keywords?,                     // extra search terms
//   meta?: { title, subtitle, badge } // legacy RelationSelectField shape
// }
//
// Behaviour: animated open/close (origin-aware scale + fade, staggered rows,
// sliding active highlight), autofocus of the search box on open, match
// highlighting, grouped sections, results count, empty / loading / error
// states, inline "Crear «X»" footer, clear button, multi-select with chips,
// full keyboard support and focus return to the trigger.
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { useIsolatedScroll } from "../hooks/useIsolatedScroll.js";
import { useComboboxPopover } from "../hooks/useComboboxPopover.js";
import { fieldCls, FieldWrapper } from "./form-field-base.jsx";
import { optionMatchesSearch, shouldOfferCreate, useListboxNav } from "./combobox-parts.jsx";
import {
  ComboboxEmpty,
  ComboboxError,
  ComboboxSearch,
  ComboboxSkeleton,
  CreateFooter,
  GroupHeader,
  OptionRow,
  OptionVisual,
} from "./combobox-rows.jsx";

const EXIT_MS = 110;
const STAGGER_ROWS = 10;
const STAGGER_STEP_MS = 18;
const STAGGER_WINDOW_MS = 480;

export function sameValue(a, b) {
  return a === b || (a != null && b != null && String(a) === String(b));
}

function normalizeOption(o) {
  return typeof o === "object" && o !== null ? o : { value: o, label: String(o) };
}

function isEmptyValue(v, multiple) {
  return multiple ? !Array.isArray(v) || v.length === 0 : v == null || v === "";
}

// Mount/unmount with an exit window so the panel can animate out.
function usePresence(open) {
  const [phase, setPhase] = useState("closed");
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(frame);
    }
    setPhase((p) => (p === "closed" ? p : "closing"));
    const timer = setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted: open || phase === "closing", visible: open && phase === "open" };
}

export const Combobox = forwardRef(function Combobox(
  {
    label,
    id,
    required,
    error,
    hint,
    icon: LeadingIcon,
    className,
    triggerClassName,
    options: rawOptions = [],
    value,
    onChange,
    onValueChange,
    multiple = false,
    maxChips = 3,
    placeholder = "Seleccionar...",
    searchPlaceholder = "Buscar...",
    searchable = true,
    onSearchChange,
    filter = true,
    minSearchLength = 0,
    maxResults = 200,
    emptyText = "Sin resultados",
    emptyDescription,
    loading = false,
    loadError = null,
    onRetry,
    clearable = false,
    disabled = false,
    missingLabel,
    onCreate,
    createMode = "search",
    createLabel,
    isCreating = false,
    createDisabled = false,
    onOpenChange,
    dropHeight = 340,
    minWidth = 240,
  },
  ref,
) {
  const emit = onChange ?? onValueChange;
  const options = rawOptions.map(normalizeOption);
  const {
    open, search, setSearch, dropdownStyle,
    containerRef, dropdownRef, searchRef, handleOpen: togglePopover, close,
  } = useComboboxPopover({ dropHeight, minWidth });
  useIsolatedScroll(dropdownRef, open);
  const { mounted, visible } = usePresence(open);

  const triggerRef = useRef(null);
  const setTriggerRef = useCallback(
    (node) => {
      triggerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // While the panel animates out, keep rendering the list as it was (the
  // popover hook clears the search on close).
  const lastSearchRef = useRef("");
  if (open) lastSearchRef.current = search;
  const effSearch = open ? search : lastSearchRef.current;
  const term = effSearch.trim();

  // Remote-search callers get their filter reset once the panel closes, and
  // everyone gets notified of open/close (SelectField validates on close).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onOpenChange?.(open);
    if (!open && lastSearchRef.current) onSearchChange?.("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [staggering, setStaggering] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    setStaggering(true);
    const timer = setTimeout(() => setStaggering(false), STAGGER_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // ── Selection ──────────────────────────────────────────────────────────────
  const values = multiple ? (Array.isArray(value) ? value : []) : [];
  const isSelected = (opt) =>
    multiple ? values.some((v) => sameValue(v, opt.value)) : sameValue(value, opt.value);
  const selected = multiple ? null : options.find((o) => sameValue(o.value, value));
  const selectedList = multiple
    ? values.map((v) => options.find((o) => sameValue(o.value, v)) ?? { value: v, label: String(v) })
    : [];
  const hasValue = !isEmptyValue(value, multiple);

  // ── Filtering + grouping ───────────────────────────────────────────────────
  const tooShort = minSearchLength > 0 && effSearch.length < minSearchLength;
  const matched = tooShort
    ? []
    : filter && term
      ? options.filter((o) => optionMatchesSearch(o, term))
      : options;
  const groupOrder = [];
  const byGroup = new Map();
  for (const o of matched) {
    const key = o.group ?? "";
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      groupOrder.push(key);
    }
    byGroup.get(key).push(o);
  }
  const visibleOptions = groupOrder.flatMap((g) => byGroup.get(g)).slice(0, maxResults);
  const showGroups = !term && groupOrder.some((g) => g !== "");

  const listOptions = loading || loadError ? [] : visibleOptions;
  const canCreate =
    typeof onCreate === "function" &&
    !loading &&
    !loadError &&
    (createMode === "empty-search" ? term.length === 0 : shouldOfferCreate(effSearch, options));
  const showSearch = searchable === "auto" ? options.length > 8 || typeof onCreate === "function" : searchable;

  // ── Actions ────────────────────────────────────────────────────────────────
  function handleOpen() {
    if (disabled) return;
    togglePopover(() => {
      if (options.length === 0 && !loading) onSearchChange?.("");
    });
  }

  function closeAndFocus() {
    close();
    triggerRef.current?.focus({ preventScroll: true });
  }

  function pick(opt) {
    if (!opt || opt.disabled) return;
    if (multiple) {
      emit?.(isSelected(opt) ? values.filter((v) => !sameValue(v, opt.value)) : [...values, opt.value]);
      return;
    }
    emit?.(opt.value);
    closeAndFocus();
  }

  function handleCreate() {
    if (createDisabled || isCreating || typeof onCreate !== "function") return;
    if (createMode !== "empty-search" && !term) return;
    onCreate(term);
    closeAndFocus();
  }

  function clearSelection(e) {
    e.preventDefault();
    e.stopPropagation();
    emit?.(multiple ? [] : null);
  }

  function removeChip(e, v) {
    e.preventDefault();
    e.stopPropagation();
    emit?.(values.filter((x) => !sameValue(x, v)));
  }

  const listRef = useRef(null);
  const listId = useId();
  const optionId = (i) => `${listId}-opt-${i}`;
  const firstSelectedIndex = listOptions.findIndex(isSelected);
  const nav = useListboxNav({
    open,
    count: listOptions.length + (canCreate ? 1 : 0),
    initialIndex: Math.max(0, firstSelectedIndex),
    onPick: (i) => (i < listOptions.length ? pick(listOptions[i]) : handleCreate()),
    onClose: closeAndFocus,
    listRef,
  });
  const activeId = nav.activeIndex >= 0 ? optionId(nav.activeIndex) : undefined;

  function handleSearchChange(e) {
    setSearch(e.target.value);
    onSearchChange?.(e.target.value);
    nav.resetActive(1);
  }

  // Without a search box the listbox itself takes focus: add type-ahead so a
  // letter jumps to the next option starting with it.
  function handleListKeyDown(e) {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const n = listOptions.length;
      for (let step = 1; step <= n; step += 1) {
        const i = (Math.max(nav.activeIndex, 0) + step) % n;
        if (String(listOptions[i].label ?? "").toLowerCase().startsWith(ch)) {
          nav.setActiveIndex(i);
          break;
        }
      }
      return;
    }
    nav.onKeyDown(e);
  }

  function handleTriggerKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      handleOpen();
    } else if (!open && multiple && e.key === "Backspace" && values.length > 0) {
      emit?.(values.slice(0, -1));
    }
  }

  // ── Sliding active highlight ───────────────────────────────────────────────
  const contentRef = useRef(null);
  const [highlight, setHighlight] = useState({ top: 0, height: 0, visible: false, instant: true });
  useLayoutEffect(() => {
    if (!mounted) return;
    const el =
      nav.activeIndex >= 0 && nav.activeIndex < listOptions.length
        ? contentRef.current?.querySelector(`[data-nav-index="${nav.activeIndex}"]`)
        : null;
    setHighlight((prev) => {
      if (!el) return prev.visible ? { ...prev, visible: false } : prev;
      const next = { top: el.offsetTop, height: el.offsetHeight, visible: true, instant: !prev.visible };
      return prev.top === next.top && prev.height === next.height && prev.visible ? prev : next;
    });
  }, [mounted, nav.activeIndex, effSearch, listOptions.length, loading]);

  // ── Trigger content ────────────────────────────────────────────────────────
  let triggerContent;
  if (multiple && selectedList.length > 0) {
    const shown = selectedList.slice(0, maxChips);
    const rest = selectedList.length - shown.length;
    triggerContent = (
      <span className="flex flex-1 min-w-0 flex-wrap items-center gap-1">
        {shown.map((o) => (
          <span
            key={String(o.value)}
            className="runly-cbx-pop inline-flex items-center gap-1 h-6 max-w-[11rem] rounded-md bg-foreground/[0.07] pl-1.5 pr-0.5 text-xs font-medium text-foreground"
          >
            <OptionVisual option={o} size="sm" />
            <span className="truncate">{o.label}</span>
            {!disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Quitar ${o.label}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => removeChip(e, o.value)}
                className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={10} strokeWidth={2.5} />
              </span>
            )}
          </span>
        ))}
        {rest > 0 && <span className="px-1 text-xs font-medium text-muted-foreground">+{rest}</span>}
      </span>
    );
  } else {
    const missing = !multiple && hasValue && !selected;
    const text = selected
      ? selected.meta?.title ?? selected.label
      : missing && loading
        ? "Cargando..."
        : missing && missingLabel
          ? missingLabel
          : placeholder;
    triggerContent = (
      <span
        className={cn(
          "flex-1 min-w-0 truncate",
          selected ? "text-foreground" : "text-muted-foreground",
          missing && missingLabel && !loading && "italic",
        )}
      >
        {text}
      </span>
    );
  }
  const leading = LeadingIcon ? (
    <LeadingIcon size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
  ) : (
    <OptionVisual option={selected} />
  );

  // ── Panel body ─────────────────────────────────────────────────────────────
  function renderBody() {
    if (loading) return <ComboboxSkeleton />;
    if (loadError) return <ComboboxError onRetry={onRetry} />;
    if (tooShort) {
      return (
        <ComboboxEmpty
          title="Escribe para buscar"
          description={`Ingresa al menos ${minSearchLength} caracteres.`}
        />
      );
    }
    if (listOptions.length === 0) {
      if (canCreate && term) {
        return (
          <p className="px-3 py-3 text-xs text-muted-foreground text-center">
            Sin coincidencias para &laquo;{term}&raquo;
          </p>
        );
      }
      if (options.length === 0) {
        return (
          <ComboboxEmpty
            title="Sin opciones"
            description={typeof onCreate === "function" ? "Escribe para crear un nuevo valor." : emptyDescription}
          />
        );
      }
      return (
        <ComboboxEmpty
          title={emptyText}
          description={emptyDescription ?? `No encontramos coincidencias con «${term}».`}
        />
      );
    }

    const rows = [];
    let lastGroup = null;
    listOptions.forEach((opt, i) => {
      const g = opt.group ?? "";
      if (showGroups && g !== lastGroup) {
        if (g) rows.push(<GroupHeader key={`g-${g}`} label={g} first={lastGroup === null} />);
        else if (lastGroup !== null) rows.push(<div key="g-none" className="mt-1 border-t border-foreground/[0.06] pt-1" />);
        lastGroup = g;
      }
      rows.push(
        <OptionRow
          key={String(opt.value)}
          id={optionId(i)}
          index={i}
          option={opt}
          active={nav.activeIndex === i}
          selected={isSelected(opt)}
          multiple={multiple}
          search={term}
          staggerDelay={staggering && i < STAGGER_ROWS ? i * STAGGER_STEP_MS : null}
          onPick={pick}
          onHover={() => nav.activeIndex !== i && nav.setActiveIndex(i)}
        />,
      );
    });
    return (
      <>
        {term && (
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground select-none">
            {matched.length > listOptions.length
              ? `Mostrando ${listOptions.length} de ${matched.length}`
              : `${listOptions.length} ${listOptions.length === 1 ? "resultado" : "resultados"}`}
          </div>
        )}
        <div ref={contentRef} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 rounded-lg bg-foreground/[0.065] dark:bg-foreground/[0.09]",
              !highlight.instant && "transition-[transform,height,opacity] duration-150 ease-out motion-reduce:transition-none",
              highlight.visible ? "opacity-100" : "opacity-0",
            )}
            style={{ transform: `translateY(${highlight.top}px)`, height: highlight.height }}
          />
          {rows}
        </div>
      </>
    );
  }

  const flipped = Boolean(dropdownStyle.flipped);

  return (
    <FieldWrapper label={label} labelFor={id} error={error} hint={hint} required={required}>
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          ref={setTriggerRef}
          type="button"
          id={id}
          disabled={disabled}
          onClick={handleOpen}
          onKeyDown={handleTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className={fieldCls(
            error,
            cn(
              "group flex items-center gap-2 text-left cursor-pointer select-none",
              multiple && selectedList.length > 0 && "h-auto min-h-11 py-1.5 pl-2",
              open && !error && "border-primary ring-2 ring-primary/20 hover:border-primary",
              triggerClassName,
            ),
          )}
        >
          {leading}
          {triggerContent}
          {clearable && hasValue && !disabled && !loading && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpiar selección"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearSelection}
              className="runly-cbx-pop flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors cursor-pointer"
            >
              <X size={12} strokeWidth={2.25} />
            </span>
          )}
          <ChevronDown
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className={cn(
              "shrink-0 transition-[transform,color] duration-200 ease-out motion-reduce:transition-none",
              open ? "rotate-180 text-foreground" : "text-muted-foreground/70 group-hover:text-muted-foreground",
            )}
          />
        </button>

        {mounted &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(flipped ? { bottom: dropdownStyle.bottom } : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
                pointerEvents: open ? "auto" : "none",
              }}
              className={cn(
                "glass-strong flex flex-col overflow-hidden rounded-xl",
                "transition-[opacity,transform] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                flipped ? "origin-bottom" : "origin-top",
                visible
                  ? "opacity-100 scale-100 translate-y-0 duration-200"
                  : cn("opacity-0 scale-[0.97] duration-100", flipped ? "translate-y-1" : "-translate-y-1"),
              )}
            >
              {showSearch && (
                <ComboboxSearch
                  inputRef={searchRef}
                  value={effSearch}
                  onChange={handleSearchChange}
                  onClear={() => {
                    setSearch("");
                    onSearchChange?.("");
                    nav.resetActive(1);
                    searchRef.current?.focus();
                  }}
                  onKeyDown={nav.onKeyDown}
                  placeholder={searchPlaceholder}
                  busy={loading && Boolean(term)}
                  listId={listId}
                  activeId={activeId}
                />
              )}
              <div
                ref={(node) => {
                  listRef.current = node;
                  if (!showSearch) searchRef.current = node;
                }}
                id={listId}
                role="listbox"
                aria-multiselectable={multiple || undefined}
                aria-activedescendant={showSearch ? undefined : activeId}
                tabIndex={showSearch ? undefined : -1}
                onKeyDown={showSearch ? undefined : handleListKeyDown}
                className="max-h-64 overflow-y-auto overscroll-contain p-1 outline-none"
              >
                {renderBody()}
              </div>
              {canCreate && (
                <CreateFooter
                  id={optionId(listOptions.length)}
                  index={listOptions.length}
                  active={nav.activeIndex === listOptions.length}
                  term={term}
                  text={createMode === "empty-search" ? createLabel || "Crear nuevo" : createLabel}
                  isCreating={isCreating}
                  disabled={createDisabled}
                  onClick={handleCreate}
                  onHover={() => nav.activeIndex !== listOptions.length && nav.setActiveIndex(listOptions.length)}
                />
              )}
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
});
