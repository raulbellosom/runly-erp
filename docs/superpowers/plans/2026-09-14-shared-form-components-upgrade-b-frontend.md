# Shared Form Components Upgrade — Plan B (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Plan A (backend) must be merged first — several tasks here call the new `PATCH .../cover` / `PATCH .../reorder` endpoints and read the new `coverImageFileId`/`photo_file_id` fields.

**Spec:** `docs/superpowers/specs/2026-09-14-shared-form-components-upgrade-design.md`

**Goal:** iOS-style cascading navigation for the shared date picker; one shared popover implementation behind `ComboboxField`/`RelationSelectField`/`CreatableComboboxField` with `glass-shell` styling and reliable autofocus; `AdvancedFileViewer` relocated to `packages/ui` as the system's one gallery-capable file viewer; `AttachmentsPanel` grouping images+video vs. documents by default with optional cover-selection/reorder; a new generic `image-asset` `RunlyTable` column type; Inventory and HR tables gain a first image column.

**Architecture:** Each of the 4 areas is an independent vertical slice touching different files — implement and verify them in separate task groups so a problem in one doesn't block the others. The combobox unification extracts ONLY the truly-shared plumbing (popover positioning, outside-click, autofocus) into a hook, leaving each field's distinctive rendering (badges, create-inline, loading/error) in place, to limit regression risk on three heavily-used, already-shipped components.

**Tech Stack:** React (apps/desktop, packages/ui), Tailwind, Node's built-in test runner for the one new pure-logic addition (`resolveAttachmentFileType`'s video kind).

---

## File Structure Map

**Calendar:**
- Modify: `packages/ui/src/components/date-picker-shared.jsx`

**Combobox:**
- Create: `packages/ui/src/hooks/useComboboxPopover.js`
- Modify: `packages/ui/src/components/FormFields.jsx` (`ComboboxField`, `RelationSelectField`, `CreatableComboboxField`, `CarColorPickerField`'s `computeDropdownStyle` import)

**File viewer relocation:**
- Move: `apps/desktop/src/modules/runly.files/components/AdvancedFileViewer.jsx` → `packages/ui/src/components/AdvancedFileViewer.jsx`
- Move: `apps/desktop/src/modules/runly.files/components/PDFViewer.jsx` → `packages/ui/src/components/PDFViewer.jsx`
- Move: `apps/desktop/src/modules/runly.files/components/FileVisual.jsx` → `packages/ui/src/components/FileVisual.jsx`
- Move: `apps/desktop/src/modules/runly.files/lib/file-kind.js` → `packages/ui/src/lib/file-kind.js`
- Modify: `packages/ui/package.json` (+`react-pdf` dependency)
- Modify: `packages/ui/src/index.js` (+export `AdvancedFileViewer`)
- Modify (import path only): `apps/desktop/src/app/ProfileScreen.jsx`, `apps/desktop/src/modules/runly.chat/components/ChatAttachmentViewer.jsx`, `apps/desktop/src/modules/runly.chat/components/ConversationProfilePanel.jsx`, `apps/desktop/src/modules/runly.chat/components/EntityFileViewer.jsx`, `apps/desktop/src/modules/runly.files/screens/FilesScreen.jsx`, `apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx`, `apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx`, `apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx`

**Attachments grouping + cover/reorder:**
- Modify: `packages/ui/src/hooks/useAttachmentsController.js` (video kind, cover/reorder API calls)
- Modify: `packages/ui/src/components/AttachmentsPanel.jsx` (default grid mode, Multimedia/Documentos labels, FileViewer → AdvancedFileViewer, cover/reorder UI)

**Image-asset table column:**
- Create: `packages/ui/src/runly-renderer/ImageAssetCell.jsx`
- Modify: `packages/ui/src/runly-renderer/RunlyTable.jsx` (new column type branch)

**Blueprints:**
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js` (attachments `coverPath`/`reorderPath`/`coverSelectable`)
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js` (same)
- Modify: `apps/desktop/src/modules/runly.inventory/screens/InventoryScreen.jsx` (TABLE blueprint: new first column)
- Modify: `apps/desktop/src/modules/runly.hr/screens/HrScreen.jsx` (TABLE blueprint: new first column)

---

## Task 1: iOS-style cascading navigation in the shared `Calendar`

**Files:**
- Modify: `packages/ui/src/components/date-picker-shared.jsx`

- [ ] **Step 1: Read the current file in full**

Read `packages/ui/src/components/date-picker-shared.jsx` (274 lines) to confirm the exact current text of the `Calendar` function (currently lines 106-227) before editing — it has `viewYear`/`viewMonth` state, `prevMonth`/`nextMonth`, `selectDay`, `isToday`/`isSelected`, and renders a header row + day grid.

- [ ] **Step 2: Implement**

Replace the entire `Calendar` function with this version, which adds a `view` state (`"day" | "month" | "year"`) and renders a different header + body per view, cascading day → month → year and back:

```jsx
const YEAR_PAGE_SIZE = 12;

export function Calendar({ value, onChange, onClose }) {
  const today = new Date();
  const selected = parseDate(value);

  const [viewYear, setViewYear] = useState(
    selected?.getFullYear() ?? today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    selected?.getMonth() ?? today.getMonth(),
  );
  const [view, setView] = useState("day");

  const cells = buildCalendarGrid(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  }

  function selectDay(day) {
    if (!day) return;
    onChange(toISO(viewYear, viewMonth, day));
    onClose();
  }

  function selectMonth(monthIndex) {
    setViewMonth(monthIndex);
    setView("day");
  }

  function selectYear(year) {
    setViewYear(year);
    setView("month");
  }

  const isToday = useCallback(
    (day) => {
      return (
        day &&
        today.getFullYear() === viewYear &&
        today.getMonth() === viewMonth &&
        today.getDate() === day
      );
    },
    [viewYear, viewMonth],
  );

  const isSelected = useCallback(
    (day) => {
      return (
        day &&
        selected?.getFullYear() === viewYear &&
        selected?.getMonth() === viewMonth &&
        selected?.getDate() === day
      );
    },
    [selected, viewYear, viewMonth],
  );

  const yearPageStart = viewYear - (((viewYear % YEAR_PAGE_SIZE) + YEAR_PAGE_SIZE) % YEAR_PAGE_SIZE);
  const yearPage = Array.from({ length: YEAR_PAGE_SIZE }, (_, i) => yearPageStart + i);

  const headerLeftAction =
    view === "day" ? prevMonth : view === "year" ? () => setViewYear((y) => y - YEAR_PAGE_SIZE) : () => setViewYear((y) => y - 1);
  const headerRightAction =
    view === "day" ? nextMonth : view === "year" ? () => setViewYear((y) => y + YEAR_PAGE_SIZE) : () => setViewYear((y) => y + 1);
  const headerLeftLabel = view === "day" ? "Mes anterior" : view === "year" ? "Años anteriores" : "Año anterior";
  const headerRightLabel = view === "day" ? "Mes siguiente" : view === "year" ? "Años siguientes" : "Año siguiente";

  return (
    <div className="select-none w-full">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={headerLeftAction}
          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted))] transition-colors"
          aria-label={headerLeftLabel}
        >
          <ChevronLeft size={14} />
        </button>

        {view === "day" && (
          <span className="text-sm font-semibold flex items-center gap-1">
            <button
              type="button"
              onClick={() => setView("month")}
              className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {MONTHS[viewMonth]}
            </button>
            <button
              type="button"
              onClick={() => setView("year")}
              className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {viewYear}
            </button>
          </span>
        )}
        {view === "month" && (
          <button
            type="button"
            onClick={() => setView("year")}
            className="text-sm font-semibold rounded px-1.5 py-0.5 hover:bg-[hsl(var(--muted))] transition-colors"
          >
            {viewYear}
          </button>
        )}
        {view === "year" && (
          <span className="text-sm font-semibold">
            {yearPageStart}–{yearPageStart + YEAR_PAGE_SIZE - 1}
          </span>
        )}

        <button
          type="button"
          onClick={headerRightAction}
          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted))] transition-colors"
          aria-label={headerRightLabel}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {view === "day" && (
        <>
          <div className="grid grid-cols-7 mb-1">
            {DAYS_HEADER.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-medium text-[hsl(var(--muted-foreground))] py-1"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              const sel = isSelected(day);
              const tod = isToday(day);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!day}
                  onClick={() => selectDay(day)}
                  className={cn(
                    "h-8 w-8 mx-auto flex items-center justify-center rounded-full text-sm transition-colors",
                    !day && "invisible",
                    day &&
                      !sel &&
                      !tod &&
                      "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                    tod && !sel && "font-semibold text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]",
                    sel &&
                      "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold hover:bg-[hsl(var(--primary))]/90",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === "month" && (
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS.map((label, index) => {
            const sel = index === viewMonth && viewYear === (selected?.getFullYear() ?? NaN);
            const tod = index === today.getMonth() && viewYear === today.getFullYear();
            return (
              <button
                key={label}
                type="button"
                onClick={() => selectMonth(index)}
                className={cn(
                  "h-10 rounded-lg text-xs font-medium transition-colors",
                  !sel && !tod && "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                  tod && !sel && "font-semibold text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]",
                  sel && "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
                )}
              >
                {label.slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}

      {view === "year" && (
        <div className="grid grid-cols-3 gap-1.5">
          {yearPage.map((year) => {
            const sel = year === (selected?.getFullYear() ?? NaN);
            const tod = year === today.getFullYear();
            return (
              <button
                key={year}
                type="button"
                onClick={() => selectYear(year)}
                className={cn(
                  "h-10 rounded-lg text-xs font-medium transition-colors",
                  !sel && !tod && "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                  tod && !sel && "font-semibold text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]",
                  sel && "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
                )}
              >
                {year}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

This preserves the exported `parseDate`/`toISO`/`formatDateDisplay`/date-time helpers above it (untouched) and `DateSelectorShell` below it (untouched) — only the `Calendar` function body changes.

- [ ] **Step 3: Manual verification**

`pnpm dev`, open any date field (e.g. Inventario > Nuevo activo > Compra > Fecha de compra). Confirm: clicking the month name shows a 12-month grid; clicking the year shows a paginated year grid; picking a year goes to the month grid for that year; picking a month goes to the day grid for that month; the arrows in each view page by month/year/12-years respectively.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/date-picker-shared.jsx
git commit -m "feat(ui): add cascading day/month/year navigation to the shared date picker"
```

---

## Task 2: `useComboboxPopover` shared hook

**Files:**
- Create: `packages/ui/src/hooks/useComboboxPopover.js`

- [ ] **Step 1: Read current code**

Read `packages/ui/src/components/FormFields.jsx` lines 1-101 (imports + the current module-private `computeDropdownStyle` function) to copy it exactly.

- [ ] **Step 2: Implement**

Create `packages/ui/src/hooks/useComboboxPopover.js`:

```js
import { useState, useRef, useEffect, useCallback } from "react";

// Calculates `position:fixed` coordinates for a floating dropdown anchored to
// `containerEl`. Works correctly even when the dropdown is rendered inside an
// ancestor that has `backdrop-filter` or `transform` — both properties create a
// new containing block for `position:fixed` descendants (CSS spec). In that case
// the browser treats the fixed element's top/left as relative to that ancestor,
// so we subtract the ancestor's getBoundingClientRect offsets.
export function computeDropdownStyle(
  containerEl,
  dropHeight = 320,
  minWidth = 220,
  forPortal = false,
) {
  const r = containerEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - r.bottom;
  const flipped = spaceBelow < dropHeight;
  const viewportLeft = r.left;
  const width = Math.max(r.width, minWidth);

  if (forPortal) {
    if (flipped) {
      return { bottom: window.innerHeight - r.top + 4, left: viewportLeft, width, flipped: true };
    }
    return { top: r.bottom + 4, left: viewportLeft, width, flipped: false };
  }

  const viewportTop = flipped
    ? Math.max(0, r.top - dropHeight - 4)
    : r.bottom + 4;

  let el = containerEl.parentElement;
  while (el && el !== document.documentElement) {
    const cs = window.getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    const tf = cs.transform || "none";
    if (bf !== "none" || (tf !== "none" && tf !== "matrix(1, 0, 0, 1, 0, 0)")) {
      const pr = el.getBoundingClientRect();
      return { top: viewportTop - pr.top, left: viewportLeft - pr.left, width };
    }
    el = el.parentElement;
  }

  return { top: viewportTop, left: viewportLeft, width };
}

// Shared plumbing behind ComboboxField/RelationSelectField/CreatableComboboxField:
// open state, portal position, outside-click-to-close, and reliable autofocus of
// the search input (a requestAnimationFrame after `open` flips true — fires right
// after the browser commits/paints the newly-rendered portal content, unlike the
// fixed setTimeout(50) each of the three fields used to hand-roll independently).
export function useComboboxPopover({ dropHeight = 260, minWidth = 220 } = {}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

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

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handleOpen = useCallback(
    (onWillOpen) => {
      const willOpen = !open;
      if (willOpen && containerRef.current) {
        setDropdownStyle(computeDropdownStyle(containerRef.current, dropHeight, minWidth, true));
      }
      setOpen((o) => !o);
      if (willOpen) onWillOpen?.();
    },
    [open, dropHeight, minWidth],
  );

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  return {
    open,
    setOpen,
    search,
    setSearch,
    dropdownStyle,
    containerRef,
    dropdownRef,
    searchRef,
    handleOpen,
    close,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/useComboboxPopover.js
git commit -m "feat(ui): add useComboboxPopover shared hook for the three combobox fields"
```

---

## Task 3: Refactor `ComboboxField` onto the shared hook + `glass-shell`

**Files:**
- Modify: `packages/ui/src/components/FormFields.jsx`

- [ ] **Step 1: Read the current `ComboboxField` in full**

Read `packages/ui/src/components/FormFields.jsx` lines 1667-1867 (the full current `ComboboxField` function) to have its exact current text before editing.

- [ ] **Step 2: Implement**

1. Add the import near the top of the file (alongside the other relative imports): `import { useComboboxPopover, computeDropdownStyle } from "../hooks/useComboboxPopover.js";`
2. Delete the module-private `computeDropdownStyle` function (lines 58-100) from `FormFields.jsx` — it now comes from the import.
3. In `ComboboxField`, replace this block:
```js
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);
```
with:
```js
  const {
    open, setOpen, search, setSearch, dropdownStyle,
    containerRef, dropdownRef, searchRef, handleOpen: handlePopoverOpen, close,
  } = useComboboxPopover({ dropHeight: 260, minWidth: 220 });
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);
```
4. Delete the now-redundant `useEffect` outside-click handler (the hook already installs one) — remove:
```js
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
```
5. Replace the existing `handleOpen` function:
```js
  function handleOpen() {
    const willOpen = !open;
    if (willOpen && containerRef.current) {
      setDropdownStyle(
        computeDropdownStyle(containerRef.current, 260, 220, true),
      );
    }
    setOpen((o) => !o);
    if (willOpen && options.length === 0) {
      onSearchChange?.("");
    }
    setTimeout(() => searchRef.current?.focus(), 50);
  }
```
with:
```js
  function handleOpen() {
    handlePopoverOpen(() => {
      if (options.length === 0) onSearchChange?.("");
    });
  }
```
6. Replace the existing `handleSelect` function's close logic to use the hook's `close()`:
```js
  function handleSelect(opt) {
    handleChange(opt.value);
    setOpen(false);
    setSearch("");
  }
```
becomes:
```js
  function handleSelect(opt) {
    handleChange(opt.value);
    close();
  }
```
7. Change the dropdown container's className from:
```js
              className={cn(
                "rounded-xl border border-border/80 bg-card text-foreground shadow-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
```
to:
```js
              className={cn(
                "glass-shell rounded-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
```

Everything else in `ComboboxField` (the trigger button, the search input row, the option-row rendering/filtering) stays exactly as it is today.

- [ ] **Step 3: Manual verification**

`pnpm dev`, open any plain combobox (e.g. Inventario form's "Tipo" if it used one, or any `SelectField`-adjacent combobox in the app) — confirm it still opens/filters/selects correctly, the search input is focused immediately on open, and the popover now uses the glass look in both light and dark theme.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/FormFields.jsx
git commit -m "refactor(ui): move ComboboxField onto useComboboxPopover with glass-shell styling"
```

---

## Task 4: Refactor `RelationSelectField` onto the shared hook + `glass-shell`

**Files:**
- Modify: `packages/ui/src/components/FormFields.jsx`

- [ ] **Step 1: Read the current `RelationSelectField` in full**

Read `packages/ui/src/components/FormFields.jsx` lines 1873-2214 (the full current `RelationSelectField` function) to see its exact current state/effect/handler block and its dropdown container's className (it will be the same literal string as `ComboboxField`'s pre-change one: `"rounded-xl border border-border/80 bg-card text-foreground shadow-xl overflow-hidden"`, plus the same `computeDropdownStyle(containerRef.current, 260, 220, true)` call and the same `setTimeout(() => searchRef.current?.focus(), 50)` pattern — apply the IDENTICAL transformation as Task 3, adapted to this component's own extra state (loading/error/retry/clear/meta/create-inline), which must all be preserved exactly as-is:

- Replace its local `open`/`search`/`dropdownStyle`/`containerRef`/`dropdownRef`/`searchRef` state with the same `useComboboxPopover({ dropHeight: 260, minWidth: 220 })` destructure used in Task 3 (keep any OTHER state this component has beyond those six — e.g. state related to loading/error — completely untouched).
- Remove its own outside-click `useEffect` (duplicate of the hook's).
- Replace its `handleOpen`-equivalent function's body to call `handlePopoverOpen(...)` the same way, preserving whatever extra logic it currently runs on open (e.g. triggering a remote search fetch) by passing it as the callback argument.
- Replace its select/clear handlers' `setOpen(false); setSearch("");` pairs with `close()`.
- Change its dropdown container's className to `"glass-shell rounded-xl overflow-hidden"` (plus whatever conditional `flex flex-col-reverse` it already has for the flipped case, preserved).

Do NOT change: the loading spinner, error/retry UI, the `meta` (badge/title/subtitle) two-line option rendering, the clear button, or the inline-create button/flow — none of that is part of the shared hook's responsibility.

- [ ] **Step 2: Manual verification**

`pnpm dev`, open Inventario > Nuevo activo, open the "Categoría"/"Marca"/"Ubicación" relation fields. Confirm: search still filters remotely, loading/error/retry states still work, the search input autofocuses reliably, and the popover uses `glass-shell`.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/FormFields.jsx
git commit -m "refactor(ui): move RelationSelectField onto useComboboxPopover with glass-shell styling"
```

---

## Task 5: Refactor `CreatableComboboxField` onto the shared hook + `glass-shell`

**Files:**
- Modify: `packages/ui/src/components/FormFields.jsx`

- [ ] **Step 1: Read the current `CreatableComboboxField` in full**

Read `packages/ui/src/components/FormFields.jsx` lines 2215-2442 (the full current `CreatableComboboxField` function).

- [ ] **Step 2: Implement**

Apply the identical transformation as Tasks 3-4: swap its local open/search/dropdownStyle/refs state for `useComboboxPopover(...)`, remove its duplicate outside-click effect, route its open handler through `handlePopoverOpen`, route its select/clear handlers through `close()`, and change its dropdown container's className to `"glass-shell rounded-xl overflow-hidden"`. Preserve its "+ Crear «X»" inline-create-by-name row and its `isCreating` loading state completely untouched — those are unique to this component and not part of the shared hook.

- [ ] **Step 3: Manual verification**

`pnpm dev`, use a `CreatableComboboxField` consumer (e.g. any hand-rolled screen still using it directly, or Inventario's catalogs screen if it uses one) — confirm search, select, and "+ Crear" still all work, and the popover is glass-shell styled.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/FormFields.jsx
git commit -m "refactor(ui): move CreatableComboboxField onto useComboboxPopover with glass-shell styling"
```

---

## Task 6: Relocate `AdvancedFileViewer` + dependencies to `packages/ui`

**Files:**
- Move: `apps/desktop/src/modules/runly.files/components/AdvancedFileViewer.jsx` → `packages/ui/src/components/AdvancedFileViewer.jsx`
- Move: `apps/desktop/src/modules/runly.files/components/PDFViewer.jsx` → `packages/ui/src/components/PDFViewer.jsx`
- Move: `apps/desktop/src/modules/runly.files/components/FileVisual.jsx` → `packages/ui/src/components/FileVisual.jsx`
- Move: `apps/desktop/src/modules/runly.files/lib/file-kind.js` → `packages/ui/src/lib/file-kind.js`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/index.js`

- [ ] **Step 1: Add the `react-pdf` dependency**

In `packages/ui/package.json`, add `"react-pdf": "^10.4.1"` to `dependencies` (same exact version already pinned in `apps/desktop/package.json` — check that file to confirm the exact version string before adding). Run `pnpm install` from the repo root afterward.

- [ ] **Step 2: Move the 4 files**

```bash
git mv apps/desktop/src/modules/runly.files/lib/file-kind.js packages/ui/src/lib/file-kind.js
git mv apps/desktop/src/modules/runly.files/components/FileVisual.jsx packages/ui/src/components/FileVisual.jsx
git mv apps/desktop/src/modules/runly.files/components/PDFViewer.jsx packages/ui/src/components/PDFViewer.jsx
git mv apps/desktop/src/modules/runly.files/components/AdvancedFileViewer.jsx packages/ui/src/components/AdvancedFileViewer.jsx
```

- [ ] **Step 3: Fix internal imports in the 4 moved files**

Read each of the 4 moved files and fix their own import paths, which currently point at their OLD relative location:
- `packages/ui/src/lib/file-kind.js`: currently imports `fileKindOf, fileKindLabel, fileKindAccent` from `"@runly/core"` — this is already a package import, not relative, so it needs NO change.
- `packages/ui/src/components/FileVisual.jsx`: currently imports `{ getFileKind, getKindAccent }` from `"../lib/file-kind"` — this relative path is IDENTICAL before and after the move (both were/are one level up in a sibling `lib/` dir), so it needs NO change. Also check its other imports (icons, etc. — likely from `"lucide-react"`, needs no change) for any other module-local (non-`@runly/*`, non-npm-package) import that would break; fix any found to the correct new relative path.
- `packages/ui/src/components/PDFViewer.jsx`: currently imports from `"react-pdf"` (npm package, no change) and likely some local UI primitives — check for any `"../lib/..."` or `"./..."` import referencing something NOT among these 4 moved files (e.g. a Button/Skeleton/etc. from the OLD `runly.files` module) and fix it to import from the correct `packages/ui/src/components/*.jsx` sibling instead.
- `packages/ui/src/components/AdvancedFileViewer.jsx`: currently imports `getFileKind, getKindLabel, formatBytes` from `"../lib/file-kind"` (unchanged relative path, no edit needed), `{ FileVisual }` from `"./FileVisual"` (unchanged, no edit needed), `{ PDFViewer }` from `"./PDFViewer"` (unchanged, no edit needed), `{ ContextMenu, ... }` from `"@runly/ui"` — **this one must change**, since a file INSIDE `packages/ui` cannot import from its own package's public entry point by name; change it to a relative import of the actual component file(s), e.g. `from "./ContextMenu.jsx"` (read the file first to confirm the exact current import list and the actual filename(s) those `ContextMenu*` exports live in under `packages/ui/src/components/`).

- [ ] **Step 4: Export from `packages/ui/src/index.js`**

Add `export { AdvancedFileViewer } from "./components/AdvancedFileViewer.jsx";` in the same style as the other single-component exports in that file.

- [ ] **Step 5: Verify the package builds in isolation**

Run `node --check packages/ui/src/components/AdvancedFileViewer.jsx` will fail (JSX) — instead run `pnpm --filter @runly/desktop build:web` and confirm it still succeeds even though consumers haven't been repointed yet (the moved files existing in their new location with correct internal imports, plus the still-present OLD import paths in the 8 consumer files, means the build will currently FAIL for those 8 consumers — that's expected and fixed in Task 7. This step's real purpose is to catch any internal-import mistake made in Step 3 in isolation; if you want to verify the moved files alone before Task 7, you can temporarily grep for any remaining `runly.files/components/AdvancedFileViewer` or `runly.files/components/PDFViewer` reference *inside* the 4 moved files themselves (there should be none) rather than running a full build yet).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml packages/ui/src/lib/file-kind.js packages/ui/src/components/FileVisual.jsx packages/ui/src/components/PDFViewer.jsx packages/ui/src/components/AdvancedFileViewer.jsx packages/ui/src/index.js
git commit -m "refactor(ui): relocate AdvancedFileViewer and its dependencies into packages/ui"
```

---

## Task 7: Repoint the 8 consumers to `@runly/ui`

**Files:**
- Modify (one-line import change each): `apps/desktop/src/app/ProfileScreen.jsx`, `apps/desktop/src/modules/runly.chat/components/ChatAttachmentViewer.jsx`, `apps/desktop/src/modules/runly.chat/components/ConversationProfilePanel.jsx`, `apps/desktop/src/modules/runly.chat/components/EntityFileViewer.jsx`, `apps/desktop/src/modules/runly.files/screens/FilesScreen.jsx`, `apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx`, `apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx`, `apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx`

- [ ] **Step 1: Implement**

In each of the 8 files, find and change the import line:

| File | Current import | New import |
|---|---|---|
| `apps/desktop/src/app/ProfileScreen.jsx:20` | `import { AdvancedFileViewer } from "../modules/runly.files/components/AdvancedFileViewer";` | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.chat/components/ChatAttachmentViewer.jsx:3` | `import { AdvancedFileViewer } from "../../runly.files/components/AdvancedFileViewer";` | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.chat/components/ConversationProfilePanel.jsx:9` | same pattern | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.chat/components/EntityFileViewer.jsx:12` | same pattern | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.files/screens/FilesScreen.jsx:44` | `import { AdvancedFileViewer } from "../components/AdvancedFileViewer";` | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx:43` | `import { AdvancedFileViewer } from "../../runly.files/components/AdvancedFileViewer";` | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx:44` | same pattern | `import { AdvancedFileViewer } from "@runly/ui";` |
| `apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx:28` | same pattern | `import { AdvancedFileViewer } from "@runly/ui";` |

Note some of these files may also import OTHER things (e.g. `PDFViewer`, `FileVisual`, file-kind helpers) directly from their old `runly.files` locations — if a file imports any of the OTHER 3 moved files directly (not just `AdvancedFileViewer`), repoint that import to `@runly/ui` too (check `getFileKind`/`getKindLabel`/`formatBytes`/`FileVisual` — these may or may not need to be exported from `packages/ui/src/index.js` too if any of the 8 consumers import them directly; if you find such a case, add the missing export to `packages/ui/src/index.js` alongside `AdvancedFileViewer`).

- [ ] **Step 2: Verify**

Run `pnpm --filter @runly/desktop build:web`. Expected: succeeds with no unresolved-import errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/app/ProfileScreen.jsx apps/desktop/src/modules/runly.chat/components/ChatAttachmentViewer.jsx apps/desktop/src/modules/runly.chat/components/ConversationProfilePanel.jsx apps/desktop/src/modules/runly.chat/components/EntityFileViewer.jsx apps/desktop/src/modules/runly.files/screens/FilesScreen.jsx apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx packages/ui/src/index.js
git commit -m "refactor: repoint AdvancedFileViewer consumers to @runly/ui"
```

- [ ] **Step 4: Manual regression check**

`pnpm dev` — open a file from: Identity (own profile picture in `ProfileScreen`), a chat attachment, HR's `HrEmployeeDetail`/`HrEmployeeForm` file section, `FilesScreen`, and `UserEditorScreen`. Confirm the viewer still opens, navigates (where applicable), rotates/flips/zooms as before.

---

## Task 8: `AttachmentsPanel` uses `AdvancedFileViewer` instead of `FileViewer`

**Files:**
- Modify: `packages/ui/src/components/AttachmentsPanel.jsx`

- [ ] **Step 1: Read current code**

Read `packages/ui/src/components/AttachmentsPanel.jsx` in full (896 lines), focusing on: the `FileViewer` import (line 23), the `viewerFiles`/`viewerIndex`/`controller.viewerItem`/`handleOpenAssociated` variables feeding it, and its exact current usage block (around lines 876-893):
```jsx
      <FileViewer
        open={Boolean(controller.viewerItem)}
        onClose={controller.closeViewer}
        file={controller.viewerItem}
        files={viewerFiles}
        activeIndex={viewerIndex}
        onActiveIndexChange={(nextIndex) => {
          const target = controller.associatedItems[nextIndex];
          if (!target) return;
          handleOpenAssociated(target);
        }}
        onResolveFile={async (item) => {
          if (item?.signedUrl) return item.signedUrl;
          if (!item?.fileAssetId) return null;
          return controller.resolveSignedUrl(item.fileAssetId);
        }}
        title="Documento"
      />
```

Also read `packages/ui/src/components/AdvancedFileViewer.jsx`'s prop signature (`open, onOpenChange, files, activeIndex, onIndexChange, onResolveSignedUrl, zIndex, onOpenInOffice, canOpenInOffice`) to confirm the exact prop names before adapting.

- [ ] **Step 2: Implement**

1. Change the import from `import { FileViewer } from "./FileViewer.jsx";` to `import { AdvancedFileViewer } from "./AdvancedFileViewer.jsx";`
2. Replace the usage block with:
```jsx
      <AdvancedFileViewer
        open={Boolean(controller.viewerItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) controller.closeViewer();
        }}
        files={viewerFiles}
        activeIndex={viewerIndex}
        onIndexChange={(nextIndex) => {
          const target = controller.associatedItems[nextIndex];
          if (!target) return;
          handleOpenAssociated(target);
        }}
        onResolveSignedUrl={async (item) => {
          if (item?.signedUrl) return item.signedUrl;
          if (!item?.fileAssetId) return null;
          return controller.resolveSignedUrl(item.fileAssetId);
        }}
      />
```

`AdvancedFileViewer` has no `file`/`title` props (it derives the current file from `files[activeIndex]` itself) — confirm `viewerFiles` items already carry `originalName`/`mimeType`/`fileAssetId` (they should, since `FileViewer` needed the same shape) so `AdvancedFileViewer` can render a proper title/kind icon without a separate `title` prop.

- [ ] **Step 3: Manual verification**

`pnpm dev`, open Inventario's file section (form and detail), click a file, confirm `AdvancedFileViewer` opens with rotate/zoom/flip controls and next/prev navigation across the item's files.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/AttachmentsPanel.jsx
git commit -m "refactor(ui): AttachmentsPanel opens AdvancedFileViewer instead of FileViewer"
```

---

## Task 9: Video kind + Multimedia/Documentos grouping as the default

**Files:**
- Modify: `packages/ui/src/hooks/useAttachmentsController.js`
- Modify: `packages/ui/src/components/AttachmentsPanel.jsx`

- [ ] **Step 1: Write a failing test for the video kind**

Check whether `packages/ui/src/hooks/__tests__/` has any existing test file covering `resolveAttachmentFileType` (search first). If not, create `packages/ui/src/hooks/__tests__/useAttachmentsController.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAttachmentFileType } from "../useAttachmentsController.js";

test("resolveAttachmentFileType recognizes video mime types as a distinct kind", () => {
  assert.equal(resolveAttachmentFileType({ mimeType: "video/mp4", fileName: "clip.mp4" }).kind, "video");
  assert.equal(resolveAttachmentFileType({ mimeType: "video/quicktime", fileName: "clip.mov" }).kind, "video");
});

test("resolveAttachmentFileType still recognizes images and falls back to file", () => {
  assert.equal(resolveAttachmentFileType({ mimeType: "image/png", fileName: "a.png" }).kind, "image");
  assert.equal(resolveAttachmentFileType({ mimeType: "application/pdf", fileName: "a.pdf" }).kind, "pdf");
  assert.equal(resolveAttachmentFileType({ mimeType: "application/octet-stream", fileName: "a.bin" }).kind, "file");
});
```

Run: `node --test packages/ui/src/hooks/__tests__/useAttachmentsController.test.js` — expect the first test to FAIL (`kind` is currently `"file"` for video mime types, since there's no video branch).

- [ ] **Step 2: Implement the video kind**

In `packages/ui/src/hooks/useAttachmentsController.js`, find `resolveFileTypeKind(mimeType, extension)` and add a video check right after the image check:

```js
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";
```

Add `video: "Video"` to the `FILE_TYPE_LABELS` object:

```js
const FILE_TYPE_LABELS = {
  image: "Imagen",
  video: "Video",
  pdf: "PDF",
  word: "Word",
  spreadsheet: "Excel",
  text: "Texto",
  archive: "Comprimido",
  file: "Archivo",
};
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --test packages/ui/src/hooks/__tests__/useAttachmentsController.test.js` — expect PASS.

- [ ] **Step 4: Make grouped view the default and rename its labels**

In `packages/ui/src/components/AttachmentsPanel.jsx`:
1. Change the `defaultViewMode = "list"` default parameter (in the `AttachmentsPanel` function signature) to `defaultViewMode = "grid"`.
2. In `AssociatedFilesList`, find:
```js
  if (localView === "grid") {
    const images = items.filter((i) => String(i.mimeType ?? "").startsWith("image/"));
    const others = items.filter((i) => !String(i.mimeType ?? "").startsWith("image/"));
```
and replace with:
```js
  if (localView === "grid") {
    const isMedia = (mimeType) => {
      const m = String(mimeType ?? "");
      return m.startsWith("image/") || m.startsWith("video/");
    };
    const images = items.filter((i) => isMedia(i.mimeType));
    const others = items.filter((i) => !isMedia(i.mimeType));
```
3. In the same function, rename the two group labels from "Imagenes (N)"/"Archivos (N)" to "Multimedia (N)"/"Documentos (N)" (find the two `<p>` elements rendering those labels and change only the literal text, keeping the `${images.length}`/`${others.length}` interpolation).

Note: `ImageGridTile` (used for the "images" bucket) renders an `<img>` thumbnail — for video items now included in this bucket, confirm what `ImageGridTile` does with a non-image `previewUrl`/mimeType (read its definition before this task's edits) and, if it would render a broken `<img>` for a video file, add a minimal fallback (a video icon glyph in place of the thumbnail) so video items don't show a broken image icon. This may require passing `mimeType` down to `ImageGridTile` if it doesn't already receive it.

- [ ] **Step 5: Manual verification**

`pnpm dev`, open Inventario's file section with a mix of an image, a video, and a PDF attached — confirm they group into "Multimedia" (image + video) and "Documentos" (PDF), in both the create/edit form and the detail view, without needing to manually toggle any view switch.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/hooks/useAttachmentsController.js packages/ui/src/hooks/__tests__/useAttachmentsController.test.js packages/ui/src/components/AttachmentsPanel.jsx
git commit -m "feat(ui): add video file kind and make Multimedia/Documentos grouping the AttachmentsPanel default"
```

---

## Task 10: Cover selection + reorder UI in `AttachmentsPanel`

**Files:**
- Modify: `packages/ui/src/hooks/useAttachmentsController.js`
- Modify: `packages/ui/src/components/AttachmentsPanel.jsx`

- [ ] **Step 1: Read current code**

Read `packages/ui/src/hooks/useAttachmentsController.js` in full to find its existing `removeAssociation`-style HTTP call (the one triggered by `AttachmentsPanel`'s remove button) — it will use `config.removePath` (with `:id`/`:docId` token replacement) and `buildApiHeaders`/`fetch`. Mirror this exact pattern for two new calls.

- [ ] **Step 2: Implement — controller changes**

In `useAttachmentsController.js`:
1. Accept two new optional config keys read from `config` (the same object that already provides `listPath`/`addPath`/`removePath`): `config.coverPath` (template with `:id` for the record and `:docId` for the file association) and `config.reorderPath` (template with `:id` for the record).
2. Add a `setCover(item)` async function: if `!config.coverPath`, no-op; otherwise `PATCH` to `replacePathTokens(config.coverPath, { id: recordId, docId: item.id })` (mirror the exact token-replacement helper and header-building already used by `removeAssociation`), then re-fetch the association list (same refresh call `removeAssociation` already triggers on success) so `isCover`/ordering reflects the change.
3. Add a `reorderItems(orderedItems)` async function (`orderedItems` = `[{id, sortOrder}]`): if `!config.reorderPath`, no-op; otherwise `PATCH` to `replacePathTokens(config.reorderPath, { id: recordId })` with `body: JSON.stringify({ items: orderedItems })`, then re-fetch.
4. Expose `setCover` and `reorderItems` (and a boolean `canManageCover = Boolean(config.coverPath)`) on the object this hook returns.

- [ ] **Step 3: Implement — panel UI changes**

In `AttachmentsPanel.jsx`:
1. Pass `controller.canManageCover`, `controller.setCover`, and a `moveImage(item, direction)` helper (computing the two affected items' swapped `sortOrder` values and calling `controller.reorderItems([...])` with just those two entries) down into `AssociatedFilesList` → `ImageGridTile` for the "Multimedia" bucket ONLY (video/image items — reordering/cover only makes sense for the visual bucket, not for "Documentos").
2. On each image/video tile in that bucket, when `controller.canManageCover` is true, render a small overlay button ("Usar como portada", a star/pin icon — reuse whatever icon set the rest of `AttachmentsPanel` already imports from `lucide-react`) that calls `controller.setCover(item)`, visually indicating the current cover item (e.g. a filled vs. outline star, comparing `item.id` against whichever item currently has `isCover: true` in `controller.associatedItems`).
3. On the same tiles, when there is more than one item in the Multimedia bucket, render small up/down (or left/right) move buttons that call `moveImage(item, -1 | 1)`.
4. If `controller.canManageCover` is false (the config didn't provide `coverPath`/`reorderPath` — true for every OTHER module using `AttachmentsPanel` today, e.g. Fleet's vehicle documents), none of this renders — the tile looks exactly as it does today. This must be verified: **no other consumer of `AttachmentsPanel` should see any visual or behavioral change from this task.**

- [ ] **Step 4: Manual verification**

`pnpm dev`, open an inventory item with 2+ photos attached (after Task 11 wires `coverPath`/`reorderPath` into the blueprint — do this verification AFTER Task 11). Confirm: clicking "Usar como portada" on a non-cover photo marks it, moving it with the up/down buttons persists after a refresh, and Fleet's vehicle documents panel (a consumer that does NOT set `coverPath`/`reorderPath`) shows no new UI at all.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/hooks/useAttachmentsController.js packages/ui/src/components/AttachmentsPanel.jsx
git commit -m "feat(ui): add opt-in cover selection and reorder controls to AttachmentsPanel"
```

---

## Task 11: Wire `coverPath`/`reorderPath` into the Inventory blueprints

**Files:**
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js`

- [ ] **Step 1: Implement**

In BOTH blueprint files, find the `attachments` section's `attachments: {...}` config object and add two keys (`coverPath`, `reorderPath`) alongside the existing `listPath`/`addPath`/`removePath`:

```js
          coverPath: '/inventory/items/:id/files/:docId/cover',
          reorderPath: '/inventory/items/:id/files/reorder',
```

- [ ] **Step 2: Manual verification**

Repeat Task 10 Step 4 now that the paths are wired — confirm the cover/reorder UI appears and functions on Inventory's Files section (both create/edit and detail), and that the RunlyTable listing (once Task 14 adds the image column) reflects the change after a refresh.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js
git commit -m "feat(inventory): enable cover selection and file reordering in the attachments section"
```

---

## Task 12: `ImageAssetCell` — generic signed-URL image column for `RunlyTable`

**Files:**
- Create: `packages/ui/src/runly-renderer/ImageAssetCell.jsx`

- [ ] **Step 1: Read reference implementation**

Read `apps/desktop/src/modules/runly.fleet/components/VehicleImageCell.jsx` in full (already quoted in the spec's research, but re-read to confirm current exact text) — this is the pattern to generalize. Also read `packages/ui/src/runly-renderer/detail-presentation.js`'s `replacePathTokens`/`getByPath` (already used elsewhere in this renderer family) to reuse instead of writing new token-substitution logic.

- [ ] **Step 2: Implement**

Create `packages/ui/src/runly-renderer/ImageAssetCell.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { AdvancedFileViewer } from "../components/AdvancedFileViewer.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { replacePathTokens } from "./detail-presentation.js";

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

// Generic "image column" cell for RunlyTable's `type: "image-asset"` columns.
// `column.field` holds a fileAssetId (NOT a ready-to-use URL — unlike the
// existing plain `type: "image"`). Resolves a signed thumbnail URL via the
// shared /files/:id/signed-url endpoint, and on click opens AdvancedFileViewer.
// If `column.imagesApiPath` is set (a path template with an :id token for the
// row's id), clicking fetches that record's full file list first so the viewer
// can navigate next/prev across all of the record's files; otherwise it opens
// with just this one image.
export function ImageAssetCell({ value, row, token, apiBaseUrl, companyId, column }) {
  const fileAssetId = value ? String(value) : null;
  const [thumbUrl, setThumbUrl] = useState(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerFiles, setViewerFiles] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const resolveSignedUrl = useCallback(
    async (assetId) => {
      if (!assetId) return null;
      try {
        const res = await fetch(joinUrl(apiBaseUrl, `/files/${encodeURIComponent(assetId)}/signed-url`), {
          headers: buildApiHeaders(token, companyId),
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data?.signedUrl ?? json?.data?.url ?? null;
      } catch {
        return null;
      }
    },
    [apiBaseUrl, token, companyId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!fileAssetId) {
      setThumbUrl(null);
      return () => {
        cancelled = true;
      };
    }
    setThumbLoading(true);
    resolveSignedUrl(fileAssetId).then((url) => {
      if (!cancelled) {
        setThumbUrl(url);
        setThumbLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fileAssetId, resolveSignedUrl]);

  const handleOpen = useCallback(async () => {
    if (!fileAssetId) return;
    setViewerLoading(true);
    try {
      if (column?.imagesApiPath && row?.id) {
        const path = replacePathTokens(column.imagesApiPath, { id: row.id });
        const res = await fetch(joinUrl(apiBaseUrl, path), { headers: buildApiHeaders(token, companyId) });
        const json = await res.json().catch(() => null);
        const rows = Array.isArray(json?.data) ? json.data : [];
        const files = rows.map((item) => ({
          id: item.id ?? item.fileAssetId ?? item.file_asset_id,
          fileAssetId: item.fileAssetId ?? item.file_asset_id,
          originalName: item?.fileAsset?.originalName ?? item?.file_asset?.originalName ?? item?.label ?? "Archivo",
          mimeType: item?.fileAsset?.mimeType ?? item?.file_asset?.mimeType ?? "application/octet-stream",
          sizeBytes: item?.fileAsset?.sizeBytes ?? item?.file_asset?.sizeBytes ?? null,
        }));
        const idx = files.findIndex((f) => f.fileAssetId === fileAssetId);
        setViewerFiles(files.length > 0 ? files : [{ id: fileAssetId, fileAssetId, originalName: "Imagen", mimeType: "image/*" }]);
        setActiveIndex(idx >= 0 ? idx : 0);
      } else {
        setViewerFiles([{ id: fileAssetId, fileAssetId, originalName: "Imagen", mimeType: "image/*" }]);
        setActiveIndex(0);
      }
      setOpen(true);
    } finally {
      setViewerLoading(false);
    }
  }, [fileAssetId, column?.imagesApiPath, row?.id, apiBaseUrl, token, companyId]);

  if (!fileAssetId) {
    return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={viewerLoading}
        className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ring))]"
        aria-label="Ver imagen"
      >
        {thumbLoading || viewerLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold">IMG</span>
        )}
      </button>

      <AdvancedFileViewer
        open={open}
        onOpenChange={setOpen}
        files={viewerFiles}
        activeIndex={activeIndex}
        onIndexChange={setActiveIndex}
        onResolveSignedUrl={(item) => resolveSignedUrl(item?.fileAssetId)}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/ImageAssetCell.jsx
git commit -m "feat(ui): add generic ImageAssetCell for RunlyTable's image-asset column type"
```

---

## Task 13: Wire the `image-asset` column type into `RunlyTable`

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyTable.jsx`

- [ ] **Step 1: Read current code**

Read `packages/ui/src/runly-renderer/RunlyTable.jsx` around lines 787-865 to confirm the exact current `if/else if` cell-rendering chain and the `truncateCell` line, before editing.

- [ ] **Step 2: Implement**

1. Add the import: `import { ImageAssetCell } from "./ImageAssetCell.jsx";`
2. In the cell-rendering chain, add a new branch right after the existing `col.type === "image"` branch:
```js
                    } else if (col.type === "image-asset") {
                      cellContent = (
                        <ImageAssetCell
                          value={value}
                          row={row}
                          token={token}
                          apiBaseUrl={apiBaseUrl}
                          companyId={companyId}
                          column={col}
                        />
                      );
```
3. Update the `truncateCell` line:
```js
                    const truncateCell = !col.component && col.type !== "color" && col.type !== "image";
```
to:
```js
                    const truncateCell = !col.component && col.type !== "color" && col.type !== "image" && col.type !== "image-asset";
```

Confirm `companyId` is already a variable in scope at this point in the file (it's a prop `RunlyTable` already receives and threads through, per the existing `col.component` branch which also passes `token`/`apiBaseUrl` but NOT `companyId` today — check whether `RunlyTable` itself receives a `companyId` prop at all; if it doesn't, add `companyId = null` to its own props destructuring and thread it through from wherever `RunlyTable` is mounted, matching how `RunlyForm`/`RunlyDetail` already receive `companyId`).

- [ ] **Step 3: Manual verification**

Deferred to Task 14 (need a blueprint declaring an `image-asset` column to see it render).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyTable.jsx
git commit -m "feat(ui): wire the image-asset column type into RunlyTable"
```

---

## Task 14: Image column on Inventory's and HR's list tables

**Files:**
- Modify: `apps/desktop/src/modules/runly.inventory/screens/InventoryScreen.jsx`
- Modify: `apps/desktop/src/modules/runly.hr/screens/HrScreen.jsx`

- [ ] **Step 1: Read current code**

Read both files' TABLE blueprint `columns` arrays in full to find their exact current first entries.

- [ ] **Step 2: Implement — Inventory**

In `InventoryScreen.jsx`'s TABLE blueprint `columns` array, add as the FIRST entry:
```js
      {
        field: 'coverImageFileId',
        label: 'Imagen',
        type: 'image-asset',
        sortable: false,
        imagesApiPath: '/inventory/items/:id/files',
      },
```

- [ ] **Step 3: Implement — HR**

In `HrScreen.jsx`'s TABLE blueprint `columns` array, add as the FIRST entry:
```js
      {
        field: 'photo_file_id',
        label: 'Foto',
        type: 'image-asset',
        sortable: false,
      },
```
(no `imagesApiPath` — an employee has a single photo, not a gallery, so clicking opens just that one image in `AdvancedFileViewer` with no next/prev).

- [ ] **Step 4: Manual verification**

`pnpm dev`. Open Inventario's list — confirm the first column shows a thumbnail (or a placeholder) per row, and clicking one with attached photos opens the viewer with gallery navigation across that item's files. Open RH's employee list — confirm the first column shows each colaborador's photo (own photo, or their linked user's avatar when they have no employee photo), and clicking opens a single-image viewer with no broken next/prev controls.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/screens/InventoryScreen.jsx apps/desktop/src/modules/runly.hr/screens/HrScreen.jsx
git commit -m "feat: add image column to Inventory and HR list tables"
```

---

## Task 15: Verification pass

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

```bash
node --test packages/ui/src/runly-renderer/__tests__/
node --test packages/ui/src/hooks/__tests__/
pnpm lint
pnpm --filter @runly/desktop build:web
```

Expected: all clean.

- [ ] **Step 2: Manual QA — desktop (1440px) and mobile (390px), light and dark theme**

1. Date picker cascading navigation (Task 1).
2. Combobox glass styling + autofocus, on all three field types (Tasks 3-5).
3. File viewer regression across Identity/HR/Chat/Files (Task 7) and Fleet's `VehicleImageCell` (unmoved, still on `FileViewer` — confirm it's untouched and still works).
4. Multimedia/Documentos grouping in Inventory's file section, both form and detail (Task 9).
5. Cover selection + reorder in Inventory's file section, reflected in the list's image column (Tasks 10-11, 14).
6. HR's list image column with the profile-photo/avatar fallback (Task 14).

- [ ] **Step 3: Update `docs/TASKS.md` and commit**

```bash
git add docs/TASKS.md
git commit -m "docs: record shared form components upgrade verification"
```
