# runly.inventory — Types, models and the Catalogs view

Date: 2026-09-28
Status: approved design (brainstorming), pending implementation plan

## 1. Problem

Filling an asset form should revolve around three things: **model, type and brand**. Today:

- "Tipo" (`InvItem.itemType`, free text: base list + company types stored in
  `inventory_reusable_catalog`) and "Categoría" (`InvCategory`, with icon, color,
  hierarchy, ordering and per-category custom fields) both answer "what is this asset?".
  Users cannot tell them apart.
- Models live as JSON rows in `inventory_reusable_catalog` (`details.brandName`,
  `details.itemType`, `details.year`). Brand is referenced by name, so renaming a brand
  silently disconnects its models; there is no foreign-key integrity.
- The Catalogs screen (`InventoryCatalogsScreen.jsx`, 582 lines) is a plain tab strip with
  thin lists: no icons, no counts, no search, no import.

## 2. Decisions (from brainstorming)

1. **Unify into "Tipo" backed by `InvCategory`.** The category concept disappears from the UI;
   every label that said "Categoría" says "Tipo". Hierarchy (subtypes), icon, color, ordering
   and per-type custom fields are kept.
2. **Migration rule: category wins.** If an item has `categoryId`, that is its type. Otherwise a
   type is created (or reused) from its `itemType` label.
3. **Default types are concrete**, not generic groups (no "Hardware").
4. **Catalogs layout: side list + panel.**
5. **Simple import** (fixed-column template) per catalog; **existing rows are skipped and
   reported**, never updated.
6. **Models become a real table** (`InvModel`) with FKs to type and brand.

## 3. Out of scope

- Large imports with free column mapping (ledger-style). Separate spec later.
- Brand logos / images.
- Removing the `InvItem.itemType` and `InvItem.model` columns (kept, see §4.3).

## 4. Data model

### 4.1 `InvCategory` (UI name: Tipo)

No schema change. Default types seeded per company (§4.5).

### 4.2 New `InvModel` (Prisma, `inv_model`)

| column | type | notes |
|---|---|---|
| id | uuid v7 | `@default(uuid(7))` |
| companyId | uuid | FK Company |
| name | varchar(255) | required |
| typeId | uuid | FK `InvCategory`, required |
| brandId | uuid | FK `InvBrand`, required |
| year | int? | 1900–2100 |
| description | varchar(2000)? | |
| sortOrder | int | default 0 |
| enabled | boolean | default true (soft delete) |
| createdAt / updatedAt | timestamps | |

Uniqueness: `(companyId, brandId, lower(name), coalesce(year, 0))` via a unique index created
in the migration SQL (expression index). Indexes on `(companyId)`, `(typeId)`, `(brandId)`.

### 4.3 `InvItem`

- Add `modelId uuid?` → FK `InvModel` (`onDelete: SetNull`), indexed.
- `model` (text) keeps being written with the model name for search/history compatibility.
- `itemType` is no longer written by any code path; left in place (read-only legacy).
- `categoryId` is the item's **type**. When a model is picked, `categoryId` = model.typeId and
  `brandId` = model.brandId (still editable).

### 4.4 Data migration (new forward Prisma migration; never edit old ones)

Per company, in SQL:

1. Seed default types (§4.5) with `ON CONFLICT (company_id, name) DO NOTHING`.
2. For each distinct `itemType` on items **without** `categoryId`: map base values to a label
   (`hardware`→"Hardware", `software`→"Software", `license`→"Licencia", `equipment`→"Equipo",
   `furniture`→"Mobiliario", `vehicle`→"Vehículo", `consumable`→"Consumible", `other`→"Otro";
   custom values keep their text), insert that `InvCategory` if missing, set `categoryId`.
3. Copy `inventory_reusable_catalog` rows with `kind='type'` into `InvCategory` (if missing).
4. Copy `kind='model'` rows into `InvModel`, guarded with `to_regclass('inventory_reusable_catalog')`:
   - brand resolved by case-insensitive name within the company; rows whose brand no longer
     exists are skipped (reported in the migration notes query, not failed).
   - type resolved from `details.itemType` via step 2 mapping; if absent, the most frequent
     type among items with that model name + brand; else a type named "Sin tipo".
5. Set `InvItem.modelId` where `lower(model)` + `brandId` matches exactly one `InvModel`.

The JSON catalog rows are left untouched (no destructive step). `/inventory/types` and
`/inventory/models` switch to the new tables (§6), so the JSON rows stop being read.

### 4.5 Default types

Laptop, Computadora de escritorio, Monitor, Celular, Tablet, Impresora, Equipo de red,
Periférico, Licencia de software, Mobiliario, Herramienta, Vehículo — each with a lucide icon
(`Laptop`, `Monitor`, `MonitorSmartphone`, `Smartphone`, `Tablet`, `Printer`, `Router`,
`Keyboard`, `KeyRound`, `Armchair`, `Wrench`, `Car`).

Existing companies: seeded by the migration. New companies: `ensureDefaultTypes(companyId)` in
the inventory service, called by `GET /inventory/categories` when the company has **zero**
`InvCategory` rows (counting disabled ones, so deleting them all never re-seeds).

## 5. Asset form

- Section "Modelo, tipo y marca" (`InventoryItemClassification.jsx`) works on ids:
  `modelId`, `categoryId` (label "Tipo"), `brandId`. Picking a model patches all three plus
  `model` (name). Type picker = `InvCategory` rows (with icon, subtypes indented); "+ Crear"
  creates a type inline. Brand picker unchanged.
- The standalone "Categoría" field is removed from the Identificación section.
- Custom-fields section keeps `categoryField: 'categoryId'` (custom fields follow the type).
- "Nuevo modelo" dialog: type, brand, name, year, description; saves to `POST /inventory/models`.
- Registro con IA (`InventorySmartForm`) and the chat/assistant actions: `categoryName` becomes
  the type reference; `itemType` is dropped from their schemas and prompts; model actions carry
  `typeName` + `brandName`.
- Detail blueprint, grouping (`GROUP_BY_OPTIONS`), filters and activity labels rename
  "Categoría" → "Tipo".

## 6. API

- `GET/POST /inventory/models`, `PUT /inventory/models/:id`, `DELETE` (soft),
  `PATCH /inventory/models/reorder` — `InvModel` via Prisma in `inventory-model-service.js`.
  `GET` supports `search` (every word must match name, brand name, type name, year or
  description), `typeId`, `brandId`; returns `typeName`, `typeIcon`, `typeColor`, `brandName`,
  `itemCount`.
- `GET /inventory/types` becomes an alias of the categories list (kept for the assistant);
  `POST /inventory/types` is removed in favour of `POST /inventory/categories`.
- Catalog list endpoints (categories, brands, locations, models) return `itemCount`; categories
  also return `customFieldCount`.
- Item create/update accept `modelId`; when present and the model is enabled, the service fills
  `model` (name) and, if not provided, `categoryId`/`brandId` from the model. Invalid/foreign
  `modelId` → 400.
- Import:
  - `GET /inventory/import/:catalog/template?format=csv|xlsx`
  - `POST /inventory/import/:catalog/preview` (multipart file) →
    `{ rows: [{ line, status: 'new'|'exists'|'error', data, message }], missing: { types, brands } }`
  - `POST /inventory/import/:catalog/commit` `{ rows, createMissing: boolean }` → re-validates
    server-side, creates all `new` rows (and missing types/brands when requested) in **one
    transaction**, returns counts. Existing rows are skipped.
  - `:catalog` ∈ `types | brands | models | locations`. Limit 2,000 rows / 5 MB per file.
  - Columns: types `nombre, descripcion, tipo_padre, icono, color`; brands `nombre, descripcion,
    sitio_web`; models `nombre, tipo, marca, anio, descripcion`; locations `nombre, descripcion,
    direccion`.
  - Parsing with `exceljs` / `csv-parse` (already dependencies of `apps/api`), validation with
    Zod in `inventory-catalog-import-service.js`. Permission `inventory.catalog.manage`.

## 7. Catalogs view

`InventoryCatalogsScreen.jsx` becomes a shell (< 200 lines) plus one component per catalog under
`components/catalogs/`:

- **Side list** (sticky, md+): icon + label + count for Tipos (`Shapes`), Marcas (`Tag`),
  Modelos (`Boxes`), Ubicaciones (`MapPin`), Campos personalizados (`SlidersHorizontal`).
  Below md it collapses to a `SelectField`. Active catalog in `?tab=` (old values
  `categories`/`types` map to `types`).
- **Panel**: `PageHeader`-style header (title, one-line description), toolbar with search,
  catalog filters, **Importar** and **Nuevo**; body is `DataTable`:
  - Tipos: color icon chip, name (subtypes indented), description, # activos, # campos.
    Drag reorder kept.
  - Marcas: name, website, # modelos, # activos.
  - Modelos: type icon + type, name, brand, year, # activos; filters by type and brand.
  - Ubicaciones: name, address, # activos.
  - Campos personalizados: unchanged behaviour, restyled to match.
- Create/edit in `Sheet` (fixed header/footer, scrolling body); types get an icon picker and
  color; soft delete through `ConfirmDialog`. Empty states via `EmptyState` with a
  "Importar" secondary action.
- **Import dialog** (`CatalogImportDialog.jsx`): steps with `ImportStepIndicator`
  (Plantilla → Archivo → Vista previa). Preview lists rows with status badges; when models
  reference missing types/brands a checkbox "Crear tipos y marcas faltantes" (default on) is
  shown. Confirm → toast with counts; queries invalidated so every screen updates at once.
- All TanStack keys under `['inventory', <catalog>]`.

## 8. Error handling

- Import: file too large / wrong format / missing required columns → 400 with a Spanish message
  shown in the dialog; row-level problems never fail the whole preview. Commit re-validates;
  if anything changed since preview (e.g. a row now exists) it is skipped and counted.
- Model create with duplicate (name + brand + year) → 409 "El modelo ya existe".
- Deleting (disabling) a type or brand that has enabled models → 409 with the count; the UI
  explains that models must be moved or disabled first.

## 9. Testing

Node test runner, focused:
- `inventory-model-service`: create/validation/duplicate, search across fields, `modelId` fill
  on item create.
- `inventory-catalog-import-service`: CSV and XLSX parsing, statuses new/exists/error, missing
  types/brands with and without `createMissing`, row limit.
- Migration mapping helper (pure function for itemType → label and model type fallback).
- `pnpm lint`, `vite build`, help content updated (overview, inventario, catalogos) and synced to
  runly-web.

## 10. Rollout notes

- One Prisma migration (schema + data). Applied migrations stay immutable.
- Help docs: "Categoría" wording replaced by "Tipo"; catalogos.md documents import.
- `docs/ai-context/inventory-ai.md` updated to the new model/type contract.
