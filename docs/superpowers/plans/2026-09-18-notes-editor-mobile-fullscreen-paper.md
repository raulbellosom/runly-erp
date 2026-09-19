# Notes editor: mobile keyboard, collapse/fullscreen, paper backgrounds, unified proportions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four issues in the `runly.notes` rich-text editor: the mobile keyboard covering the caret, no way to collapse the notes list or go fullscreen, no paper-style (lined/grid) background option, and inconsistent content width between desktop, mobile, and the public note view.

**Architecture:** Backend gets one new `notes.paper_style` column plumbed through the existing raw-SQL `notes-service.js` (mirrors the existing `background_color` column exactly). On the frontend, a new shared `NoteSheet` component becomes the single place that renders a note's background color, paper-style texture, and fixed max-width column — used by `NoteEditor.jsx` internally so both the authenticated editor (`NotesScreen.jsx`) and the public view (`PublicNoteScreen.jsx`) render identically for free. Keyboard avoidance uses the `visualViewport` API. Collapse and fullscreen are local UI state in `NotesScreen.jsx`, with fullscreen implemented as a CSS `fixed inset-0` overlay (not the browser Fullscreen API) so it behaves identically on iOS Safari, Android, and desktop.

**Tech Stack:** JavaScript (no TypeScript), React, TipTap/`@tiptap/react`, Tailwind CSS, Hono, `prisma.$queryRaw` (raw SQL, no Prisma models for this table), Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-18-notes-editor-mobile-fullscreen-paper-design.md`

---

## Task 1: Backend — `paper_style` column + service layer

**Files:**
- Create: `prisma/migrations/20260918120000_notes_paper_style/migration.sql`
- Modify: `apps/api/src/routes/notes/notes-service.js:230-254` (listNotes GROUP BY), `apps/api/src/routes/notes/notes-service.js:267-332` (updateNote CASE block)
- Test: `apps/api/src/routes/notes/__tests__/notes-access.test.js`

The `notes` table has no Prisma model (confirmed: no `model Note` in `prisma/schema.prisma`) — it's managed entirely through forward SQL migrations and raw `$queryRaw`/`$executeRaw` calls, exactly like `note_type` was added in `prisma/migrations/20260910182109_notes_canvas/migration.sql`. `getNote` and `listNotes` both select `n.*`/`a.*`, so a new column flows through those automatically — the ONLY place that needs an explicit column name is `listNotes`'s `GROUP BY` clause (Postgres requires every non-aggregated selected column listed there when grouping a CTE result, since functional-dependency-on-primary-key reduction only applies to base tables, not CTEs) and `updateNote`'s `CASE` block.

- [ ] **Step 1: Write the migration**

Create `prisma/migrations/20260918120000_notes_paper_style/migration.sql`:

```sql
-- Adds notes.paper_style — per-note "Estilo de hoja" background (none/lined/grid).
ALTER TABLE notes
  ADD COLUMN paper_style TEXT NOT NULL DEFAULT 'none';

ALTER TABLE notes
  ADD CONSTRAINT chk_notes_paper_style CHECK (paper_style IN ('none', 'lined', 'grid'));
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm db:migrate`

This connects to the shared self-hosted Supabase Postgres instance (see CLAUDE.md — there is no local DB). Confirm it reports the new migration applied with no errors before continuing; every other step in this task depends on the column existing.

- [ ] **Step 3: Write the failing test for `updateNote`**

Add to `apps/api/src/routes/notes/__tests__/notes-access.test.js` (new `describe` block, anywhere after the existing `describe("notes-service — read/write require access", ...)` block):

```js
describe("notes-service — updateNote paper_style", () => {
  it("includes paper_style in the CASE update and returns it", async () => {
    let capturedSql = "";
    const prisma = {
      $queryRaw: (strings) => {
        const text = sql(strings).toLowerCase();
        capturedSql = text;
        if (text.includes("from notes n left join note_shares")) {
          return Promise.resolve([{ id: NOTE, owner_user_id: OWNER, share_permission: null }]);
        }
        if (text.includes("update notes")) {
          return Promise.resolve([{ id: NOTE, paper_style: "lined" }]);
        }
        return Promise.resolve([]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createNotesService({ prisma });
    const note = await svc.updateNote(NOTE, OWNER, { paperStyle: "lined" });
    assert.equal(note.paper_style, "lined");
    assert.match(capturedSql, /paper_style/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test apps/api/src/routes/notes/__tests__/notes-access.test.js`
Expected: FAIL — `capturedSql` won't match `/paper_style/` because `updateNote` doesn't reference that column yet.

- [ ] **Step 5: Add `paper_style` to `listNotes`'s GROUP BY**

In `apps/api/src/routes/notes/notes-service.js`, find the `GROUP BY` list inside `listNotes` (starts at line 230). Add `a.paper_style,` right after `a.background_image_url,`:

```js
      GROUP BY
        a.id,
        a.owner_user_id,
        a.note_type,
        a.company_id,
        a.folder_id,
        a.title,
        a.content,
        a.content_text,
        a.cover_url,
        a.icon,
        a.background_color,
        a.background_image_url,
        a.paper_style,
        a.is_pinned,
```

(The remaining lines of the GROUP BY list — `is_archived` through `my_share_permission` — stay exactly as they are.)

- [ ] **Step 6: Add `paper_style` to `updateNote`'s CASE block**

In the same file, inside `updateNote` (starts at line 267), find the `background_image_url` CASE block (ends around line 302 with `ELSE background_image_url END,`) and insert a new `paper_style` block immediately after it, before `cover_url`:

```js
        background_image_url = CASE
                                 WHEN ${data.backgroundImageUrl !== undefined ? "t" : "f"}::boolean = TRUE
                                 THEN ${data.backgroundImageUrl ?? null}::text
                                 ELSE background_image_url
                               END,
        paper_style          = CASE
                                 WHEN ${data.paperStyle !== undefined ? "t" : "f"}::boolean = TRUE
                                 THEN ${data.paperStyle ?? 'none'}::text
                                 ELSE paper_style
                               END,
        cover_url            = CASE
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test apps/api/src/routes/notes/__tests__/notes-access.test.js`
Expected: PASS (all tests in the file, not just the new one — confirm no regression).

- [ ] **Step 8: Commit**

```bash
git add prisma/migrations/20260918120000_notes_paper_style apps/api/src/routes/notes/notes-service.js apps/api/src/routes/notes/__tests__/notes-access.test.js
git commit -m "feat(notes): add paper_style column and wire it through notes-service"
```

---

## Task 2: Frontend — shared `NoteSheet` (unified width + background)

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx:1-22` (imports), `:373-458` (render)
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx:220-232` (editor panel wrapper)
- Modify: `apps/desktop/src/modules/runly.notes/PublicNoteScreen.jsx:73-93` (sheet div)

This introduces one shared "sheet" column (fixed max-width, centered, carries the note's `background_color`) rendered *inside* `NoteEditor`, so it automatically applies wherever `NoteEditor` is used — the authenticated editor and the public view — without each caller re-implementing it. Canvas-type notes are excluded (they don't go through `NoteEditor`; their own background-color panel styling in `NotesScreen.jsx` is preserved unchanged, just scoped to `note_type === 'canvas'` so it isn't lost when the general panel background is removed).

- [ ] **Step 1: Create `NoteSheet.jsx`**

```jsx
import { DARK_BG_MAP } from '../lib/noteColors.js'

// Shared "sheet" column rendered inside NoteEditor — used by both the
// authenticated editor (NotesScreen) and the public share view
// (PublicNoteScreen) so a note's content area is always the same width and
// background treatment regardless of where it's rendered.
export const NOTE_SHEET_MAX_WIDTH_CLASS = 'max-w-3xl mx-auto'

export function NoteSheet({ note, isDark = false, children }) {
  const raw = note?.background_color ?? null
  const backgroundColor = raw ? (isDark ? (DARK_BG_MAP[raw] ?? raw) : raw) : undefined

  return (
    <div
      className={`${NOTE_SHEET_MAX_WIDTH_CLASS} min-h-full`}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Wire `NoteSheet` into `NoteEditor.jsx`**

In `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`, add to the imports (after the existing `import { useAuth } from '../../../auth/AuthProvider'` block, anywhere in the top import group):

```js
import { useIsDark } from '../hooks/useIsDark.js'
import { NoteSheet } from './NoteSheet.jsx'
```

Inside `NoteEditorSurface` (the function starting at line 156), add near the other top-level hooks (e.g. right after `const provider = engine?.provider ?? null`):

```js
  const isDark = useIsDark()
```

Replace the final return block (currently lines 445-458):

```jsx
  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {scrollable ? (
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          onClick={readOnly ? undefined : handleContainerClick}
        >
          {editorProvider}
        </div>
      ) : (
        editorProvider
      )}
    </div>
  )
```

with:

```jsx
  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {scrollable ? (
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          onClick={readOnly ? undefined : handleContainerClick}
        >
          <NoteSheet note={note} isDark={isDark}>
            {editorProvider}
          </NoteSheet>
        </div>
      ) : (
        <NoteSheet note={note} isDark={isDark}>
          {editorProvider}
        </NoteSheet>
      )}
    </div>
  )
```

- [ ] **Step 3: Make the desktop editor panel a neutral canvas, keep canvas-note background as-is**

In `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`, replace the editor panel wrapper (currently lines 221-232):

```jsx
      <div
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden bg-background',
          mobileView === 'editor' ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
        style={(() => {
          const raw = selectedNote?.background_color
          if (!raw) return {}
          const color = isDark ? (DARK_BG_MAP[raw] ?? raw) : raw
          return { backgroundColor: color }
        })()}
      >
```

with:

```jsx
      <div
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          selectedNote?.note_type === 'canvas' ? '' : 'bg-muted/30',
          mobileView === 'editor' ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
        style={selectedNote?.note_type === 'canvas' ? (() => {
          const raw = selectedNote?.background_color
          if (!raw) return {}
          const color = isDark ? (DARK_BG_MAP[raw] ?? raw) : raw
          return { backgroundColor: color }
        })() : undefined}
      >
```

(`isDark` and `DARK_BG_MAP` stay imported/used exactly as before — only now they're scoped to the canvas-note case. Document notes now get their background color from `NoteSheet` instead, and the panel around them is a neutral canvas tone so the sheet reads as a page centered on a desk, per the approved design.)

- [ ] **Step 4: Simplify `PublicNoteScreen.jsx`'s sheet div**

In `apps/desktop/src/modules/runly.notes/PublicNoteScreen.jsx`, replace:

```jsx
        <div
          className="rounded-xl shadow-sm overflow-hidden"
          style={{ backgroundColor: note.background_color ?? '#ffffff' }}
        >
          {/* scrollable=false: this page already owns scroll (the h-dvh
              overflow-y-auto root above) — see NoteEditor's scrollable prop. */}
          <NoteEditor note={note} readOnly scrollable={false} />
        </div>
```

with:

```jsx
        <div className="rounded-xl shadow-sm overflow-hidden bg-white">
          {/* scrollable=false: this page already owns scroll (the h-dvh
              overflow-y-auto root above) — see NoteEditor's scrollable prop.
              Background color and the max-width sheet column are now rendered
              by NoteEditor itself (NoteSheet), shared with the authenticated
              editor — this wrapper only supplies the rounded/shadow chrome. */}
          <NoteEditor note={note} readOnly scrollable={false} />
        </div>
```

(The public view forces light theme, so `bg-white` is a safe static fallback for the sliver of this wrapper outside the sheet's own `min-h-full` — in practice `NoteSheet`'s background fully covers it whenever `background_color` is set.)

- [ ] **Step 5: Manual verification**

Run `pnpm dev`, open a document note with a background color set:
- Confirm the desktop editor now shows a centered ~768px-wide "page" with the note's color, sitting on a neutral gray canvas.
- Confirm a canvas-type note's background color still fills its whole panel exactly as before.
- Open the note's public link (`/app/p/notes/<slug>`) and confirm it looks the same width/color as the authenticated editor.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx apps/desktop/src/modules/runly.notes/NotesScreen.jsx apps/desktop/src/modules/runly.notes/PublicNoteScreen.jsx
git commit -m "feat(notes): unify editor width/background via shared NoteSheet"
```

---

## Task 3: Frontend — paper-style (lined/grid) background

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/paperStyles.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/paper-styles.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx` (add `data-paper-style` attribute)
- Modify: `apps/desktop/src/styles.css` (paper-style CSS rules)
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteSettingsPanel.jsx` (new "Estilo de hoja" section)
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx:117-121` (camelToSnake map)

The ruled/grid lines are pure CSS (`repeating-linear-gradient`), scoped to the actual `.tiptap` text area (not the cover banner/toolbar above it) via a `data-paper-style` attribute placed on `NoteEditor`'s outer wrapper — a plain React-rendered div, so it updates immediately when the setting changes (unlike TipTap's own `editorProps`, which is baked in once at editor creation and never re-applied). Line spacing uses `em` units so it tracks `.tiptap`'s own `line-height: 1.72` at any font-size, including the `max-width: 639px` mobile breakpoint that shrinks the base font-size without touching the line-height ratio.

- [ ] **Step 1: Write the failing test for the paper-style catalog**

Create `apps/desktop/src/modules/runly.notes/lib/__tests__/paper-styles.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOTE_PAPER_STYLES } from '../paperStyles.js'

test('NOTE_PAPER_STYLES: has exactly the none/lined/grid options with labels', () => {
  const values = NOTE_PAPER_STYLES.map(s => s.value)
  assert.deepEqual(values, ['none', 'lined', 'grid'])
  for (const style of NOTE_PAPER_STYLES) {
    assert.equal(typeof style.label, 'string')
    assert.ok(style.label.length > 0)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/paper-styles.test.js`
Expected: FAIL with a module-not-found error (`paperStyles.js` doesn't exist yet).

- [ ] **Step 3: Create `paperStyles.js`**

```js
// Paper-style catalog for the note "Estilo de hoja" setting, plus the
// preview backgrounds used by NoteSettingsPanel's picker thumbnails. The
// real ruled/grid rendering inside the editor lives in styles.css (scoped
// via the [data-paper-style] attribute NoteEditor sets), sized in `em` so it
// tracks `.tiptap`'s actual line-height — these previews use fixed px since
// they're small decorative swatches, not real editor content.
export const NOTE_PAPER_STYLES = [
  { value: 'none',  label: 'En blanco' },
  { value: 'lined', label: 'Rayado' },
  { value: 'grid',  label: 'Cuadriculado' },
]

export function paperStylePreviewBackground(value) {
  const line = 'hsl(var(--border)) 9px, hsl(var(--border)) 10px'
  if (value === 'lined') {
    return { backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent 9px, ${line})` }
  }
  if (value === 'grid') {
    return {
      backgroundImage:
        `repeating-linear-gradient(to bottom, transparent, transparent 9px, ${line}),` +
        `repeating-linear-gradient(to right, transparent, transparent 9px, ${line})`,
    }
  }
  return {}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/paper-styles.test.js`
Expected: PASS

- [ ] **Step 5: Add the real ruled/grid CSS to `styles.css`**

In `apps/desktop/src/styles.css`, insert this block right after the mobile font-size media query (after the closing `}` that follows line 529, before the `/* Paragraph */` comment at line 531):

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

- [ ] **Step 6: Have `NoteEditor.jsx` set the `data-paper-style` attribute**

In `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`, in the return block you edited in Task 2, add the attribute to the outer `containerRef` div:

```jsx
    <div
      ref={containerRef}
      className="flex flex-col h-full overflow-hidden"
      data-paper-style={note.paper_style ?? 'none'}
    >
```

- [ ] **Step 7: Add the settings-panel UI**

In `apps/desktop/src/modules/runly.notes/components/NoteSettingsPanel.jsx`, add to the imports:

```js
import { NOTE_PAPER_STYLES, paperStylePreviewBackground } from '../lib/paperStyles.js'
```

Insert a new section immediately after the existing "Color de fondo" section (after the closing `</div>` that follows line 246):

```jsx
      {/* ── Estilo de hoja ───────────────────────────────── */}
      <div>
        <SectionLabel>Estilo de hoja</SectionLabel>
        <div className="flex gap-2">
          {NOTE_PAPER_STYLES.map(style => {
            const isActive = (note?.paper_style ?? 'none') === style.value
            return (
              <button
                key={style.value}
                type="button"
                onClick={() => onUpdate({ paperStyle: style.value })}
                title={style.label}
                className={`flex-1 h-14 rounded-lg border-2 bg-background transition-all ${
                  isActive ? 'border-amber-500' : 'border-border hover:border-muted-foreground/40'
                }`}
                style={paperStylePreviewBackground(style.value)}
              >
                <span className="sr-only">{style.label}</span>
              </button>
            )
          })}
        </div>
      </div>
```

- [ ] **Step 8: Wire `paperStyle` into the optimistic-update map**

In `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`, find the `camelToSnake` map (lines 117-121) and add `paperStyle: 'paper_style',`:

```js
    const camelToSnake = {
      title: 'title', content: 'content', icon: 'icon',
      backgroundColor: 'background_color', folderId: 'folder_id',
      isPinned: 'is_pinned', isArchived: 'is_archived', coverUrl: 'cover_url',
      paperStyle: 'paper_style',
    }
```

- [ ] **Step 9: Manual verification**

Run `pnpm dev`, open a note, go to Ajustes → Estilo de hoja, pick "Rayado" then "Cuadriculado":
- Confirm the editor body immediately shows ruled/grid lines aligned with the text rows (no remount needed).
- Confirm the cover banner/toolbar above the text are unaffected (no lines there).
- Switch to dark mode and confirm the lines are still subtle/legible.
- Reload the note and confirm the choice persisted.
- Open the note's public link and confirm the same paper style renders there.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/paperStyles.js apps/desktop/src/modules/runly.notes/lib/__tests__/paper-styles.test.js apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx apps/desktop/src/styles.css apps/desktop/src/modules/runly.notes/components/NoteSettingsPanel.jsx apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): add lined/grid paper-style background setting"
```

---

## Task 4: Frontend — mobile keyboard avoidance

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/keyboardInset.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/keyboard-inset.test.js`
- Create: `apps/desktop/src/modules/runly.notes/hooks/useKeyboardInset.js`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`

Scope confirmed with the user: TipTap text notes only, not canvas/Excalidraw notes. The math (inset height, whether the caret is hidden, how far to scroll) is extracted into plain functions so it's unit-testable per this codebase's convention (only `lib/` functions are unit-tested; hooks/components aren't) — mirrors `lib/clickBelowContent.js`.

- [ ] **Step 1: Write the failing tests for the pure math**

Create `apps/desktop/src/modules/runly.notes/lib/__tests__/keyboard-inset.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeKeyboardInset,
  isCaretHiddenByKeyboard,
  computeCaretScrollDelta,
} from '../keyboardInset.js'

test('computeKeyboardInset: returns the gap between layout and visual viewport', () => {
  assert.equal(computeKeyboardInset(800, 500, 0), 300)
})

test('computeKeyboardInset: never returns a negative inset', () => {
  assert.equal(computeKeyboardInset(800, 800, 0), 0)
  assert.equal(computeKeyboardInset(800, 850, 0), 0)
})

test('computeKeyboardInset: accounts for a non-zero visual viewport offset', () => {
  assert.equal(computeKeyboardInset(800, 500, 20), 280)
})

test('isCaretHiddenByKeyboard: true when the caret bottom is below the visible viewport', () => {
  assert.equal(isCaretHiddenByKeyboard(520, 500), true)
})

test('isCaretHiddenByKeyboard: false when the caret is within the visible viewport', () => {
  assert.equal(isCaretHiddenByKeyboard(480, 500), false)
})

test('computeCaretScrollDelta: scrolls just enough to clear the keyboard plus margin', () => {
  assert.equal(computeCaretScrollDelta(520, 500, 16), 36)
})

test('computeCaretScrollDelta: defaults the margin to 16px', () => {
  assert.equal(computeCaretScrollDelta(520, 500), 36)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/keyboard-inset.test.js`
Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement `keyboardInset.js`**

```js
// Pure math for mobile keyboard avoidance — see hooks/useKeyboardInset.js for
// the browser-facing visualViewport wiring this backs.

// The on-screen keyboard shrinks window.visualViewport while
// window.innerHeight stays the layout-viewport height, so the gap between
// them is (approximately) the keyboard's height.
export function computeKeyboardInset(innerHeight, viewportHeight, viewportOffsetTop) {
  const inset = innerHeight - (viewportHeight + viewportOffsetTop)
  return inset > 0 ? inset : 0
}

// True when the caret's bottom edge (in viewport px, e.g. from
// ProseMirror's view.coordsAtPos) is hidden behind the on-screen keyboard —
// i.e. below the visible viewport height.
export function isCaretHiddenByKeyboard(caretBottom, viewportHeight) {
  return caretBottom > viewportHeight
}

// How far (px) the scroll container must scroll down so the caret sits
// `margin` px above the visible viewport's bottom edge.
export function computeCaretScrollDelta(caretBottom, viewportHeight, margin = 16) {
  return caretBottom - viewportHeight + margin
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/keyboard-inset.test.js`
Expected: PASS

- [ ] **Step 5: Create the `useKeyboardInset` hook**

```js
import { useEffect, useState } from 'react'
import { computeKeyboardInset } from '../lib/keyboardInset.js'

// Tracks the on-screen keyboard's height on touch devices via the
// visualViewport API, so callers can pad/scroll content clear of it.
// Returns 0 on desktop/mouse devices and browsers without visualViewport.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !window.matchMedia?.('(pointer: coarse)')?.matches) return

    function update() {
      setInset(computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
```

- [ ] **Step 6: Wire it into `NoteEditorSurface`**

In `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`, add to the imports:

```js
import { useKeyboardInset } from '../hooks/useKeyboardInset.js'
import { isCaretHiddenByKeyboard, computeCaretScrollDelta } from '../lib/keyboardInset.js'
```

Inside `NoteEditorSurface`, add a `scrollRef` alongside the existing `containerRef`/`editorInstanceRef` declarations (line 158-159):

```js
  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const editorInstanceRef = useRef(null)
```

Right after the `isDark` line added in Task 2, add:

```js
  const rawKeyboardInset = useKeyboardInset()
  const keyboardInset = readOnly ? 0 : rawKeyboardInset

  const handleSelectionUpdate = useCallback(
    ({ editor }) => {
      if (readOnly || keyboardInset <= 0 || !scrollRef.current) return
      const coords = editor.view.coordsAtPos(editor.state.selection.head)
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      if (!isCaretHiddenByKeyboard(coords.bottom, viewportHeight)) return
      const delta = computeCaretScrollDelta(coords.bottom, viewportHeight)
      scrollRef.current.scrollBy({ top: delta, behavior: 'smooth' })
    },
    [readOnly, keyboardInset],
  )
```

Add `onSelectionUpdate={handleSelectionUpdate}` to the `<EditorProvider>` props (next to the existing `onUpdate={handleUpdate}`, around line 382).

Finally, update the return block's scrollable branch to attach `scrollRef` and the padding-bottom:

```jsx
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
          onClick={readOnly ? undefined : handleContainerClick}
        >
          <NoteSheet note={note} isDark={isDark}>
            {editorProvider}
          </NoteSheet>
        </div>
```

- [ ] **Step 7: Manual verification (cannot be unit-tested — no DOM/visualViewport in `node --test`)**

Run `pnpm dev:frontend`, open Chrome DevTools device toolbar (or a real phone) with an emulated mobile viewport, open a document note, and:
- Focus the editor and type near the bottom of the visible area — confirm the view scrolls so the caret stays visible above the on-screen keyboard, without needing manual blank lines.
- Confirm nothing changes on desktop (mouse pointer) — `useKeyboardInset` should stay at 0.
- Confirm the public read-only view is unaffected (no padding/scroll changes — `readOnly` forces `keyboardInset` to 0).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/keyboardInset.js apps/desktop/src/modules/runly.notes/lib/__tests__/keyboard-inset.test.js apps/desktop/src/modules/runly.notes/hooks/useKeyboardInset.js apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx
git commit -m "feat(notes): keep the caret visible above the mobile on-screen keyboard"
```

---

## Task 5: Frontend — collapse the notes list

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`

Desktop-only (`lg:` and up) — mobile already shows one panel at a time via the existing `mobileView` state. Persisted in `localStorage`, mirroring the exact helper-function pattern `RunlyApp.jsx` already uses for the main app sidebar (`getSidebarCollapsed`/`persistSidebarCollapsed`, wrapped in try/catch).

- [ ] **Step 1: Add the collapse icons to the lucide-react import**

In `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`, extend the existing import (lines 3-7):

```js
import {
  Plus, ArrowLeft,
  Settings2, Share2, RotateCcw, Trash2, PenLine,
  FileText, Shapes, ChevronLeft, ChevronRight,
} from 'lucide-react'
```

- [ ] **Step 2: Add the localStorage helpers**

Add near the top of the file, after `viewFromPath` (after line 34):

```js
const NOTES_LIST_COLLAPSED_KEY = 'atlas:v1:notes-list-collapsed'

function getListCollapsed() {
  try {
    return localStorage.getItem(NOTES_LIST_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function persistListCollapsed(val) {
  try {
    localStorage.setItem(NOTES_LIST_COLLAPSED_KEY, val ? '1' : '0')
  } catch {
    // localStorage unavailable (private mode, etc.) — collapse still works
    // for the session, it just won't persist across reloads.
  }
}
```

- [ ] **Step 3: Add the state**

In the `NotesScreen` function body, alongside the other `useState` declarations (after line 50):

```js
  const [listCollapsed, setListCollapsed] = useState(getListCollapsed)
```

- [ ] **Step 4: Update the list panel wrapper and header**

Replace the list panel's opening wrapper (lines 158-162):

```jsx
      <div className={[
        'shrink-0 border-r border-border flex flex-col bg-background',
        'w-full lg:w-72',
        mobileView === 'list' ? 'flex' : 'hidden lg:flex',
      ].join(' ')}>
```

with:

```jsx
      <div className={[
        'shrink-0 border-r border-border flex flex-col bg-background',
        listCollapsed ? 'w-full lg:w-12' : 'w-full lg:w-72',
        mobileView === 'list' ? 'flex' : 'hidden lg:flex',
      ].join(' ')}>
```

Replace the header row inside it (lines 164-189):

```jsx
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0">
          <span className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {folderId ? 'Carpeta' : VIEW_LABELS[activeView]}
          </span>
          {!isTrashView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={createNote.isPending}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Plus size={13} />
                  <span>Nueva</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => handleCreateNote('document')}>
                  <FileText size={13} className="mr-2" /> Documento
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleCreateNote('canvas')}>
                  <Shapes size={13} className="mr-2" /> Lienzo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
```

with:

```jsx
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0">
          {!listCollapsed && (
            <span className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {folderId ? 'Carpeta' : VIEW_LABELS[activeView]}
            </span>
          )}
          {!listCollapsed && !isTrashView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={createNote.isPending}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Plus size={13} />
                  <span>Nueva</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => handleCreateNote('document')}>
                  <FileText size={13} className="mr-2" /> Documento
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleCreateNote('canvas')}>
                  <Shapes size={13} className="mr-2" /> Lienzo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={() => {
              const next = !listCollapsed
              setListCollapsed(next)
              persistListCollapsed(next)
            }}
            className="hidden lg:flex p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title={listCollapsed ? 'Expandir lista' : 'Colapsar lista'}
          >
            {listCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>
```

- [ ] **Step 5: Hide the list body and trash actions while collapsed**

Replace the `<NotesList .../>` call plus the trash action block (lines 191-217):

```jsx
        <NotesList
          notes={notes}
          selectedNoteId={selectedNote?.id}
          onSelect={selectNote}
          onTrash={!isTrashView ? handleTrash : undefined}
          isLoading={isLoading}
          showTrash={isTrashView}
        />

        {isTrashView && selectedNote && (
          <div className="px-3 py-2 border-t border-border flex gap-2 shrink-0">
            <button
              onClick={() => { setNoteToAction(selectedNote); setRestoreOpen(true) }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-border rounded-lg hover:bg-muted text-foreground transition-colors"
            >
              <RotateCcw size={13} />
              Restaurar
            </button>
            <button
              onClick={() => { setNoteToAction(selectedNote); setDeleteOpen(true) }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-red-200 dark:border-red-900/50 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <Trash2 size={13} />
              Eliminar
            </button>
          </div>
        )}
```

with:

```jsx
        {!listCollapsed && (
          <>
            <NotesList
              notes={notes}
              selectedNoteId={selectedNote?.id}
              onSelect={selectNote}
              onTrash={!isTrashView ? handleTrash : undefined}
              isLoading={isLoading}
              showTrash={isTrashView}
            />

            {isTrashView && selectedNote && (
              <div className="px-3 py-2 border-t border-border flex gap-2 shrink-0">
                <button
                  onClick={() => { setNoteToAction(selectedNote); setRestoreOpen(true) }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-border rounded-lg hover:bg-muted text-foreground transition-colors"
                >
                  <RotateCcw size={13} />
                  Restaurar
                </button>
                <button
                  onClick={() => { setNoteToAction(selectedNote); setDeleteOpen(true) }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-red-200 dark:border-red-900/50 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  <Trash2 size={13} />
                  Eliminar
                </button>
              </div>
            )}
          </>
        )}
```

- [ ] **Step 6: Manual verification**

Run `pnpm dev`, on a desktop-width viewport:
- Click the collapse chevron — confirm the list shrinks to a narrow rail showing only the toggle button, and the editor panel gets the reclaimed width.
- Click again to expand — confirm the list and "Nueva" button return.
- Reload the page — confirm the collapsed/expanded state persisted.
- Shrink the window to mobile width — confirm the collapse toggle is hidden and the list/editor behave exactly as before (single-panel `mobileView` switching, untouched).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): add a collapsible notes list, persisted per device"
```

---

## Task 6: Frontend — fullscreen / zen mode

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`

A separate control from the list-collapse in Task 5. Implemented as a CSS `fixed inset-0 z-50` overlay rather than the browser Fullscreen API (`element.requestFullscreen()`) — the Fullscreen API has inconsistent/absent support for arbitrary elements on iOS Safari, and the spec requires this to work identically "en todos los dispositivos". A `fixed inset-0` overlay has no such platform gaps and needs no `fullscreenchange` event wiring. Session-only state (not persisted) — resets on navigation, per the approved design.

- [ ] **Step 1: Add the fullscreen icons to the lucide-react import**

Extend the import updated in Task 5:

```js
import {
  Plus, ArrowLeft,
  Settings2, Share2, RotateCcw, Trash2, PenLine,
  FileText, Shapes, ChevronLeft, ChevronRight,
  Maximize2, Minimize2,
} from 'lucide-react'
```

- [ ] **Step 2: Add the state and the Escape-to-exit handler**

Alongside the `listCollapsed` state added in Task 5:

```js
  const [isZenMode, setIsZenMode] = useState(false)

  useEffect(() => {
    if (!isZenMode) return
    function onKeyDown(e) {
      if (e.key === 'Escape') setIsZenMode(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isZenMode])
```

- [ ] **Step 3: Make the editor panel a fullscreen overlay when active**

Replace the editor panel wrapper you last edited in Task 2 (Step 3):

```jsx
      <div
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          selectedNote?.note_type === 'canvas' ? '' : 'bg-muted/30',
          mobileView === 'editor' ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
        style={selectedNote?.note_type === 'canvas' ? (() => {
          const raw = selectedNote?.background_color
          if (!raw) return {}
          const color = isDark ? (DARK_BG_MAP[raw] ?? raw) : raw
          return { backgroundColor: color }
        })() : undefined}
      >
```

with:

```jsx
      <div
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          isZenMode ? 'fixed inset-0 z-50 bg-background' : (selectedNote?.note_type === 'canvas' ? '' : 'bg-muted/30'),
          (mobileView === 'editor' || isZenMode) ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
        style={(!isZenMode && selectedNote?.note_type === 'canvas') ? (() => {
          const raw = selectedNote?.background_color
          if (!raw) return {}
          const color = isDark ? (DARK_BG_MAP[raw] ?? raw) : raw
          return { backgroundColor: color }
        })() : undefined}
      >
```

- [ ] **Step 4: Add the toggle button next to "Ajustes"**

In the header actions row (lines 252-273), add the toggle button right before the "Ajustes" button:

```jsx
          {selectedNote && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors"
              >
                <Share2 size={13} />
                <span className="hidden sm:inline">Compartir</span>
              </button>
              <button
                onClick={() => setIsZenMode(z => !z)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors"
                title={isZenMode ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {isZenMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              <button
                onClick={() => setRightPanel(p => p === 'editor' ? 'settings' : 'editor')}
                className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  rightPanel === 'settings'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Settings2 size={13} />
                <span className="hidden sm:inline">{rightPanel === 'settings' ? 'Editor' : 'Ajustes'}</span>
              </button>
            </div>
          )}
```

(Only the new button between "Compartir" and "Ajustes" is added — everything else in this block is unchanged.)

- [ ] **Step 5: Manual verification**

Run `pnpm dev`:
- Open a note, click the fullscreen toggle — confirm the notes list AND the app's global sidebar/topbar disappear, leaving only the note header + content filling the viewport.
- Press Escape — confirm it exits fullscreen back to the normal layout.
- Click the toggle again to enter, then click the same button (now showing the "exit" icon) — confirm it exits too.
- Repeat on a mobile-width viewport — confirm the same behavior (list + app chrome hidden, note fills the screen).
- While in fullscreen, open the share modal or settings panel — confirm they still render above the fullscreen overlay correctly (both use `z-50` Dialog/Popover primitives from `@runly/ui`, same stacking layer, later in DOM order — no visual clipping).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): add a distraction-free fullscreen mode for the editor"
```

---

## Final verification (whole plan)

- [ ] Run the full relevant test suites:

```bash
node --test apps/api/src/routes/notes/__tests__/
node --test apps/desktop/src/modules/runly.notes/lib/__tests__/
```

Expected: all PASS, no regressions in existing notes tests.

- [ ] Run lint: `pnpm lint`
- [ ] Manual pass through all six scenarios from the spec in one session (dev server, real or emulated mobile viewport + desktop): keyboard avoidance, list collapse, fullscreen, paper styles (light + dark), and side-by-side comparison of desktop editor vs. public link for the same note to confirm matching width/background/paper-style.
