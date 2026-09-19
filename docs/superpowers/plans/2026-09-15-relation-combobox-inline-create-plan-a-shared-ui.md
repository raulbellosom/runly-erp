# Restore Inline Create on Relation Comboboxes — Plan A (Shared UI capability) — Implementation Plan

Date: 2026-09-15
Spec: docs/superpowers/specs/2026-09-15-relation-combobox-inline-create-design.md
Status: Code complete — pending live browser QA (no browser-automation tool available in this session)

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

## Goal

Add a `mode: "quick"` inline-create capability to the shared `RunlyForm` relation-field renderer (name-only, immediate POST, no nested form), fix `RunlyCrudView` so a caller can supply a locally-known blueprint for the existing `mode: "modal"` path to resolve against, and fix the low-contrast dropdown text/icons in `RelationSelectField` / `ComboboxField` / `CreatableComboboxField`. This plan delivers the shared capability only; Plan B wires it into HR, Inventory, and Fleet.

## Architecture summary

`normalizeRelationDescriptor` (packages/ui/src/runly-renderer/renderer-adapters.js) currently only builds a `create` descriptor when `mode === "modal"` and a `viewKey` is present (spec §17). We add a second branch for `mode === "quick"` that only requires `apiPath` (reusing the field's own `relation.apiPath` as a default) and a `nameField` (default `"name"`). In `RunlyForm.jsx`, the existing `handleInlineCreateSuccess` logic (spec §17, §23.2) is factored into a shared `applyCreatedRelationResult(fieldName, descriptor, result)` helper so both the modal path (via `inlineCreateState`) and the new quick path (`handleQuickCreate`) can reuse the exact same "select + refresh options + surface partial-failure errors" logic — no behavior change to the modal path. The `case "relation"` render branches `onCreate` between `openInlineCreate` (modal) and `handleQuickCreate` (quick) based on `descriptor.create.mode`, and passes a new `isCreating` flag through to `RelationSelectField`. `RelationSelectField` gains an `isCreating` prop mirroring `CreatableComboboxField`'s existing "Creando..." affordance (spec §8). `RunlyCrudView` gains passthrough `blueprints`/`resolveBlueprintByKey` props (already accepted by `RunlyForm` per lines 137-138, just never forwarded) so Plan B can fix Fleet's modal-create resolution without a server-side blueprint registry.

---

## File Structure Map

### Create

(none)

### Modify

- `packages/ui/src/runly-renderer/renderer-adapters.js` — add `mode: "quick"` branch to `normalizeRelationDescriptor`
- `packages/ui/src/runly-renderer/RunlyForm.jsx` — extract `applyCreatedRelationResult`, add `handleQuickCreate` + `quickCreatingField` state, branch `onCreate`/`isCreating` in the `"relation"` case
- `packages/ui/src/components/FormFields.jsx` — add `isCreating` prop + "Creando..." state to `RelationSelectField`'s create button; fix contrast tokens on the search icon, placeholder, and empty-state text in `RelationSelectField`, `ComboboxField`, `CreatableComboboxField`
- `packages/ui/src/runly-renderer/RunlyCrudView.jsx` — accept and forward `blueprints`/`resolveBlueprintByKey` props to all four `<RunlyForm>` render sites

---

## Task 1 — Add "quick" create mode to the relation descriptor normalizer

**Files:**
- Modify: `packages/ui/src/runly-renderer/renderer-adapters.js`

**Changes:**

- [x] In `normalizeRelationDescriptor`, alongside the existing `if (mode === 'modal' && viewKey && createApiPath)` branch, add an `else if (mode === 'quick' && createApiPath)` branch that builds:
  ```js
  create = {
    enabled: true,
    label: ... (same fallback pattern as modal),
    mode: 'quick',
    apiPath: createApiPath,
    nameField: typeof rawCreate.nameField === 'string' && rawCreate.nameField.trim() ? rawCreate.nameField.trim() : 'name',
    selectCreated: rawCreate.selectCreated !== false,
    refreshOptions: rawCreate.refreshOptions !== false,
    allowedWhen: allowedWhenNormalized,
    permissionKey: ... (same as modal, stored but not enforced client-side per spec §18),
  };
  ```
  Do not set `viewKey`/`title`/`prefillFromSearch` for quick mode — they are modal-only concepts.
- [x] Confirm the existing modal branch is untouched (same condition, same fields) — this is an additive `else if`, not a rewrite.

**Validation:**

```bash
node --check packages/ui/src/runly-renderer/renderer-adapters.js
node --test packages/ui/src/runly-renderer/__tests__/renderer-adapters.test.js
```

Existing modal-mode tests must still pass unchanged; add (or confirm coverage exists for) a case asserting `mode: "quick"` with only `apiPath` produces a non-null `create` descriptor with `mode: "quick"`.

Done: `node --check` passed; `node --test packages/ui/src/runly-renderer/__tests__/renderer-adapters.test.js` — 7/7 pass (5 pre-existing + 2 new quick-mode cases added).

---

## Task 2 — Extract `applyCreatedRelationResult` and add `handleQuickCreate` in RunlyForm

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx`

**Changes:**

- [x] Extract the body of `handleInlineCreateSuccess` (lines ~672-765: extracting the created record, updating `relationState` options, calling `handleChange` when `selectCreated !== false`, refreshing options, and setting `relationInlineErrors`) into a new `applyCreatedRelationResult(fieldName, descriptor, result)` callback that takes `fieldName`/`descriptor` as explicit parameters instead of reading `inlineCreateState`.
- [x] Rewrite `handleInlineCreateSuccess(result)` as a thin wrapper: `await applyCreatedRelationResult(inlineCreateState.fieldName, inlineCreateState.descriptor, result); closeInlineCreate();` — no behavior change for the existing modal path.
- [x] Add `const [quickCreatingField, setQuickCreatingField] = useState(null);` near the existing `inlineCreateState`/`relationInlineErrors` state.
- [x] Add `handleQuickCreate(fieldName, descriptor, searchText)`:
  - Guard: `descriptor?.create?.mode === "quick"` and non-empty trimmed `searchText`, else return.
  - `setQuickCreatingField(fieldName)`, clear any prior `relationInlineErrors[fieldName]`.
  - `fetch(joinUrl(apiBaseUrl, descriptor.create.apiPath), { method: "POST", headers: { ...buildApiHeaders(token, companyId), "Content-Type": "application/json" }, body: JSON.stringify({ [descriptor.create.nameField]: trimmed }) })`.
  - Parse the JSON body regardless of `response.ok` (to read `{ error }` on failure); on `!response.ok` throw `new Error(payload?.error || "No se pudo crear el registro.")`.
  - On success, `await applyCreatedRelationResult(fieldName, descriptor, payload)`.
  - On error (thrown or network), `setRelationInlineErrors` with the message, matching the existing style in `openInlineCreate`'s catch block.
  - `finally`: `setQuickCreatingField(null)`.
- [x] In the `case "relation"` render block, branch `onCreate`:
  ```js
  onCreate: canInlineCreate
    ? descriptor.create.mode === "quick"
      ? (searchText) => handleQuickCreate(field.name, descriptor, searchText)
      : (searchText) => openInlineCreate(field.name, descriptor, searchText)
    : undefined
  ```
  and pass `isCreating={quickCreatingField === field.name}` to `<RelationSelectField>`.
- [x] `createDisabled` logic stays as-is (`!canInlineCreate || (inlineCreateState.open && inlineCreateState.fieldName === field.name)`) but also disable while `quickCreatingField === field.name` for the quick path.

**Validation:**

```bash
node --check packages/ui/src/runly-renderer/RunlyForm.jsx
pnpm lint
```

Done: `.jsx` can't run through `node --check` (unsupported extension); verified instead via `npx eslint` (clean) and `pnpm build` (full monorepo build, including the Tauri native build, succeeded with no errors).

Manual smoke (after Plan B wires a real quick-create field): typing a name and clicking "Crear" POSTs once, selects the created record, and does not leave the button in a permanently-disabled state after success or failure. **Not yet performed live** — no browser-automation tool was available in this session; needs a manual pass via `pnpm dev`.

---

## Task 3 — `RelationSelectField` "Creando..." state + combobox contrast fix

**Files:**
- Modify: `packages/ui/src/components/FormFields.jsx`

**Changes:**

- [x] Add an `isCreating = false` prop to `RelationSelectField`. When true, render the create button's label as `"Creando..."` (matching `CreatableComboboxField`'s existing pattern at line ~2308-2317) and treat it as disabled in addition to the existing `createDisabled` prop (`disabled={createDisabled || isCreating}`).
- [x] Audit the three dropdown components (`RelationSelectField`, `ComboboxField`, `CreatableComboboxField`) for `text-muted-foreground` usage on: the search `<Search>` icon, the search `<input>` `placeholder:text-muted-foreground` class, and the empty-state `<p>` text ("Sin opciones disponibles" / "Sin resultados" / the `emptyText` prop). No dedicated higher-contrast muted token exists in `apps/desktop/src/styles.css` (only `--muted-foreground` itself, already used at full strength for the placeholder and empty-state text). The actual dampening culprit found was the search icon's `text-muted-foreground/50` class stacking a 50% alpha cut on top of the already-muted token — present identically in `ComboboxField`, `RelationSelectField`, and (deviation, see below) `CarColorPickerField`. Bumped all three to `text-muted-foreground/80`.
- [x] Keep the change scoped to these dropdown-internal text/icon elements — do not restyle the trigger button, selected-value text, or option rows, which are not part of the reported complaint.
- **Deviation from plan:** `CreatableComboboxField` has no `<Search>` icon at all (its search bar is icon-less), so nothing to fix there. Found a 4th instance of the identical `text-muted-foreground/50` search-icon pattern in `CarColorPickerField` (not named in the spec's list of 3) and fixed it too, since it's the exact same defect in the same file, not a new component to redesign.

**Validation:**

```bash
node --check packages/ui/src/components/FormFields.jsx
pnpm lint
```

Done: `.jsx` can't run through `node --check`; verified via `npx eslint` (clean) and `pnpm build` (succeeded).

Manual (dev server, `pnpm dev`): open any combobox (e.g. an existing working one) in light mode and dark mode, at 390px and 1440px, and confirm the search placeholder, icon, and empty-state text are clearly legible against the panel background in both themes. **Not yet performed live** — no browser-automation tool was available in this session.

---

## Task 4 — Forward `blueprints`/`resolveBlueprintByKey` through `RunlyCrudView`

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyCrudView.jsx`

**Changes:**

- [x] Add `blueprints = null` and `resolveBlueprintByKey = null` to `RunlyCrudView`'s destructured props (alongside the existing `fields`, `componentRegistry`, etc.).
- [x] Pass both props through to all four `<RunlyForm ...>` render sites (page-mode create, page-mode edit, sheet-mode create, sheet-mode edit) exactly as the other passthrough props (`token`, `companyId`, `apiBaseUrl`) are already forwarded.
- [x] Do not change any other `RunlyCrudView` behavior.

**Validation:**

```bash
node --check packages/ui/src/runly-renderer/RunlyCrudView.jsx
pnpm lint
```

Done: verified via `npx eslint` (clean, 4/4 `<RunlyForm>` sites confirmed via grep to carry the new props) and `pnpm build` (succeeded).

Manual (after Plan B Task B3 wires Fleet): confirm `VehiclesScreen.jsx` can pass a `blueprints` array that `RunlyForm`'s `resolveInlineCreateBlueprint` finds via its local-rows branch, without a `/blueprints` network call for that key. **Not yet performed live.**

---

## Rollback Notes

No migrations, no schema changes. All four tasks are additive (`else if` branches, new optional props defaulting to `null`/`false`, an extracted-but-behavior-preserving helper). Reverting any subset of these four files independently is safe — Plan B's wiring simply has no effect (falls back to today's broken/hinted behavior) if a given Plan A task is reverted.

---

## Verification Gate

Before marking any task complete:

- [x] All task validation commands have been run.
- [x] All commands exited without errors.
- [x] `node --test packages/ui/src/runly-renderer/__tests__/renderer-adapters.test.js` passes with the existing modal-mode assertions unchanged plus new quick-mode coverage (7/7).
- [ ] Manual dev-server check of the "Creando..." state and contrast fix completed at 390px and 1440px, light and dark. **Outstanding** — no browser-automation tool was available in this session; needs a human or a future session with browser access to complete.
