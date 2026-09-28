# Atlas Design System Guide — Glassmorphism / Spatial UI

This is the canonical reference for the visual identity of Atlas ERP. It exists because the identity was being reinvented ad hoc across ~70 `@runly/ui` components and 20+ modules with no single source of truth. See `docs/superpowers/decisions/2026-08-24-design-system-unification-audit.md` for the full audit this guide was built from.

**Identity in one sentence:** translucent, layered "frosted glass" surfaces that float above a solid background, expressing hierarchy through blur + elevation rather than flat color blocks.

## 1. Token source of truth

All tokens live in `apps/desktop/src/styles.css`. Never hardcode a hex/rgb color, blur value, or shadow in a component — reference the token.

### Glass tokens (the identity)

| Token | Purpose |
|---|---|
| `--glass-blur` | backdrop-filter blur radius (20px desktop/light+dark, 8px mobile — cheaper compositing on mobile GPUs) |
| `--glass-bg` / `--glass-bg-strong` | translucent white/black fill, two intensities |
| `--glass-border` / `--glass-border-subtle` | translucent border, two intensities |
| `--glass-shadow` | elevation shadow for glass surfaces |
| `--glass-tint` | brand-tinted glass variant |
| `--glass-glow` | glow accent for emphasis states |

Consumed via utility classes, **use these three tiers consistently, do not invent a fourth**:

| Class | Use for |
|---|---|
| `.glass-subtle` | inline surfaces sitting *within* a page (form fields, inline panels) |
| `.glass` | lightweight floating elements (tooltips) |
| `.glass-strong` | modals, sheets, popovers, dropdown menus — anything that overlays page content |

Two utilities exist in CSS but are currently unused anywhere in the app: `.glass-card-responsive`, `.glow-primary` / `.glow-primary-sm`. Either use them or remove them — don't let a fourth undocumented tier accumulate.

### Color tokens

Semantic tokens (`--background`, `--foreground`, `--card`, `--muted`, `--border`, `--input`, `--ring`, `--surface-1/2/3`) are mapped through a Tailwind v4 `@theme` block to utilities (`bg-background`, `text-foreground`, `border-border`, etc.). **Prefer the semantic utility form** (`bg-card`, `text-foreground`, `border-border`) over the legacy bracket form (`bg-[hsl(var(--card))]`) in all new/edited code — both resolve identically today, but the semantic form is what the codebase is converging on.

### Brand tokens

`--brand-primary` (defaults to `--runly-cyan`) is the **only** color allowed to represent "this tenant's brand" — it exists specifically so white-label deployments can override it. `Button.jsx`'s primary variant correctly uses `bg-(--brand-primary)`.

**Rule: never hardcode `indigo-500` (or any raw brand-ish color) in a component that represents a selected/checked/active state.** If it should track the tenant's brand, use `--brand-primary`. If it's genuinely a fixed semantic color (destructive red, success green), use the semantic token (`--destructive`, etc.), not a raw Tailwind color name.

### Radius scale

Use one radius per conceptual shape, consistently:

| Shape | Radius |
|---|---|
| Modal / Sheet / Popover / Dropdown content | `rounded-2xl` |
| Card (any variant) | `rounded-2xl` |
| Form field (input/select/textarea/button-sized trigger) | `rounded-lg` |
| Badge / Pill | `rounded-full` |

`rounded-md`, `rounded-xl` on things that are conceptually a "card" or "field" are drift — fix on touch, don't introduce new ones.

### Z-index scale

There is no custom Tailwind z-index scale — `apps/desktop/tailwind.config.js` has an empty `theme.extend`. Use bracket syntax with the existing informal scale observed in the app: `z-50` (Radix overlays: Dialog/Sheet/Popover/Toast), `z-[200]` (app loader), `z-[300]` (context menus). **Never use bare `z-60`/`z-61`-style classes past 50** — Tailwind's default scale stops at `z-50`, so anything higher must use bracket syntax (`z-[60]`) or it silently generates no CSS.

## 2. Component decision tree

Before writing any UI, ask in this order:

1. **Does `@runly/ui` already export something for this?** Check `packages/ui/src/index.js`. If yes, use it. Do not reimplement its chrome inline "just this once."
2. **Is this a floating/overlay surface** (modal, drawer, context menu, tooltip, dropdown)? It must be built on `Dialog`, `Sheet`, `Popover`, `DropdownMenu`, or `Tooltip` — never a hand-rolled `fixed inset-0` div. If none of those fit the interaction shape, that's a signal a new `@runly/ui` primitive is needed (add it there, not locally).
3. **Is this a card-shaped container** (bordered box with padding presenting a chunk of content)? Use `<Card variant="solid|bordered|interactive|default">`, not an inline `rounded-2xl border bg-card` div. If you need a specialized card (stat tile, file tile), compose it *from* `Card`, don't hand-roll parallel chrome.
4. **Is this a text/search input, select, checkbox, switch, or date field?** Use the matching `FormFields.jsx` export (`TextField`, `SelectField`, `CheckboxField`, `SwitchField`, `DateField`, …) or `SearchInput` for search-with-icon. Never a raw `<input>`/`<select>` for internal ERP chrome (raw natives remain correct for `type="file"`, `type="color"`, and previews of end-user-authored public forms).
5. **Confirming a destructive action?** `ConfirmDialog`. Never `window.confirm`.

## 3. Overlay family reference

All four Radix-based overlays (`Dialog`, `Sheet`, `Popover`, `DropdownMenu`) share the same visual contract:

- Surface: `.glass-strong`
- Overlay/scrim (Dialog/Sheet only): `bg-black/40 backdrop-blur-sm`
- Focus ring on interactive elements inside: `focus-visible:ring-[hsl(var(--ring))]/40` (or the semantic equivalent) — never a hardcoded color
- Mobile bottom sheet: `packages/ui/src/components/bottom-sheet-shared.jsx` is the ONLY base (used by `Dialog` mobile variant and `Sheet` bottom / right-left-on-mobile). The surface never scrolls: drag handle and close button stay pinned, content scrolls inside `BottomSheetBody`, `SheetHeader`/`DialogHeader` are sticky, top padding is forced (`pt-9!`) and on mobile `Sheet` drops consumer `width`/`maxWidth` to span the full screen. Handle gestures (`useDragToDismiss`): drag up expands to full screen and stays there, drag down from full screen collapses, drag down from collapsed dismisses. With the on-screen keyboard open the sheet rides on top of it (`useKeyboardViewport`) and the focused field is scrolled to the center; `Input`/`TextField`/`TextareaField` inside a modal default to `autocomplete="off"` (pass `autoComplete` explicitly to opt back in). Never hand-roll a bottom sheet or override these in a consumer
- Drag-to-dismiss (Dialog/Sheet, mobile): shared pointer-handler behavior — if you need this in a third place, extract the existing logic into a hook (`useDragToDismiss`) instead of copying it a third time

`Tooltip` intentionally uses the lighter `.glass` tier (it's the least "modal" surface). `Toast` (Sonner) also uses `.glass` — this is a deliberate exception, not drift, because toasts are meant to feel lightweight/transient rather than blocking like a modal.

There is no shared "drawer" abstraction distinct from `Sheet` — a right-side slide-in panel is `<Sheet side="right">`. Do not build a second bespoke slide-in panel implementation (see the audit's `ActivityDrawer` finding).

## 4. Anti-patterns to reject in review

- A `fixed inset-0` div built by hand to act as a modal, anywhere outside `packages/ui/src/components/Dialog.jsx` / `Sheet.jsx` themselves.
- A component that imports `@radix-ui/react-dialog` (or any Radix primitive) directly instead of the `@runly/ui` wrapper.
- `window.confirm` / `window.alert` / `window.prompt`.
- A raw `<select>` or text `<input>` for something a `FormFields.jsx` export already covers.
- A second copy of `FieldWrapper`, `FIELD_BASE`/`fieldCls`, or any other shared style-builder pasted into a new field component instead of imported.
- A hardcoded `indigo-500` (or similar) on a checked/selected/active state instead of `--brand-primary`.
- A new radius/blur/shadow value invented ad hoc instead of picked from the scales in §1.

## 5. Where things live

- Tokens: `apps/desktop/src/styles.css`
- Tailwind config (mostly vestigial under Tailwind v4's `@source`-based scanning): `apps/desktop/tailwind.config.js`
- Component library: `packages/ui/src/components/*.jsx`, barrel at `packages/ui/src/index.js`
- Field-type wrappers (Text/Select/Date/etc.): `packages/ui/src/components/FormFields.jsx`
- Blueprint renderer (RME3 CUSTOM/TABLE/FORM views): `packages/ui/src/atlas-renderer/*` — see `docs/ai-context/rme3-runtime-capabilities.md` for its component inventory
- Prior architecture decision this guide extends: `docs/superpowers/decisions/2026-05-13-ame3-renderer-ui-reuse-and-glassic-design.md`
- Full audit + fix backlog: `docs/superpowers/decisions/2026-08-24-design-system-unification-audit.md`
