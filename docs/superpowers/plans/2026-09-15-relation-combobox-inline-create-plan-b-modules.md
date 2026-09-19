# Restore Inline Create on Relation Comboboxes — Plan B (Module wiring) — Implementation Plan

Date: 2026-09-15
Spec: docs/superpowers/specs/2026-09-15-relation-combobox-inline-create-design.md
Status: Code complete — pending live browser QA (no browser-automation tool available in this session)
Depends on: docs/superpowers/plans/2026-09-15-relation-combobox-inline-create-plan-a-shared-ui.md (landed)

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

## Goal

Wire the `mode: "quick"` capability (Plan A, Task 1-3) into HR's Puesto/Departamento fields and Inventory's Categoría/Marca/Ubicación fields, and fix Fleet's already-declared `mode: "modal"` create for Modelo de vehículo so it actually resolves, using Plan A's `RunlyCrudView` blueprint passthrough (Task 4).

## Architecture summary

HR and Inventory need only blueprint-data changes (spec §17) — add a `relation.create` block per field and drop the now-obsolete hint text. Fleet needs the actual bug fixed: `CatalogsScreen.jsx`'s vehicle-models form schema becomes the single exported source of truth, `VehiclesScreen.jsx` imports it instead of re-declaring a `viewKey` that never matched, and passes it through `RunlyCrudView`'s new `blueprints` prop so `RunlyForm`'s `resolveInlineCreateBlueprint` finds it locally without depending on a server-side `/blueprints` registration that doesn't exist for Fleet's catalogs (spec §4.3, §24.4).

---

## File Structure Map

### Create

(none)

### Modify

- `apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js`
- `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`
- `apps/desktop/src/modules/runly.fleet/screens/CatalogsScreen.jsx`
- `apps/desktop/src/modules/runly.fleet/screens/VehiclesScreen.jsx`

---

## Task B1 — HR: Puesto / Departamento quick-create

**Files:**
- Modify: `apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js`

**Changes:**

- [x] On the `jobTitleId` field's `relation` block, add:
  ```js
  create: {
    enabled: true,
    mode: 'quick',
    apiPath: '/hr/job-titles',
    label: 'Crear puesto',
    permissionKey: 'hr.job_title.create',
  },
  ```
- [x] On the `departmentId` field's `relation` block, add the equivalent with `apiPath: '/hr/departments'`, `label: 'Crear departamento'`, `permissionKey: 'hr.department.create'`.
- [x] Remove the `hint: 'Para crear un puesto nuevo, ve primero a Catálogos de RH.'` / departamento equivalent from both fields (they can now be created inline; leave `hint` unset unless another hint is still relevant, per spec §8).

**Validation:**

```bash
node --check apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js
pnpm lint
```

Done: both commands pass clean.

Manual (dev server): open an employee form, type a new job title in Puesto, click "Crear <nombre>", confirm it's created, selected, and appears in the option list; repeat for Departamento. **Not yet performed live** — no browser-automation tool was available in this session.

---

## Task B2 — Inventory: Categoría / Marca / Ubicación quick-create

**Files:**
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`

**Changes:**

- [x] On `categoryId`, add `create: { enabled: true, mode: 'quick', apiPath: '/inventory/categories', label: 'Crear categoría', permissionKey: 'inventory.catalog.manage' }`; remove its hint.
- [x] On `brandId`, add the equivalent with `apiPath: '/inventory/brands'`, `label: 'Crear marca'`; remove its hint.
- [x] On `locationId`, add the equivalent with `apiPath: '/inventory/locations'`, `label: 'Crear ubicación'`; remove its hint.
- [x] All three share `permissionKey: 'inventory.catalog.manage'` (confirmed in spec §12/§18 against `apps/api/src/routes/inventory/index.js:339`).

**Validation:**

```bash
node --check apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js
pnpm lint
```

Done: both commands pass clean.

Manual (dev server): reproduce the reported "da error" first, on the current code, and note exactly what happens (console error? toast? silent?). Then apply this task's change and confirm: (a) whatever was reported is resolved or is demonstrably a separate issue (document which), and (b) creating a category/brand/location inline from the item form works end-to-end. **Not yet performed live** — no browser-automation tool was available in this session; the "da error" report is therefore still undiagnosed beyond static code review (no thrown error found in the relevant blueprint/renderer code path — see spec §24.3).

---

## Task B3 — Fleet: fix Modelo de vehículo's broken modal-create

**Files:**
- Modify: `apps/desktop/src/modules/runly.fleet/screens/CatalogsScreen.jsx`
- Modify: `apps/desktop/src/modules/runly.fleet/screens/VehiclesScreen.jsx`

**Changes:**

- [x] In `CatalogsScreen.jsx`, export the `vehicle-models` entry's `form` blueprint object as a named export (`export const FLEET_VEHICLE_MODEL_FORM_BLUEPRINT = CATALOG_BLUEPRINTS['vehicle-models'].form`) — key/schema/fields untouched, export only.
- [x] In `VehiclesScreen.jsx`, import `FLEET_VEHICLE_MODEL_FORM_BLUEPRINT` from `./CatalogsScreen.jsx`.
- [x] Change the `vehicle_model_id` field's `relation.create.viewKey` to reference `FLEET_VEHICLE_MODEL_FORM_BLUEPRINT.key` directly (rather than a second hardcoded string literal) so the two can never drift apart again — this is a stricter version of the plan's literal suggestion (`"fleet.catalogs.vehicle-models.form"`), same effect.
- [x] Pass `blueprints={[FLEET_VEHICLE_MODEL_FORM_BLUEPRINT]}` to the `<RunlyCrudView>` element in `VehiclesScreen.jsx`.
- [x] Did not modify `catalog-service.js`, the `/fleet/catalogs/vehicle-models` route, or any other Fleet catalog.

**Validation:**

```bash
node --check apps/desktop/src/modules/runly.fleet/screens/CatalogsScreen.jsx
node --check apps/desktop/src/modules/runly.fleet/screens/VehiclesScreen.jsx
pnpm lint
```

Done: `.jsx` can't run through `node --check`; verified via `npx eslint` (clean) and `pnpm build` (full monorepo build, including Tauri, succeeded).

Manual (dev server): on the vehicle create/edit form, open the Modelo de vehículo combobox, click "Crear modelo de vehiculo", confirm the modal opens (no "No se encontró la vista de creación relacionada." error), submit a new model (name + year), and confirm it's selected on the vehicle form afterward. **Not yet performed live** — no browser-automation tool was available in this session.

---

## Rollback Notes

- Tasks B1/B2 are pure blueprint-data reverts (remove the added `create` block, restore the hint) — safe to revert independently, no other files affected.
- Task B3's export in `CatalogsScreen.jsx` is additive; reverting `VehiclesScreen.jsx`'s three changes (import, `viewKey`, `blueprints` prop) restores today's broken-but-harmless state (button visible, click shows an inline error) with no data impact either way.
- No migrations, no backend changes in this entire plan — rollback is a pure frontend file revert.

---

## Verification Gate

Before marking any task complete:

- [x] All task validation commands have been run.
- [x] All commands exited without errors.
- [x] `pnpm build` succeeds (full monorepo build, including the Tauri native build).
- [ ] All three manual dev-server checks (HR, Inventory, Fleet) completed and documented, including the Inventory "da error" repro note. **Outstanding** — no browser-automation tool was available in this agent session; needs a human pass (or a future session with browser access) via `pnpm dev`.
- [ ] Verification checklist at `docs/superpowers/templates/verification-checklist-template.md` filled in for the combined Plan A + Plan B change. **Outstanding**, blocked on the same live-QA gap above.
