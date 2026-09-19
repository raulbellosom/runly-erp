# Notes: title wraps correctly + realistic notebook paper effects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the title/icon overlap so long titles wrap normally instead of looking broken, and add three independently-toggleable "realistic notebook" paper effects (warm ruled-line color, red margin line, subtle texture, sheet shadow) on top of the existing "Estilo de hoja" picker.

**Architecture:** One-line CSS fix (`padding-left` → `text-indent`) for the title. Three new boolean columns on `notes`, following the exact existing `paper_style` pattern in `notes-service.js`. Three new `data-*` attributes on `NoteEditor.jsx`'s outer wrapper (mirroring `data-paper-style`), driving CSS attribute-selector rules on `.note-sheet` — pseudo-elements for the margin line and texture, a direct `box-shadow` for depth, and updated CSS custom properties for the ruled-line color. A new settings-panel section with three checkboxes.

**Tech Stack:** JavaScript (no TypeScript), React, Tailwind CSS, Hono, `prisma.$queryRaw` raw SQL, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-19-notes-title-wrap-and-realistic-paper-design.md`

**Note on `NoteSettingsPanel.jsx`:** this file has been restructured since earlier work on this module (now uses `@runly/ui`'s `Sheet`/`SheetContent` and a local `Section({ label, children })` helper instead of the older `SectionLabel` pattern, and takes `open`/`onOpenChange` props). Read the file's CURRENT content before editing — anchor by the "Estilo de hoja" `Section` block and the `@runly/ui` import list, not by assumed old structure.

---

## Task 1: Backend — three new paper-effect columns

**Files:**
- Create: `prisma/migrations/<TIMESTAMP>_notes_paper_effects/migration.sql`
- Modify: `apps/api/src/routes/notes/notes-service.js`
- Test: `apps/api/src/routes/notes/__tests__/notes-access.test.js`

- [ ] Step 1: Migration

```sql
ALTER TABLE notes
  ADD COLUMN paper_margin  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN paper_texture BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN paper_shadow  BOOLEAN NOT NULL DEFAULT false;
```

Pick a timestamp later than the most recently applied migration (check `prisma/migrations/` for the latest folder). Apply with `pnpm db:migrate` against the shared Supabase instance (already approved by the user for this kind of schema change in this module — see prior `paper_style`/`content_text` migrations on this same table).

- [ ] Step 2: Extend `listNotes`'s GROUP BY

Add `a.paper_margin, a.paper_texture, a.paper_shadow,` to the GROUP BY list in `listNotes`, right after the existing `a.paper_style,` entry (same reasoning as the existing column: the query groups a CTE, not a base table, so every non-aggregated selected column must be listed explicitly).

- [ ] Step 3: Extend `updateNote`'s CASE block

Add three more CASE blocks, mirroring `paper_style`'s exactly, right after it:

```js
        paper_margin         = CASE
                                 WHEN ${data.paperMargin !== undefined ? "t" : "f"}::boolean = TRUE
                                 THEN ${data.paperMargin ?? false}::boolean
                                 ELSE paper_margin
                               END,
        paper_texture        = CASE
                                 WHEN ${data.paperTexture !== undefined ? "t" : "f"}::boolean = TRUE
                                 THEN ${data.paperTexture ?? false}::boolean
                                 ELSE paper_texture
                               END,
        paper_shadow         = CASE
                                 WHEN ${data.paperShadow !== undefined ? "t" : "f"}::boolean = TRUE
                                 THEN ${data.paperShadow ?? false}::boolean
                                 ELSE paper_shadow
                               END,
```

- [ ] Step 4: Test

Add to `notes-access.test.js`, mirroring the existing `paper_style`/`contentText` CASE-update tests exactly (same `fakePrisma` pattern):

```js
describe("notes-service — updateNote paper effect toggles", () => {
  it("includes paper_margin/paper_texture/paper_shadow in the CASE update and returns them", async () => {
    let capturedSql = "";
    const prisma = {
      $queryRaw: (strings) => {
        const text = sql(strings).toLowerCase();
        capturedSql = text;
        if (text.includes("from notes n left join note_shares")) {
          return Promise.resolve([{ id: NOTE, owner_user_id: OWNER, share_permission: null }]);
        }
        if (text.includes("update notes")) {
          return Promise.resolve([{ id: NOTE, paper_margin: true, paper_texture: true, paper_shadow: true }]);
        }
        return Promise.resolve([]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createNotesService({ prisma });
    const note = await svc.updateNote(NOTE, OWNER, { paperMargin: true, paperTexture: true, paperShadow: true });
    assert.equal(note.paper_margin, true);
    assert.equal(note.paper_texture, true);
    assert.equal(note.paper_shadow, true);
    assert.match(capturedSql, /paper_margin/);
    assert.match(capturedSql, /paper_texture/);
    assert.match(capturedSql, /paper_shadow/);
  });
});
```

Run `node --test apps/api/src/routes/notes/__tests__/notes-access.test.js` — confirm it passes (plus the one pre-existing unrelated failure already known from this module).

- [ ] Step 5: Commit

```bash
git add prisma/migrations apps/api/src/routes/notes/notes-service.js apps/api/src/routes/notes/__tests__/notes-access.test.js
git commit -m "feat(notes): add paper_margin/paper_texture/paper_shadow columns"
```

---

## Task 2: Frontend — title wraps correctly

**Files:** Modify `apps/desktop/src/styles.css`

- [ ] Step 1: In the `.tiptap > p:first-child` rule, change `padding-left: 2.75rem;` (added in earlier work on the icon/title overlap) to `text-indent: 2.75rem;`. Nothing else in that rule changes.
- [ ] Step 2: Commit

```bash
git add apps/desktop/src/styles.css
git commit -m "fix(notes): long titles wrap to a new line instead of staying indented"
```

---

## Task 3: Frontend — paper color system + margin line + texture + shadow CSS

**Files:** Modify `apps/desktop/src/styles.css`

- [ ] Step 1: Add new CSS custom properties for the ruled-line and margin-line colors, in both `:root` and `.dark` (find where other note-related tokens like `--muted-foreground` are declared for each and add alongside):

```css
:root {
  --note-paper-line: 213 55% 78%;
  --note-paper-margin: 350 70% 78%;
}
.dark {
  --note-paper-line: 213 35% 38%;
  --note-paper-margin: 350 45% 45%;
}
```

- [ ] Step 2: Update the existing lined/grid rules to use the new line-color variable instead of `hsl(var(--border))` — find the `[data-paper-style="lined"] .note-sheet` / `[data-paper-style="grid"] .note-sheet` rules (and their `@media (max-width: 639px)` mobile overrides) and replace every `hsl(var(--border))` inside them with `hsl(var(--note-paper-line))`.

- [ ] Step 3: Add `position: relative` to `.note-sheet`'s base rule so the new pseudo-elements anchor correctly. Find wherever `.note-sheet` (or the class list containing it) is styled — if there's no dedicated `.note-sheet { ... }` rule yet (the class is applied via Tailwind utilities in `NoteSheet.jsx`, not a custom CSS block), add one:

```css
.note-sheet {
  position: relative;
}
```

- [ ] Step 4: Add the margin-line, texture, and shadow rules (anywhere near the existing paper-style block):

```css
/* Red margin line (school-notebook style) — independent of paper_style,
   works even on a blank ("En blanco") page. */
[data-paper-margin="true"] .note-sheet::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3.5rem;
  width: 1px;
  background: hsl(var(--note-paper-margin) / 0.6);
  pointer-events: none;
}

/* Subtle paper grain — inline SVG feTurbulence noise, no external asset.
   Kept at very low opacity so it never fights with text contrast. */
[data-paper-texture="true"] .note-sheet::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  opacity: 0.035;
  pointer-events: none;
}

/* Sheet depth — a page sitting on the desk, not a flat panel. */
[data-paper-shadow="true"] .note-sheet {
  box-shadow: 0 4px 24px -4px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.08);
}
```

- [ ] Step 2 (manual verification, do this once Task 4 also lands so the toggles are reachable from the UI): dev server, dark and light mode — each of the 3 toggles alone and combined, on top of each of the 3 base paper styles, plus a long multi-line title next to the icon.

- [ ] Step 5: Commit

```bash
git add apps/desktop/src/styles.css
git commit -m "feat(notes): warmer paper-line color, red margin line, texture, and sheet shadow"
```

---

## Task 4: Frontend — settings UI + NoteEditor attributes + optimistic-update map

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteSettingsPanel.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`

- [ ] Step 1: In `NoteSettingsPanel.jsx`, add `CheckboxField` to the existing `@runly/ui` import list (it currently imports `ConfirmDialog, TextField, CreatableComboboxField, Popover, PopoverTrigger, PopoverContent, Sheet, SheetContent, SheetHeader, SheetTitle` — add `CheckboxField` to that list).

Add a new `Section` right after the existing "Estilo de hoja" `Section` block (the one mapping over `NOTE_PAPER_STYLES`):

```jsx
            <Section label="Efectos de papel">
              <div className="space-y-2.5">
                <CheckboxField
                  id="paper-margin"
                  label="Linea de margen roja"
                  checked={note?.paper_margin ?? false}
                  onChange={e => onUpdate({ paperMargin: e.target.checked })}
                />
                <CheckboxField
                  id="paper-texture"
                  label="Textura de papel"
                  checked={note?.paper_texture ?? false}
                  onChange={e => onUpdate({ paperTexture: e.target.checked })}
                />
                <CheckboxField
                  id="paper-shadow"
                  label="Sombra de hoja"
                  checked={note?.paper_shadow ?? false}
                  onChange={e => onUpdate({ paperShadow: e.target.checked })}
                />
              </div>
            </Section>
```

(Keep this inside whatever `{!isCanvas && (...)}` guard already wraps the "Estilo de hoja" section, if any — these effects are just as inapplicable to canvas notes as the paper style itself.)

- [ ] Step 2: In `NoteEditor.jsx`, find where `data-paper-style={note.paper_style ?? 'none'}` is set on the outer wrapper div and add the three new attributes alongside it:

```jsx
      data-paper-style={note.paper_style ?? 'none'}
      data-paper-margin={note.paper_margin ? 'true' : 'false'}
      data-paper-texture={note.paper_texture ? 'true' : 'false'}
      data-paper-shadow={note.paper_shadow ? 'true' : 'false'}
```

- [ ] Step 3: In `NotesScreen.jsx`, find the `camelToSnake` map (already has `paperStyle: 'paper_style'`) and add:

```js
      paperMargin: 'paper_margin', paperTexture: 'paper_texture', paperShadow: 'paper_shadow',
```

- [ ] Step 4: Manual verification

Run `pnpm dev`, open a note's Ajustes:
- Confirm the 3 new checkboxes appear under "Efectos de papel", below "Estilo de hoja".
- Toggle each on/off — confirm the corresponding visual effect appears/disappears immediately in the editor (margin line, grain texture, shadow).
- Combine all 3 with each paper style (none/lined/grid) — confirm nothing looks broken or z-index-clipped.
- Reload the note — confirm the toggles persisted.
- Confirm none of this appears on a canvas (lienzo) note's settings.
- Type a long title that wraps to 2 lines — confirm the icon sits correctly on line 1 and line 2 renders at full width, not indented.

- [ ] Step 5: Commit

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteSettingsPanel.jsx apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): settings UI for the new paper-effect toggles"
```

---

## Final verification

- [ ] `node --test apps/api/src/routes/notes/__tests__/notes-access.test.js` — all pass except the one known pre-existing unrelated failure.
- [ ] `pnpm lint` — clean.
- [ ] Full manual pass: long title wrap, all 3 toggles × all 3 paper styles × light/dark mode.
