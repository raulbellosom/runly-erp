# Restore Inline "Create New" on Relation Comboboxes + Combobox Contrast Fix

Date: 2026-09-15
Status: In Progress (code complete, live browser QA outstanding)
Author: Claude Code (agent session)
Spec file: docs/superpowers/specs/2026-09-15-relation-combobox-inline-create-design.md
Plan file: docs/superpowers/plans/2026-09-15-relation-combobox-inline-create-plan-a-shared-ui.md and -plan-b-modules.md (created after spec approval)

---

## 1. Feature title

Restore inline "create new" on relation comboboxes (HR, Inventory, Fleet) and fix low-contrast combobox styling.

## 2. Status

In Progress — code complete for all four Plan A tasks and all three Plan B tasks; live browser QA (Section 26) has not been performed (no browser-automation tool was available in the implementing session).

## 3. Context

Several module forms (`runly.hr`, `runly.inventory`, `runly.fleet`) used to let users create a new catalog record (job title, department, category, brand, location, vehicle model) directly from the combobox they were filling in, via the hand-rolled `CreatableComboboxField` component (`onCreate(name)` -> immediate `POST {name}` -> select the new record). Each of these screens was later rebuilt on top of the shared, blueprint-driven `RunlyForm` renderer (`packages/ui/src/runly-renderer/RunlyForm.jsx`), which represents relation fields declaratively (`type: "relation"`, with a `relation.create` config block) instead of hand-written JSX. The rebuilds did not carry the inline-create capability forward.

Separately, the shared `RelationSelectField` / `ComboboxField` / `CreatableComboboxField` components (`packages/ui/src/components/FormFields.jsx`) render their open dropdown inside a `.glass-shell` panel. In light mode this panel is a near-opaque white (`rgba(255,255,255,0.97)`), and the dropdown's icons, placeholder, and empty-state text all use `text-muted-foreground`, which reads as very low contrast against that background in both light and dark themes.

## 4. Problem

1. In `runly.hr`'s employee form, the Puesto (`jobTitleId`) and Departamento (`departmentId`) relation fields cannot create a new job title/department inline anymore. The blueprint (`apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js`) declares no `relation.create` block and instead shows a hint telling the user to go create it in "Catálogos de RH" first, forcing a context switch.
2. In `runly.inventory`'s item form, the Categoría (`categoryId`), Marca (`brandId`), and Ubicación (`locationId`) relation fields have the identical problem (`apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`) — hint text pointing to "Inventario > Catálogos" instead of a working create action.
3. In `runly.fleet`'s vehicle form, the Modelo de vehículo (`vehicle_model_id`) relation field *does* declare a `relation.create` block (`mode: "modal"`, `viewKey: "fleet.catalog.vehicle_models.form"`), but it is non-functional: the referenced blueprint key does not match the one actually registered by `CatalogsScreen.jsx` (`fleet.catalogs.vehicle-models.form`), and neither key is ever served by `GET /blueprints` (Fleet's catalog screens are hardcoded client schemas, not RME3-registered blueprints), so `RunlyForm`'s `resolveInlineCreateBlueprint` always fails and the user sees "No se encontró la vista de creación relacionada."
4. The combobox dropdown text/icons are hard to read in both themes because of a `text-muted-foreground`-on-near-white/near-transparent contrast gap, independent of the above.

## 5. Goals

1. Users can create a new Puesto or Departamento directly from the employee form's combobox, without leaving the form.
2. Users can create a new Categoría, Marca, or Ubicación directly from the inventory item form's combobox, without leaving the form.
3. Users can create a new Modelo de vehículo directly from the vehicle form's combobox (opens the existing modal form with brand/type/year fields), without leaving the form.
4. The shared relation-create mechanism in `packages/ui` supports two configurable modes: a lightweight "quick" mode (name-only, immediate POST, used by HR/Inventory) and the existing "modal" mode (full nested form, used by Fleet), so future modules can pick whichever fits their catalog's shape.
5. Combobox dropdown text and icons are clearly legible in both light and dark themes.

## 6. Non-goals

1. No changes to the underlying catalog CRUD screens (`HrCatalogsScreen.jsx`, Inventory catalogs screen, `CatalogsScreen.jsx` for Fleet) beyond what's needed to fix the Fleet key mismatch.
2. No new Prisma models, migrations, or API endpoints — all target `POST` endpoints (`/hr/job-titles`, `/hr/departments`, `/inventory/categories`, `/inventory/brands`, `/inventory/locations`, `/fleet/catalogs/vehicle-models`) already exist and are already permission-guarded.
3. No redesign of the glass-shell/dropdown visual language beyond the specific text/icon contrast tokens.
4. No change to the hand-rolled `CreatableComboboxField` usages that were never migrated (`runly.notes`, `runly.pfm` x2, `runly.website` wizard) — they are unaffected and already work.
5. Not attempting to fix a possible separate "da error" report in `runly.inventory` beyond what's covered by goal 2 — that will be re-verified live in the browser as part of this fix's QA, not assumed to be a distinct bug.

## 7. User stories

- As an HR user filling out an employee's Datos laborales, I want to type a new job title/department name and create it on the spot, so that I don't have to abandon the form to visit Catálogos de RH.
- As an Inventory user registering a new asset, I want to create a missing category/brand/location inline, so that I don't lose my in-progress item form.
- As a Fleet user registering a vehicle, I want to create a new vehicle model (with brand, type, year) inline via a modal, so that I don't have to pre-populate the catalog before registering the vehicle.
- As any user opening a relation combobox, I want the search field, placeholder, and empty-state text to be clearly readable in both light and dark mode.

## 8. UX requirements

- Quick-create entries render exactly like the existing `CreatableComboboxField` "+ Crear "X"" affordance: a `Plus` icon + `Crear "<nombre>"` label, shown below a divider under the filtered options, disabled with a "Creando..." state while the request is in flight.
- Quick-create requires only the combobox's current search text (trimmed, min length per the existing `hrCatalogCreateSchema`/inventory schema validation — surface the API's validation error inline if the POST fails, e.g. name too short).
- On successful quick-create, the field selects the new record immediately and the option list is refreshed (existing `refreshOptions`/`selectCreated` semantics already implemented in `RunlyForm.jsx` are reused, not reinvented).
- Modal-create (Fleet) behavior is unchanged from what's already implemented in `RunlyForm.jsx`'s `openInlineCreate`/`inlineCreateState` — only the resolution of the target blueprint is fixed.
- Remove the "Para crear X nuevo, ve primero a Catálogos..." hints on the fields gaining inline create; keep hints only where still true (none expected after this fix for the 5 quick-create fields).
- All labels stay in Spanish, matching existing conventions ("Crear puesto", "Crear departamento", "Crear categoría", "Crear marca", "Crear ubicación").
- Contrast fix: dropdown search icon, placeholder text, and empty-state text must use a token with sufficient contrast against `.glass-shell`'s `--glass-bg` in both `:root` and `.dark`, verified visually at 390px and 1440px per this repo's standard responsive QA pass.

## 9. Routes/screens

No new routes. Existing screens modified in place:

| Route | Screen | Module | Description |
|---|---|---|---|
| /app/m/runly.hr/hr/employees/new, /:id/edit | HrEmployeeForm.jsx (thin wrapper over HR_EMPLOYEE_FORM blueprint) | runly.hr | Puesto/Departamento gain inline quick-create |
| /app/m/runly.inventory/inventory/items/new, /:id/edit | InventoryItemForm.jsx (thin wrapper over INVENTORY_ITEM_FORM blueprint) | runly.inventory | Categoría/Marca/Ubicación gain inline quick-create |
| /app/m/runly.fleet/fleet/vehicles/new, /:id/edit | VehiclesScreen.jsx | runly.fleet | Modelo de vehículo's existing modal-create is fixed to actually resolve |

## 10. Data model

N/A — no new entities. Reuses existing `HrJobTitle`, `HrDepartment`, inventory `Category`/`Brand`/`Location`, and `FleetVehicleModel` records via their existing create endpoints.

### New models

N/A

### Modified models

N/A

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

No new endpoints. Existing endpoints reused as-is:

### POST /hr/job-titles
Auth: required
Permission: `hr.job_title.create`
Body: `{ name: string, description?: string }`
Response: `{ data: HrJobTitle }`

### POST /hr/departments
Auth: required
Permission: `hr.department.create`
Body: `{ name: string, description?: string }`
Response: `{ data: HrDepartment }`

### POST /inventory/categories
Auth: required
Permission: `inventory.catalog.manage` (confirmed in `apps/api/src/routes/inventory/index.js:339`)
Body: `{ name: string }`
Response: `{ data: Category }`

### POST /inventory/brands
Auth: required
Permission: `inventory.catalog.manage`
Body: `{ name: string }`
Response: `{ data: Brand }`

### POST /inventory/locations
Auth: required
Permission: `inventory.catalog.manage`
Body: `{ name: string }`
Response: `{ data: Location }`

### POST /fleet/catalogs/vehicle-models
Auth: required
Permission: `fleet.catalogs.create`
Body: `{ name: string, year: number, brand_id?: string, type_id?: string }`
Response: `{ data: FleetVehicleModel }`

## 13. SDK contract

N/A — all screens already call these endpoints directly via `fetch`/the existing blueprint `apiPath` mechanism, not through `@runly/sdk` domain methods. No new SDK methods needed.

## 14. Validator contract

N/A — reuses existing Zod schemas (`hrCatalogCreateSchema` et al., and Inventory's own catalog create schemas). No new schemas.

## 15. Module manifest impact

N/A — no manifest changes. No new permissions, no new navigation, no new dependencies.

## 16. Navigation impact

N/A — no navigation changes.

## 17. Blueprint impact

Modified blueprints (schema-only changes, adding a `relation.create` block):

- `hr.employee.form` (`hr-employee-form.blueprint.js`) — `jobTitleId` and `departmentId` fields gain `relation.create = { enabled: true, mode: "quick", apiPath: "...", label: "Crear puesto"/"Crear departamento" }`.
- `inventory.item.form` (`inventory-item-form.blueprint.js`) — `categoryId`, `brandId`, `locationId` fields gain the equivalent `relation.create` quick-mode blocks.
- Fleet's vehicle form (`VehiclesScreen.jsx`, inline schema object, not a separately keyed blueprint file) — `vehicle_model_id`'s existing `relation.create` block's `viewKey` is corrected to match the real key, and the screen passes a local blueprint resolver so `RunlyForm` can resolve it without depending on `GET /blueprints`.

New capability in the shared renderer (not a blueprint, a renderer capability): `packages/ui/src/runly-renderer/RunlyForm.jsx` (and its schema helpers in `runly-form-schema.js` if the descriptor normalization lives there) gains support for `relation.create.mode: "quick"` — POST `{ [nameField ?? "name"]: trimmedSearchText }` to `relation.create.apiPath`, then select/refresh exactly like the modal path already does after nested-form success. `mode: "modal"` (the current, only, implicit behavior) continues to work unchanged for Fleet.

## 18. RBAC/permissions

No new permission keys. Existing keys govern the reused endpoints (see Section 12). No navigation gating changes.

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| hr.job_title.create | POST /hr/job-titles | No |
| hr.department.create | POST /hr/departments | No |
| inventory.catalog.manage | POST /inventory/categories | No |
| inventory.catalog.manage | POST /inventory/brands | No |
| inventory.catalog.manage | POST /inventory/locations | No |
| fleet.catalogs.create | POST /fleet/catalogs/vehicle-models | No |

`RunlyForm.jsx` has no client-side permission awareness today (it is a generic renderer with no access to the app's RBAC state), and the pre-existing modal-create path never gated its button on `permissionKey` either — it stores the key in the normalized descriptor but never reads it. This fix does not add new client-side permission gating (that would be new scope, not restoration of lost behavior). As before the migrations, a user lacking the `*.create` permission simply gets a 403 from the reused endpoint, surfaced inline via the existing `relationInlineErrors` mechanism — identical to how the old `CreatableComboboxField`-based forms behaved.

## 19. Multi-company behavior

Unchanged — all reused endpoints are already company-scoped via existing middleware (`X-Runly-Company-Id` header / `activeCompanyId`), since they are the same endpoints the standalone Catálogos screens already use to create these records.

## 20. Files/storage impact

N/A

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A for this feature specifically — the reused endpoints already perform whatever audit logging they did before (e.g. Fleet's `catalog-service.js` already calls `logAudit` with `fleet.catalog.vehicle_model.create`). No new audit actions are introduced.

## 23. Edge cases

1. User types a name that already exists (case-insensitive) among the loaded options — should behave like `CreatableComboboxField` today: either select the existing match instead of showing "create", or let the create call fail with the API's own duplicate-name validation, whichever the existing quick-create service functions already enforce. Verify against `hrCatalogCreateSchema`/inventory catalog service behavior; do not add new duplicate-detection logic.
2. Quick-create POST fails (validation error, permission error, network error) — show the error inline near the field (reuse `relationInlineErrors` state already in `RunlyForm.jsx`), do not close the dropdown or lose the typed search text.
3. User lacks the `*.create` permission — the create option is still shown (no client-side gating, matching pre-migration behavior), but submitting it surfaces the API's 403 inline near the field instead of silently failing or crashing.
4. Fleet's modal-create is opened, but the nested vehicle-model form itself references `brand_id`/`type_id` relations that may also want inline-create (nested create) — `RunlyForm.jsx` already caps `inlineCreateDepth < 2`; this fix does not change that cap or add new nested-create wiring beyond what already exists in the `VehiclesScreen.jsx` schema (`create.enabled` on those nested fields is out of scope unless already present).
5. Very short/blank search text — the create action must not be offered for an empty/whitespace-only search, matching current `CreatableComboboxField` behavior (`trimmed.length > 0`).
6. Rapid duplicate submits (double-click) — reuse the existing `isCreating`/`createDisabled` guard pattern already implemented for the modal path.

## 24. Risks

1. Risk: The generic "quick create" addition to `RunlyForm.jsx` could regress the already-working Fleet "modal" path if the two code paths aren't cleanly separated by `create.mode`. Mitigation: gate strictly on `descriptor.create.mode === "quick"` vs the default/`"modal"`, with a small dedicated test/manual check of both paths before considering the plan done.
2. Risk: (Resolved during spec authoring) Inventory's categories/brands/locations create permission was initially assumed per-entity; confirmed via `apps/api/src/routes/inventory/index.js:339` to be the single shared `inventory.catalog.manage` key for all three. No further action needed beyond using that key consistently.
3. Risk: The reported Inventory "da error" might be a distinct, unrelated bug not explained by the missing create option. Mitigation: reproduce live in the dev app as part of verification; if a distinct error surfaces, log it as a new issue rather than silently folding an unrelated fix into this scope.
4. Risk: Fixing the Fleet key mismatch by pointing `VehiclesScreen.jsx` at `CatalogsScreen.jsx`'s blueprint object requires exporting that object or duplicating it; duplication risks drift. Mitigation: export the single source of truth from `CatalogsScreen.jsx` (or a shared `fleetCatalogBlueprints.js`) and import it in `VehiclesScreen.jsx`, rather than copy-pasting the schema.

## 25. Acceptance criteria

1. Given a user with `hr.job_title.create`, when they type a new name in the Puesto combobox on the employee form and click "Crear <nombre>", then a new job title is created, selected, and appears in the dropdown's option list without a page navigation.
2. Given a user with `hr.department.create`, the same holds for Departamento.
3. Given a user with the relevant Inventory create permission, the same holds for Categoría, Marca, and Ubicación on the item form.
4. Given a user with `fleet.catalogs.create`, when they click "Crear modelo de vehiculo" on the vehicle form's Modelo combobox, then the modal opens successfully (no "No se encontró la vista de creación relacionada." error) and, on submitting a valid model, the vehicle form selects the newly created model.
5. Given a user without the relevant `*.create` permission, when they submit the quick/modal create, then the API's 403 is shown inline near the field (not a crash or silent no-op).
6. Given the combobox dropdown is open in light mode, the search placeholder, icon, and "Sin opciones disponibles"/"Sin resultados" text are visibly legible against the `.glass-shell` background (verified visually, not just token-value comparison).
7. Given the same in dark mode, legibility holds as well.
8. Given the reported Inventory error is reproduced live, it is documented (repro steps + observed behavior) whether or not it is fixed within this change.

## 26. Verification plan

- `node --check apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js`
- `node --check apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`
- `node --check apps/desktop/src/modules/runly.fleet/screens/VehiclesScreen.jsx`
- `node --check apps/desktop/src/modules/runly.fleet/screens/CatalogsScreen.jsx`
- `node --check packages/ui/src/runly-renderer/RunlyForm.jsx`
- `node --check packages/ui/src/runly-renderer/RunlyCrudView.jsx` (if modified)
- `node --check packages/ui/src/components/FormFields.jsx`
- `pnpm lint`
- `pnpm build`
- Manual (dev server, `pnpm dev`): create a job title/department inline from the HR employee form; create a category/brand/location inline from the Inventory item form; create a vehicle model inline (modal) from the Fleet vehicle form; reproduce the reported Inventory error and document the result; visually check combobox contrast at 390px and 1440px, light and dark.

## 27. Rollback plan

No migrations involved. Rollback is a plain revert of the modified blueprint/schema files and `RunlyForm.jsx`/`FormFields.jsx` changes — no data or schema to unwind. No feature flag needed given the small, additive blast radius (new optional `create.mode`, defaulting to existing "modal" behavior when unspecified).

## 28. Future enhancements

1. Consider registering Fleet's catalog forms as real server-side blueprints (via `/blueprints`) so `resolveInlineCreateBlueprint`'s server fallback works generically, instead of relying on a locally-passed blueprint resolver — deferred because it duplicates the now-retired RME3 Phase 5 architecture and is out of scope for restoring existing behavior.
2. Consider extending "quick create" to accept more than a bare name (e.g. an optional second field) if a future catalog needs it — deferred until a concrete need arises.
