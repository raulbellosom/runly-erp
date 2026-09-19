# Notes: paper-style coverage fix + dark-mode icon contrast audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two regressions/gaps: (1) the notes paper-style (lined/grid) background only covers a small area near the top of the note instead of the whole page, and desyncs from the real font size; (2) several shared input components stack extra opacity on top of the already-muted icon color, making leading icons hard to see in dark mode.

**Architecture:** Bug 1 is a pure CSS-selector-target change (move the ruled/grid `repeating-linear-gradient` from `.tiptap` to a new stable class on `NoteSheet`, which reliably fills the whole page height) plus switching the line-spacing unit from `em` to an explicit `calc(<rem> * 1.72)` so it stays numerically synced to `.tiptap`'s real line-height at both breakpoints. Bug 2 is a mechanical className change (drop the `/NN` opacity suffix on 7 confirmed icon instances across 2 files) — no component logic changes.

**Tech Stack:** JavaScript (no TypeScript), React, Tailwind CSS v4 (`@theme`-registered color tokens), plain global stylesheet (`apps/desktop/src/styles.css`).

**Spec:** `docs/superpowers/specs/2026-09-18-notes-paper-style-and-icon-contrast-fixes-design.md`

---

## Task 1: Fix paper-style coverage + font sync

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Give `NoteSheet` a stable class name**

In `apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx`, change:

```jsx
    <div
      className={`${NOTE_SHEET_MAX_WIDTH_CLASS} min-h-full bg-card`}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
```

to:

```jsx
    <div
      className={`${NOTE_SHEET_MAX_WIDTH_CLASS} min-h-full bg-card note-sheet`}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
```

- [ ] **Step 2: Move the paper-style CSS rules from `.tiptap` to `.note-sheet`, using rem-based spacing**

In `apps/desktop/src/styles.css`, find this block (currently right after the mobile `.tiptap` font-size media query, right before the `/* Paragraph */` comment):

```css
/* Paper-style backgrounds (per-note "Estilo de hoja" setting). Scoped to the
   actual text area only (not the cover banner/toolbar above it) via the
   [data-paper-style] attribute NoteEditor sets on its outer wrapper. Line
   spacing is in `em`, relative to .tiptap's own font-size, so it tracks the
   line-height: 1.72 set above at any font-size — including the mobile
   breakpoint, which only changes font-size, not the line-height ratio. */
[data-paper-style="lined"] .tiptap {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(1.72em - 1px),
    hsl(var(--border)) calc(1.72em - 1px),
    hsl(var(--border)) 1.72em
  );
}
[data-paper-style="grid"] .tiptap {
  background-image:
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent calc(1.72em - 1px),
      hsl(var(--border)) calc(1.72em - 1px),
      hsl(var(--border)) 1.72em
    ),
    repeating-linear-gradient(
      to right,
      transparent 0,
      transparent calc(1.72em - 1px),
      hsl(var(--border)) calc(1.72em - 1px),
      hsl(var(--border)) 1.72em
    );
}
```

Replace it with:

```css
/* Paper-style backgrounds (per-note "Estilo de hoja" setting). Painted on
   .note-sheet (NoteSheet.jsx), NOT .tiptap: .tiptap's own min-height:100%
   never resolves because TipTap's internal EditorContent wrapper (which we
   don't style) has no defined height, so a percentage height on .tiptap
   computes as auto per the CSS spec — the pattern used to stop at the
   content's intrinsic height instead of covering the whole page. .note-sheet
   sits one level up and its min-height:100% DOES resolve (its parent is the
   flex-sized, definite-height scrollable container), so it reliably fills
   the whole visible page and grows further with content.
   Line spacing uses calc(<rem> * 1.72) — the exact same numbers .tiptap
   uses for its own line-height: 1.72 at each breakpoint below — instead of
   `em`, because .note-sheet doesn't share .tiptap's explicit font-size, so
   `em` here would resolve against the wrong element and desync from the
   real body-text line-height. Cover banner/toolbar sit in the same tree but
   already paint their own opaque/blurred background, so this doesn't leak
   through them. */
[data-paper-style="lined"] .note-sheet {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(0.9375rem * 1.72 - 1px),
    hsl(var(--border)) calc(0.9375rem * 1.72 - 1px),
    hsl(var(--border)) calc(0.9375rem * 1.72)
  );
}
[data-paper-style="grid"] .note-sheet {
  background-image:
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent calc(0.9375rem * 1.72 - 1px),
      hsl(var(--border)) calc(0.9375rem * 1.72 - 1px),
      hsl(var(--border)) calc(0.9375rem * 1.72)
    ),
    repeating-linear-gradient(
      to right,
      transparent 0,
      transparent calc(0.9375rem * 1.72 - 1px),
      hsl(var(--border)) calc(0.9375rem * 1.72 - 1px),
      hsl(var(--border)) calc(0.9375rem * 1.72)
    );
}
@media (max-width: 639px) {
  [data-paper-style="lined"] .note-sheet {
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent calc(0.875rem * 1.72 - 1px),
      hsl(var(--border)) calc(0.875rem * 1.72 - 1px),
      hsl(var(--border)) calc(0.875rem * 1.72)
    );
  }
  [data-paper-style="grid"] .note-sheet {
    background-image:
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent calc(0.875rem * 1.72 - 1px),
        hsl(var(--border)) calc(0.875rem * 1.72 - 1px),
        hsl(var(--border)) calc(0.875rem * 1.72)
      ),
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(0.875rem * 1.72 - 1px),
        hsl(var(--border)) calc(0.875rem * 1.72 - 1px),
        hsl(var(--border)) calc(0.875rem * 1.72)
      );
  }
}
```

(The `0.9375rem`/`0.875rem` values are `.tiptap`'s own desktop/mobile font-sizes, defined a few lines above this block in the same file — don't change those, just reuse the same numbers here.)

- [ ] **Step 3: Manual verification**

Run `pnpm dev`, open a note, set "Estilo de hoja" to "Rayado":
- Confirm the ruled lines now extend all the way down the visible page (scroll to check they continue past the initial content), not just the first few rows.
- Confirm the lines still land under the actual paragraph text rows (spacing looks right, not obviously mismatched).
- Switch to "Cuadriculado" and repeat.
- Shrink the window below 640px width and confirm the pattern still looks right at the smaller mobile font size (lines/grid still track the text rows, don't look stretched or compressed).
- Confirm the cover banner and toolbar area still look normal (no stray pattern bleeding through).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx apps/desktop/src/styles.css
git commit -m "fix(notes): paper-style background now covers the whole page and stays synced to body text size"
```

---

## Task 2: Fix dark-mode icon contrast (remove alpha-stacking)

**Files:**
- Modify: `packages/ui/src/components/form-field-base.jsx`
- Modify: `packages/ui/src/components/ContactPicker.jsx`
- Modify: `packages/ui/src/components/FormFields.jsx`

7 confirmed instances where an icon inside a form field/input stacks an opacity modifier on top of the `muted-foreground` token, compounding into low contrast in dark mode. `SearchInput.jsx` already uses full opacity and isn't touched by this task (pending live re-verification in Step 5 below).

- [ ] **Step 1: `form-field-base.jsx` — shared `InputIcon` component**

Find (around line 30):

```jsx
    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none z-10">
```

Change to:

```jsx
    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10">
```

- [ ] **Step 2: `ContactPicker.jsx` — search icon**

Find (around line 83):

```jsx
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
```

Change to:

```jsx
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
```

- [ ] **Step 3: `FormFields.jsx` — date-field trailing `CalendarDays` icons (2 instances)**

Find each occurrence (around lines 629 and 755 — same line appears twice, once per date-field variant in this file):

```jsx
      <CalendarDays size={14} className="text-muted-foreground/70 shrink-0" />
```

Change both to:

```jsx
      <CalendarDays size={14} className="text-muted-foreground shrink-0" />
```

(Leave the sibling `text-muted-foreground/70` on the placeholder `<span>` a few lines above each of these — e.g. `!displayValue && "text-muted-foreground/70"` — untouched; that's dimmed placeholder TEXT, not an icon, and is out of scope for this fix.)

- [ ] **Step 4: `FormFields.jsx` — combobox dropdown `Search` icons (3 instances)**

Find each occurrence (around lines 1734, 1992, and 2510):

```jsx
                <Search
                  size={13}
                  className="text-muted-foreground/80 shrink-0"
                />
```

Change all three to:

```jsx
                <Search
                  size={13}
                  className="text-muted-foreground shrink-0"
                />
```

(Leave the chevron/rotate-indicator icons elsewhere in this file — the ones using `text-muted-foreground/60` on a `ChevronDown`-style icon with a `rotate-180`/`transition-transform` class — untouched. Those are a different UI affordance (dropdown open/close indicators) not in scope for this fix; only touch the 3 `Search` icon instances listed above.)

- [ ] **Step 5: Live re-verification of `SearchInput.jsx`**

Run `pnpm dev`, switch to dark mode, and visually check the "Buscar notas..." search input in the runly.notes list (`NotesList.jsx`, which uses `@runly/ui`'s `SearchInput`). Static analysis found it already uses full opacity and computes to good contrast — if it looks fine live too, no change needed there. If it's still genuinely hard to see, note the specific visual symptom (e.g. icon is there but very faint against a specific background, icon appears misaligned/clipped, etc.) so a targeted follow-up fix can be scoped precisely — don't guess a fix without a concrete visual symptom to address.

- [ ] **Step 6: Manual verification of the 7 fixed instances**

In dark mode, visually check: any input using the shared `InputIcon` component (search `packages/ui`'s consumers of `form-field-base.jsx`'s `InputIcon` if unsure which screens exercise it), the contact picker's search icon, a date field's calendar icon, and a combobox's dropdown search icon (e.g. a `CreatableComboboxField`/`ComboboxField` usage). Confirm all are now clearly visible against dark backgrounds.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/form-field-base.jsx packages/ui/src/components/ContactPicker.jsx packages/ui/src/components/FormFields.jsx
git commit -m "fix(ui): remove alpha-stacking on input icons that made them hard to see in dark mode"
```

---

## Final verification (whole plan)

- [ ] Run `pnpm lint` (or `npx eslint` on all 5 changed files) — confirm clean.
- [ ] Re-read both changed CSS/JSX sections once more in full context to confirm nothing else was disturbed.
- [ ] Manual pass in the running app, dark mode: notes paper-style (both variants, both breakpoints) + all 7 fixed icon instances + the re-checked `SearchInput.jsx`.
