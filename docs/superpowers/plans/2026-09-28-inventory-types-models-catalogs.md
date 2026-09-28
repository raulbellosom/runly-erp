# Inventory Types, Models and Catalogs Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify "Categoría" and "Tipo" into a single "Tipo" (backed by `InvCategory`), move inventory models to a real `InvModel` table linked to type and brand, redesign the Catálogos screen (side list + panel, icons, counts) and add a simple fixed-column CSV/XLSX import per catalog.

**Architecture:** Prisma owns `InvModel` and the new `InvItem.modelId`; one forward migration creates the table and migrates legacy data (`itemType` strings and the JSON `inventory_reusable_catalog` rows). The API gets three focused services: `inventory-catalog-service.js` (extracted from the 987-line `inventory-service.js`), `inventory-model-service.js` and `inventory-catalog-import-service.js`. The desktop module swaps the JSON-catalog hooks for id-based model/type pickers and splits `InventoryCatalogsScreen.jsx` into one panel per catalog.

**Tech Stack:** Node + Hono + Prisma 7 (Postgres/Supabase), Zod, `exceljs`, `csv-parse`; React 19 + TanStack Query + `@runly/ui`; Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-28-inventory-types-models-catalogs-design.md`

**Conventions for every task**
- All UI text in Spanish, code/comments in English, no emojis.
- Run from the repo root `D:\RacoonDevs\runly` unless stated.
- Tests: `node --test <file>`; lint: `pnpm exec eslint <paths>`; web build: `pnpm --filter ./apps/desktop build:web` (or `cd apps/desktop && pnpm build:web`).
- Never print secrets. Never edit existing files under `prisma/migrations/`.

---

## File map

**API (create)**
- `apps/api/src/services/inventory-guards.js` — `InventoryServiceError`, `assertCompany`, `createRefGuard`.
- `apps/api/src/services/inventory-catalog-service.js` — types (categories), brands, locations, custom fields, reorder, default types, counts, delete guards.
- `apps/api/src/services/inventory-model-service.js` — `InvModel` CRUD, search, `applyModelDefaults`.
- `apps/api/src/services/inventory-catalog-import-service.js` — parse, template, preview, commit.
- `apps/api/src/routes/inventory/models-routes.js`, `apps/api/src/routes/inventory/import-routes.js`.
- Tests: `apps/api/src/services/__tests__/inventory-model-service.test.js`, `inventory-catalog-import-service.test.js`, `inventory-catalog-service.test.js`.
- `prisma/migrations/20260928120000_inventory_models_types/migration.sql`.

**API (modify)** `prisma/schema.prisma`, `inventory-service.js`, `routes/inventory/index.js`, `inventory-chat-actions.js`, `inventory-intake-service.js`, `routes/inventory/intake-validators.js`, `vision-service.js`, `inventory-query.js`, `inventory-assistant-service.js`.

**API (delete)** `inventory-reusable-catalog.js`, `__tests__/inventory-reusable-catalog.test.js`.

**Desktop (create)** under `apps/desktop/src/modules/runly.inventory/`:
- `hooks/useInventoryModels.js`
- `components/catalogs/CatalogNav.jsx`, `CatalogPanel.jsx`, `CatalogListRow.jsx`, `CatalogRowActions.jsx`, `CatalogEditSheet.jsx`, `CatalogImportDialog.jsx`, `TypesPanel.jsx`, `BrandsPanel.jsx`, `ModelsPanel.jsx`, `LocationsPanel.jsx`, `CustomFieldsPanel.jsx`, `catalog-config.js`.

**Desktop (modify)** `components/InventoryCatalogPickers.jsx`, `InventoryModelDialog.jsx`, `InventoryItemClassification.jsx`, `InventorySmartForm.jsx`, `InventoryActionProposal.jsx`, `InventoryGroupedView.jsx`, `blueprints/*.js`, `lib/activity-field-labels.js`, `lib/inventory-constants.js`, `hooks/useInventoryCatalogs.js`, `screens/InventoryCatalogsScreen.jsx`, `screens/InventoryScreen.jsx`.

**Desktop (delete)** `hooks/useInventoryReusableCatalogs.js`, `components/InventoryReusableCatalog.jsx`.

**UI package (modify)** `packages/ui/src/components/icon-catalog.js`.

---

### Task 0: Commit the pending model-picker work

The working tree still holds the previous session's changes (model picker, `@runly/ui` combobox search, help docs). Commit them so this plan starts from a clean tree.

- [ ] **Step 1: Check the tree**

Run: `git status --short`
Expected: modified inventory files, `packages/ui` combobox files, help docs; no unrelated files.

- [ ] **Step 2: Commit**

```bash
git add apps/api apps/desktop packages/ui docs
git commit -m "feat(inventory): model picker fills type and brand, per-word combobox search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Icons for default types

**Files:** Modify `packages/ui/src/components/icon-catalog.js`

- [ ] **Step 1: Add imports** — in the `import { ... } from "lucide-react"` list, directly after the line `  Tablet,` add:

```js
  Smartphone,
  Router,
  KeyRound,
  Armchair,
```

- [ ] **Step 2: Add catalog entries** — directly after `  { name: "Tablet", component: Tablet },` add:

```js
  { name: "Smartphone", component: Smartphone },
  { name: "Router", component: Router },
  { name: "KeyRound", component: KeyRound },
  { name: "Armchair", component: Armchair },
```

- [ ] **Step 3: Verify**

Run: `node -e "import('./packages/ui/src/components/icon-catalog.js').then(m => console.log(['Smartphone','Router','KeyRound','Armchair','Cpu','Car'].map(n => n + ':' + Boolean(m.resolveLucideIcon(n))).join(' ')))"`
Expected: `Smartphone:true Router:true KeyRound:true Armchair:true Cpu:true Car:true`
(If the dynamic import fails because the file imports JSX-free ESM from `lucide-react` without a loader, instead run `pnpm exec eslint packages/ui/src/components/icon-catalog.js` and rely on the web build in Task 13.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/icon-catalog.js
git commit -m "feat(ui): add Smartphone, Router, KeyRound and Armchair to the icon catalog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prisma schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260928120000_inventory_models_types/migration.sql`

- [ ] **Step 1: Schema — Company relation.** After the line `  invBrands       InvBrand[]       @relation("CompanyInvBrands")` add:

```prisma
  invModels       InvModel[]       @relation("CompanyInvModels")
```

- [ ] **Step 2: Schema — back-relations.** In `model InvCategory`, after `  customFields InvCustomField[]` add `  models       InvModel[]`. In `model InvBrand`, after `  items   InvItem[]` add `  models  InvModel[]`.

- [ ] **Step 3: Schema — InvItem.** In `model InvItem`:
  - after `  model         String?   @db.VarChar(255)` add `  modelId       String?   @db.Uuid @map("model_id")`
  - after `  location     InvLocation?   @relation(fields: [locationId], references: [id])` add `  catalogModel InvModel?      @relation(fields: [modelId], references: [id], onDelete: SetNull)`
  - after `  @@index([assignedToId])` add `  @@index([modelId])`

- [ ] **Step 4: Schema — new model.** After the closing `}` of `model InvLocation` add:

```prisma
model InvModel {
  id          String   @id @default(uuid(7)) @db.Uuid
  companyId   String   @db.Uuid @map("company_id")
  name        String   @db.VarChar(255)
  nameKey     String   @db.VarChar(255) @map("name_key")
  typeId      String   @db.Uuid @map("type_id")
  brandId     String   @db.Uuid @map("brand_id")
  year        Int?
  description String?  @db.VarChar(2000)
  sortOrder   Int      @default(0) @map("sort_order")
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  company Company     @relation("CompanyInvModels", fields: [companyId], references: [id])
  type    InvCategory @relation(fields: [typeId], references: [id])
  brand   InvBrand    @relation(fields: [brandId], references: [id])
  items   InvItem[]

  // NULL years are distinct in Postgres; inventory-model-service checks that case.
  @@unique([companyId, brandId, nameKey, year])
  @@index([companyId])
  @@index([typeId])
  @@index([brandId])
  @@map("inv_model")
}
```

- [ ] **Step 5: Validate the schema**

Run: `pnpm exec prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`

- [ ] **Step 6: Write the migration SQL** — create `prisma/migrations/20260928120000_inventory_models_types/migration.sql`:

```sql
-- runly.inventory: unify "Tipo" into inv_category, add inv_model and inv_item.model_id,
-- and migrate legacy item_type strings plus the JSON inventory_reusable_catalog rows.
-- See docs/superpowers/specs/2026-09-28-inventory-types-models-catalogs-design.md.

CREATE TABLE "inv_model" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "company_id"  UUID NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "name_key"    VARCHAR(255) NOT NULL,
    "type_id"     UUID NOT NULL,
    "brand_id"    UUID NOT NULL,
    "year"        INTEGER,
    "description" VARCHAR(2000),
    "sort_order"  INTEGER NOT NULL DEFAULT 0,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inv_model_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inv_model_company_id_brand_id_name_key_year_key" ON "inv_model"("company_id", "brand_id", "name_key", "year");
CREATE INDEX "inv_model_company_id_idx" ON "inv_model"("company_id");
CREATE INDEX "inv_model_type_id_idx" ON "inv_model"("type_id");
CREATE INDEX "inv_model_brand_id_idx" ON "inv_model"("brand_id");
ALTER TABLE "inv_model" ADD CONSTRAINT "inv_model_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inv_model" ADD CONSTRAINT "inv_model_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "inv_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inv_model" ADD CONSTRAINT "inv_model_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "inv_brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inv_model" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "inv_model" FROM PUBLIC, anon, authenticated;

ALTER TABLE "inv_item" ADD COLUMN "model_id" UUID;
CREATE INDEX "inv_item_model_id_idx" ON "inv_item"("model_id");
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "inv_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Base item_type values -> Spanish type names.
CREATE TEMP TABLE "_inv_type_labels" ("value" TEXT PRIMARY KEY, "label" TEXT NOT NULL);
INSERT INTO "_inv_type_labels" VALUES
  ('hardware', 'Hardware'), ('software', 'Software'), ('license', 'Licencia'), ('equipment', 'Equipo'),
  ('furniture', 'Mobiliario'), ('vehicle', 'Vehículo'), ('consumable', 'Consumible'), ('other', 'Otro');

-- 1. Default concrete types for every company (never overwrites an existing name).
INSERT INTO "inv_category" ("company_id", "name", "icon", "sort_order", "enabled", "created_at", "updated_at")
SELECT c."id", t."name", t."icon", t."ord" * 10, true, now(), now()
FROM "company" c
CROSS JOIN (VALUES
  ('Laptop', 'Laptop', 0), ('Computadora de escritorio', 'Cpu', 1), ('Monitor', 'Monitor', 2),
  ('Celular', 'Smartphone', 3), ('Tablet', 'Tablet', 4), ('Impresora', 'Printer', 5),
  ('Equipo de red', 'Router', 6), ('Periférico', 'Keyboard', 7), ('Licencia de software', 'KeyRound', 8),
  ('Mobiliario', 'Armchair', 9), ('Herramienta', 'Wrench', 10), ('Vehículo', 'Car', 11)
) AS t("name", "icon", "ord")
ON CONFLICT ("company_id", "name") DO NOTHING;

-- 2. Items without a category get a type named after their legacy item_type (category wins).
INSERT INTO "inv_category" ("company_id", "name", "sort_order", "enabled", "created_at", "updated_at")
SELECT DISTINCT i."company_id", left(COALESCE(l."label", btrim(i."item_type")), 100), 1000, true, now(), now()
FROM "inv_item" i
LEFT JOIN "_inv_type_labels" l ON l."value" = i."item_type"
WHERE i."category_id" IS NULL AND i."item_type" IS NOT NULL AND btrim(i."item_type") <> ''
ON CONFLICT ("company_id", "name") DO NOTHING;

UPDATE "inv_item" i SET "category_id" = c."id"
FROM "inv_category" c
WHERE i."category_id" IS NULL AND i."item_type" IS NOT NULL AND btrim(i."item_type") <> ''
  AND c."company_id" = i."company_id"
  AND c."name" = left(COALESCE((SELECT l."label" FROM "_inv_type_labels" l WHERE l."value" = i."item_type"), btrim(i."item_type")), 100);

-- 3. Legacy JSON catalog (Runly ORM table; may not exist on every instance).
DO $$
BEGIN
  IF to_regclass('public.inventory_reusable_catalog') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "inv_category" ("company_id", "name", "sort_order", "enabled", "created_at", "updated_at")
  SELECT r.company_id, left(r.name, 100), 1000, true, now(), now()
  FROM inventory_reusable_catalog r
  WHERE r.kind = 'type'
  ON CONFLICT ("company_id", "name") DO NOTHING;

  INSERT INTO "inv_category" ("company_id", "name", "sort_order", "enabled", "created_at", "updated_at")
  SELECT DISTINCT r.company_id, 'Sin tipo', 9999, true, now(), now()
  FROM inventory_reusable_catalog r
  WHERE r.kind = 'model'
  ON CONFLICT ("company_id", "name") DO NOTHING;

  -- Rows whose brand no longer exists are skipped (inner join on inv_brand).
  INSERT INTO "inv_model" ("company_id", "name", "name_key", "type_id", "brand_id", "year", "description", "created_at", "updated_at")
  SELECT r.company_id, left(r.name, 255), lower(left(r.name, 255)),
         COALESCE(t_detail.id, t_items.category_id, t_none.id), b.id,
         CASE WHEN (r.details->>'year') ~ '^[0-9]{4}$' THEN (r.details->>'year')::int END,
         left(r.details->>'description', 2000), now(), now()
  FROM inventory_reusable_catalog r
  JOIN "inv_brand" b ON b.company_id = r.company_id AND lower(b.name) = lower(r.details->>'brandName')
  LEFT JOIN "inv_category" t_detail ON t_detail.company_id = r.company_id
    AND t_detail.name = COALESCE((SELECT l."label" FROM "_inv_type_labels" l WHERE l."value" = r.details->>'itemType'), r.details->>'itemType')
  LEFT JOIN LATERAL (
    SELECT i.category_id FROM "inv_item" i
    WHERE i.company_id = r.company_id AND i.brand_id = b.id AND lower(i.model) = lower(r.name) AND i.category_id IS NOT NULL
    GROUP BY i.category_id ORDER BY count(*) DESC LIMIT 1
  ) t_items ON true
  JOIN "inv_category" t_none ON t_none.company_id = r.company_id AND t_none.name = 'Sin tipo'
  WHERE r.kind = 'model'
  ON CONFLICT ("company_id", "brand_id", "name_key", "year") DO NOTHING;

  -- Drop the helper "Sin tipo" type where nothing ended up using it.
  UPDATE "inv_category" c SET "enabled" = false, "updated_at" = now()
  WHERE c.name = 'Sin tipo'
    AND NOT EXISTS (SELECT 1 FROM "inv_model" m WHERE m.type_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM "inv_item" i WHERE i.category_id = c.id);
END $$;

-- 4. Link items to the model with the same name + brand when exactly one matches.
UPDATE "inv_item" i SET "model_id" = m."id"
FROM "inv_model" m
WHERE i."model_id" IS NULL AND i."model" IS NOT NULL
  AND m."company_id" = i."company_id" AND m."brand_id" = i."brand_id" AND m."name_key" = lower(i."model")
  AND (SELECT count(*) FROM "inv_model" m2
       WHERE m2."company_id" = i."company_id" AND m2."brand_id" = i."brand_id" AND m2."name_key" = lower(i."model")) = 1;

DROP TABLE "_inv_type_labels";
```

- [ ] **Step 7: Apply to the dev Supabase instance and regenerate the client**

Run: `pnpm db:migrate`
Expected: `1 migration found ... 20260928120000_inventory_models_types ... All migrations have been successfully applied.` followed by Prisma client generation. If it fails, fix the SQL in this new (still unapplied) migration folder and rerun; never touch older migrations.

- [ ] **Step 8: Check status**

Run: `pnpm exec prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260928120000_inventory_models_types
git commit -m "feat(inventory): InvModel table, InvItem.modelId and type/model data migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared guards and catalog service extraction

`inventory-service.js` is 987 lines. Move the error class/guards into `inventory-guards.js` and the catalog section (categories/brands/locations/custom fields/reorder) into `inventory-catalog-service.js`, then add counts, default types and model-aware delete guards.

**Files:**
- Create: `apps/api/src/services/inventory-guards.js`, `apps/api/src/services/inventory-catalog-service.js`, `apps/api/src/services/__tests__/inventory-catalog-service.test.js`
- Modify: `apps/api/src/services/inventory-service.js`

- [ ] **Step 1: Create `inventory-guards.js`**

```js
// inventory-guards.js — error type and tenant guards shared by the inventory services.
export class InventoryServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'InventoryServiceError';
    this.status = status;
  }
}

// A missing companyId reaching a Prisma `where` as `undefined` would drop the
// tenant filter entirely, so reject it here.
export function assertCompany(companyId) {
  if (typeof companyId !== 'string' || companyId.trim() === '') {
    throw new InventoryServiceError('companyId es requerido.', 400);
  }
  return companyId;
}

// Rejects a foreign-key reference that belongs to a different company.
export function createRefGuard(prisma) {
  return async function assertRefInCompany(model, id, companyId, label) {
    if (id === undefined || id === null || id === '') return;
    const row = await prisma[model].findFirst({ where: { id, companyId }, select: { id: true } });
    if (!row) throw new InventoryServiceError(`${label} no pertenece a la empresa actual.`, 400);
  };
}
```

- [ ] **Step 2: Write the failing catalog tests** — `apps/api/src/services/__tests__/inventory-catalog-service.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryCatalogService, DEFAULT_INVENTORY_TYPES } from '../inventory-catalog-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const TYPE = '01900000-0000-7000-8000-000000000010';

function prismaWith({ categoryCount = 0, rows = [], itemCount = 0, modelCount = 0 } = {}) {
  const calls = { createMany: [], update: [] };
  return {
    calls,
    invCategory: {
      count: async () => categoryCount,
      createMany: async (args) => { calls.createMany.push(args); return { count: args.data.length }; },
      findMany: async () => rows,
      findFirst: async () => ({ id: TYPE }),
      update: async (args) => { calls.update.push(args); return { id: args.where.id, ...args.data }; },
    },
    invItem: { count: async () => itemCount },
    invModel: { count: async () => modelCount },
  };
}

test('listCategories seeds default types only for a company with no types at all', async () => {
  const prisma = prismaWith({ categoryCount: 0 });
  await createInventoryCatalogService({ prisma }).listCategories(COMPANY);
  assert.equal(prisma.calls.createMany.length, 1);
  assert.deepEqual(prisma.calls.createMany[0].data.map(t => t.name), DEFAULT_INVENTORY_TYPES.map(t => t.name));
  assert.equal(prisma.calls.createMany[0].skipDuplicates, true);

  const seeded = prismaWith({ categoryCount: 3 });
  await createInventoryCatalogService({ prisma: seeded }).listCategories(COMPANY);
  assert.equal(seeded.calls.createMany.length, 0);
});

test('listCategories flattens counts', async () => {
  const prisma = prismaWith({ categoryCount: 1, rows: [{ id: TYPE, name: 'Laptop', _count: { items: 4, customFields: 2, models: 3 } }] });
  const [row] = await createInventoryCatalogService({ prisma }).listCategories(COMPANY);
  assert.deepEqual(row, { id: TYPE, name: 'Laptop', itemCount: 4, customFieldCount: 2, modelCount: 3 });
});

test('deleteCategory refuses a type that enabled models still use', async () => {
  const prisma = prismaWith({ modelCount: 2 });
  await assert.rejects(createInventoryCatalogService({ prisma }).deleteCategory(TYPE, COMPANY), (err) => err.status === 409 && /2 modelo/.test(err.message));
  assert.equal(prisma.calls.update.length, 0);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test apps/api/src/services/__tests__/inventory-catalog-service.test.js`
Expected: FAIL — `Cannot find module '../inventory-catalog-service.js'`.

- [ ] **Step 4: Create `inventory-catalog-service.js`.** Move the catalog code out of `inventory-service.js` — everything from the comment `// ── Catalog — Categories ──` down to and including the four `const reorder… = (companyId, items) => reorderCatalog(...)` lines — into this new file, then apply the changes shown. The full file must read:

```js
// inventory-catalog-service.js — runly.inventory catalogs: types (InvCategory),
// brands, locations and custom fields. Extracted from inventory-service.js.
import { InventoryServiceError, assertCompany, createRefGuard } from './inventory-guards.js';

// Seeded once per company (see listCategories) and by the 20260928120000 migration.
export const DEFAULT_INVENTORY_TYPES = [
  { name: 'Laptop', icon: 'Laptop' },
  { name: 'Computadora de escritorio', icon: 'Cpu' },
  { name: 'Monitor', icon: 'Monitor' },
  { name: 'Celular', icon: 'Smartphone' },
  { name: 'Tablet', icon: 'Tablet' },
  { name: 'Impresora', icon: 'Printer' },
  { name: 'Equipo de red', icon: 'Router' },
  { name: 'Periférico', icon: 'Keyboard' },
  { name: 'Licencia de software', icon: 'KeyRound' },
  { name: 'Mobiliario', icon: 'Armchair' },
  { name: 'Herramienta', icon: 'Wrench' },
  { name: 'Vehículo', icon: 'Car' },
];

const enabledOnly = { where: { enabled: true } };

export function createInventoryCatalogService({ prisma }) {
  const assertRefInCompany = createRefGuard(prisma);

  async function assertUnused(where, label) {
    const [items, models] = await Promise.all([
      prisma.invItem.count({ where: { ...where, enabled: true } }),
      where.categoryId || where.brandId
        ? prisma.invModel.count({ where: { companyId: where.companyId, enabled: true, ...(where.categoryId ? { typeId: where.categoryId } : { brandId: where.brandId }) } })
        : 0,
    ]);
    if (models > 0) throw new InventoryServiceError(`No se puede eliminar: ${models} modelo(s) usan ${label}. Muévelos o desactívalos primero.`, 409);
    if (items > 0) throw new InventoryServiceError(`No se puede eliminar: ${items} activo(s) usan ${label}.`, 409);
  }

  // ── Types (InvCategory) ────────────────────────────────────────────────────

  async function ensureDefaultTypes(companyId) {
    // Counts disabled rows too, so a company that removed every type is not re-seeded.
    if (await prisma.invCategory.count({ where: { companyId } }) > 0) return;
    await prisma.invCategory.createMany({
      data: DEFAULT_INVENTORY_TYPES.map((type, index) => ({ companyId, name: type.name, icon: type.icon, sortOrder: index * 10 })),
      skipDuplicates: true,
    });
  }

  async function listCategories(companyId) {
    assertCompany(companyId);
    await ensureDefaultTypes(companyId);
    const rows = await prisma.invCategory.findMany({
      where: { companyId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: enabledOnly, customFields: enabledOnly, models: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0, customFieldCount: _count?.customFields ?? 0, modelCount: _count?.models ?? 0 }));
  }

  async function createCategory(data, companyId) {
    assertCompany(companyId);
    const { name, description, icon, color, parentId, sortOrder } = data;
    await assertRefInCompany('invCategory', parentId, companyId, 'El tipo padre');
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (icon !== undefined) createData.icon = icon;
    if (color !== undefined) createData.color = color;
    if (parentId !== undefined) createData.parentId = parentId;
    if (sortOrder !== undefined) createData.sortOrder = sortOrder;
    return prisma.invCategory.create({ data: createData });
  }

  async function updateCategory(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCategory.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Category not found', 404);
    const { name, description, icon, color, parentId, sortOrder } = data;
    if (parentId !== undefined && parentId !== null && parentId === id) {
      throw new InventoryServiceError('Un tipo no puede ser su propio padre.', 400);
    }
    await assertRefInCompany('invCategory', parentId, companyId, 'El tipo padre');
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    return prisma.invCategory.update({ where: { id }, data: updateData });
  }

  async function deleteCategory(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCategory.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Category not found', 404);
    await assertUnused({ companyId, categoryId: id }, 'este tipo');
    return prisma.invCategory.update({ where: { id }, data: { enabled: false } });
  }

  // ── Brands ─────────────────────────────────────────────────────────────────

  async function listBrands(companyId) {
    assertCompany(companyId);
    const rows = await prisma.invBrand.findMany({
      where: { companyId, enabled: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: enabledOnly, models: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0, modelCount: _count?.models ?? 0 }));
  }

  async function createBrand(data, companyId) {
    assertCompany(companyId);
    const { name, description, website } = data;
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (website !== undefined) createData.website = website;
    return prisma.invBrand.create({ data: createData });
  }

  async function updateBrand(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invBrand.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Brand not found', 404);
    const { name, description, website } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (website !== undefined) updateData.website = website;
    return prisma.invBrand.update({ where: { id }, data: updateData });
  }

  async function deleteBrand(id, companyId) {
    assertCompany(companyId);
    const brand = await prisma.invBrand.findFirst({ where: { id, companyId, enabled: true } });
    if (!brand) throw new InventoryServiceError('Brand not found', 404);
    await assertUnused({ companyId, brandId: id }, 'esta marca');
    return prisma.invBrand.update({ where: { id }, data: { enabled: false } });
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  async function listLocations(companyId) {
    assertCompany(companyId);
    const rows = await prisma.invLocation.findMany({
      where: { companyId, enabled: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0 }));
  }

  async function createLocation(data, companyId) {
    assertCompany(companyId);
    const { name, description, address } = data;
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (address !== undefined) createData.address = address;
    return prisma.invLocation.create({ data: createData });
  }

  async function updateLocation(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invLocation.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Location not found', 404);
    const { name, description, address } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (address !== undefined) updateData.address = address;
    return prisma.invLocation.update({ where: { id }, data: updateData });
  }

  async function deleteLocation(id, companyId) {
    assertCompany(companyId);
    const location = await prisma.invLocation.findFirst({ where: { id, companyId, enabled: true } });
    if (!location) throw new InventoryServiceError('Location not found', 404);
    await assertUnused({ companyId, locationId: id }, 'esta ubicación');
    return prisma.invLocation.update({ where: { id }, data: { enabled: false } });
  }

  // ── Custom Fields ──────────────────────────────────────────────────────────

  // categoryId: a type id (its fields + global ones), 'all' (every field) or
  // empty (global fields only).
  async function listCustomFields(companyId, categoryId) {
    assertCompany(companyId);
    const where = { companyId, enabled: true };
    if (categoryId === 'all') {
      // no type filter
    } else if (categoryId) {
      where.OR = [{ categoryId }, { categoryId: null }];
    } else {
      where.categoryId = null;
    }
    return prisma.invCustomField.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  }

  async function createCustomField(data, companyId) {
    assertCompany(companyId);
    const { label, fieldKey, fieldType, categoryId, options, required, sortOrder } = data;
    await assertRefInCompany('invCategory', categoryId, companyId, 'El tipo');
    const createData = { companyId, label, fieldKey, fieldType };
    if (categoryId !== undefined) createData.categoryId = categoryId;
    if (options !== undefined) createData.options = options;
    if (required !== undefined) createData.required = required;
    if (sortOrder !== undefined) createData.sortOrder = sortOrder;
    return prisma.invCustomField.create({ data: createData });
  }

  async function updateCustomField(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCustomField.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Custom field not found', 404);
    const { label, fieldKey, fieldType, categoryId, options, required, sortOrder } = data;
    await assertRefInCompany('invCategory', categoryId, companyId, 'El tipo');
    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (fieldKey !== undefined) updateData.fieldKey = fieldKey;
    if (fieldType !== undefined) updateData.fieldType = fieldType;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (options !== undefined) updateData.options = options;
    if (required !== undefined) updateData.required = required;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    return prisma.invCustomField.update({ where: { id }, data: updateData });
  }

  async function deleteCustomField(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCustomField.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Custom field not found', 404);
    return prisma.invCustomField.update({ where: { id }, data: { enabled: false } });
  }

  // Reorder helpers scope every write by companyId (via updateMany) so a
  // payload referencing another company's rows is a silent no-op, never a write.
  async function reorderCatalog(model, companyId, items) {
    assertCompany(companyId);
    if (!Array.isArray(items)) return;
    await prisma.$transaction(
      items
        .filter((entry) => entry && typeof entry.id === 'string')
        .map(({ id, sortOrder }) => prisma[model].updateMany({ where: { id, companyId }, data: { sortOrder: Number(sortOrder) || 0 } })),
    );
  }

  return {
    listCategories, createCategory, updateCategory, deleteCategory,
    listBrands, createBrand, updateBrand, deleteBrand,
    listLocations, createLocation, updateLocation, deleteLocation,
    listCustomFields, createCustomField, updateCustomField, deleteCustomField,
    reorderCategories: (companyId, items) => reorderCatalog('invCategory', companyId, items),
    reorderBrands: (companyId, items) => reorderCatalog('invBrand', companyId, items),
    reorderLocations: (companyId, items) => reorderCatalog('invLocation', companyId, items),
    reorderModels: (companyId, items) => reorderCatalog('invModel', companyId, items),
    reorderCustomFields: (companyId, items) => reorderCatalog('invCustomField', companyId, items),
  };
}
```

- [ ] **Step 5: Slim down `inventory-service.js`.**
  1. Replace the `InventoryServiceError` class (lines 6–12) and the `assertCompany` function (the block starting `// Defensive company-scope guard.` through its closing `}`) with:

```js
import { InventoryServiceError, assertCompany, createRefGuard } from './inventory-guards.js';
import { createInventoryCatalogService } from './inventory-catalog-service.js';

export { InventoryServiceError };
```
  (place the two imports with the other imports at the top of the file and the `export { … }` right below them.)
  2. Replace the whole inner `async function assertRefInCompany(model, id, companyId, label) { … }` (inside `createInventoryService`) with `const assertRefInCompany = createRefGuard(prisma);`.
  3. Delete the catalog section moved in Step 4 (from `// ── Catalog — Categories ──` through the `const reorderCustomFields = …` line).
  4. In the returned object, delete every entry from `// Categories` through `reorderCustomFields,` and add `...createInventoryCatalogService({ prisma }),` as the last entry.
  5. In `createItem` and `updateItem`: rename the labels `'La categoria'` → `'El tipo'`; delete the lines `itemType,` from both destructurings and the lines `if (itemType !== undefined) itemData.itemType = itemType || null;` / `if (itemType !== undefined) updateData.itemType = itemType || null;`; add `modelId,` to both destructurings (after `model,`) and add, after the `model` assignment lines:

```js
    if (modelId !== undefined) itemData.modelId = modelId || null;
```
  (in `updateItem` use `updateData` instead of `itemData`).

- [ ] **Step 6: Run the new and existing inventory tests**

Run: `node --test apps/api/src/services/__tests__/inventory-catalog-service.test.js apps/api/src/services/__tests__/inventory-service.test.js apps/api/src/services/__tests__/inventory-tenant-isolation.test.js`
Expected: all pass. If an existing test fails only because its Prisma mock lacks `invCategory.count`, `invModel.count` or `include`-aware rows, add the stub to that test's mock (`count: async () => 1` on `invCategory`, `invModel: { count: async () => 0 }`) — do not change service behaviour to satisfy a mock. If a test asserts the old message text "categoria", update it to "tipo".

- [ ] **Step 7: Check file sizes**

Run: `wc -l apps/api/src/services/inventory-service.js apps/api/src/services/inventory-catalog-service.js`
Expected: both under 800.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/inventory-guards.js apps/api/src/services/inventory-catalog-service.js apps/api/src/services/inventory-service.js apps/api/src/services/__tests__
git commit -m "refactor(inventory): extract catalog service, add counts, default types and model delete guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Model service

**Files:**
- Create: `apps/api/src/services/inventory-model-service.js`, `apps/api/src/services/__tests__/inventory-model-service.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryModelService } from '../inventory-model-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const TYPE = '01900000-0000-7000-8000-000000000010';
const BRAND = '01900000-0000-7000-8000-000000000020';
const MODEL = '01900000-0000-7000-8000-000000000030';

function prismaWith({ duplicate = null, brands = [{ id: BRAND }], types = [{ id: TYPE }], model = null, itemCount = 0 } = {}) {
  const calls = { findMany: [], create: [], update: [] };
  const row = (data) => ({ id: MODEL, sortOrder: 0, ...data, type: { name: 'Laptop', icon: 'Laptop', color: null }, brand: { name: 'Dell' }, _count: { items: 0 } });
  return {
    calls,
    invCategory: { findFirst: async () => ({ id: TYPE }), findMany: async () => types },
    invBrand: { findFirst: async () => ({ id: BRAND }), findMany: async () => brands },
    invItem: { count: async () => itemCount },
    invModel: {
      findFirst: async (args) => (args.select?.name ? model : args.where.nameKey !== undefined ? duplicate : model),
      findMany: async (args) => { calls.findMany.push(args); return [row({ name: 'XPS 15', typeId: TYPE, brandId: BRAND, year: 2023 })]; },
      create: async (args) => { calls.create.push(args); return row(args.data); },
      update: async (args) => { calls.update.push(args); return row({ ...model, ...args.data }); },
    },
  };
}

test('create resolves type and brand by name and flattens the row', async () => {
  const prisma = prismaWith();
  const row = await createInventoryModelService({ prisma }).create({ name: ' XPS 15 ', typeName: 'Laptop', brandName: 'dell', year: 2023 }, COMPANY);
  assert.deepEqual(prisma.calls.create[0].data, { companyId: COMPANY, name: 'XPS 15', nameKey: 'xps 15', typeId: TYPE, brandId: BRAND, year: 2023, description: null });
  assert.equal(row.typeName, 'Laptop');
  assert.equal(row.brandName, 'Dell');
  assert.equal(row.itemCount, 0);
});

test('create requires type and brand', async () => {
  const service = createInventoryModelService({ prisma: prismaWith() });
  await assert.rejects(service.create({ name: 'XPS', brandId: BRAND }, COMPANY), /tipo/);
  await assert.rejects(service.create({ name: 'XPS', typeId: TYPE }, COMPANY), /marca/);
  await assert.rejects(createInventoryModelService({ prisma: prismaWith({ brands: [] }) }).create({ name: 'XPS', typeId: TYPE, brandName: 'Nope' }, COMPANY), /«Nope» no existe/);
});

test('create rejects a duplicate (brand + name + year) unless reuse is requested', async () => {
  const existing = { id: MODEL, name: 'XPS 15', typeId: TYPE, brandId: BRAND, year: null };
  const service = createInventoryModelService({ prisma: prismaWith({ duplicate: existing, model: existing }) });
  await assert.rejects(service.create({ name: 'xps 15', typeId: TYPE, brandId: BRAND }, COMPANY), (err) => err.status === 409);
  const reused = await service.create({ name: 'xps 15', typeId: TYPE, brandId: BRAND }, COMPANY, { reuse: true });
  assert.equal(reused.reused, true);
});

test('list turns every search word into an OR over name, description, brand, type and year', async () => {
  const prisma = prismaWith();
  await createInventoryModelService({ prisma }).list({ companyId: COMPANY, search: 'dell 2023' });
  const { AND } = prisma.calls.findMany[0].where;
  assert.equal(AND.length, 2);
  assert.ok(AND[0].OR.some((c) => c.brand?.name?.contains === 'dell'));
  assert.ok(AND[1].OR.some((c) => c.year === 2023));
});

test('applyModelDefaults fills name, type and brand but keeps explicit values', async () => {
  const model = { name: 'XPS 15', typeId: TYPE, brandId: BRAND };
  const service = createInventoryModelService({ prisma: prismaWith({ model }) });
  assert.deepEqual(await service.applyModelDefaults({ modelId: MODEL, name: 'Laptop 1' }, COMPANY),
    { modelId: MODEL, name: 'Laptop 1', model: 'XPS 15', categoryId: TYPE, brandId: BRAND });
  assert.equal((await service.applyModelDefaults({ modelId: MODEL, categoryId: 'other' }, COMPANY)).categoryId, 'other');
  assert.deepEqual(await service.applyModelDefaults({ name: 'x' }, COMPANY), { name: 'x' });
  await assert.rejects(createInventoryModelService({ prisma: prismaWith({ model: null }) }).applyModelDefaults({ modelId: MODEL }, COMPANY), /modelo no existe/);
});

test('remove refuses a model used by enabled items', async () => {
  const service = createInventoryModelService({ prisma: prismaWith({ model: { id: MODEL }, itemCount: 3 }) });
  await assert.rejects(service.remove(MODEL, COMPANY), (err) => err.status === 409 && /3 activo/.test(err.message));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test apps/api/src/services/__tests__/inventory-model-service.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `inventory-model-service.js`**

```js
// inventory-model-service.js — runly.inventory models (InvModel): a product line
// defined by type + brand + name (+ optional year). Items reference it via modelId.
import { z } from 'zod';
import { InventoryServiceError, assertCompany, createRefGuard } from './inventory-guards.js';

const modelInput = z.object({
  name: z.string().trim().min(1).max(255),
  typeId: z.uuid().optional(),
  typeName: z.string().trim().min(1).max(100).optional(),
  brandId: z.uuid().optional(),
  brandName: z.string().trim().min(1).max(100).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).strict();

const INCLUDE = {
  type: { select: { name: true, icon: true, color: true } },
  brand: { select: { name: true } },
  _count: { select: { items: { where: { enabled: true } } } },
};

const nameKeyOf = (name) => name.trim().toLocaleLowerCase('es');

function toRow({ type, brand, _count, ...model }) {
  return {
    ...model,
    typeName: type?.name ?? null,
    typeIcon: type?.icon ?? null,
    typeColor: type?.color ?? null,
    brandName: brand?.name ?? null,
    itemCount: _count?.items ?? 0,
  };
}

function parse(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new InventoryServiceError('Revisa los datos del modelo.', 400);
  return parsed.data;
}

export function createInventoryModelService({ prisma }) {
  const assertRefInCompany = createRefGuard(prisma);

  // Accepts an id (UI) or a name (import, AI actions).
  async function resolveRef(model, id, name, companyId, noun) {
    if (id) {
      await assertRefInCompany(model, id, companyId, noun === 'tipo' ? 'El tipo' : 'La marca');
      return id;
    }
    if (!name) throw new InventoryServiceError(`Indica ${noun === 'tipo' ? 'el tipo' : 'la marca'} del modelo.`, 400);
    const rows = await prisma[model].findMany({
      where: { companyId, enabled: true, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    });
    if (rows.length !== 1) throw new InventoryServiceError(`${noun === 'tipo' ? 'El tipo' : 'La marca'} «${name}» no existe.`, 400);
    return rows[0].id;
  }

  async function findDuplicate(companyId, brandId, nameKey, year, exceptId) {
    return prisma.invModel.findFirst({
      where: { companyId, brandId, nameKey, year: year ?? null, enabled: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      include: INCLUDE,
    });
  }

  async function list({ companyId, search, typeId, brandId }) {
    assertCompany(companyId);
    const words = String(search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 10);
    const contains = (value) => ({ contains: value, mode: 'insensitive' });
    const rows = await prisma.invModel.findMany({
      where: {
        companyId,
        enabled: true,
        ...(typeId ? { typeId } : {}),
        ...(brandId ? { brandId } : {}),
        AND: words.map((word) => ({
          OR: [
            { name: contains(word) },
            { description: contains(word) },
            { brand: { name: contains(word) } },
            { type: { name: contains(word) } },
            ...(/^\d{4}$/.test(word) ? [{ year: Number(word) }] : []),
          ],
        })),
      },
      include: INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    return rows.map(toRow);
  }

  async function create(input, companyId, { reuse = false } = {}) {
    assertCompany(companyId);
    const data = parse(modelInput, input);
    const typeId = await resolveRef('invCategory', data.typeId, data.typeName, companyId, 'tipo');
    const brandId = await resolveRef('invBrand', data.brandId, data.brandName, companyId, 'marca');
    const nameKey = nameKeyOf(data.name);
    const duplicate = await findDuplicate(companyId, brandId, nameKey, data.year);
    if (duplicate) {
      if (reuse) return { ...toRow(duplicate), reused: true };
      throw new InventoryServiceError('El modelo ya existe para esa marca y año.', 409);
    }
    try {
      const created = await prisma.invModel.create({
        data: { companyId, name: data.name, nameKey, typeId, brandId, year: data.year ?? null, description: data.description ?? null },
        include: INCLUDE,
      });
      return toRow(created);
    } catch (err) {
      if (err?.code === 'P2002') throw new InventoryServiceError('El modelo ya existe para esa marca y año.', 409);
      throw err;
    }
  }

  async function update(id, input, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invModel.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Modelo no encontrado.', 404);
    const data = parse(modelInput.partial(), input);
    const typeId = data.typeId || data.typeName ? await resolveRef('invCategory', data.typeId, data.typeName, companyId, 'tipo') : existing.typeId;
    const brandId = data.brandId || data.brandName ? await resolveRef('invBrand', data.brandId, data.brandName, companyId, 'marca') : existing.brandId;
    const name = data.name ?? existing.name;
    const year = data.year !== undefined ? data.year : existing.year;
    if (await findDuplicate(companyId, brandId, nameKeyOf(name), year, id)) {
      throw new InventoryServiceError('El modelo ya existe para esa marca y año.', 409);
    }
    const updated = await prisma.invModel.update({
      where: { id },
      data: {
        name, nameKey: nameKeyOf(name), typeId, brandId, year,
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
      include: INCLUDE,
    });
    return toRow(updated);
  }

  async function remove(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invModel.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Modelo no encontrado.', 404);
    const items = await prisma.invItem.count({ where: { companyId, modelId: id, enabled: true } });
    if (items > 0) throw new InventoryServiceError(`No se puede eliminar: ${items} activo(s) usan este modelo.`, 409);
    return prisma.invModel.update({ where: { id }, data: { enabled: false } });
  }

  // Item create/update: picking a model fills its name and, unless the caller
  // sent them, the item's type (categoryId) and brand.
  async function applyModelDefaults(data, companyId) {
    if (!data?.modelId) return data;
    const model = await prisma.invModel.findFirst({
      where: { id: data.modelId, companyId, enabled: true },
      select: { name: true, typeId: true, brandId: true },
    });
    if (!model) throw new InventoryServiceError('El modelo no existe en esta empresa.', 400);
    return { ...data, model: model.name, categoryId: data.categoryId ?? model.typeId, brandId: data.brandId ?? model.brandId };
  }

  return { list, create, update, remove, applyModelDefaults };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test apps/api/src/services/__tests__/inventory-model-service.test.js`
Expected: 6 pass, 0 fail. (The mock's `findFirst` distinguishes duplicate lookups by the presence of `where.nameKey`; if a test fails on that heuristic, fix the mock, not the service.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inventory-model-service.js apps/api/src/services/__tests__/inventory-model-service.test.js
git commit -m "feat(inventory): InvModel service with search, dedupe and item defaults

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Model routes, types alias and item modelId

**Files:**
- Create: `apps/api/src/routes/inventory/models-routes.js`
- Modify: `apps/api/src/routes/inventory/index.js`
- Delete: `apps/api/src/services/inventory-reusable-catalog.js`, `apps/api/src/services/__tests__/inventory-reusable-catalog.test.js`

- [ ] **Step 1: Create `models-routes.js`**

```js
// runly.inventory models (InvModel) + GET /inventory/types (alias of the types
// catalog, kept for the AI assistant). Mounted by routes/inventory/index.js.
import { Hono } from 'hono';
import { createInventoryModelService } from '../../services/inventory-model-service.js';

export function createInventoryModelsRouter({ prisma, requirePermission, inventoryService, InventoryServiceError }) {
  const router = new Hono();
  const models = createInventoryModelService({ prisma });
  const fail = (c, err, fallback) => err instanceof InventoryServiceError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: fallback }, 500);

  router.get('/inventory/types', requirePermission('inventory.catalog.read'), async (c) => {
    try {
      const rows = await inventoryService.listCategories(c.get('companyId'));
      return c.json({ data: rows.map((row) => ({ ...row, value: row.id })) });
    } catch (err) { return fail(c, err, 'No se pudieron cargar los tipos.'); }
  });

  router.get('/inventory/models', requirePermission('inventory.catalog.read'), async (c) => {
    try {
      const { search, typeId, brandId } = c.req.query();
      return c.json({ data: await models.list({ companyId: c.get('companyId'), search, typeId, brandId }) });
    } catch (err) { return fail(c, err, 'No se pudieron cargar los modelos.'); }
  });

  router.post('/inventory/models', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      return c.json({ data: await models.create(await c.req.json(), c.get('companyId')) }, 201);
    } catch (err) { return fail(c, err, 'No se pudo crear el modelo.'); }
  });

  router.patch('/inventory/models/reorder', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      const { items } = await c.req.json();
      await inventoryService.reorderModels(c.get('companyId'), items);
      return c.json({ ok: true });
    } catch (err) { return fail(c, err, 'No se pudo guardar el orden.'); }
  });

  router.put('/inventory/models/:id', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      return c.json({ data: await models.update(c.req.param('id'), await c.req.json(), c.get('companyId')) });
    } catch (err) { return fail(c, err, 'No se pudo actualizar el modelo.'); }
  });

  router.delete('/inventory/models/:id', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      await models.remove(c.req.param('id'), c.get('companyId'));
      return c.json({ ok: true });
    } catch (err) { return fail(c, err, 'No se pudo eliminar el modelo.'); }
  });

  return router;
}
```

- [ ] **Step 2: Wire it in `routes/inventory/index.js`.**
  1. Replace the import line `import { createInventoryReusableCatalog, INVENTORY_BASE_TYPES, INVENTORY_BASE_TYPE_LABELS } from '../../services/inventory-reusable-catalog.js';` with:

```js
import { createInventoryModelsRouter } from './models-routes.js';
import { createInventoryModelService } from '../../services/inventory-model-service.js';
```
  2. Delete the block from `const reusableCatalog = createInventoryReusableCatalog({ prisma });` through the closing `}` of the `for (const [segment, kind] of [['models', 'model'], ['types', 'type']])` loop, and in its place add:

```js
  router.route('/', createInventoryModelsRouter({ prisma, requirePermission, inventoryService, InventoryServiceError }));
  const modelDefaults = createInventoryModelService({ prisma });
```
  3. In `router.post("/inventory/items", …)` replace `const data = await c.req.json();` with `const data = await modelDefaults.applyModelDefaults(await c.req.json(), companyId);`. Do the same in `router.patch("/inventory/items/:id", …)`.
  4. In the catalog GET loop, make the custom-fields branch pass through `'all'`: it already forwards `c.req.query().categoryId`, so no change is needed — confirm it reads `inventoryService[listFn](companyId, c.req.query().categoryId)`.

- [ ] **Step 3: Delete the JSON catalog service and its test**

```bash
git rm apps/api/src/services/inventory-reusable-catalog.js apps/api/src/services/__tests__/inventory-reusable-catalog.test.js
```

- [ ] **Step 4: Static check** (chat/intake still import the deleted file; Task 6 fixes them, so check only the router files here)

Run: `node --check apps/api/src/routes/inventory/models-routes.js && node --check apps/api/src/routes/inventory/index.js && node --test apps/api/src/routes/inventory/__tests__/router.test.js`
Expected: no syntax errors; router tests pass. If `router.test.js` asserts the old `/inventory/models` JSON-catalog behaviour, update that assertion to the new `{ data: [...] }` list shape.

- [ ] **Step 5: Commit** (together with Task 6 if the API does not boot without it — see Task 6 Step 7)

---

### Task 6: AI, intake and query code off `itemType`

**Files:** Modify `apps/api/src/services/inventory-chat-actions.js`, `inventory-intake-service.js`, `routes/inventory/intake-validators.js`, `vision-service.js`, `inventory-query.js`, `inventory-assistant-service.js`

- [ ] **Step 1: `intake-validators.js`** — replace the line `  itemType: z.string().min(1).max(50).nullable().optional(),` with `  modelId: ref,`, and in the observation `field: z.enum([...])` list remove `'itemType', `.

- [ ] **Step 2: `inventory-intake-service.js`** — replace the import `import { createInventoryReusableCatalog } from './inventory-reusable-catalog.js';` with `import { createInventoryModelService } from './inventory-model-service.js';` and replace the line `    await createInventoryReusableCatalog({ prisma: db }).assertType(companyId, data.common.itemType);` with:

```js
    data.common = await createInventoryModelService({ prisma: db }).applyModelDefaults(data.common, companyId);
```

- [ ] **Step 3: `vision-service.js`** — in the prompt array:
  - replace `"field solo puede ser name, itemType, categoryName, brandName, model, partNumber, serialNumber, productCode, description.",` with `"field solo puede ser name, categoryName, brandName, model, partNumber, serialNumber, productCode, description. categoryName es el tipo concreto del equipo (por ejemplo Laptop, Celular, Monitor).",`
  - delete the line `"itemType solo hardware, software, license, equipment, furniture, vehicle, consumable, other.",`
  - in the `ProdID/Product ID …` line delete the trailing sentence ` Para equipos electrónicos físicos, itemType es hardware.`

- [ ] **Step 4: `inventory-query.js`** — in `inventoryFiltersSchema` replace `model: z.string().max(255).optional(), itemType: z.string().max(50).optional(),` with `model: z.string().max(255).optional(), modelId: z.uuid().optional(),`; in `buildInventoryWhere` replace `'model', 'itemType'` with `'model', 'modelId'`.

- [ ] **Step 5: `inventory-assistant-service.js`** — in the filter properties list replace `'itemType'` with `'modelId'`; in `groupBy({ by: ['brandId', 'model', 'itemType', 'categoryId'], …` remove `'itemType', `; in the mapping remove `type: g.itemType, ` and rename `category:` to `type:` so the object reads `model: g.model, categoryId: g.categoryId, type: categories.find(c => c.id === g.categoryId)?.name ?? null, count: g._count.id`; in the item `select` remove `itemType: true, `.

- [ ] **Step 6: `inventory-chat-actions.js`**
  1. Replace the import `import { createInventoryReusableCatalog, reusableCatalogSchema } from './inventory-reusable-catalog.js';` with `import { createInventoryModelService } from './inventory-model-service.js';`.
  2. After the `customField` schema add:

```js
const modelData = z.object({ name, typeName: name.max(100), brandName: name.max(100),
  year: z.number().int().min(1900).max(2100).optional(), description: z.string().max(2000).optional() }).strict();
```
  3. In `itemData`: change `.omit({ categoryId: true, brandId: true, locationId: true, customValues: true })` to `.omit({ categoryId: true, brandId: true, locationId: true, customValues: true, modelId: true })` and delete the line `  itemType: z.string().trim().min(1).max(50).nullable().optional(),`.
  4. In `inventoryActionPlanSchema` replace `...['model', 'type'].map(kind => z.object({ kind: z.literal(kind), data: reusableCatalogSchema }).strict()),` with `z.object({ kind: z.literal('model'), data: modelData }).strict(),`.
  5. In `toolPlanSchema` replace `z.enum(['brand', 'category', 'location', 'model', 'type', 'customField', 'item'])` with `z.enum(['brand', 'category', 'location', 'model', 'customField', 'item'])` and `...reusableCatalogSchema.shape` with `...modelData.shape`.
  6. In the `inventory_prepare_create` description replace `model: name, brandName e itemType obligatorios (valor de tipo base o nombre de tipo del catálogo), year y description opcionales; type: name y description opcional` with `category es el TIPO concreto del equipo (Laptop, Celular...); model: name, typeName y brandName obligatorios, year y description opcionales; item usa categoryName como su tipo`.
  7. In `prepare` delete the line starting `      if (action.kind === 'type' && action.data.name.length > 50)`.
  8. In `catalogs` replace the two `createInventoryReusableCatalog(...)` list calls with a single `createInventoryModelService({ prisma }).list({ companyId: scope.companyId, search })` (destructure as `models`), and change the return to:

```js
    return { brands, categories, locations, fields, limitPerCatalog: 50,
      models: models.slice(0, 50).map(m => ({ id: m.id, name: m.name, typeName: m.typeName, brandName: m.brandName, year: m.year })) };
```
  9. In `execute`: replace `const reusable = createInventoryReusableCatalog({ prisma: db });` with `const modelService = createInventoryModelService({ prisma: db });`; change `priority` to `{ brand: 0, category: 1, location: 2, model: 3, customField: 4, item: 5 }`; replace the `else if (kind === 'model' || kind === 'type') { … }` branch with:

```js
      } else if (kind === 'model') {
        row = await modelService.create(data, scope.companyId, { reuse: true });
        reused = Boolean(row.reused);
```
  and delete the line `        await reusable.assertType(scope.companyId, data.itemType);`.

- [ ] **Step 7: Run the inventory API test suites and boot check**

Run: `node --test apps/api/src/services/__tests__/inventory-chat-actions.test.js apps/api/src/services/__tests__/inventory-intake-service.test.js apps/api/src/services/__tests__/inventory-assistant-service.test.js apps/api/src/services/__tests__/inventory-service.test.js apps/api/src/services/__tests__/inventory-model-service.test.js apps/api/src/services/__tests__/inventory-catalog-service.test.js apps/api/src/routes/inventory/__tests__/router.test.js`
Expected: all pass. A test that builds a `type` action or sends `itemType` must be updated to the new contract (`category` action / no `itemType`).

Run: `grep -rn "inventory-reusable-catalog\|itemType" apps/api/src --include=*.js | grep -v __tests__`
Expected: no `inventory-reusable-catalog` imports; `itemType` only inside `inventory-service.js` `toFlatSnapshot`/`getItem` reads (legacy column) if any.

- [ ] **Step 8: Commit (Tasks 5 + 6)**

```bash
git add apps/api/src
git commit -m "feat(inventory): InvModel routes, item modelId defaults; AI and intake use types instead of itemType

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Catalog import service

**Files:**
- Create: `apps/api/src/services/inventory-catalog-import-service.js`, `apps/api/src/services/__tests__/inventory-catalog-import-service.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseCatalogFile, createInventoryCatalogImportService } from '../inventory-catalog-import-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';

function prismaWith({ categories = [], brands = [], locations = [], models = [] } = {}) {
  const created = [];
  const table = (rows, name) => ({
    findMany: async () => rows,
    create: async ({ data }) => { const row = { id: `${name}-${created.length + 1}`, ...data }; created.push({ table: name, data }); rows.push(row); return row; },
  });
  const prisma = {
    created,
    invCategory: table(categories, 'invCategory'),
    invBrand: table(brands, 'invBrand'),
    invLocation: table(locations, 'invLocation'),
    invModel: table(models, 'invModel'),
  };
  prisma.$transaction = async (fn) => fn(prisma);
  return prisma;
}

test('parseCatalogFile reads CSV with accented headers and XLSX', async () => {
  const csv = Buffer.from('Nombre,Descripción,Año\nXPS 15,Laptop,2023\n');
  assert.deepEqual(await parseCatalogFile(csv, 'modelos.csv'), [{ nombre: 'XPS 15', descripcion: 'Laptop', anio: '2023' }]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Marcas');
  sheet.addRow(['nombre', 'sitio_web']);
  sheet.addRow(['Dell', 'https://dell.example.com']);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.deepEqual(await parseCatalogFile(xlsx, 'marcas.xlsx'), [{ nombre: 'Dell', sitio_web: 'https://dell.example.com' }]);

  await assert.rejects(parseCatalogFile(Buffer.from('x'), 'data.pdf'), /CSV o Excel/);
});

test('preview marks new, existing, repeated and invalid rows', async () => {
  const service = createInventoryCatalogImportService({ prisma: prismaWith({ brands: [{ id: 'b1', name: 'Dell' }] }) });
  const result = await service.preview('brands', [{ nombre: 'dell' }, { nombre: 'HP' }, { nombre: 'hp' }, { nombre: '' }], COMPANY);
  assert.deepEqual(result.rows.map((r) => r.status), ['exists', 'new', 'error', 'error']);
  assert.match(result.rows[2].message, /Repetido/);
  assert.deepEqual(result.counts, { new: 1, exists: 1, error: 2 });
});

test('models report missing types and brands and only create them when asked', async () => {
  const records = [{ nombre: 'XPS 15', tipo: 'Laptop', marca: 'Dell', anio: '2023' }, { nombre: 'Pixel', tipo: 'Celular', marca: 'Google', anio: '20x' }];
  const prisma = prismaWith({ categories: [{ id: 't1', name: 'Laptop' }] });
  const service = createInventoryCatalogImportService({ prisma });

  const preview = await service.preview('models', records, COMPANY);
  assert.deepEqual(preview.missing, { types: ['Celular'], brands: ['Dell', 'Google'] });
  assert.equal(preview.rows[0].status, 'error');
  assert.equal(preview.rows[0].missingOnly, true);
  assert.equal(preview.rows[1].missingOnly, false); // bad year too

  const withMissing = await service.preview('models', records, COMPANY, { createMissing: true });
  assert.deepEqual(withMissing.rows.map((r) => r.status), ['new', 'error']);

  const result = await service.commit('models', records, COMPANY, { createMissing: true });
  assert.deepEqual(result, { created: 1, skipped: 0, failed: 1 });
  assert.deepEqual(prisma.created.map((c) => c.table), ['invBrand', 'invModel']);
  assert.equal(prisma.created[1].data.year, 2023);
  assert.equal(prisma.created[1].data.nameKey, 'xps 15');
});

test('types resolve parents declared earlier in the same file', async () => {
  const prisma = prismaWith();
  const service = createInventoryCatalogImportService({ prisma });
  const result = await service.commit('types', [{ nombre: 'Cómputo' }, { nombre: 'Laptop gamer', tipo_padre: 'cómputo', icono: 'Laptop', color: '#112233' }], COMPANY);
  assert.deepEqual(result, { created: 2, skipped: 0, failed: 0 });
  assert.equal(prisma.created[1].data.parentId, 'invCategory-1');
});

test('rejects files above the row limit', async () => {
  const service = createInventoryCatalogImportService({ prisma: prismaWith() });
  await assert.rejects(service.preview('brands', Array.from({ length: 2001 }, (_, i) => ({ nombre: `M${i}` })), COMPANY), /2,000/);
});

test('template lists the catalog columns', async () => {
  const service = createInventoryCatalogImportService({ prisma: prismaWith() });
  const csv = await service.template('models', 'csv');
  assert.equal(csv.buffer.toString('utf8').split('\n')[0], 'nombre,tipo,marca,anio,descripcion');
  assert.equal(csv.contentType, 'text/csv; charset=utf-8');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test apps/api/src/services/__tests__/inventory-catalog-import-service.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `inventory-catalog-import-service.js`**

```js
// inventory-catalog-import-service.js — fixed-column CSV/XLSX import for the
// inventory catalogs (types, brands, models, locations). Existing rows are
// skipped, never updated. Large imports with column mapping are out of scope.
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { InventoryServiceError, assertCompany } from './inventory-guards.js';

export const MAX_IMPORT_ROWS = 2000;
export const IMPORT_COLUMNS = {
  types: ['nombre', 'descripcion', 'tipo_padre', 'icono', 'color'],
  brands: ['nombre', 'descripcion', 'sitio_web'],
  models: ['nombre', 'tipo', 'marca', 'anio', 'descripcion'],
  locations: ['nombre', 'descripcion', 'direccion'],
};
const TABLE = { types: 'invCategory', brands: 'invBrand', models: 'invModel', locations: 'invLocation' };

const key = (value) => String(value ?? '').trim().toLocaleLowerCase('es');
const clean = (value) => String(value ?? '').trim();
// "Descripción" -> "descripcion", "Año" -> "ano" (accepted as anio).
function normalizeHeader(header) {
  const h = clean(header).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_');
  return h === 'ano' ? 'anio' : h;
}
function normalizeRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([header, value]) => [normalizeHeader(header), clean(value)]).filter(([header]) => header));
}

export async function parseCatalogFile(buffer, filename) {
  const lower = String(filename ?? '').toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseCsv(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true }).map(normalizeRecord);
  }
  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const headers = [];
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) { row.eachCell((cell, col) => { headers[col - 1] = cell.text; }); return; }
      const record = {};
      row.eachCell((cell, col) => { if (headers[col - 1]) record[headers[col - 1]] = cell.text; });
      rows.push(normalizeRecord(record));
    });
    return rows;
  }
  throw new InventoryServiceError('Formato no soportado. Usa un archivo CSV o Excel (.xlsx).', 400);
}

export function createInventoryCatalogImportService({ prisma }) {
  async function loadContext(db, companyId) {
    const [types, brands, locations, models] = await Promise.all([
      db.invCategory.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invBrand.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invLocation.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invModel.findMany({ where: { companyId, enabled: true }, select: { id: true, brandId: true, nameKey: true, year: true } }),
    ]);
    const byName = (rows) => new Map(rows.map((row) => [key(row.name), row.id]));
    return { types: byName(types), brands: byName(brands), locations: byName(locations), models };
  }

  // Returns { status, data, message, missing } for one record. `ctx` is mutated
  // with the names this file will create so later rows can reference them.
  function analyze(catalog, record, ctx, seen, { createMissing }) {
    const name = clean(record.nombre);
    const errors = [];
    const missing = {};
    const maxName = catalog === 'models' ? 255 : 100;
    if (!name) errors.push('El nombre es obligatorio.');
    else if (name.length > maxName) errors.push(`El nombre admite hasta ${maxName} caracteres.`);
    const data = { ...record, nombre: name };

    let dedupeKey = key(name);
    if (catalog === 'types') {
      if (record.color && !/^#[0-9a-f]{6}$/i.test(record.color)) errors.push('El color debe ser #RRGGBB.');
      if (record.icono && record.icono.length > 50) errors.push('El ícono admite hasta 50 caracteres.');
      if (record.tipo_padre && !ctx.types.has(key(record.tipo_padre))) errors.push(`El tipo padre «${record.tipo_padre}» no existe.`);
    }
    if (catalog === 'models') {
      if (!clean(record.tipo)) errors.push('El tipo es obligatorio.');
      else if (!ctx.types.has(key(record.tipo))) missing.type = clean(record.tipo);
      if (!clean(record.marca)) errors.push('La marca es obligatoria.');
      else if (!ctx.brands.has(key(record.marca))) missing.brand = clean(record.marca);
      if (record.anio && !(/^\d{4}$/.test(record.anio) && Number(record.anio) >= 1900 && Number(record.anio) <= 2100)) errors.push('El año debe estar entre 1900 y 2100.');
      dedupeKey = `${key(record.marca)}|${key(name)}|${record.anio || ''}`;
    }

    if (errors.length === 0 && seen.has(dedupeKey)) errors.push(`Repetido en el archivo (fila ${seen.get(dedupeKey)}).`);
    const missingList = [missing.type && `el tipo «${missing.type}»`, missing.brand && `la marca «${missing.brand}»`].filter(Boolean);
    if (errors.length) return { status: 'error', data, message: [...errors, ...missingList.map((m) => `Falta ${m}.`)].join(' '), missing, missingOnly: false };

    let exists = false;
    if (catalog === 'models') {
      const brandId = ctx.brands.get(key(record.marca));
      const year = record.anio ? Number(record.anio) : null;
      exists = Boolean(brandId) && ctx.models.some((m) => m.brandId === brandId && m.nameKey === key(name) && (m.year ?? null) === year);
    } else {
      exists = ctx[catalog].has(key(name));
    }
    if (exists) return { status: 'exists', data, message: 'Ya existe; se omite.', missing, missingOnly: false };
    if (missingList.length && !createMissing) {
      return { status: 'error', data, message: `Falta ${missingList.join(' y ')}. Activa «Crear lo que falta» para crearlo.`, missing, missingOnly: true };
    }
    return { status: 'new', data, message: missingList.length ? `Se creará ${missingList.join(' y ')}.` : '', missing, missingOnly: false };
  }

  function assertInput(catalog, records) {
    if (!IMPORT_COLUMNS[catalog]) throw new InventoryServiceError('Catálogo no válido para importar.', 400);
    if (!Array.isArray(records)) throw new InventoryServiceError('No se recibieron filas.', 400);
    if (records.length > MAX_IMPORT_ROWS) throw new InventoryServiceError('El archivo supera el límite de 2,000 filas.', 400);
  }

  function run(catalog, records, ctx, options) {
    const seen = new Map();
    // A "new" type created by this file can be a later row's parent.
    const plannedTypes = new Set();
    return records.map((raw, index) => {
      const record = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, clean(v)]));
      if (catalog === 'types' && record.tipo_padre && plannedTypes.has(key(record.tipo_padre))) ctx.types.set(key(record.tipo_padre), ctx.types.get(key(record.tipo_padre)) ?? '__planned__');
      const result = analyze(catalog, record, ctx, seen, options);
      const line = index + 2; // header is row 1
      if (result.status !== 'error') seen.set(catalog === 'models' ? `${key(record.marca)}|${key(record.nombre)}|${record.anio || ''}` : key(record.nombre), line);
      if (catalog === 'types' && result.status === 'new') plannedTypes.add(key(record.nombre));
      return { line, ...result };
    });
  }

  async function preview(catalog, records, companyId, { createMissing = false } = {}) {
    assertCompany(companyId);
    assertInput(catalog, records);
    const ctx = await loadContext(prisma, companyId);
    const rows = run(catalog, records, ctx, { createMissing });
    const counts = { new: 0, exists: 0, error: 0 };
    for (const row of rows) counts[row.status] += 1;
    const unique = (values) => [...new Map(values.filter(Boolean).map((v) => [key(v), v])).values()];
    return {
      rows,
      counts,
      missing: { types: unique(rows.map((r) => r.missing?.type)), brands: unique(rows.map((r) => r.missing?.brand)) },
    };
  }

  async function commit(catalog, records, companyId, { createMissing = false } = {}) {
    assertCompany(companyId);
    assertInput(catalog, records);
    return prisma.$transaction(async (tx) => {
      const ctx = await loadContext(tx, companyId);
      const rows = run(catalog, records, ctx, { createMissing });
      let created = 0;
      const ensure = async (map, table, name) => {
        const existing = map.get(key(name));
        if (existing && existing !== '__planned__') return existing;
        const row = await tx[table].create({ data: { companyId, name } });
        map.set(key(name), row.id);
        return row.id;
      };
      for (const row of rows) {
        if (row.status !== 'new') continue;
        const d = row.data;
        if (catalog === 'types') {
          const created_ = await tx.invCategory.create({ data: {
            companyId, name: d.nombre, description: d.descripcion || null, icon: d.icono || null, color: d.color || null,
            parentId: d.tipo_padre ? ctx.types.get(key(d.tipo_padre)) : null,
          } });
          ctx.types.set(key(d.nombre), created_.id);
        } else if (catalog === 'brands') {
          await tx.invBrand.create({ data: { companyId, name: d.nombre, description: d.descripcion || null, website: d.sitio_web || null } });
        } else if (catalog === 'locations') {
          await tx.invLocation.create({ data: { companyId, name: d.nombre, description: d.descripcion || null, address: d.direccion || null } });
        } else {
          const typeId = await ensure(ctx.types, 'invCategory', d.tipo);
          const brandId = await ensure(ctx.brands, 'invBrand', d.marca);
          await tx.invModel.create({ data: {
            companyId, name: d.nombre, nameKey: key(d.nombre), typeId, brandId,
            year: d.anio ? Number(d.anio) : null, description: d.descripcion || null,
          } });
        }
        created += 1;
      }
      return {
        created,
        skipped: rows.filter((r) => r.status === 'exists').length,
        failed: rows.filter((r) => r.status === 'error').length,
      };
    });
  }

  async function template(catalog, format) {
    const columns = IMPORT_COLUMNS[catalog];
    if (!columns) throw new InventoryServiceError('Catálogo no válido para importar.', 400);
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Plantilla');
      sheet.addRow(columns).font = { bold: true };
      columns.forEach((_, i) => { sheet.getColumn(i + 1).width = 24; });
      return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `plantilla-${catalog}.xlsx` };
    }
    return { buffer: Buffer.from(`${columns.join(',')}\n`, 'utf8'), contentType: 'text/csv; charset=utf-8', filename: `plantilla-${catalog}.csv` };
  }

  return { preview, commit, template, TABLE };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test apps/api/src/services/__tests__/inventory-catalog-import-service.test.js`
Expected: 6 pass. Note the models test: row 1 (`Dell`/`Laptop`) with `createMissing` creates the brand `Dell` then the model; row 2 fails on the year, so `Google`/`Celular` are **not** created (they are only created by rows that import). If the test's `created` table order differs, fix the service so missing refs are created lazily per imported row (as written), not up front.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inventory-catalog-import-service.js apps/api/src/services/__tests__/inventory-catalog-import-service.test.js
git commit -m "feat(inventory): fixed-column CSV/XLSX import service for catalogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Import routes

**Files:** Create `apps/api/src/routes/inventory/import-routes.js`; modify `apps/api/src/routes/inventory/index.js`

- [ ] **Step 1: Create `import-routes.js`**

```js
// runly.inventory catalog import: template download, preview and commit.
import { Hono } from 'hono';
import { createInventoryCatalogImportService, parseCatalogFile } from '../../services/inventory-catalog-import-service.js';

const MAX_BYTES = 5 * 1024 * 1024;

export function createInventoryImportRouter({ prisma, requirePermission, InventoryServiceError }) {
  const router = new Hono();
  const imports = createInventoryCatalogImportService({ prisma });
  const fail = (c, err, fallback) => err instanceof InventoryServiceError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: fallback }, 500);
  const guard = requirePermission('inventory.catalog.manage');

  router.get('/inventory/import/:catalog/template', guard, async (c) => {
    try {
      const file = await imports.template(c.req.param('catalog'), c.req.query('format') === 'xlsx' ? 'xlsx' : 'csv');
      return c.body(file.buffer, 200, { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"` });
    } catch (err) { return fail(c, err, 'No se pudo generar la plantilla.'); }
  });

  router.post('/inventory/import/:catalog/preview', guard, async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return c.json({ error: 'Adjunta un archivo CSV o Excel.' }, 400);
      if (file.size > MAX_BYTES) return c.json({ error: 'El archivo supera 5 MB.' }, 400);
      const records = await parseCatalogFile(Buffer.from(await file.arrayBuffer()), file.name);
      const createMissing = form.get('createMissing') === 'true';
      return c.json({ data: await imports.preview(c.req.param('catalog'), records, c.get('companyId'), { createMissing }) });
    } catch (err) { return fail(c, err, 'No se pudo leer el archivo.'); }
  });

  router.post('/inventory/import/:catalog/commit', guard, async (c) => {
    try {
      const { rows, createMissing } = await c.req.json();
      return c.json({ data: await imports.commit(c.req.param('catalog'), rows, c.get('companyId'), { createMissing: createMissing === true }) });
    } catch (err) { return fail(c, err, 'No se pudo importar.'); }
  });

  return router;
}
```

- [ ] **Step 2: Mount it** — in `routes/inventory/index.js` add `import { createInventoryImportRouter } from './import-routes.js';` next to the models router import, and right after the `router.route('/', createInventoryModelsRouter(...))` line add:

```js
  router.route('/', createInventoryImportRouter({ prisma, requirePermission, InventoryServiceError }));
```

- [ ] **Step 3: Boot the API and smoke test** (dev servers use the configured `.env`; never print it)

Run in one terminal: `pnpm dev:api`
Then, with a session token exported locally as `RUNLY_TOKEN` and a company id as `RUNLY_COMPANY` (do not paste values into chat or files):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $RUNLY_TOKEN" -H "X-Runly-Company-Id: $RUNLY_COMPANY" "http://localhost:4010/inventory/import/models/template?format=csv"
curl -s -H "Authorization: Bearer $RUNLY_TOKEN" -H "X-Runly-Company-Id: $RUNLY_COMPANY" "http://localhost:4010/inventory/models" | head -c 300
curl -s -H "Authorization: Bearer $RUNLY_TOKEN" -H "X-Runly-Company-Id: $RUNLY_COMPANY" "http://localhost:4010/inventory/categories" | head -c 300
```
Expected: `200`; `{"data":[...]}` with `typeName`/`brandName`; categories with `itemCount`. Without a token, each returns 401 — that still proves the routes are mounted. If no token is available, ask the user to run these three commands.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/inventory
git commit -m "feat(inventory): catalog import routes (template, preview, commit)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Desktop hooks and pickers

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/hooks/useInventoryModels.js`
- Modify: `hooks/useInventoryCatalogs.js`, `components/InventoryCatalogPickers.jsx`
- Delete: `hooks/useInventoryReusableCatalogs.js`

- [ ] **Step 1: Create `useInventoryModels.js`**

```js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'

// InvModel catalog. Keys live under ['inventory', ...] so a create anywhere
// (item form, model dialog, Catalogs, import) refreshes every screen.
function useInventoryApi() {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  return {
    companyId: activeCompanyId,
    enabled: Boolean(token && activeCompanyId),
    call: (path, { body, method } = {}) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path, body, method }),
  }
}

function useInvalidateCatalogs() {
  const qc = useQueryClient()
  return () => Promise.all(['models', 'categories', 'brands'].map((key) => qc.invalidateQueries({ queryKey: ['inventory', key] })))
}

export function useInventoryModels() {
  const { companyId, enabled, call } = useInventoryApi()
  return useQuery({ queryKey: ['inventory', 'models', companyId], queryFn: () => call('/inventory/models'), enabled, staleTime: 60 * 1000 })
}

export function useSaveInventoryModel() {
  const { call } = useInventoryApi()
  const invalidate = useInvalidateCatalogs()
  return useMutation({
    mutationFn: ({ id, ...data }) => (id ? call(`/inventory/models/${id}`, { body: data, method: 'PUT' }) : call('/inventory/models', { body: data })),
    onSuccess: invalidate,
  })
}

export function useDeleteInventoryModel() {
  const { call } = useInventoryApi()
  const invalidate = useInvalidateCatalogs()
  return useMutation({ mutationFn: (id) => call(`/inventory/models/${id}`, { method: 'DELETE' }), onSuccess: invalidate })
}

// "XPS 15 · Dell · 2023 · Laptop"
export function modelLabel(row) {
  return [row?.name, row?.brandName, row?.year, row?.typeName].filter(Boolean).join(' · ')
}
```

- [ ] **Step 2: Custom fields query key** — in `hooks/useInventoryCatalogs.js`, in `useInventoryCustomFields`, change `queryKey: ['inventory', 'custom-fields', categoryId ?? 'all'],` to `queryKey: ['inventory', 'custom-fields', categoryId ?? 'global'],`. Also add model counts to brand/type invalidation: in `useCreateInventoryBrand`, `useUpdateInventoryBrand`, `useDeleteInventoryBrand` and the three category mutations, after the existing `qc.invalidateQueries({ queryKey: ['inventory', '<brands|categories>'] })` add `qc.invalidateQueries({ queryKey: ['inventory', 'models'] })` (model rows embed brand/type names).

- [ ] **Step 3: Rewrite `components/InventoryCatalogPickers.jsx`**

```jsx
import { CreatableComboboxField } from '@runly/ui'
import { toast } from 'sonner'
import {
  useInventoryBrands, useCreateInventoryBrand, useInventoryCategories, useCreateInventoryCategory,
} from '../hooks/useInventoryCatalogs.js'

const rowsOf = (data) => (data?.data ?? data ?? []).filter((row) => row.enabled !== false)

export function useBrandRows() {
  return rowsOf(useInventoryBrands().data)
}

export function useTypeRows() {
  return rowsOf(useInventoryCategories().data)
}

// Subtypes read "Laptop › Gamer" so the hierarchy is visible in a flat list.
export function typeOptions(types) {
  const byId = new Map(types.map((type) => [type.id, type]))
  return types.map((type) => ({
    value: type.id,
    label: type.parentId && byId.has(type.parentId) ? `${byId.get(type.parentId).name} › ${type.name}` : type.name,
  }))
}

export function InventoryTypePicker({ value, onChange, error, required, label = 'Tipo' }) {
  const types = useTypeRows()
  const createType = useCreateInventoryCategory()
  async function handleCreate(name) {
    try {
      const res = await createType.mutateAsync({ name })
      const row = res?.data ?? res
      if (row?.id) onChange(row.id)
      toast.success(`Tipo «${name}» creado`)
    } catch (err) { toast.error(err?.message || 'No se pudo crear el tipo.') }
  }
  return (
    <CreatableComboboxField label={label} required={required} error={error} value={value ?? ''} options={typeOptions(types)}
      onChange={onChange} onCreate={handleCreate} isCreating={createType.isPending}
      placeholder="Buscar o crear..." searchPlaceholder="Buscar tipo..." />
  )
}

export function InventoryBrandPicker({ value, onChange, error, required, label = 'Marca' }) {
  const brands = useBrandRows()
  const createBrand = useCreateInventoryBrand()
  async function handleCreate(name) {
    try {
      const res = await createBrand.mutateAsync({ name })
      const row = res?.data ?? res
      if (row?.id) onChange(row.id)
      toast.success(`Marca «${name}» creada`)
    } catch (err) { toast.error(err?.message || 'No se pudo crear la marca.') }
  }
  return (
    <CreatableComboboxField label={label} required={required} error={error} value={value ?? ''}
      options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
      onChange={onChange} onCreate={handleCreate} isCreating={createBrand.isPending}
      placeholder="Buscar o crear..." searchPlaceholder="Buscar marca..." />
  )
}
```

- [ ] **Step 4: Delete the JSON-catalog hook**

```bash
git rm apps/desktop/src/modules/runly.inventory/hooks/useInventoryReusableCatalogs.js
```

(The build stays broken until Task 10 updates its importers; commit Tasks 9 and 10 together.)

---

### Task 10: Item form, model dialog and labels

**Files:** Modify `components/InventoryModelDialog.jsx`, `components/InventoryItemClassification.jsx`, `blueprints/inventory-item-form.blueprint.js`, `blueprints/inventory-item-detail.blueprint.js`, `lib/activity-field-labels.js`, `lib/inventory-constants.js`, `components/InventorySmartForm.jsx`, `components/InventoryActionProposal.jsx`, `components/InventoryGroupedView.jsx`, `screens/InventoryScreen.jsx` (all under `apps/desktop/src/modules/runly.inventory/`)

- [ ] **Step 1: Rewrite `InventoryModelDialog.jsx`** (create and edit)

```jsx
import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextField, TextareaField } from '@runly/ui'
import { toast } from 'sonner'
import { useSaveInventoryModel } from '../hooks/useInventoryModels.js'
import { InventoryBrandPicker, InventoryTypePicker } from './InventoryCatalogPickers.jsx'

const EMPTY = { name: '', typeId: '', brandId: '', year: '', description: '' }

// Creates or edits a catalog model. No <form>: it can open inside RunlyForm,
// and a portaled submit would bubble to that form through the React tree.
export function InventoryModelDialog({ open, onOpenChange, model = null, initialValues, onSaved }) {
  const save = useSaveInventoryModel()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setValues(model
      ? { name: model.name, typeId: model.typeId, brandId: model.brandId, year: model.year ? String(model.year) : '', description: model.description ?? '' }
      : { ...EMPTY, ...initialValues })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => { setValues((prev) => ({ ...prev, [key]: value })); setErrors((prev) => ({ ...prev, [key]: '' })) }

  async function handleSave() {
    const year = values.year === '' ? null : Number(values.year)
    const next = {}
    if (!values.name.trim()) next.name = 'Indica el nombre del modelo'
    if (!values.typeId) next.typeId = 'Selecciona o crea el tipo'
    if (!values.brandId) next.brandId = 'Selecciona o crea la marca'
    if (year !== null && !(Number.isInteger(year) && year >= 1900 && year <= 2100)) next.year = 'Año entre 1900 y 2100'
    setErrors(next)
    if (Object.keys(next).length) return
    try {
      const row = await save.mutateAsync({
        ...(model ? { id: model.id } : {}),
        name: values.name.trim(), typeId: values.typeId, brandId: values.brandId, year,
        description: values.description.trim() || null,
      })
      toast.success(model ? 'Modelo actualizado' : 'Modelo creado')
      onSaved?.(row)
      onOpenChange(false)
    } catch (err) { toast.error(err.message) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader>
          <DialogTitle>{model ? 'Editar modelo' : 'Nuevo modelo'}</DialogTitle>
          <DialogDescription>Un modelo se define por su tipo, marca, nombre y, opcionalmente, año.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <InventoryTypePicker required value={values.typeId} onChange={(v) => set('typeId', v)} error={errors.typeId} />
            <InventoryBrandPicker required value={values.brandId} onChange={(v) => set('brandId', v)} error={errors.brandId} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField label="Nombre del modelo" required value={values.name} maxLength={255} hint="XPS 15"
              onChange={(e) => set('name', e.target.value)} error={errors.name} />
            <TextField label="Año" type="number" min={1900} max={2100} value={values.year}
              onChange={(e) => set('year', e.target.value)} error={errors.year} />
          </div>
          <TextareaField label="Descripción" value={values.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={save.isPending} onClick={handleSave}>
            {save.isPending ? 'Guardando...' : model ? 'Guardar cambios' : 'Crear modelo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Rewrite `InventoryItemClassification.jsx`** (id-based)

```jsx
import { useMemo, useState } from 'react'
import { CreatableComboboxField } from '@runly/ui'
import { useInventoryModels, modelLabel } from '../hooks/useInventoryModels.js'
import { InventoryBrandPicker, InventoryTypePicker } from './InventoryCatalogPickers.jsx'
import { InventoryModelDialog } from './InventoryModelDialog.jsx'

const LEGACY = '__legacy__'
const NONE = '__none__'

// RunlyForm "component" section: model, type (categoryId) and brand. Picking a
// catalog model fills Tipo and Marca; "+ Crear «X»" opens the model dialog,
// which can itself create types and brands.
export function InventoryItemClassification({ value, onChange, errors = {}, disabled }) {
  const { data: models = [] } = useInventoryModels()
  const [dialog, setDialog] = useState(null)

  const selected = value.modelId || (value.model ? LEGACY : '')
  const options = useMemo(() => {
    const rows = models.map((row) => ({ value: row.id, label: modelLabel(row), keywords: row.description ?? '' }))
    if (!value.modelId && value.model) rows.unshift({ value: LEGACY, label: `${value.model} (sin catálogo)` })
    if (value.modelId || value.model) rows.unshift({ value: NONE, label: 'Sin modelo' })
    return rows
  }, [models, value.modelId, value.model])

  function applyModel(row) {
    onChange({ modelId: row.id, model: row.name, categoryId: row.typeId, brandId: row.brandId })
  }

  function handleSelect(id) {
    if (id === NONE) return onChange({ modelId: null, model: '' })
    const row = models.find((model) => model.id === id)
    if (row) applyModel(row)
  }

  return (
    <fieldset disabled={disabled} className="grid gap-4 lg:grid-cols-2">
      <div className="col-span-full">
        <CreatableComboboxField
          label="Modelo"
          value={selected}
          options={options}
          error={errors.modelId || errors.model}
          hint="Busca por nombre, marca, tipo o año. Al elegir un modelo se completan tipo y marca."
          onChange={handleSelect}
          onCreate={(name) => setDialog({ name, typeId: value.categoryId ?? '', brandId: value.brandId ?? '' })}
          placeholder="Buscar o crear..."
          searchPlaceholder="Ej. Dell XPS 2023"
        />
      </div>
      <InventoryTypePicker value={value.categoryId} onChange={(categoryId) => onChange({ categoryId })} error={errors.categoryId} />
      <InventoryBrandPicker value={value.brandId} onChange={(brandId) => onChange({ brandId })} error={errors.brandId} />
      <InventoryModelDialog
        open={Boolean(dialog)}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        initialValues={dialog ?? undefined}
        onSaved={applyModel}
      />
    </fieldset>
  )
}

export const inventoryFormComponents = {
  resolve: (key) => (key === 'inventory.item-classification' ? InventoryItemClassification : null),
}
```

- [ ] **Step 3: Form blueprint** (`blueprints/inventory-item-form.blueprint.js`)
  - Delete the lines `import { ITEM_STATUSES, ITEM_TYPES } from '../lib/inventory-constants.js'` → replace with `import { ITEM_STATUSES } from '../lib/inventory-constants.js'`, and delete `const ITEM_TYPE_OPTIONS = ...`.
  - In `preview.rows` delete `{ field: 'itemType', label: 'Tipo' },`.
  - In the "Identificación" section delete the whole `categoryId` relation field object (the `{ field: 'categoryId', label: 'Categoría', type: 'relation', relation: { … } },` block).
  - Replace the classification section's `fields` with:

```js
        fields: [
          { field: 'modelId', label: 'Modelo', type: 'relation' },
          { field: 'model', label: 'Nombre del modelo', type: 'text' },
          { field: 'categoryId', label: 'Tipo', type: 'relation' },
          { field: 'brandId', label: 'Marca', type: 'relation' },
        ],
```
  - `customFields.categoryField` stays `'categoryId'`.

- [ ] **Step 4: Detail blueprint** (`blueprints/inventory-item-detail.blueprint.js`) — change `subtitleFields: ['itemType', 'model'],` to `subtitleFields: ['categoryName', 'model'],`; delete the line `{ field: 'itemType', label: 'Tipo', icon: 'Layers', type: 'select', options: ITEM_TYPE_OPTIONS },`; change both `{ field: 'categoryName', label: 'Categoría', icon: 'Layers' }` to `label: 'Tipo'`. Remove the now-unused `ITEM_TYPE_OPTIONS` constant and its `ITEM_TYPES` import if nothing else in the file uses them.

- [ ] **Step 5: Labels**
  - `lib/activity-field-labels.js`: `categoryName: { label: 'Categoría', type: 'text' },` → `categoryName: { label: 'Tipo', type: 'text' },` and `itemType: { label: 'Tipo', …` → `itemType: { label: 'Tipo (anterior)', …` (kept so old activity entries still render).
  - `lib/inventory-constants.js`: `{ value: 'category',  label: 'Categoria' },` → `{ value: 'category',  label: 'Tipo' },`.
  - `components/InventoryGroupedView.jsx`: `{ field: 'categoryName',   label: 'Categoria' },` → `label: 'Tipo'`; `<SelectValue placeholder="Categoria" />` → `<SelectValue placeholder="Tipo" />`.
  - `screens/InventoryScreen.jsx`: `{ field: 'categoryName',   label: 'Categoria',   sortable: false },` → `label: 'Tipo'`; `{ key: 'categoryId', label: 'Categoria', type: 'select', options: categoryOptions },` → `label: 'Tipo'`.
  - `components/InventorySmartForm.jsx`: in `LABELS` remove `itemType: 'Tipo', ` and change `categoryName: 'Categoría'` → `categoryName: 'Tipo'`; change `for (const field of ['name', 'itemType', 'model', 'partNumber'])` → `for (const field of ['name', 'model', 'partNumber'])`; in the summary map change `categoryId: 'Categoría'` → `categoryId: 'Tipo'`.
  - `components/InventoryActionProposal.jsx`: in `KIND_ICONS` remove `type: Layers, ` (and the `Layers` import if unused); in `KINDS` change `category: 'Categoría'` → `category: 'Tipo'` and remove `type: 'Tipo', `; in `LABELS` replace `itemType: 'Tipo', ` with `typeName: 'Tipo', year: 'Año', ` and `categoryName: 'Categoría'` → `categoryName: 'Tipo'`.

- [ ] **Step 6: Find leftovers**

Run: `grep -rn "useInventoryReusableCatalogs\|InventoryReusableCatalog\|itemType\|Categor" apps/desktop/src/modules/runly.inventory --include=*.js --include=*.jsx | grep -v __tests__`
Expected: only `activity-field-labels.js` (`itemType` legacy label), `inventory-constants.js` (`ITEM_TYPES` definition), and `InventoryCatalogsScreen.jsx` (rewritten in Task 11). Fix anything else.

- [ ] **Step 7: Lint**

Run: `pnpm exec eslint apps/desktop/src/modules/runly.inventory`
Expected: no errors (the catalogs screen still imports `InventoryReusableCatalog` until Task 11 — if lint/build fails only there, continue to Task 11 before building).

---

### Task 11: Catalogs screen redesign

**Files:** Create under `apps/desktop/src/modules/runly.inventory/components/catalogs/`: `catalog-config.js`, `CatalogNav.jsx`, `CatalogPanel.jsx`, `CatalogListRow.jsx`, `CatalogRowActions.jsx`, `CatalogEditSheet.jsx`, `TypesPanel.jsx`, `BrandsPanel.jsx`, `ModelsPanel.jsx`, `LocationsPanel.jsx`, `CustomFieldsPanel.jsx`. Rewrite `screens/InventoryCatalogsScreen.jsx`. Delete `components/InventoryReusableCatalog.jsx`.

- [ ] **Step 1: `catalog-config.js`**

```js
import { Boxes, MapPin, Shapes, SlidersHorizontal, Tag } from 'lucide-react'

export const CATALOGS = [
  { key: 'types', label: 'Tipos', icon: Shapes, description: 'Qué es cada activo. Define su ícono, color y los campos personalizados que pide.' },
  { key: 'brands', label: 'Marcas', icon: Tag, description: 'Fabricantes de tus activos y modelos.' },
  { key: 'models', label: 'Modelos', icon: Boxes, description: 'Tipo, marca, nombre y año. Al elegir un modelo en un activo se completan tipo y marca.' },
  { key: 'locations', label: 'Ubicaciones', icon: MapPin, description: 'Dónde se encuentran tus activos.' },
  { key: 'custom-fields', label: 'Campos personalizados', icon: SlidersHorizontal, description: 'Datos extra que pide cada tipo de activo (por ejemplo RAM o placas).' },
]

// Old links (?tab=categories) keep working.
const LEGACY = { categories: 'types' }

export function resolveCatalogKey(requested) {
  const key = LEGACY[requested] ?? requested
  return CATALOGS.some((catalog) => catalog.key === key) ? key : 'types'
}

export const catalogByKey = (key) => CATALOGS.find((catalog) => catalog.key === key)
```

- [ ] **Step 2: `CatalogNav.jsx`**

```jsx
import { SelectField, cn } from '@runly/ui'
import { CATALOGS } from './catalog-config.js'

// Sticky side list on md+, a select below md.
export function CatalogNav({ active, counts, onSelect }) {
  return (
    <>
      <div className="md:hidden">
        <SelectField label="Catálogo" value={active} onValueChange={onSelect}
          options={CATALOGS.map((c) => ({ value: c.key, label: `${c.label} (${counts[c.key] ?? 0})`, icon: c.icon }))} />
      </div>
      <nav aria-label="Catálogos" className="hidden md:block">
        <ul className="glass-shell-flat sticky top-4 space-y-1 rounded-2xl p-2">
          {CATALOGS.map(({ key, label, icon: Icon }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onSelect(key)}
                aria-current={active === key ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  active === key
                    ? 'bg-[hsl(var(--primary))]/10 font-medium text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active === key && 'text-[hsl(var(--primary))]')} />
                <span className="flex-1 truncate">{label}</span>
                <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs tabular-nums">{counts[key] ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
```

- [ ] **Step 3: `CatalogPanel.jsx`**

```jsx
import { Button } from '@runly/ui'
import { Plus, Upload } from 'lucide-react'
import { catalogByKey } from './catalog-config.js'

export function CatalogPanel({ catalogKey, createLabel, onCreate, onImport, children }) {
  const { label, description, icon: Icon } = catalogByKey(catalogKey)
  return (
    <section className="glass-shell-flat min-w-0 space-y-4 rounded-2xl p-4 md:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">{label}</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onImport ? (
            <Button type="button" variant="outline" size="sm" onClick={onImport}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />Importar
            </Button>
          ) : null}
          {onCreate ? (
            <Button type="button" size="sm" onClick={onCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />{createLabel}
            </Button>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  )
}
```

- [ ] **Step 4: `CatalogRowActions.jsx`**

```jsx
import { useState } from 'react'
import { Button, ConfirmDialog } from '@runly/ui'
import { Pencil, Trash2 } from 'lucide-react'

export function CatalogRowActions({ name, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${name}`} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--destructive))]" aria-label={`Eliminar ${name}`} onClick={() => setConfirming(true)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Eliminar «${name}»`}
        description="El registro se desactiva y deja de ofrecerse en los formularios. Los activos que ya lo usan no cambian."
        confirmLabel="Eliminar"
        onConfirm={async () => { setConfirming(false); await onDelete() }}
      />
    </div>
  )
}
```

- [ ] **Step 5: `CatalogListRow.jsx`** (sortable rows for Tipos and Campos personalizados)

```jsx
import { Badge, cn } from '@runly/ui'
import { GripVertical } from 'lucide-react'
import { CatalogRowActions } from './CatalogRowActions.jsx'

export function CatalogListRow({ icon: Icon, color = '#7c3aed', title, subtitle, badges = [], dragHandleProps, isDragging, onEdit, onDelete }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5', isDragging && 'opacity-50 shadow-lg')}>
      {dragHandleProps ? (
        <button {...dragHandleProps} type="button" aria-label="Arrastrar para reordenar" className="shrink-0 cursor-grab touch-none text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}22`, color }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">{title}</p>
        {subtitle ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p> : null}
      </div>
      <div className="hidden shrink-0 gap-1.5 sm:flex">
        {badges.map((badge) => <Badge key={badge} variant="outline" className="text-xs">{badge}</Badge>)}
      </div>
      <CatalogRowActions name={title} onEdit={onEdit} onDelete={onDelete} />
    </div>
  )
}
```

- [ ] **Step 6: `CatalogEditSheet.jsx`** (fixed header/footer, scrolling body)

```jsx
import { Button, Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@runly/ui'

export function CatalogEditSheet({ open, onOpenChange, title, busy, saveDisabled, onSave, children }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
        <SheetFooter className="shrink-0 border-t border-[hsl(var(--border))] px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button type="button" onClick={onSave} disabled={busy || saveDisabled}>{busy ? 'Guardando...' : 'Guardar'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 7: `TypesPanel.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { EmptyState, IconPickerField, LoadingState, SelectField, SortableList, TextField, TextareaField, resolveLucideIcon, cn } from '@runly/ui'
import { Package, Shapes } from 'lucide-react'
import { toast } from 'sonner'
import {
  useInventoryCategories, useCreateInventoryCategory, useUpdateInventoryCategory, useDeleteInventoryCategory, useReorderInventoryCategories,
} from '../../hooks/useInventoryCatalogs.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogListRow } from './CatalogListRow.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#475569']
const NO_PARENT = '__none__'
const EMPTY = { name: '', description: '', icon: 'Package', color: COLORS[0], parentId: NO_PARENT }

export function TypesPanel({ onImport }) {
  const { data, isLoading } = useInventoryCategories()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const create = useCreateInventoryCategory()
  const update = useUpdateInventoryCategory()
  const remove = useDeleteInventoryCategory()
  const reorder = useReorderInventoryCategories()
  const [order, setOrder] = useState(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  useEffect(() => { setOrder(null) }, [data])

  const byId = new Map(rows.map((row) => [row.id, row]))
  const term = search.trim().toLowerCase()
  const items = order ?? rows
  const visible = term ? items.filter((row) => `${row.name} ${row.description ?? ''}`.toLowerCase().includes(term)) : items

  function open(row) {
    setEditing(row ?? {})
    setForm(row
      ? { name: row.name, description: row.description ?? '', icon: row.icon ?? 'Package', color: row.color ?? COLORS[0], parentId: row.parentId ?? NO_PARENT }
      : EMPTY)
  }

  async function save() {
    const payload = { ...form, name: form.name.trim(), parentId: form.parentId === NO_PARENT ? null : form.parentId }
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...payload }); toast.success('Tipo actualizado') }
      else { await create.mutateAsync(payload); toast.success('Tipo creado') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar el tipo') }
  }

  function handleReorder(next) {
    setOrder(next)
    reorder.mutate(next.map((row, index) => ({ id: row.id, sortOrder: index * 10 })))
  }

  const renderRow = (row, drag = {}) => (
    <CatalogListRow
      icon={resolveLucideIcon(row.icon) ?? Package}
      color={row.color ?? COLORS[0]}
      title={row.name}
      subtitle={row.parentId && byId.has(row.parentId) ? `Subtipo de ${byId.get(row.parentId).name}` : (row.description || 'Sin descripción')}
      badges={[`${row.itemCount ?? 0} activos`, `${row.modelCount ?? 0} modelos`, `${row.customFieldCount ?? 0} campos`]}
      dragHandleProps={drag.dragHandleProps}
      isDragging={drag.isDragging}
      onEdit={() => open(row)}
      onDelete={() => remove.mutateAsync(row.id).then(() => toast.success('Tipo eliminado')).catch((err) => toast.error(err.message))}
    />
  )

  const parentOptions = [{ value: NO_PARENT, label: 'Ninguno (tipo principal)' },
    ...rows.filter((row) => !row.parentId && row.id !== editing?.id).map((row) => ({ value: row.id, label: row.name }))]

  return (
    <CatalogPanel catalogKey="types" createLabel="Nuevo tipo" onCreate={() => open(null)} onImport={onImport}>
      <TextField label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tipo..." />
      {isLoading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState icon={Shapes} title="Sin tipos" description="Crea tu primer tipo de activo o importa una lista." action={{ label: 'Nuevo tipo', onClick: () => open(null) }} />
      ) : term ? (
        <div className="space-y-1.5">{visible.map((row) => <div key={row.id}>{renderRow(row)}</div>)}</div>
      ) : (
        <div className="space-y-1.5">
          <SortableList items={visible} onReorder={handleReorder} renderItem={(row, drag) => renderRow(row, drag)} />
        </div>
      )}
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar tipo' : 'Nuevo tipo'} busy={create.isPending || update.isPending}
        saveDisabled={!form.name.trim()} onSave={save}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Laptop" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <IconPickerField label="Ícono" value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} />
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">Color</p>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((color) => (
              <button key={color} type="button" aria-label={`Color ${color}`} onClick={() => setForm((f) => ({ ...f, color }))}
                className={cn('h-8 w-8 rounded-full border-2 transition-transform', form.color === color ? 'scale-110 border-[hsl(var(--foreground))]' : 'border-transparent')}
                style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
        <SelectField label="Tipo padre" value={form.parentId} onValueChange={(parentId) => setForm((f) => ({ ...f, parentId }))} options={parentOptions} />
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
```

(`IconPickerField` passes the icon name to `onChange` — confirm in `packages/ui/src/components/IconPickerField.jsx`; if it passes an event-like object, use `(e) => … e.target.value` instead.)

- [ ] **Step 8: `BrandsPanel.jsx`**

```jsx
import { useState } from 'react'
import { DataTable, TextField, TextareaField } from '@runly/ui'
import { Tag } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryBrands, useCreateInventoryBrand, useUpdateInventoryBrand, useDeleteInventoryBrand } from '../../hooks/useInventoryCatalogs.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const EMPTY = { name: '', description: '', website: '' }

export function BrandsPanel({ onImport }) {
  const { data, isLoading, isError, refetch } = useInventoryBrands()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const create = useCreateInventoryBrand()
  const update = useUpdateInventoryBrand()
  const remove = useDeleteInventoryBrand()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { name: row.name, description: row.description ?? '', website: row.website ?? '' } : EMPTY)
  }
  async function save() {
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...form }); toast.success('Marca actualizada') }
      else { await create.mutateAsync(form); toast.success('Marca creada') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar la marca') }
  }

  const columns = [
    { accessorKey: 'name', header: 'Marca', cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium"><Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />{row.original.name}</span>
    ) },
    { accessorKey: 'website', header: 'Sitio web' },
    { accessorKey: 'modelCount', header: 'Modelos' },
    { accessorKey: 'itemCount', header: 'Activos' },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => open(row.original)}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Marca eliminada')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="brands" createLabel="Nueva marca" onCreate={() => open(null)} onImport={onImport}>
      <DataTable columns={columns} data={rows} isLoading={isLoading} isError={isError} onRetry={refetch} getRowId={(row) => row.id}
        searchPlaceholder="Buscar marca..." emptyTitle="Sin marcas" emptyDescription="Crea una marca o importa una lista."
        emptyIcon={Tag} emptyAction={{ label: 'Nueva marca', onClick: () => open(null) }} />
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar marca' : 'Nueva marca'} busy={create.isPending || update.isPending}
        saveDisabled={!form.name.trim()} onSave={save}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Dell" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextField label="Sitio web" value={form.website} maxLength={255} placeholder="https://..." onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
```

- [ ] **Step 9: `LocationsPanel.jsx`**

```jsx
import { useState } from 'react'
import { DataTable, TextField, TextareaField } from '@runly/ui'
import { MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryLocations, useCreateInventoryLocation, useUpdateInventoryLocation, useDeleteInventoryLocation } from '../../hooks/useInventoryCatalogs.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const EMPTY = { name: '', description: '', address: '' }

export function LocationsPanel({ onImport }) {
  const { data, isLoading, isError, refetch } = useInventoryLocations()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const create = useCreateInventoryLocation()
  const update = useUpdateInventoryLocation()
  const remove = useDeleteInventoryLocation()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { name: row.name, description: row.description ?? '', address: row.address ?? '' } : EMPTY)
  }
  async function save() {
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...form }); toast.success('Ubicación actualizada') }
      else { await create.mutateAsync(form); toast.success('Ubicación creada') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar la ubicación') }
  }

  const columns = [
    { accessorKey: 'name', header: 'Ubicación', cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium"><MapPin className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />{row.original.name}</span>
    ) },
    { accessorKey: 'address', header: 'Dirección' },
    { accessorKey: 'itemCount', header: 'Activos' },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => open(row.original)}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Ubicación eliminada')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="locations" createLabel="Nueva ubicación" onCreate={() => open(null)} onImport={onImport}>
      <DataTable columns={columns} data={rows} isLoading={isLoading} isError={isError} onRetry={refetch} getRowId={(row) => row.id}
        searchPlaceholder="Buscar ubicación..." emptyTitle="Sin ubicaciones" emptyDescription="Crea una ubicación o importa una lista."
        emptyIcon={MapPin} emptyAction={{ label: 'Nueva ubicación', onClick: () => open(null) }} />
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar ubicación' : 'Nueva ubicación'} busy={create.isPending || update.isPending}
        saveDisabled={!form.name.trim()} onSave={save}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Oficina central" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextField label="Dirección" value={form.address} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
```

- [ ] **Step 10: `ModelsPanel.jsx`**

```jsx
import { useMemo, useState } from 'react'
import { DataTable, resolveLucideIcon } from '@runly/ui'
import { Boxes, Package } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryModels, useDeleteInventoryModel } from '../../hooks/useInventoryModels.js'
import { InventoryModelDialog } from '../InventoryModelDialog.jsx'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'

export function ModelsPanel({ onImport }) {
  const { data: rows = [], isLoading, isError, refetch } = useInventoryModels()
  const remove = useDeleteInventoryModel()
  const [dialog, setDialog] = useState(null) // { model } | {} | null

  const filters = useMemo(() => {
    const unique = (pairs) => [...new Map(pairs.filter(([id]) => id)).entries()].map(([value, label]) => ({ value, label }))
    return [
      { key: 'typeId', label: 'Tipo', options: unique(rows.map((r) => [r.typeId, r.typeName])) },
      { key: 'brandId', label: 'Marca', options: unique(rows.map((r) => [r.brandId, r.brandName])) },
    ]
  }, [rows])

  const columns = [
    { id: 'type', header: 'Tipo', accessorFn: (r) => r.typeName ?? '', cell: ({ row }) => {
      const Icon = resolveLucideIcon(row.original.typeIcon) ?? Package
      const color = row.original.typeColor ?? '#7c3aed'
      return (
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}22`, color }}><Icon className="h-3.5 w-3.5" /></span>
          {row.original.typeName}
        </span>
      )
    } },
    { accessorKey: 'name', header: 'Modelo', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'brandName', header: 'Marca' },
    { accessorKey: 'year', header: 'Año' },
    { accessorKey: 'itemCount', header: 'Activos' },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => setDialog({ model: row.original })}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Modelo eliminado')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="models" createLabel="Nuevo modelo" onCreate={() => setDialog({})} onImport={onImport}>
      <DataTable columns={columns} data={rows} filters={filters} isLoading={isLoading} isError={isError} onRetry={refetch}
        getRowId={(row) => row.id} searchPlaceholder="Buscar por nombre, marca, tipo o año..." emptyTitle="Sin modelos"
        emptyDescription="Crea un modelo o importa una lista." emptyIcon={Boxes} emptyAction={{ label: 'Nuevo modelo', onClick: () => setDialog({}) }} />
      <InventoryModelDialog open={Boolean(dialog)} onOpenChange={(value) => { if (!value) setDialog(null) }} model={dialog?.model ?? null} />
    </CatalogPanel>
  )
}
```

- [ ] **Step 11: `CustomFieldsPanel.jsx`** — the existing `CustomFieldsTab` logic (lines 400–534 of the current screen, including its `FIELD_TYPES` constant) moved into this file, restyled, now listing every field and with a Tipo selector:

```jsx
import { useEffect, useState } from 'react'
import { EmptyState, LoadingState, SelectField, SortableList, TextField, resolveLucideIcon } from '@runly/ui'
import { SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import {
  useInventoryCustomFields, useCreateInventoryCustomField, useUpdateInventoryCustomField, useDeleteInventoryCustomField, useReorderInventoryCustomFields,
} from '../../hooks/useInventoryCatalogs.js'
import { typeOptions, useTypeRows } from '../InventoryCatalogPickers.jsx'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogListRow } from './CatalogListRow.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const FIELD_TYPES = [
  { value: 'text', label: 'Texto' }, { value: 'textarea', label: 'Texto largo' }, { value: 'number', label: 'Número' },
  { value: 'date', label: 'Fecha' }, { value: 'boolean', label: 'Sí/No' }, { value: 'select', label: 'Lista de opciones' },
  { value: 'url', label: 'URL' }, { value: 'email', label: 'Email' },
]
const ALL_TYPES = '__all__'
const EMPTY = { label: '', fieldKey: '', fieldType: 'text', categoryId: ALL_TYPES }

export function CustomFieldsPanel() {
  const { data, isLoading } = useInventoryCustomFields('all')
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const types = useTypeRows()
  const typeById = new Map(types.map((type) => [type.id, type]))
  const create = useCreateInventoryCustomField()
  const update = useUpdateInventoryCustomField()
  const remove = useDeleteInventoryCustomField()
  const reorder = useReorderInventoryCustomFields()
  const [order, setOrder] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  useEffect(() => { setOrder(null) }, [data])

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { label: row.label, fieldKey: row.fieldKey, fieldType: row.fieldType, categoryId: row.categoryId ?? ALL_TYPES } : EMPTY)
  }
  async function save() {
    const payload = { ...form, categoryId: form.categoryId === ALL_TYPES ? null : form.categoryId }
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...payload }); toast.success('Campo actualizado') }
      else { await create.mutateAsync(payload); toast.success('Campo creado') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar el campo') }
  }
  function handleReorder(next) {
    setOrder(next)
    reorder.mutate(next.map((row, index) => ({ id: row.id, sortOrder: index * 10 })))
  }

  const fieldTypeLabel = (value) => FIELD_TYPES.find((t) => t.value === value)?.label ?? value

  return (
    <CatalogPanel catalogKey="custom-fields" createLabel="Nuevo campo" onCreate={() => open(null)}>
      {isLoading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="Sin campos" description="Crea campos que se piden al registrar activos de un tipo." action={{ label: 'Nuevo campo', onClick: () => open(null) }} />
      ) : (
        <div className="space-y-1.5">
          <SortableList
            items={order ?? rows}
            onReorder={handleReorder}
            renderItem={(row, { dragHandleProps, isDragging }) => {
              const type = row.categoryId ? typeById.get(row.categoryId) : null
              return (
                <CatalogListRow
                  icon={(type && resolveLucideIcon(type.icon)) || SlidersHorizontal}
                  color={type?.color ?? '#475569'}
                  title={row.label}
                  subtitle={`${type ? type.name : 'Todos los tipos'} · ${row.fieldKey}`}
                  badges={[fieldTypeLabel(row.fieldType), ...(row.required ? ['Obligatorio'] : [])]}
                  dragHandleProps={dragHandleProps}
                  isDragging={isDragging}
                  onEdit={() => open(row)}
                  onDelete={() => remove.mutateAsync(row.id).then(() => toast.success('Campo eliminado')).catch((err) => toast.error(err.message))}
                />
              )
            }}
          />
        </div>
      )}
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar campo' : 'Nuevo campo personalizado'} busy={create.isPending || update.isPending}
        saveDisabled={!form.label.trim() || !form.fieldKey.trim()} onSave={save}>
        <TextField label="Etiqueta" required value={form.label} placeholder="Memoria RAM" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        <TextField label="Clave" value={form.fieldKey} placeholder="memoria_ram" hint="Solo letras minúsculas, números y guiones bajos"
          disabled={Boolean(editing?.id)} onChange={(e) => setForm((f) => ({ ...f, fieldKey: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} />
        <SelectField label="Tipo de campo" value={form.fieldType} onValueChange={(fieldType) => setForm((f) => ({ ...f, fieldType }))} options={FIELD_TYPES} />
        <SelectField label="Se pide en" value={form.categoryId} onValueChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
          options={[{ value: ALL_TYPES, label: 'Todos los tipos' }, ...typeOptions(types)]} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
```

- [ ] **Step 12: Rewrite `screens/InventoryCatalogsScreen.jsx`**

```jsx
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@runly/ui'
import { useInventoryBrands, useInventoryCategories, useInventoryCustomFields, useInventoryLocations } from '../hooks/useInventoryCatalogs.js'
import { useInventoryModels } from '../hooks/useInventoryModels.js'
import { resolveCatalogKey, catalogByKey } from '../components/catalogs/catalog-config.js'
import { CatalogNav } from '../components/catalogs/CatalogNav.jsx'
import { CatalogImportDialog } from '../components/catalogs/CatalogImportDialog.jsx'
import { TypesPanel } from '../components/catalogs/TypesPanel.jsx'
import { BrandsPanel } from '../components/catalogs/BrandsPanel.jsx'
import { ModelsPanel } from '../components/catalogs/ModelsPanel.jsx'
import { LocationsPanel } from '../components/catalogs/LocationsPanel.jsx'
import { CustomFieldsPanel } from '../components/catalogs/CustomFieldsPanel.jsx'

const PANELS = { types: TypesPanel, brands: BrandsPanel, models: ModelsPanel, locations: LocationsPanel, 'custom-fields': CustomFieldsPanel }
const IMPORTABLE = new Set(['types', 'brands', 'models', 'locations'])
const count = (query) => (query.data?.data ?? query.data ?? []).filter((row) => row.enabled !== false).length

export default function InventoryCatalogsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = resolveCatalogKey(searchParams.get('tab'))
  const [importing, setImporting] = useState(false)
  const counts = {
    types: count(useInventoryCategories()),
    brands: count(useInventoryBrands()),
    models: count(useInventoryModels()),
    locations: count(useInventoryLocations()),
    'custom-fields': count(useInventoryCustomFields('all')),
  }
  const Panel = PANELS[active]

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Inventario"
        title="Catálogos"
        description="Tipos, marcas, modelos, ubicaciones y campos personalizados que se usan al registrar activos."
      />
      <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <CatalogNav active={active} counts={counts} onSelect={(key) => setSearchParams({ tab: key }, { replace: true })} />
        <Panel onImport={IMPORTABLE.has(active) ? () => setImporting(true) : undefined} />
      </div>
      {IMPORTABLE.has(active) ? (
        <CatalogImportDialog catalog={active} title={catalogByKey(active).label.toLowerCase()} open={importing} onOpenChange={setImporting} />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 13: Delete the old JSON catalog component**

```bash
git rm apps/desktop/src/modules/runly.inventory/components/InventoryReusableCatalog.jsx
```

(Task 12 creates `CatalogImportDialog.jsx`; build after Task 12.)

---

### Task 12: Import dialog

**Files:** Create `apps/desktop/src/modules/runly.inventory/components/catalogs/CatalogImportDialog.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge, Button, CheckboxField, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  ErrorState, ImportStepIndicator,
} from '@runly/ui'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../../auth/AuthProvider'
import { useActiveCompany } from '../../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../../lib/runtimeConfig.js'
import { intakeRequest } from '../../lib/intake.js'

const STEPS = [
  { key: 'template', label: 'Plantilla', icon: Download },
  { key: 'file', label: 'Archivo', icon: Upload },
  { key: 'preview', label: 'Vista previa', icon: FileSpreadsheet },
]
const STATUS = {
  new: { label: 'Nuevo', variant: 'success' },
  exists: { label: 'Ya existe', variant: 'outline' },
  error: { label: 'Error', variant: 'destructive' },
}
const COLUMNS = [
  { accessorKey: 'line', header: 'Fila' },
  { id: 'status', header: 'Estado', accessorFn: (r) => STATUS[r.status].label,
    cell: ({ row }) => <Badge variant={STATUS[row.original.status].variant}>{STATUS[row.original.status].label}</Badge> },
  { id: 'name', header: 'Nombre', accessorFn: (r) => r.data?.nombre ?? '' },
  { accessorKey: 'message', header: 'Detalle' },
]

export function CatalogImportDialog({ catalog, title, open, onOpenChange }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const qc = useQueryClient()
  const token = session?.access_token
  const fileRef = useRef(null)
  const lastFile = useRef(null)
  const [step, setStep] = useState('template')
  const [preview, setPreview] = useState(null)
  const [createMissing, setCreateMissing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const base = `/inventory/import/${catalog}`
  const call = (path, body) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path: `${base}${path}`, body })

  function close(next) {
    if (!next) { setStep('template'); setPreview(null); setError(''); setCreateMissing(true); lastFile.current = null }
    onOpenChange(next)
  }

  async function download(format) {
    try {
      const res = await fetch(`${getApiUrl()}${base}/template?format=${format}`, { headers: { Authorization: `Bearer ${token}`, 'X-Runly-Company-Id': activeCompanyId } })
      if (!res.ok) throw new Error('No se pudo descargar la plantilla.')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `plantilla-${catalog}.${format}`
      link.click()
      URL.revokeObjectURL(url)
      setStep('file')
    } catch (err) { toast.error(err.message) }
  }

  async function runPreview(file, missing) {
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('createMissing', String(missing))
      setPreview(await call('/preview', form))
      setStep('preview')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function handleFile(file) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    lastFile.current = file
    await runPreview(file, createMissing)
  }

  async function toggleMissing(next) {
    setCreateMissing(next)
    if (lastFile.current) await runPreview(lastFile.current, next)
  }

  async function commit() {
    setBusy(true); setError('')
    try {
      const result = await call('/commit', { rows: preview.rows.map((row) => row.data), createMissing })
      toast.success(`${result.created} creados, ${result.skipped} omitidos${result.failed ? `, ${result.failed} con error` : ''}.`)
      await qc.invalidateQueries({ queryKey: ['inventory'] })
      close(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const missing = preview ? [...preview.missing.types.map((n) => `tipo «${n}»`), ...preview.missing.brands.map((n) => `marca «${n}»`)] : []
  const creatable = preview?.counts.new ?? 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent scrollable size="lg">
        <DialogHeader>
          <DialogTitle>Importar {title}</DialogTitle>
          <DialogDescription>Carga un archivo CSV o Excel con las columnas de la plantilla. Los registros que ya existen se omiten.</DialogDescription>
        </DialogHeader>
        <ImportStepIndicator steps={STEPS} current={step} className="shrink-0" />
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          {step === 'template' ? (
            <div className="space-y-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Descarga la plantilla, llénala sin cambiar los encabezados y súbela en el siguiente paso.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => download('xlsx')}><Download className="mr-1.5 h-3.5 w-3.5" />Plantilla Excel</Button>
                <Button type="button" variant="outline" onClick={() => download('csv')}><Download className="mr-1.5 h-3.5 w-3.5" />Plantilla CSV</Button>
                <Button type="button" variant="ghost" onClick={() => setStep('file')}>Ya tengo mi archivo</Button>
              </div>
            </div>
          ) : null}
          {step === 'file' ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] p-6">
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />{busy ? 'Leyendo archivo...' : 'Elegir archivo'}
              </Button>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">CSV o Excel (.xlsx), hasta 2,000 filas y 5 MB.</p>
            </div>
          ) : null}
          {step === 'preview' && preview ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">{preview.counts.new} nuevos</Badge>
                <Badge variant="outline">{preview.counts.exists} ya existen</Badge>
                <Badge variant="destructive">{preview.counts.error} con error</Badge>
              </div>
              {missing.length > 0 ? (
                <CheckboxField
                  label={`Crear lo que falta: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` y ${missing.length - 5} más` : ''}`}
                  checked={createMissing}
                  disabled={busy}
                  onChange={(e) => toggleMissing(e.target.checked)}
                />
              ) : null}
              <DataTable columns={COLUMNS} data={preview.rows} pageSize={20} getRowId={(row) => String(row.line)} emptyTitle="El archivo no tiene filas" />
            </>
          ) : null}
          {error ? <ErrorState title="No se pudo procesar el archivo" description={error} /> : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={() => close(false)}>Cancelar</Button>
          {step === 'preview' ? (
            <Button type="button" disabled={busy || creatable === 0} onClick={commit}>{busy ? 'Importando...' : `Importar ${creatable}`}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Lint and build the desktop app (Tasks 9–12 together)**

Run: `pnpm exec eslint apps/desktop/src/modules/runly.inventory packages/ui/src/components/icon-catalog.js`
Expected: no errors.

Run: `cd apps/desktop && pnpm build:web`
Expected: `✓ built in …` with no unresolved imports.

- [ ] **Step 3: File sizes**

Run: `wc -l apps/desktop/src/modules/runly.inventory/components/catalogs/*.jsx apps/desktop/src/modules/runly.inventory/screens/InventoryCatalogsScreen.jsx`
Expected: every file under 300 lines.

- [ ] **Step 4: Manual check in the app** — `pnpm dev`, open `http://localhost:5173/app/m/runly.inventory/inventory/catalogs`:
  - side list shows five catalogs with counts; `?tab=categories` opens Tipos;
  - Tipos shows the 12 default types with icons; create a type with icon + color; drag to reorder;
  - Modelos: create "XPS 15 / Laptop / Dell / 2023", filter by type and brand, search "dell 2023";
  - Importar on Marcas: download CSV template, upload a file with one existing and one new brand → preview 1 nuevo / 1 ya existe → Importar 1 → counts update;
  - new asset form: pick the model → Tipo and Marca fill; custom fields of the type appear; save; reopen edit → model still selected.
  Report anything that deviates; do not mark done without this check (or state explicitly that it was not run).

- [ ] **Step 5: Commit (Tasks 9–12)**

```bash
git add apps/desktop/src/modules/runly.inventory
git commit -m "feat(inventory): id-based model/type pickers, redesigned Catálogos with import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, help and final verification

**Files:** `docs/ai-context/inventory-ai.md`, `apps/api/src/manifests/official/help/runly.inventory/overview.md`, `views/inventario.md`, `views/catalogos.md`, `views/registro-ia.md` (if it mentions categoría/tipo), `docs/TASKS.md`.

- [ ] **Step 1: `docs/ai-context/inventory-ai.md`** — replace the paragraph that starts `**Catálogos** incluye ahora Modelos y Tipos.` with:

```markdown
**Catálogos**: "Tipo" es `InvCategory` (ícono, color, subtipos, campos personalizados); el antiguo `InvItem.itemType` ya no se escribe. Los modelos viven en `InvModel` (`typeId`, `brandId`, `year` opcional, único por marca + nombre + año) y el activo guarda `modelId` además del texto `model`. Al crear o editar un activo con `modelId`, el API completa `model`, `categoryId` y `brandId` (`inventory-model-service.applyModelDefaults`). Los catálogos Tipos, Marcas, Modelos y Ubicaciones se importan con plantilla fija (`/inventory/import/:catalog/template|preview|commit`); los existentes se omiten. La tabla `inventory_reusable_catalog` queda solo como origen histórico de la migración `20260928120000_inventory_models_types`.
```
  and in the endpoint table replace the row `| GET/POST /inventory/models, /inventory/types | …` with:

```markdown
| `GET/POST /inventory/models`, `PUT/DELETE /inventory/models/:id`, `GET /inventory/types` | `inventory.catalog.read` / `inventory.catalog.manage` | Modelos (tipo + marca + año) y alias de lectura de tipos |
| `GET /inventory/import/:catalog/template`, `POST …/preview`, `POST …/commit` | `inventory.catalog.manage` | Importación simple de tipos, marcas, modelos y ubicaciones |
```

- [ ] **Step 2: Help content** (Spanish, no accents in these files to match their style, no emojis)
  - `overview.md`: replace the Catalogos bullet with `- **Catalogos**: tipos (con icono, color y campos personalizados), marcas, modelos y ubicaciones. Un modelo agrupa tipo, marca, nombre y año; al elegirlo en un activo se completan el tipo y la marca. Cada catalogo se puede importar desde una plantilla CSV o Excel.`
  - `views/catalogos.md`: set `summary: Tipos, marcas, modelos, ubicaciones y campos personalizados, con importacion desde plantilla.` and body:

```markdown
Administra los catalogos que despues eliges al registrar un activo. Elige el catalogo en la lista de la izquierda.

- **Tipos**: que es cada activo (Laptop, Celular, Monitor...). Cada tipo tiene icono, color, subtipos opcionales y los campos personalizados que pide. Ya vienen tipos iniciales que puedes editar.
- **Modelos**: siempre tienen tipo, marca y nombre, y opcionalmente año. Al crear un modelo puedes crear ahi mismo el tipo o la marca. Un mismo nombre con la misma marca pero distinto año es otro modelo.
- **Importar**: descarga la plantilla, llenala y subela. La vista previa marca cada fila como nueva, ya existente (se omite) o con error; en Modelos puedes crear en el mismo paso los tipos y marcas que falten.
- No puedes eliminar un tipo o una marca mientras tenga modelos activos; muevelos o desactivalos primero.
```
  - `views/inventario.md`: replace "categoria" wording with "tipo" (e.g. `Busca y filtra por tipo, estado o responsable asignado...`); keep the model bullets from the previous session.
  - `views/registro-ia.md`: if it says "categoria", change to "tipo".

- [ ] **Step 3: Run the help tests**

Run: `node --test apps/api/src/services/__tests__/help-service.test.js`
Expected: all pass.

- [ ] **Step 4: Full inventory + UI verification**

Run: `node --test apps/api/src/services/__tests__/inventory-*.test.js apps/api/src/routes/inventory/__tests__/*.test.js apps/desktop/src/modules/runly.inventory/lib/__tests__/*.test.js packages/ui/src/runly-renderer/__tests__/*.test.js`
Expected: all pass (if `inventory-chat.test.js` fails only when run in parallel, rerun it alone and record both results).

Run: `pnpm lint`
Expected: exit 0.

Run: `cd apps/desktop && pnpm build:web`
Expected: build succeeds.

- [ ] **Step 5: `docs/TASKS.md`** — add under the inventory section:

```markdown
- [x] runly.inventory: "Tipo" unified onto InvCategory, InvModel (type + brand + year) with item modelId, Catálogos redesign (side list, icons, counts) and fixed-column import for tipos/marcas/modelos/ubicaciones. Verified: 2026-09-28 (<list the exact commands above and their results>)
- [ ] runly.inventory: large catalog/asset import with column mapping (ledger-style) — separate spec
```
  Fill the `Verified:` evidence with the real command results from Step 4 and the Task 12 manual check; if the manual check was not run, leave the item `[ ]` and say so.

- [ ] **Step 6: Sync the public help site** (sibling repo `../runly-web`)

```bash
cd ../runly-web && node scripts/sync-help-content.mjs && pnpm exec vitest run && pnpm build
```
Expected: only `src/content/help/runly.inventory/*` changes; tests and build pass. Do not commit in `runly-web` unless the user asks.

- [ ] **Step 7: Commit**

```bash
git add docs apps/api/src/manifests/official/help
git commit -m "docs(inventory): types/models/catalog import in help and ai-context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §7 said subtypes are "indented"; the plan shows them as "Subtipo de X" (list rows) and "Padre › Hijo" (pickers) because drag reordering works on a flat list. Behaviourally equivalent; spec wording to be read accordingly.
- Spec §6 mentions `GET /inventory/types` as an alias — implemented in `models-routes.js`; `POST /inventory/types` is removed (types are created via `POST /inventory/categories`).
- Items created by intake/AI without `modelId` keep only the `model` text; no automatic model matching (out of scope).
- The `inventory_reusable_catalog` Runly ORM model (`apps/api/src/manifests/official/inventory-assistant.model.js`) is intentionally kept; dropping the table would destroy the migration source.
