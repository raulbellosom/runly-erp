# Shared Form Components Upgrade — Plan A (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-14-shared-form-components-upgrade-design.md`

**Goal:** Add a Prisma migration + two new inventory endpoints for cover-image selection/reordering of an item's attached files, enrich `getItem()`/`listItems()` with a computed `coverImageFileId`, and enrich HR's employee list with a computed `photoFileId` — all additive, no breaking changes to existing contracts.

**Architecture:** `InvItemFile` gets two new columns (`sortOrder`, `isCover`). Since it has no `companyId` column of its own, the new reorder/cover functions verify ownership via the parent `InvItem` first (same idiom `removeItemFile` already uses), then scope writes by `itemId` — they cannot reuse the existing `reorderCatalog` helper, which scopes by `companyId` directly on the target model.

**Tech Stack:** Prisma, Hono, Node's built-in test runner (`node --test`).

---

## File Structure Map

- Modify: `prisma/schema.prisma` (`InvItemFile` model)
- Create: `prisma/migrations/20260914020000_add_inv_item_file_sort_cover/migration.sql`
- Modify: `apps/api/src/services/inventory-service.js` (`getItem`, `listItems`, new `setItemFileCover`, new `reorderItemFiles`)
- Modify: `apps/api/src/routes/inventory/index.js` (2 new routes)
- Modify: `apps/api/src/services/hr-service.js` (`listEmployees`, both query paths)
- Modify: `packages/sdk/src/index.js` (2 new inventory SDK methods)
- Modify: `apps/api/src/services/__tests__/inventory-service.test.js`

---

## Task 1: Prisma migration for `InvItemFile.sortOrder`/`isCover`

**Files:**
- Modify: `prisma/schema.prisma` (find `model InvItemFile` at line 3179)
- Create: `prisma/migrations/20260914020000_add_inv_item_file_sort_cover/migration.sql`

- [ ] **Step 1: Edit the Prisma model**

In `prisma/schema.prisma`, find:

```prisma
model InvItemFile {
  id          String   @id @default(uuid(7)) @db.Uuid
  itemId      String   @db.Uuid @map("item_id")
  fileAssetId String   @db.Uuid @map("file_asset_id")
  label       String?  @db.VarChar(100)
  createdAt   DateTime @default(now()) @map("created_at")

  item      InvItem   @relation(fields: [itemId], references: [id], onDelete: Cascade)
  fileAsset FileAsset @relation("FileAssetInvItems", fields: [fileAssetId], references: [id], onDelete: Cascade)

  @@index([itemId])
  @@index([fileAssetId])
  @@map("inv_item_file")
}
```

Replace with (adds `sortOrder`/`isCover`, both after `label`, before `createdAt`):

```prisma
model InvItemFile {
  id          String   @id @default(uuid(7)) @db.Uuid
  itemId      String   @db.Uuid @map("item_id")
  fileAssetId String   @db.Uuid @map("file_asset_id")
  label       String?  @db.VarChar(100)
  sortOrder   Int      @default(0) @map("sort_order")
  isCover     Boolean  @default(false) @map("is_cover")
  createdAt   DateTime @default(now()) @map("created_at")

  item      InvItem   @relation(fields: [itemId], references: [id], onDelete: Cascade)
  fileAsset FileAsset @relation("FileAssetInvItems", fields: [fileAssetId], references: [id], onDelete: Cascade)

  @@index([itemId])
  @@index([fileAssetId])
  @@map("inv_item_file")
}
```

- [ ] **Step 2: Write the migration SQL**

Create the directory `prisma/migrations/20260914020000_add_inv_item_file_sort_cover/` with a file `migration.sql`:

```sql
-- AlterTable
ALTER TABLE "inv_item_file" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inv_item_file" ADD COLUMN "is_cover" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Apply and regenerate**

Run:
```bash
pnpm db:generate
pnpm db:migrate
```
Expected: both commands exit 0. `pnpm db:migrate` applies the new migration without touching any existing migration file (do not edit any other file under `prisma/migrations/`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914020000_add_inv_item_file_sort_cover
git commit -m "feat(db): add sortOrder and isCover columns to InvItemFile"
```

---

## Task 2: `setItemFileCover` and `reorderItemFiles` service functions

**Files:**
- Modify: `apps/api/src/services/inventory-service.js` (add two new functions right after `removeItemFile`, which is around line 936-941 per the current file)
- Test: `apps/api/src/services/__tests__/inventory-service.test.js`

- [ ] **Step 1: Read current code**

Read `apps/api/src/services/inventory-service.js` in full to find the exact current text of `removeItemFile` (so the new functions can be inserted right after it) and the function's closing `return { success: true }; }` line, and to confirm the exported function list at the bottom of `createInventoryService` (the `return { ... }` object) needs both new functions added to it.

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/src/services/__tests__/inventory-service.test.js`:

```js
// ---------------------------------------------------------------------------
// setItemFileCover / reorderItemFiles
// ---------------------------------------------------------------------------

describe('setItemFileCover', () => {
  it('marks the target file as cover and clears any other cover on the same item', async () => {
    let updateManyArgs = null
    let updateArgs = null
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }) },
      _tx: {
        invItemFile: {
          findFirst: async () => ({ id: 'file-1', itemId: ITEM_ID }),
          updateMany: async (args) => { updateManyArgs = args; return { count: 2 } },
          update: async (args) => { updateArgs = args; return { id: args.where.id, isCover: true } },
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.setItemFileCover(ITEM_ID, 'file-1', COMPANY_ID)

    assert.equal(result.isCover, true)
    assert.deepEqual(updateManyArgs.where, { itemId: ITEM_ID })
    assert.deepEqual(updateManyArgs.data, { isCover: false })
    assert.equal(updateArgs.where.id, 'file-1')
    assert.equal(updateArgs.data.isCover, true)
  })

  it('throws 404 if the item does not belong to the company', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.setItemFileCover(ITEM_ID, 'file-1', COMPANY_ID),
      (err) => { assert.ok(err instanceof InventoryServiceError); assert.equal(err.status, 404); return true },
    )
  })

  it('throws 404 if the file association does not belong to the item', async () => {
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }) },
      _tx: { invItemFile: { findFirst: async () => null } },
    })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.setItemFileCover(ITEM_ID, 'file-1', COMPANY_ID),
      (err) => { assert.ok(err instanceof InventoryServiceError); assert.equal(err.status, 404); return true },
    )
  })
})

describe('reorderItemFiles', () => {
  it('scopes each updateMany by itemId, not companyId', async () => {
    const calls = []
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }) },
      invItemFile: {
        updateMany: async (args) => { calls.push(args); return { count: 1 } },
      },
    })
    const svc = createInventoryService({ prisma })
    await svc.reorderItemFiles(ITEM_ID, COMPANY_ID, [
      { id: 'file-1', sortOrder: 0 },
      { id: 'file-2', sortOrder: 1 },
    ])

    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].where, { id: 'file-1', itemId: ITEM_ID })
    assert.deepEqual(calls[0].data, { sortOrder: 0 })
    assert.deepEqual(calls[1].where, { id: 'file-2', itemId: ITEM_ID })
  })

  it('throws 404 if the item does not belong to the company', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.reorderItemFiles(ITEM_ID, COMPANY_ID, [{ id: 'file-1', sortOrder: 0 }]),
      (err) => { assert.ok(err instanceof InventoryServiceError); assert.equal(err.status, 404); return true },
    )
  })
})
```

Note: `buildPrismaMock`'s `$transaction` stub (already defined at the top of this test file) calls `fn(makeTx(overrides._tx ?? {}))` — so `setItemFileCover`'s transaction body must be written to actually use the `tx` parameter passed into its `prisma.$transaction(async (tx) => {...})` callback for both the `findFirst` existence check and the `updateMany`/`update` calls, exactly like `assignItem`'s existing transaction pattern in this same file. `reorderItemFiles` does NOT need to run inside `$transaction` per the existing `reorderCatalog` precedent (it uses a plain `Promise.all`-via-`$transaction([...])` array form, not a callback) — mirror `reorderCatalog`'s exact style: `prisma.$transaction(items.map(...))`, so the mock's `_root`/top-level `invItemFile.updateMany` stub (not `_tx`) is what gets called, matching the test above.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: FAIL (`svc.setItemFileCover is not a function`, `svc.reorderItemFiles is not a function`).

- [ ] **Step 4: Implement**

Add these two functions to `apps/api/src/services/inventory-service.js`, right after `removeItemFile`:

```js
  async function setItemFileCover(itemId, docId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id: itemId, companyId, enabled: true },
      select: { id: true },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    return prisma.$transaction(async (tx) => {
      const row = await tx.invItemFile.findFirst({ where: { id: docId, itemId } });
      if (!row) throw new InventoryServiceError('File association not found', 404);
      await tx.invItemFile.updateMany({ where: { itemId }, data: { isCover: false } });
      return tx.invItemFile.update({ where: { id: docId }, data: { isCover: true } });
    });
  }

  async function reorderItemFiles(itemId, companyId, items) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id: itemId, companyId, enabled: true },
      select: { id: true },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    if (!Array.isArray(items)) return;
    await prisma.$transaction(
      items
        .filter((entry) => entry && typeof entry.id === 'string')
        .map(({ id, sortOrder }) =>
          prisma.invItemFile.updateMany({
            where: { id, itemId },
            data: { sortOrder: Number(sortOrder) || 0 },
          }),
        ),
    );
  }
```

Then find the `return { ... }` object at the end of `createInventoryService` (the one that exposes `listItemFiles`, `addItemFile`, `removeItemFile`, etc. to callers) and add `setItemFileCover,` and `reorderItemFiles,` to it.

IMPORTANT: `InventoryServiceError` thrown from *inside* a `prisma.$transaction(async (tx) => {...})` callback in `setItemFileCover` must propagate correctly out of the transaction (Prisma re-throws whatever error the callback throws, rolling back the transaction) — do not wrap it in a try/catch that swallows it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: PASS — all tests in the file, including every pre-existing describe block.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/inventory-service.js apps/api/src/services/__tests__/inventory-service.test.js
git commit -m "feat(inventory): add setItemFileCover and reorderItemFiles service functions"
```

---

## Task 3: `coverImageFileId` computed field on `getItem()`/`listItems()`

**Files:**
- Modify: `apps/api/src/services/inventory-service.js` (`getItem`, `listItems`)
- Test: `apps/api/src/services/__tests__/inventory-service.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('getItem', ...)` block already added by a previous task (add these as new `it(...)` entries inside that existing describe, right before its closing `})`):

```js
  it('coverImageFileId resolves to the file marked isCover', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID,
          companyId: COMPANY_ID,
          enabled: true,
          category: null, brand: null, location: null, assignedTo: null,
        }),
      },
      invItemFile: {
        findMany: async () => [
          { id: 'f1', fileAssetId: 'asset-1', isCover: false, sortOrder: 0, createdAt: new Date('2026-01-01'), fileAsset: { mimeType: 'image/png' } },
          { id: 'f2', fileAssetId: 'asset-2', isCover: true, sortOrder: 1, createdAt: new Date('2026-01-02'), fileAsset: { mimeType: 'image/png' } },
        ],
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.coverImageFileId, 'asset-2')
  })

  it('coverImageFileId falls back to the earliest image when nothing is marked cover', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID, companyId: COMPANY_ID, enabled: true,
          category: null, brand: null, location: null, assignedTo: null,
        }),
      },
      invItemFile: {
        findMany: async () => [
          { id: 'f1', fileAssetId: 'pdf-1', isCover: false, sortOrder: 0, createdAt: new Date('2026-01-01'), fileAsset: { mimeType: 'application/pdf' } },
          { id: 'f2', fileAssetId: 'asset-2', isCover: false, sortOrder: 1, createdAt: new Date('2026-01-02'), fileAsset: { mimeType: 'image/png' } },
        ],
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.coverImageFileId, 'asset-2')
  })

  it('coverImageFileId is null when the item has no image attachments', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID, companyId: COMPANY_ID, enabled: true,
          category: null, brand: null, location: null, assignedTo: null,
        }),
      },
      invItemFile: { findMany: async () => [] },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.coverImageFileId, null)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: FAIL (`result.coverImageFileId` is `undefined`, and the mock's `invItemFile.findMany` stub is never called since `getItem` doesn't query it yet).

- [ ] **Step 3: Implement**

Read the current `getItem` function (already modified by an earlier feature to add `categoryName`/`brandName`/`locationName`/`assignedToName`) to find its exact current text, then add a second query for the item's files and a `coverImageFileId` computation. Replace:

```js
  async function getItem(id, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id, companyId, enabled: true },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, description: true } },
        brand:    { select: { id: true, name: true, website: true } },
        location: { select: { id: true, name: true, address: true } },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, userProfileId: true },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        customValues: {
          include: {
            field: { select: { id: true, label: true, fieldKey: true, fieldType: true, options: true } },
          },
        },
        // files intentionally omitted — fetched separately by /items/:id/files
      },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    return {
      ...item,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      assignedToName: item.assignedTo
        ? ([item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ') || null)
        : null,
    };
  }
```

with:

```js
  async function getItem(id, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id, companyId, enabled: true },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, description: true } },
        brand:    { select: { id: true, name: true, website: true } },
        location: { select: { id: true, name: true, address: true } },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, userProfileId: true },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        customValues: {
          include: {
            field: { select: { id: true, label: true, fieldKey: true, fieldType: true, options: true } },
          },
        },
        // full file list intentionally omitted here — fetched separately by
        // /items/:id/files; only resolveCoverImageFileId below queries InvItemFile,
        // and only for mimeType/isCover/sortOrder, not the full row.
      },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    const coverImageFileId = await resolveCoverImageFileId(id);
    return {
      ...item,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      assignedToName: item.assignedTo
        ? ([item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ') || null)
        : null,
      coverImageFileId,
    };
  }
```

Add a new private helper function above `getItem` (not exported — it's an internal helper used by both `getItem` and `listItems`):

```js
  // Resolves the "cover photo" for an inventory item: the file explicitly
  // marked isCover, else the earliest-uploaded image attachment, else null.
  // Only selects mimeType (not the full FileAsset row) to keep this cheap.
  async function resolveCoverImageFileId(itemId) {
    const files = await prisma.invItemFile.findMany({
      where: { itemId },
      select: {
        fileAssetId: true,
        isCover: true,
        sortOrder: true,
        createdAt: true,
        fileAsset: { select: { mimeType: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const explicit = files.find((f) => f.isCover);
    if (explicit) return explicit.fileAssetId;
    const firstImage = files.find((f) => String(f.fileAsset?.mimeType ?? '').startsWith('image/'));
    return firstImage?.fileAssetId ?? null;
  }
```

Then, in `listItems`, find the existing `enriched` mapping:

```js
    const enriched = data.map(item => ({
      ...item,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      assignedToName: item.assignedTo
        ? [item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ')
        : null,
    }));

    return { data: enriched, total, page: normalizePage(page), limit: take };
```

Replace with (resolves the cover image for every row in the page — acceptable N+1 for a paginated list, same cost class as the existing per-row relation includes):

```js
    const enriched = await Promise.all(data.map(async (item) => ({
      ...item,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      assignedToName: item.assignedTo
        ? [item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ')
        : null,
      coverImageFileId: await resolveCoverImageFileId(item.id),
    })));

    return { data: enriched, total, page: normalizePage(page), limit: take };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: PASS — all tests including every pre-existing describe block (createItem/updateItem/deleteItem/assignItem/returnItem/getItem/setItemFileCover/reorderItemFiles).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inventory-service.js apps/api/src/services/__tests__/inventory-service.test.js
git commit -m "feat(inventory): compute coverImageFileId in getItem and listItems"
```

---

## Task 4: New routes for cover/reorder

**Files:**
- Modify: `apps/api/src/routes/inventory/index.js`

- [ ] **Step 1: Implement**

In `apps/api/src/routes/inventory/index.js`, find the existing "Item files" block (`router.get("/inventory/items/:id/files", ...)`, `router.post("/inventory/items/:id/files", ...)`, `router.delete("/inventory/items/:id/files/:docId", ...)`). Immediately after the `DELETE` route, add:

```js
  router.patch("/inventory/items/:id/files/:docId/cover", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id, docId } = c.req.param();
      const record = await inventoryService.setItemFileCover(id, docId, companyId);
      return c.json({ data: record });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo marcar la portada." }, 500);
    }
  });

  router.patch("/inventory/items/:id/files/reorder", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const { items } = await c.req.json();
      await inventoryService.reorderItemFiles(id, companyId, items);
      return c.json({ ok: true });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo reordenar." }, 500);
    }
  });
```

- [ ] **Step 2: Verify**

Run: `node --check apps/api/src/routes/inventory/index.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/inventory/index.js
git commit -m "feat(inventory): add cover and reorder routes for item files"
```

---

## Task 5: SDK methods

**Files:**
- Modify: `packages/sdk/src/index.js`

- [ ] **Step 1: Implement**

Read `packages/sdk/src/index.js` to find the exact current text of the `inventory` domain's `reorderCustomFields` method (the last of the four existing reorder methods) and the `deleteCustomField` method (for the URL-path-with-id style). Add these two new methods to the same `inventory` domain object, right after `reorderCustomFields`:

```js
      setItemFileCover: (itemId, docId, token) =>
        request(`/inventory/items/${encodeURIComponent(itemId)}/files/${encodeURIComponent(docId)}/cover`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      reorderItemFiles: (itemId, items, token) =>
        request(`/inventory/items/${encodeURIComponent(itemId)}/files/reorder`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
```

- [ ] **Step 2: Verify**

Run: `node --check packages/sdk/src/index.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/index.js
git commit -m "feat(sdk): add setItemFileCover and reorderItemFiles methods"
```

---

## Task 6: HR employee list gains `photoFileId`

**Files:**
- Modify: `apps/api/src/services/hr-service.js` (`listEmployees`, both the paginated/RunlyTable path around line 358-388 and the legacy `include`-based path around line 392-408)

- [ ] **Step 1: Read current code**

Read `apps/api/src/services/hr-service.js` in full around `listEmployees` (lines ~324-409) to confirm the exact current text of both query paths before editing — the paginated path uses a plain `findMany({ where, orderBy, take, skip })` with no `include`, and the legacy path uses `include: { supervisor: ..., departmentRef: ..., jobTitleRef: ..., userProfile: { select: { id: true, displayName: true, email: true } } }`.

- [ ] **Step 2: Implement — paginated path**

In the paginated path's `Promise.all([...])` call, add `include: { userProfile: { select: { avatarFileId: true } } }` to the `prisma.hrEmployee.findMany({ where, orderBy, take, skip })` call, so it becomes:

```js
          prisma.hrEmployee.findMany({
            where, orderBy, take, skip,
            include: { userProfile: { select: { avatarFileId: true } } },
          }),
```

Then in the `.map()` that builds the flattened `rows` array, add a `photo_file_id` key (matching this path's existing snake_case export-style convention) right after `id: r.id,`:

```js
          rows: rows.map((r) => ({
            id: r.id,
            photo_file_id: r.profileImageFileId ?? r.userProfile?.avatarFileId ?? null,
            full_name: `${r.firstName} ${r.lastName}`.trim(),
            ...
```

(keep every other existing key in that object exactly as-is — only add the one new key).

- [ ] **Step 3: Implement — legacy path**

In the legacy path's `include`, change the `userProfile` sub-select from `{ id: true, displayName: true, email: true }` to `{ id: true, displayName: true, email: true, avatarFileId: true }`. This path returns raw Prisma rows directly (no `.map()` today) — since `profileImageFileId` is already a plain scalar on the row and `userProfile.avatarFileId` will now be included via the relation, no flattening is needed for THIS path (its consumer, if any, can compute the same fallback itself, or is left as a future enhancement — this legacy path is not used by `HrScreen.jsx`'s table per the plan's research, only the paginated path is).

- [ ] **Step 4: Verify**

Run: `node --check apps/api/src/services/hr-service.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/hr-service.js
git commit -m "feat(hr): include photo_file_id (own photo, falling back to user avatar) in employee list"
```

---

## Task 7: Verification pass

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

```bash
pnpm db:generate
node --test apps/api/src/services/__tests__/inventory-service.test.js
node --check apps/api/src/routes/inventory/index.js
node --check packages/sdk/src/index.js
node --check apps/api/src/services/hr-service.js
pnpm lint
```

Expected: all clean, all tests passing.

- [ ] **Step 2: Manual verification**

With the API running against a real (or a test) database that has had the migration applied:
- Create/find an inventory item with 2+ image attachments. Call `PATCH /inventory/items/:id/files/:docId/cover` for one of them, then `GET /inventory/items/:id` and confirm `coverImageFileId` matches.
- Call `PATCH /inventory/items/:id/files/reorder` with a new order and confirm subsequent `GET .../files` reflects the new `sortOrder`.
- `GET /hr/employees` (paginated) and confirm `photo_file_id` appears on each row.

- [ ] **Step 3: Commit verification note**

```bash
git add docs/superpowers/plans/2026-09-14-shared-form-components-upgrade-a-backend.md
git commit -m "docs(plan): record backend verification results"
```
