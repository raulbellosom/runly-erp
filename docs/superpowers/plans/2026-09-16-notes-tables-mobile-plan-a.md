# Notes Editor — Tables (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let images and drawing blocks be inserted inside table cells, and make table controls (column resize, add/delete row/column/table) usable on touch devices.

**Architecture:** All changes live in `apps/desktop/src/modules/runly.notes/` (frontend only, no API/DB). The `/` slash-command menu's table guard is narrowed instead of removed; a shared, pure `getTableMenuActions()`/`tableMenuSections()` module backs both the existing desktop toolbar popover and a new touch-only floating button + bottom sheet, so there is exactly one source of truth for what the "Tabla" menu contains.

**Tech Stack:** React, TipTap v3 (ProseMirror), `@runly/ui` (`Sheet`, `useCoarsePointer`), Node's built-in test runner (`node --test`).

Spec: `docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md` (sections 1 and 4).

---

### Task 1: Extract slash-command items into a testable module with table filtering

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/slashCommandItems.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/slash-command-items.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/lib/extensions/SlashCommand.jsx`

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/modules/runly.notes/lib/__tests__/slash-command-items.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterSlashItems } from '../slashCommandItems.js'

const items = [
  { title: 'Tabla', keywords: ['table', 'tabla'] },
  { title: 'Bloque de codigo', keywords: ['code', 'codigo'] },
  { title: 'Imagen', keywords: ['image', 'imagen', 'foto'], allowedInTable: true },
  { title: 'Canvas de dibujo', keywords: ['drawing', 'dibujo', 'canvas'], allowedInTable: true },
]

test('filterSlashItems returns everything when not inside a table', () => {
  const result = filterSlashItems(items, { query: '', inTable: false })
  assert.deepEqual(result.map((i) => i.title), items.map((i) => i.title))
})

test('filterSlashItems keeps only allowedInTable items when inside a table', () => {
  const result = filterSlashItems(items, { query: '', inTable: true })
  assert.deepEqual(result.map((i) => i.title), ['Imagen', 'Canvas de dibujo'])
})

test('filterSlashItems applies the query filter on top of the table restriction', () => {
  const result = filterSlashItems(items, { query: 'dibujo', inTable: true })
  assert.deepEqual(result.map((i) => i.title), ['Canvas de dibujo'])
})

test('filterSlashItems query matches keywords too, outside a table', () => {
  const result = filterSlashItems(items, { query: 'codigo', inTable: false })
  assert.deepEqual(result.map((i) => i.title), ['Bloque de codigo'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/slash-command-items.test.js`
Expected: FAIL — `Cannot find module '../slashCommandItems.js'`

- [ ] **Step 3: Create `slashCommandItems.js` with `buildSlashItems` (moved verbatim from `SlashCommand.jsx`, two items tagged) and the new `filterSlashItems`**

```js
// apps/desktop/src/modules/runly.notes/lib/slashCommandItems.js
import {
  Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Code2, Table2, ImagePlus, PenLine,
} from 'lucide-react'
import { pickAndUploadNoteImage } from './noteImageUpload.js'

// Notion-style "/" command list. Each `run` reuses the exact same editor
// command the equivalent NoteToolbar.jsx button already calls — no
// duplicated block-insertion logic. `allowedInTable: true` marks the only
// two items that stay available while the cursor is inside a table cell —
// everything else (headings, lists, nested tables, etc.) stays blocked
// there (see docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md).
export function buildSlashItems({ noteId, token }) {
  return [
    { title: 'Titulo 1', icon: Heading1, keywords: ['heading', 'h1', 'titulo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
    { title: 'Titulo 2', icon: Heading2, keywords: ['heading', 'h2', 'titulo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
    { title: 'Titulo 3', icon: Heading3, keywords: ['heading', 'h3', 'titulo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
    { title: 'Lista con vinetas', icon: List, keywords: ['bullet', 'lista'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
    { title: 'Lista numerada', icon: ListOrdered, keywords: ['ordered', 'numerada', 'lista'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
    { title: 'Lista de tareas', icon: ListChecks, keywords: ['task', 'checklist', 'pendientes'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
    { title: 'Cita', icon: Quote, keywords: ['quote', 'blockquote'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
    { title: 'Bloque de codigo', icon: Code2, keywords: ['code', 'codigo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
    { title: 'Tabla', icon: Table2, keywords: ['table', 'tabla'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { title: 'Imagen', icon: ImagePlus, keywords: ['image', 'imagen', 'foto'], allowedInTable: true,
      run: (editor, range) => { editor.chain().focus().deleteRange(range).run(); pickAndUploadNoteImage({ editor, noteId, token }) } },
    { title: 'Canvas de dibujo', icon: PenLine, keywords: ['drawing', 'dibujo', 'canvas'], allowedInTable: true,
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertDrawingBlock().run() },
  ]
}

// Pure filter used by the Suggestion `items` callback — kept separate from
// buildSlashItems so it's testable without a TipTap editor instance.
export function filterSlashItems(items, { query, inTable }) {
  const pool = inTable ? items.filter((item) => item.allowedInTable === true) : items
  const q = (query || '').toLowerCase()
  if (!q) return pool
  return pool.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/slash-command-items.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the new module into `SlashCommand.jsx`, allow `/` to open inside a table, and delete the old inline `buildItems`**

Replace the whole file:

```jsx
// apps/desktop/src/modules/runly.notes/lib/extensions/SlashCommand.jsx
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { SlashCommandMenu } from '../../components/SlashCommandMenu.jsx'
import { buildSlashItems, filterSlashItems } from '../slashCommandItems.js'

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return { noteId: null, token: null }
  },

  addProseMirrorPlugins() {
    const { noteId, token } = this.options
    const items = buildSlashItems({ noteId, token })

    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        // Table cells allow image + drawing (filtered in `items` below); only
        // codeBlock stays a hard block on the whole menu opening at all.
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: ({ editor, query }) =>
          filterSlashItems(items, { query, inTable: editor.isActive('table') }),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let component
          let unmount

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandMenu, { props, editor: props.editor })
              unmount = props.mount(component.element)
            },
            onUpdate(props) {
              component.updateProps(props)
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                unmount?.()
                return true
              }
              return component.ref?.onKeyDown(props) ?? false
            },
            onExit() {
              unmount?.()
              component.destroy()
            },
          }
        },
      }),
    ]
  },
})
```

- [ ] **Step 6: Run the full notes test suite to confirm nothing else broke**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/`
Expected: PASS (all files, including the new one)

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/slashCommandItems.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/slash-command-items.test.js \
        apps/desktop/src/modules/runly.notes/lib/extensions/SlashCommand.jsx
git commit -m "feat(notes): allow image and drawing slash commands inside table cells"
```

---

### Task 2: Shared, testable table-menu-actions module

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/tableMenuActions.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/table-menu-actions.test.js`

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/modules/runly.notes/lib/__tests__/table-menu-actions.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTableMenuActions, tableMenuSections } from '../tableMenuActions.js'

function fakeEditor() {
  const calls = []
  const chain = {}
  for (const method of [
    'focus', 'addColumnAfter', 'addColumnBefore', 'addRowAfter', 'addRowBefore',
    'deleteColumn', 'deleteRow', 'deleteTable',
  ]) {
    chain[method] = () => { calls.push(method); return chain }
  }
  chain.run = () => { calls.push('run'); return true }
  return { editor: { chain: () => chain }, calls }
}

test('getTableMenuActions returns the 7 expected actions in order', () => {
  const { editor } = fakeEditor()
  const actions = getTableMenuActions(editor)
  assert.deepEqual(actions.map((a) => a.label), [
    'Agregar columna a la derecha',
    'Agregar columna a la izquierda',
    'Agregar fila abajo',
    'Agregar fila arriba',
    'Eliminar columna',
    'Eliminar fila',
    'Eliminar tabla',
  ])
})

test('getTableMenuActions marks only the delete actions as destructive', () => {
  const { editor } = fakeEditor()
  const actions = getTableMenuActions(editor)
  assert.deepEqual(
    actions.filter((a) => a.destructive).map((a) => a.label),
    ['Eliminar columna', 'Eliminar fila', 'Eliminar tabla'],
  )
})

test('each action onClick chains focus() through to the matching command and run()', () => {
  const { editor, calls } = fakeEditor()
  const actions = getTableMenuActions(editor)
  actions[0].onClick()
  assert.deepEqual(calls, ['focus', 'addColumnAfter', 'run'])
})

test('tableMenuSections groups consecutive same-group actions for divider placement', () => {
  const { editor } = fakeEditor()
  const sections = tableMenuSections(getTableMenuActions(editor))
  assert.deepEqual(sections.map((s) => s.group), ['add', 'delete-cell', 'delete-table'])
  assert.deepEqual(sections.map((s) => s.items.length), [4, 2, 1])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/table-menu-actions.test.js`
Expected: FAIL — `Cannot find module '../tableMenuActions.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/desktop/src/modules/runly.notes/lib/tableMenuActions.js
// Single source of truth for the "Tabla" options menu, shared by the desktop
// toolbar popover (NoteToolbar.jsx) and the touch floating sheet
// (TableFloatingMenu.jsx) so both stay in sync.
export function getTableMenuActions(editor) {
  return [
    { label: 'Agregar columna a la derecha', group: 'add',
      onClick: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Agregar columna a la izquierda', group: 'add',
      onClick: () => editor.chain().focus().addColumnBefore().run() },
    { label: 'Agregar fila abajo', group: 'add',
      onClick: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Agregar fila arriba', group: 'add',
      onClick: () => editor.chain().focus().addRowBefore().run() },
    { label: 'Eliminar columna', group: 'delete-cell', destructive: true,
      onClick: () => editor.chain().focus().deleteColumn().run() },
    { label: 'Eliminar fila', group: 'delete-cell', destructive: true,
      onClick: () => editor.chain().focus().deleteRow().run() },
    { label: 'Eliminar tabla', group: 'delete-table', destructive: true,
      onClick: () => editor.chain().focus().deleteTable().run() },
  ]
}

// Groups consecutive actions that share the same `group`, so callers can
// render a divider between groups without hardcoding positions.
export function tableMenuSections(actions) {
  const sections = []
  for (const action of actions) {
    const last = sections[sections.length - 1]
    if (last && last.group === action.group) last.items.push(action)
    else sections.push({ group: action.group, items: [action] })
  }
  return sections
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/table-menu-actions.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/tableMenuActions.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/table-menu-actions.test.js
git commit -m "feat(notes): extract shared table-menu-actions module"
```

---

### Task 3: Refactor the desktop toolbar's table popover to use the shared module

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx`

- [ ] **Step 1: Add the import**

In `apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx`, after the existing `import { KeyboardShortcutsDialog } ...` line, add:

```js
import { getTableMenuActions, tableMenuSections } from '../lib/tableMenuActions.js'
```

- [ ] **Step 2: Replace the hardcoded `PopoverContent` body**

Find this block (currently lines 416-426):

```jsx
            <PopoverContent className="p-1 w-52" side="bottom" align="start">
              <TableMenuItem label="Agregar columna a la derecha" onClick={() => editor.chain().focus().addColumnAfter().run()} />
              <TableMenuItem label="Agregar columna a la izquierda" onClick={() => editor.chain().focus().addColumnBefore().run()} />
              <TableMenuItem label="Agregar fila abajo" onClick={() => editor.chain().focus().addRowAfter().run()} />
              <TableMenuItem label="Agregar fila arriba" onClick={() => editor.chain().focus().addRowBefore().run()} />
              <div className="my-1 border-t border-border" />
              <TableMenuItem label="Eliminar columna" onClick={() => editor.chain().focus().deleteColumn().run()} destructive />
              <TableMenuItem label="Eliminar fila" onClick={() => editor.chain().focus().deleteRow().run()} destructive />
              <div className="my-1 border-t border-border" />
              <TableMenuItem label="Eliminar tabla" onClick={() => editor.chain().focus().deleteTable().run()} destructive />
            </PopoverContent>
```

Replace it with:

```jsx
            <PopoverContent className="p-1 w-52" side="bottom" align="start">
              {tableMenuSections(getTableMenuActions(editor)).map((section, si) => (
                <div key={section.group}>
                  {si > 0 && <div className="my-1 border-t border-border" />}
                  {section.items.map((action) => (
                    <TableMenuItem
                      key={action.label}
                      label={action.label}
                      onClick={action.onClick}
                      destructive={action.destructive}
                    />
                  ))}
                </div>
              ))}
            </PopoverContent>
```

- [ ] **Step 3: Manual check — no automated test for this file (no existing test harness renders NoteToolbar)**

Run: `pnpm dev:frontend`, open a note, click into a table, open the "Tabla" popover from the toolbar. Confirm the same 7 items appear in the same order with the same two dividers as before the refactor (visually identical to pre-change).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx
git commit -m "refactor(notes): drive the toolbar table menu from the shared actions module"
```

---

### Task 4: CSS fixes — resize-handle clipping and touch visibility

**Files:**
- Modify: `apps/desktop/src/styles.css:661-685`

- [ ] **Step 1: Read the current rules to confirm line numbers before editing**

The current block (`apps/desktop/src/styles.css:661-685`):

```css
.tiptap .column-resize-handle {
  background: #f59e0b;
  bottom: -2px;
  /* pointer-events: auto allows touch events to target the handle directly */
  pointer-events: auto;
  position: absolute;
  right: -3px;
  top: 0;
  width: 6px;
  z-index: 10;
  cursor: col-resize;
  touch-action: none;
  opacity: 0;
  transition: opacity 0.1s;
}
.tiptap td:hover .column-resize-handle,
.tiptap th:hover .column-resize-handle,
.tiptap .resize-cursor .column-resize-handle {
  opacity: 1;
}
.tiptap .tableWrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0.75rem 0;
}
.tiptap .resize-cursor { cursor: col-resize; }
```

- [ ] **Step 2: Apply the fix**

Replace that block with:

```css
.tiptap .column-resize-handle {
  background: #f59e0b;
  bottom: -2px;
  /* pointer-events: auto allows touch events to target the handle directly */
  pointer-events: auto;
  position: absolute;
  right: -3px;
  top: 0;
  width: 6px;
  z-index: 10;
  cursor: col-resize;
  touch-action: none;
  opacity: 0;
  transition: opacity 0.1s;
}
.tiptap td:hover .column-resize-handle,
.tiptap th:hover .column-resize-handle,
.tiptap .resize-cursor .column-resize-handle {
  opacity: 1;
}
/* :hover never fires on touch, so the handle would otherwise stay invisible
   forever on phones even though the touch->mouse bridge (NoteEditor.jsx)
   already forwards touch events to it. Always show it, and widen the strip
   for a more forgiving touch target. */
@media (pointer: coarse) {
  .tiptap .column-resize-handle {
    opacity: 1;
    width: 12px;
    right: -6px;
  }
}
.tiptap .tableWrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0.75rem 0;
  /* Breathing room so the image resize handle's -m-5 extended hit-area
     (ImageAnnotationOverlay.jsx) isn't clipped by this wrapper's overflow
     when the image sits in the table's last column/row. */
  padding: 0 0.5rem 0.5rem 0;
}
.tiptap .resize-cursor { cursor: col-resize; }
```

- [ ] **Step 3: Manual check**

Run: `pnpm dev:frontend`. In a browser devtools mobile emulation (390px width, touch simulated), open a note with a table, tap into a cell — the amber column-resize strip should be visible without needing to hover. Insert an image into the last cell of the last row/column of a table (needs Task 5/6 of Plan B to actually insert one, or temporarily test by moving an existing image node into a cell via `editor.commands` in the console) and confirm its resize handle isn't visually cut off at the table's edge.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "fix(notes): make table column-resize handle visible on touch, fix handle clipping"
```

---

### Task 5: `TableFloatingMenu` — touch-only floating table options

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/components/TableFloatingMenu.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`

- [ ] **Step 1: Write the component**

```jsx
// apps/desktop/src/modules/runly.notes/components/TableFloatingMenu.jsx
import { useState } from 'react'
import { useCurrentEditor } from '@tiptap/react'
import { Table2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, useCoarsePointer } from '@runly/ui'
import { getTableMenuActions, tableMenuSections } from '../lib/tableMenuActions.js'

// Touch-only replacement for the desktop toolbar's inline "Tabla" popover
// (NoteToolbar.jsx), which is easy to lose inside the horizontally-scrolling
// mobile toolbar. Renders nothing on a fine-pointer (mouse/trackpad) device —
// the existing toolbar popover keeps working there unchanged.
export function TableFloatingMenu() {
  const { editor } = useCurrentEditor()
  const isCoarsePointer = useCoarsePointer()
  const [open, setOpen] = useState(false)

  if (!editor || !isCoarsePointer || !editor.isActive('table')) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Opciones de tabla"
        title="Opciones de tabla"
        className="fixed z-20 flex items-center justify-center w-12 h-12 rounded-full bg-amber-500 text-white shadow-lg active:scale-95 transition-transform"
        style={{ right: '1rem', bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Table2 className="w-5 h-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Opciones de tabla</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1">
            {tableMenuSections(getTableMenuActions(editor)).map((section, si) => (
              <div key={section.group}>
                {si > 0 && <div className="my-1 border-t border-border" />}
                {section.items.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => { action.onClick(); setOpen(false) }}
                    className={[
                      'w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors',
                      action.destructive
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'text-foreground hover:bg-muted',
                    ].join(' ')}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
```

- [ ] **Step 2: Mount it inside `EditorProvider`'s context in `NoteEditor.jsx`**

Add the import near the other component imports in `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`:

```js
import { TableFloatingMenu } from './TableFloatingMenu.jsx'
```

Then find (near the end of `NoteEditorSurface`, inside the `<EditorProvider ...>` element):

```jsx
    >
      {/* EditorProvider renders children inside editor context */}
    </EditorProvider>
```

Replace with:

```jsx
    >
      {!readOnly && <TableFloatingMenu />}
    </EditorProvider>
```

- [ ] **Step 3: Manual check**

Run: `pnpm dev:frontend`. In devtools mobile emulation (390px, touch simulated): open a note, tap into a table cell — a round amber floating button should appear bottom-right; tapping it opens a bottom sheet with the same 7 options (2 dividers) as the desktop toolbar popover; tapping "Eliminar tabla" removes the table and closes the sheet. Then resize the browser to desktop width (1440px, mouse) and confirm the floating button never appears and the toolbar's inline popover is unaffected.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/TableFloatingMenu.jsx \
        apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx
git commit -m "feat(notes): add touch-only floating table options menu"
```

---

### Task 6: Full verification pass

- [ ] **Step 1: Run the full notes unit test suite**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/`
Expected: PASS (all files)

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no new errors in the changed files.

- [ ] **Step 3: Manual QA — screenshots at 390px and 1440px, both themes (per `docs/ai-context/ui-screen-audit-checklist.md`)**

- Insert an image via `/imagen` while the cursor is inside a table cell; confirm `/tabla`, `/titulo 1`, etc. do NOT appear in the menu while inside the cell, but do appear outside it.
- Insert a drawing block (`/canvas de dibujo`) inside a cell the same way.
- 390px, touch emulation: column-resize handle visible without hovering; dragging it resizes the column; floating "Tabla" button appears when the cursor is in a table and its sheet's actions all work (add column/row, delete column/row/table).
- 1440px, mouse: toolbar's inline "Tabla" popover unchanged in appearance and behavior; no floating button rendered anywhere.
- Both themes (light/dark): floating button and sheet contrast is readable in both.

- [ ] **Step 4: Update the spec status if all manual QA passes**

In `docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md`, no changes needed — the spec doesn't track a completion checklist itself. If `docs/TASKS.md` tracks notes-module work, add a line noting Plan A (tables) is complete, with `Verified: YYYY-MM-DD (390px + 1440px, both themes)`.
