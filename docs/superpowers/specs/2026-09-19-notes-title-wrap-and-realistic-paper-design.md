# Notes: title wraps correctly + realistic notebook paper effects

Date: 2026-09-19
Status: Approved
Scope: two follow-up refinements to work already shipped in `runly.notes` — the icon/title overlap (from an earlier session) and the paper-style lined/grid background — plus a genuinely new feature (three independent, toggleable paper effects).

## 1. Title wraps to a second line correctly

**Symptom:** a long title looks broken/misaligned with the overlapping icon.

**Root cause:** the icon/title overlap fix reserved horizontal space for the icon via `padding-left: 2.75rem` on `.tiptap > p:first-child` — `padding-left` applies to the WHOLE element, so every wrapped line of a long title (not just the first one, where the icon actually sits) gets pushed in by that amount, which both looks wrong (line 2+ needlessly indented) and isn't what a normal wrapping title should do.

**Fix:** replace `padding-left: 2.75rem` with `text-indent: 2.75rem` on the same rule. `text-indent` is a standard CSS property that affects ONLY the first line box of a block element — exactly the line the icon overlaps — while any wrapped continuation line renders at the normal full width, indent-free. Confirmed with the user: when a title is too long for one line, it should simply continue on a line below (normal text wrapping), not truncate or shrink — `text-indent` is the minimal, correct fix for that. Known minor limitation, acceptable: the icon (`w-10 h-10`, 40px) is slightly taller than one title line box (~32.5px), so on a title that wraps to 2+ lines the icon may overhang a few pixels into the very top of line 2 — a small cosmetic nuance, not a functional problem.

## 2. Realistic notebook paper effects

**Symptom:** the current lined/grid background reads as flat vector lines, not like a real notebook page.

**Design:** four independent visual refinements, each individually toggleable per note (alongside the existing "Estilo de hoja" none/lined/grid picker in the note's settings panel, not replacing it):

1. **Warm, paper-like line color** — replace the generic `hsl(var(--border))` line color (used by both the lined and grid patterns) with a dedicated color designed to read as ruled-paper blue, with its own light/dark values (new CSS custom properties, e.g. `--note-paper-line`), rather than reusing the app's neutral UI border token. Applies automatically whenever "Rayado"/"Cuadriculado" is selected — not a separate toggle, since it's not a new effect, it's fixing the color of the existing one.
2. **Red margin line** (independent toggle: `paper_margin`) — a thin vertical line near the left edge, in a soft red/rose tone with its own light/dark values, mimicking the classic margin rule on school-notebook paper. Rendered as a `::before` pseudo-element on the sheet, positioned independently of whatever `paper_style` is active (works even with "En blanco").
3. **Subtle paper texture** (independent toggle: `paper_texture`) — a very low-opacity grain/noise layer (an inline SVG `feTurbulence` data URI, no external asset), rendered as a `::after` pseudo-element so it composes with the line pattern and margin line without any CSS layering conflicts.
4. **Sheet shadow/depth** (independent toggle: `paper_shadow`) — a more pronounced `box-shadow` on the sheet itself, reinforcing the "physical page sitting on a desk" look established by the existing sheet-on-canvas layout.

Each of the three toggles (margin, texture, shadow) is a boolean, independently settable, so the user can mix and match (e.g., shadow + texture but no margin line) or turn on all of them together. They're not exclusive to the lined/grid patterns — a blank ("En blanco") page can still have a margin line, texture, and/or shadow.

**Color values (first pass — flagged to the user as something they may want to fine-tune once they see it live, since paper-color preference is inherently subjective):**
- Ruled-line color: soft sky-blue in light mode, muted navy-blue in dark mode (replacing the neutral gray).
- Margin-line color: soft coral/rose in light mode, muted rose in dark mode.

## Data model

Three new boolean columns on `notes`, mirroring the existing `paper_style` column's pattern exactly (new forward migration, `notes-service.js`'s `listNotes` GROUP BY and `updateNote` CASE block extended the same way):
- `paper_margin BOOLEAN NOT NULL DEFAULT false`
- `paper_texture BOOLEAN NOT NULL DEFAULT false`
- `paper_shadow BOOLEAN NOT NULL DEFAULT false`

Frontend camelCase equivalents: `paperMargin`, `paperTexture`, `paperShadow` — added to `NotesScreen.jsx`'s existing `camelToSnake` optimistic-update map alongside `paperStyle`.

## Rendering approach

Mirrors the existing `data-paper-style` attribute pattern (set on `NoteEditor.jsx`'s outer wrapper, a plain reactive React attribute — not baked into TipTap's `editorProps`, so it updates live without a remount): three more attributes, `data-paper-margin`, `data-paper-texture`, `data-paper-shadow`, each `"true"`/`"false"` driven by the corresponding note field. CSS attribute-selectors on `.note-sheet` (the same class the existing paper-style CSS already targets) apply each effect independently:
- Line-color change: update the existing `[data-paper-style="lined"/"grid"] .note-sheet` rules to reference the new `--note-paper-line` variable instead of `hsl(var(--border))`.
- Margin line: `[data-paper-margin="true"] .note-sheet::before { ... }`.
- Texture: `[data-paper-texture="true"] .note-sheet::after { ... }`.
- Shadow: `[data-paper-shadow="true"] .note-sheet { box-shadow: ...; }`.

`.note-sheet` needs `position: relative` added (currently unset) so the two pseudo-elements anchor correctly to its box — harmless addition, doesn't conflict with the existing zoom/background-color inline styles or the `bg-card`/max-width classes already on that element.

## Settings UI

A new "Efectos de papel" section in `NoteSettingsPanel.jsx`, placed right after the existing "Estilo de hoja" section, with three `CheckboxField` rows (`@runly/ui`, per this codebase's UI-first policy — no native checkboxes) for margin/texture/shadow, each calling `onUpdate({ paperMargin: checked })` etc. on change.

## Non-goals

- Not making the ruled-line/margin colors user-customizable beyond the two toggled states (on/off with a fixed color) — no color picker for these specific effects in this pass.
- Not touching the existing "Estilo de hoja" (none/lined/grid) picker's own structure — only its line COLOR changes.
- Not addressing the pre-existing, already-known limitation that ruled lines don't perfectly align under headings/lists (unrelated, unchanged).

## Testing

- Backend: extend the existing `paper_style` CASE-update test pattern in `notes-access.test.js` with equivalent coverage for the three new boolean columns.
- No automated tests for the CSS/pseudo-element effects or the `text-indent` fix (component/CSS-only, consistent with this codebase's convention).
- Manual verification: dev server — a long multi-line title next to the icon, each of the 3 new toggles individually and combined, in both light and dark mode, on top of each of the 3 base paper styles (none/lined/grid).
