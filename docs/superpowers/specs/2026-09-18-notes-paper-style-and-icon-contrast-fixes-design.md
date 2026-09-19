# Notes: paper-style coverage fix + dark-mode icon contrast audit

Date: 2026-09-18
Status: Approved
Scope: two small, independent bug fixes reported after the notes editor mobile/fullscreen/paper feature shipped. Not a new feature — corrects regressions/gaps in already-shipped behavior.

## Bug 1: dark-mode icon contrast in inputs

**Symptom:** in dark mode, the search icon in the notes list ("Buscar notas...") and similar leading icons in other inputs are hard to see.

**Root cause (confirmed by investigation):** several shared input components stack an extra opacity modifier on top of the already-muted `--muted-foreground` token color (`text-muted-foreground/60`, `/70`, `/80`), compounding into low effective contrast against dark backgrounds. This exact bug class was already hit once before in this codebase (`docs/superpowers/plans/2026-09-15-relation-combobox-inline-create-plan-a-shared-ui.md`) and partially fixed by bumping to `/80` — not far enough, since the symptom persists.

Confirmed occurrences to fix:
- `packages/ui/src/components/form-field-base.jsx:30` — `text-muted-foreground/70`
- `packages/ui/src/components/ContactPicker.jsx:83` — `text-muted-foreground/70`
- `packages/ui/src/components/FormFields.jsx` (combobox search icons, multiple spots) — `text-muted-foreground/60` and `/80`

`packages/ui/src/components/SearchInput.jsx:14` already uses full-opacity `text-[hsl(var(--muted-foreground))]` and computes to ~5.3:1 contrast in dark mode (above WCAG's 3:1 for non-text UI) — no alpha stacking found there. It will be re-checked live in a dev server in case there's a non-CSS rendering factor; if the live check finds it's actually fine, no change is needed there and the fix is scoped to the alpha-stacked instances above.

**Fix:** remove the alpha modifier from all confirmed instances so every input's leading icon renders at full `muted-foreground` opacity, matching `SearchInput.jsx`'s already-correct pattern. This is a mechanical, low-risk CSS class change — no component logic changes.

## Bug 2: paper-style (lined/grid) background doesn't cover the whole page and desyncs from body text

**Symptom:** the ruled/grid background added for the "Estilo de hoja" note setting only paints a small area near the top of the note instead of the whole page.

**Root cause:** the background is currently painted on `.tiptap` (the TipTap-rendered contentEditable div) via `[data-paper-style="..."] .tiptap { background-image: ... }`. `.tiptap`'s own `min-h-full` (min-height: 100%) has no effect because its immediate parent — a wrapper div rendered internally by TipTap's `EditorContent`, which this codebase doesn't style — has no defined height (sizes to its content). Per CSS spec, a percentage height on a child of an auto-height parent resolves as if `auto` were specified, so `.tiptap`'s box only ever grows to its actual text content's intrinsic height, never further — which is why the pattern stops a few lines down instead of continuing to the bottom of the visible page.

**Fix:** move the `repeating-linear-gradient` rules from targeting `.tiptap` to targeting `NoteSheet`'s own wrapper div instead (give it a stable `note-sheet` class). `NoteSheet` sits one level up in `NoteEditor.jsx`'s render tree and its `min-h-full` DOES resolve correctly, because its immediate parent (the `overflow-y-auto` scrollable container, itself a flex child with a definite computed height) has a real, non-auto height — so `NoteSheet` reliably fills the whole visible page and grows further with content, exactly what "toda la hoja" requires.

Because `NoteSheet` doesn't set its own `font-size` (unlike `.tiptap`, which explicitly sets `0.9375rem`, or `0.875rem` at the existing mobile breakpoint), the existing `em`-based line spacing (`1.72em`, relative to whichever element the rule is applied to) would no longer track the same absolute pixel value once the rule targets `NoteSheet` instead of `.tiptap`. Fix: replace `em` with `calc(<font-size> * 1.72)` using the exact same root-relative values `.tiptap` uses at each breakpoint (`calc(0.9375rem * 1.72)` desktop, `calc(0.875rem * 1.72)` under the existing `max-width: 639px` media query) — this keeps the ruled-line spacing numerically identical to `.tiptap`'s real line-height at both breakpoints, satisfying "sincronizadas con el tipo de letra normal", while now painting across the entire sheet instead of just the initial content height.

The cover banner and sticky toolbar sit above/around this in the same render tree but already have their own opaque/blurred backgrounds (`bg-background/90 backdrop-blur-sm` for the toolbar; the cover banner renders its own image/color), so painting the pattern one level up on `NoteSheet` doesn't visually leak an unwanted texture behind that chrome.

## Non-goals

- Not touching `SearchInput.jsx` unless the live dev-server check in Bug 1 finds a real issue there beyond what static analysis found.
- Not addressing the general documented limitation that ruled lines don't perfectly align under headings/lists (only under normal-weight paragraph text) — that was already a known, accepted limitation from the original paper-style design, unrelated to today's two reported symptoms.
- Not part of this fix: the four new features requested in the same conversation (smarter search, zoom control, canvas dark mode, blank-note UX + title/icon layout) — those get their own design pass afterward.

## Testing

- No new automated tests: both fixes are CSS/className changes to non-`lib/` files (React components + global stylesheet), which per this codebase's convention aren't covered by `node --test` (only pure `lib/` functions are).
- Manual verification: dev server, dark mode, visually confirm (a) all audited input icons are clearly visible, (b) a note's ruled/grid background now extends to the bottom of the visible page and lines land under real paragraph text rows, at both desktop and the mobile breakpoint.
