# Inventory Glass Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-14-inventory-glass-redesign-design.md`

**Goal:** Restyle the shared `RunlyTable`/`RunlyForm`/`RunlyDetail`/`StatStrip` renderers to use the app's existing `.glass` design system, migrate `runly.inventory`'s create/edit and detail screens from hand-rolled JSX to blueprint-driven `RunlyForm`/`RunlyDetail`, and wire up a working, human-readable audit history panel.

**Architecture:** Two genuinely new, generic renderer capabilities are added along the way (a `"component"` section type in `RunlyDetail` resolved via a `componentRegistry` prop, and a `"custom-fields"` section type in `RunlyForm` for per-category dynamic fields) — both additive, opt-in by section-type string, and proven safe against every other existing blueprint (Fleet, HR, etc.) because none of them use these new type strings. Inventory's two screens use `RunlyForm`/`RunlyDetail` directly (not `RunlyCrudView`, which would also force-migrate the list screen — out of scope). Backend changes are limited to fixing the audit pipeline and adding flat convenience fields `getItem()` already computes elsewhere (`listItems()`).

**Tech Stack:** React (apps/desktop), Hono (apps/api), Prisma, `@runly/ui` (packages/ui), Node's built-in test runner (`node --test`), Tailwind CSS with this repo's `.glass` utility classes (`apps/desktop/src/styles.css`).

---

## File Structure Map

**Backend (apps/api):**
- Modify: `apps/api/src/services/inventory-service.js`
- Modify: `apps/api/src/services/activity-bridge.js`
- Modify: `apps/api/src/routes/inventory/index.js`
- Modify: `apps/api/src/services/__tests__/inventory-service.test.js`
- Modify: `apps/api/src/services/__tests__/activity-bridge.test.js`

**Shared renderers (packages/ui):**
- Modify: `packages/ui/src/components/StatStrip.jsx`
- Modify: `packages/ui/src/runly-renderer/RunlyTable.jsx`
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx`
- Modify: `packages/ui/src/runly-renderer/RunlyDetail.jsx`
- Modify: `packages/ui/src/runly-renderer/detail-presentation.js`
- Modify: `packages/ui/src/runly-renderer/runly-form-schema.js`
- Modify: `packages/ui/src/index.js`
- Create: `packages/ui/src/runly-renderer/DynamicFieldsSection.jsx`
- Create: `packages/ui/src/components/FormCompletionRing.jsx`
- Create: `packages/ui/src/components/FormPreviewPanel.jsx`
- Modify: `packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js`
- Create: `packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`

**Inventory module (apps/desktop):**
- Create: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`
- Create: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js`
- Create: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailAssignmentSection.jsx`
- Create: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailCommentsSection.jsx`
- Create: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx`
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`
- Rewrite: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx`
- Rewrite: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx`

No changes to: `ModuleOutlet.jsx` (routes stay identical), `InventoryScreen.jsx` (list, out of scope), `InventoryCatalogsScreen.jsx`, `InventoryAssignmentsScreen.jsx`, `InventoryCustomFieldsForm.jsx`, `InventoryAssignmentPanel.jsx`, `InventoryCommentThread.jsx`, `useInventoryItems.js`, `useInventoryCatalogs.js`, `inventory-constants.js`, any Prisma schema/migration, any permission key, `packages/validators`.

---

## Task 1: `getItem()` returns flat convenience fields

**Files:**
- Modify: `apps/api/src/services/inventory-service.js:135-157`
- Test: `apps/api/src/services/__tests__/inventory-service.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/__tests__/inventory-service.test.js` (after the last `describe` block, before the final closing of the file):

```js
// ---------------------------------------------------------------------------
// getItem
// ---------------------------------------------------------------------------

describe('getItem', () => {
  it('computes categoryName/brandName/locationName/assignedToName like listItems does', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID,
          companyId: COMPANY_ID,
          enabled: true,
          category: { id: 'cat-1', name: 'Laptops' },
          brand: { id: 'brand-1', name: 'Dell' },
          location: { id: 'loc-1', name: 'Oficina Centro' },
          assignedTo: { id: EMPLOYEE_ID, firstName: 'Ana', lastName: 'Lopez' },
        }),
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.categoryName, 'Laptops')
    assert.equal(result.brandName, 'Dell')
    assert.equal(result.locationName, 'Oficina Centro')
    assert.equal(result.assignedToName, 'Ana Lopez')
  })

  it('flat fields are null when relations are missing', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID,
          companyId: COMPANY_ID,
          enabled: true,
          category: null,
          brand: null,
          location: null,
          assignedTo: null,
        }),
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.categoryName, null)
    assert.equal(result.brandName, null)
    assert.equal(result.locationName, null)
    assert.equal(result.assignedToName, null)
  })

  it('throws 404 if item not found', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.getItem(ITEM_ID, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: FAIL — the 3 new `getItem` assertions fail because `result.categoryName` etc. are `undefined` (not computed yet). The "throws 404" test already passes (existing behavior).

- [ ] **Step 3: Implement**

In `apps/api/src/services/inventory-service.js`, replace the `getItem` function body:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: PASS — all `getItem` tests green, all pre-existing tests in the file still green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inventory-service.js apps/api/src/services/__tests__/inventory-service.test.js
git commit -m "feat(inventory): compute flat category/brand/location/assignee names in getItem"
```

---

## Task 2: `deleteItem()` writes an audit entry; enrich existing audit payloads with item name

**Files:**
- Modify: `apps/api/src/services/inventory-service.js` (`deleteItem` at line 423; the two `updateItem` bridge calls around lines 384-396 and 408-419; `assignItem` bridge call around line 457-468; `returnItem` bridge call around line 501-512)
- Test: `apps/api/src/services/__tests__/inventory-service.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/__tests__/inventory-service.test.js`:

```js
// ---------------------------------------------------------------------------
// deleteItem
// ---------------------------------------------------------------------------

describe('deleteItem', () => {
  it('soft-disables the item and logs an inventory.item.deleted audit entry with the item name', async () => {
    let capturedAudit = null
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true, name: 'Laptop XPS' }),
        update: async (args) => ({ id: args.where.id, enabled: false, name: 'Laptop XPS' }),
      },
    })
    const activityBridge = {
      logAndPublish: async (args) => { capturedAudit = args },
    }
    const svc = createInventoryService({ prisma, activityBridge })
    const result = await svc.deleteItem(ITEM_ID, COMPANY_ID)

    assert.equal(result.enabled, false)
    assert.ok(capturedAudit, 'logAndPublish was called')
    assert.equal(capturedAudit.auditEntry.action, 'inventory.item.deleted')
    assert.equal(capturedAudit.auditEntry.entityId, ITEM_ID)
    assert.equal(capturedAudit.auditEntry.entityType, 'InvItem')
    assert.equal(capturedAudit.auditEntry.after.name, 'Laptop XPS')
    assert.equal(capturedAudit.companyId, COMPANY_ID)
  })

  it('throws 404 if item not found', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.deleteItem(ITEM_ID, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: FAIL — `capturedAudit` stays `null` because `deleteItem` never calls `logAndPublish` today.

- [ ] **Step 3: Implement**

Replace `deleteItem` in `apps/api/src/services/inventory-service.js`:

```js
  async function deleteItem(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invItem.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Item not found', 404);
    const updated = await prisma.invItem.update({ where: { id }, data: { enabled: false } });
    await bridge.logAndPublish({
      auditEntry: {
        actorId: 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: id,
        action: 'inventory.item.deleted',
        after: { enabled: false, name: existing.name ?? null },
      },
      hint: { verb: 'deleted', label: existing.name ?? id },
      companyId,
    }).catch(() => {});
    return updated;
  }
```

Then, in the SAME file, enrich the `after` payload of the four existing `logAndPublish` calls so their translators (Task 3) have a name to work with. Each edit only adds one key to an existing `after: {...}` object literal — no other logic changes.

In `createItem`'s two `logAndPublish` calls (`after: { name: created.name, assetTag: created.assetTag }`) — already has `name`, **no change needed**.

In `updateItem`'s first `logAndPublish` call (inside the `if (customValues...)` branch):
```js
          action: 'inventory.item.updated',
          after: { fields: Object.keys(updateData) },
```
becomes:
```js
          action: 'inventory.item.updated',
          after: { fields: Object.keys(updateData), name: result?.name ?? null },
```

In `updateItem`'s second `logAndPublish` call (the branch without custom values):
```js
        action: 'inventory.item.updated',
        after: { fields: Object.keys(updateData) },
```
becomes:
```js
        action: 'inventory.item.updated',
        after: { fields: Object.keys(updateData), name: updated?.name ?? null },
```

In `assignItem`'s `logAndPublish` call:
```js
        action: 'inventory.item.assigned',
        after: { employeeId },
```
becomes:
```js
        action: 'inventory.item.assigned',
        after: { employeeId, name: item?.name ?? null },
```

In `returnItem`'s `logAndPublish` call:
```js
        action: 'inventory.item.returned',
        after: { status: 'available' },
```
becomes:
```js
        action: 'inventory.item.returned',
        after: { status: 'available', name: item?.name ?? null },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: PASS — all `deleteItem` tests green, all pre-existing tests (createItem, assignItem, returnItem, etc.) still green since only an `after` payload key was added, no signature changed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inventory-service.js apps/api/src/services/__tests__/inventory-service.test.js
git commit -m "feat(inventory): audit item deletion and include item name in audit payloads"
```

---

## Task 3: Register `inventory.item.*` translators in `activity-bridge.js`

**Files:**
- Modify: `apps/api/src/services/activity-bridge.js:21-126` (the `TRANSLATORS` map)
- Test: `apps/api/src/services/__tests__/activity-bridge.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/__tests__/activity-bridge.test.js`, inside the existing `describe("activity-bridge", ...)` block (add these `it(...)` calls right before the final closing `});` of that describe):

```js
  it("has translators registered for inventory item actions", () => {
    assert.ok(getTranslator("inventory.item.created"));
    assert.ok(getTranslator("inventory.item.updated"));
    assert.ok(getTranslator("inventory.item.assigned"));
    assert.ok(getTranslator("inventory.item.returned"));
    assert.ok(getTranslator("inventory.item.deleted"));
  });

  it("translates inventory.item.created into a real Spanish sentence with a link", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.created",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        after: { name: "Laptop XPS 15", assetTag: "INV-2026-0001" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.equal(a.type, "inventory.item.created");
    assert.ok(a.summary.includes("Laptop XPS 15"));
    assert.equal(a.link, `/app/m/runly.inventory/inventory/${ENTITY_ID}`);
    assert.equal(a.severity, "success");
  });

  it("translates inventory.item.deleted using the item name captured in after", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.deleted",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        after: { enabled: false, name: "Laptop XPS 15" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.ok(a.summary.includes("Laptop XPS 15"));
    assert.equal(a.severity, "warning");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/activity-bridge.test.js`
Expected: FAIL — `getTranslator("inventory.item.created")` etc. return `null`/`undefined` today.

- [ ] **Step 3: Implement**

In `apps/api/src/services/activity-bridge.js`, add five entries to the `TRANSLATORS` map, right after the existing `"catalog.stock.adjust"` entry (before the map's closing `};` on line 126):

```js
  "inventory.item.created": ({ actor, entityId, after }) => ({
    type: "inventory.item.created",
    summary: `${actorName(actor)} dio de alta el activo ${safeStr(after?.name)}`.trim(),
    severity: "success",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.updated": ({ actor, entityId, after }) => ({
    type: "inventory.item.updated",
    summary: `${actorName(actor)} actualizó el activo ${safeStr(after?.name)}`.trim(),
    severity: "info",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.assigned": ({ actor, entityId, after }) => ({
    type: "inventory.item.assigned",
    summary: `${actorName(actor)} asignó el activo ${safeStr(after?.name)}`.trim(),
    severity: "success",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.returned": ({ actor, entityId, after }) => ({
    type: "inventory.item.returned",
    summary: `${actorName(actor)} registró la devolución del activo ${safeStr(after?.name)}`.trim(),
    severity: "info",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.deleted": ({ actor, entityId, after }) => ({
    type: "inventory.item.deleted",
    summary: `${actorName(actor)} dio de baja el activo ${safeStr(after?.name)}`.trim(),
    severity: "warning",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/activity-bridge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/activity-bridge.js apps/api/src/services/__tests__/activity-bridge.test.js
git commit -m "feat(activity-bridge): translate inventory.item.* audit actions into Spanish"
```

---

## Task 4: Add `PATCH /inventory/items/:id` route alias

**Files:**
- Modify: `apps/api/src/routes/inventory/index.js:74-85`

- [ ] **Step 1: Implement**

In `apps/api/src/routes/inventory/index.js`, immediately after the existing `router.put("/inventory/items/:id", ...)` block (which stays untouched), add a `PATCH` alias calling the exact same service method:

```js
  // PATCH alias — RunlyForm (the shared blueprint-driven form renderer) always
  // submits edits via PATCH, matching the convention already used by
  // PATCH /fleet/vehicles/:id. The PUT route above is kept for any other caller.
  router.patch("/inventory/items/:id", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const data = await c.req.json();
      const item = await inventoryService.updateItem(id, data, companyId);
      return c.json({ data: item });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo actualizar el item." }, 500);
    }
  });
```

- [ ] **Step 2: Verify with a syntax check**

Run: `node --check apps/api/src/routes/inventory/index.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Manual verification**

Start the API (`pnpm dev:api`) and run (replace `$RUNLY_TOKEN` with a valid session token):

```bash
curl -X PATCH "http://localhost:4010/inventory/items/<an-existing-item-id>" \
  -H "Authorization: Bearer $RUNLY_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Laptop XPS 15 (test)"}'
```

Expected: `200` with `{ "data": { ...,"name":"Laptop XPS 15 (test)" } }`, identical to what `PUT` on the same path already returns.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/inventory/index.js
git commit -m "feat(inventory): add PATCH alias for item update to match RunlyForm's submit convention"
```

---

## Task 5: `StatStrip` adopts the glass card style

**Files:**
- Modify: `packages/ui/src/components/StatStrip.jsx:28`

- [ ] **Step 1: Implement**

In `packages/ui/src/components/StatStrip.jsx`, change the `Card` variant from `"solid"` to `"default"` (the app's `Card` already renders `variant="default"` with the `.glass` utility class — see `packages/ui/src/components/Card.jsx:13`):

```jsx
          <Card
            variant="default"
            className="flex h-full min-w-[150px] snap-start flex-col justify-between gap-2 p-3 sm:min-w-0"
          >
```

(only the `variant` value changes, from `"solid"` to `"default"`).

- [ ] **Step 2: Verify with a syntax check**

Run: `node --check packages/ui/src/components/StatStrip.jsx`

This file uses JSX, so `node --check` will fail on the JSX syntax itself — that's expected and not a signal of a real problem for `.jsx` files in this repo (JSX is compiled by Vite, not run directly by Node). Skip `node --check` for every `.jsx` file in this plan; rely on `pnpm build` (Task 24) and manual QA instead.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/StatStrip.jsx
git commit -m "style(ui): give StatStrip tiles the glass panel treatment"
```

---

## Task 6: `RunlyTable`'s outer container adopts the glass panel style

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyTable.jsx` (4 occurrences, at lines 671, 728, 913, 964)

- [ ] **Step 1: Implement**

In `packages/ui/src/runly-renderer/RunlyTable.jsx`, replace every occurrence of the exact string `"rounded-2xl border border-[hsl(var(--border))] overflow-clip"` with `"rounded-2xl glass overflow-clip"` (the `.glass` utility already declares its own background/border/shadow/blur, so the manual `border border-[hsl(var(--border))]` is dropped in favor of it). Use a single find/replace across all 4 occurrences in the file — they are byte-identical strings at lines 671, 728, 913 and 964.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyTable.jsx
git commit -m "style(ui): give RunlyTable's outer panel the glass treatment"
```

---

## Task 7: `RunlyForm` section cards adopt the glass panel style

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx:1301-1313`

- [ ] **Step 1: Implement**

In `packages/ui/src/runly-renderer/RunlyForm.jsx`, the `renderSection` function currently wraps each section in:

```jsx
    return (
      <div
        key={section.id}
        className={cn(
          "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4 space-y-4",
          header && isCollapsible && !isCollapsed && "pb-5",
        )}
      >
        {header}
        {!isCollapsed ? renderSectionBody() : null}
      </div>
    );
```

Replace the wrapping `className` with the glass treatment (drop the manual `border`/`bg` in favor of `.glass`, keep the rounding/padding/spacing/collapse-state logic identical):

```jsx
    return (
      <div
        key={section.id}
        className={cn(
          "glass rounded-xl px-5 py-4 space-y-4",
          header && isCollapsible && !isCollapsed && "pb-5",
        )}
      >
        {header}
        {!isCollapsed ? renderSectionBody() : null}
      </div>
    );
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyForm.jsx
git commit -m "style(ui): give RunlyForm section cards the glass treatment"
```

---

## Task 8: `RunlyDetail` sections get a glass card wrapper (they currently have none)

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyDetail.jsx:946-1049`

- [ ] **Step 1: Implement**

`RunlyDetail`'s `renderSection` today returns a bare `<div className="space-y-4">` with no card/panel background at all (unlike `RunlyForm`'s sections). Wrap the whole returned element in a glass panel matching `RunlyForm`'s new treatment. Replace:

```jsx
  const renderSection = (section) => (
    <div key={section.id} className="space-y-4">
      {section.title ? (
```

with:

```jsx
  const renderSection = (section) => (
    <div key={section.id} className="glass rounded-xl px-5 py-4 space-y-4">
      {section.title ? (
```

(the rest of the function body — the header block, the `attachments`/`relation-card`/`relation-list`/`fields`/`component` branches, and the closing `</div>` — stays exactly as-is; only the opening tag's `className` changes).

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyDetail.jsx
git commit -m "style(ui): wrap RunlyDetail sections in a glass panel"
```

---

## Task 9: Extend `RunlyDetail`'s status dictionary with inventory's status vocabulary

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyDetail.jsx:46-66`

- [ ] **Step 1: Implement**

`RunlyDetail.jsx` already has `STATUS_LABELS`/`STATUS_COLORS` dictionaries used by the generic `renderValue()` status-chip fallback (covers `active`/`inactive`/`maintenance`/`retired`/`pending`/`disabled`/`draft`/`finalized`). Inventory's `InvItem.status` values are `available`/`assigned`/`maintenance`/`retired`/`lost`/`stolen`/`disposed` (see `apps/desktop/src/modules/runly.inventory/lib/inventory-constants.js`) — `maintenance`/`retired` are already covered, the other five are not. Add the missing five keys to both dictionaries:

```js
const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
  draft: "Borrador",
  finalized: "Finalizado",
  available: "Disponible",
  assigned: "Asignado",
  lost: "Perdido",
  stolen: "Robado",
  disposed: "Desechado",
};

const STATUS_COLORS = {
  active: "bg-green-500/15 text-green-700 dark:text-green-400",
  inactive: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  maintenance: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  retired: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  pending: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  disabled: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  draft: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  finalized: "bg-green-500/15 text-green-700 dark:text-green-400",
  available: "bg-green-500/15 text-green-700 dark:text-green-400",
  assigned: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  lost: "bg-red-500/15 text-red-700 dark:text-red-400",
  stolen: "bg-red-500/15 text-red-700 dark:text-red-400",
  disposed: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
};
```

None of the five new keys collide with the eight existing ones, so no other blueprint's status rendering changes.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyDetail.jsx
git commit -m "feat(ui): add inventory status labels/colors to RunlyDetail's status dictionary"
```

---

## Task 10: `normalizeComponentSection` pure helper in `detail-presentation.js`

**Files:**
- Modify: `packages/ui/src/runly-renderer/detail-presentation.js`
- Test: `packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js` (add `normalizeComponentSection` to the existing `import { ... } from "../detail-presentation.js";` list at the top, then add):

```js
test("normalizeComponentSection returns null without a component key", () => {
  assert.equal(normalizeComponentSection({}, 0, "Historial", "History"), null);
  assert.equal(normalizeComponentSection({ component: "  " }, 0, null, null), null);
});

test("normalizeComponentSection builds a component section descriptor", () => {
  const section = normalizeComponentSection(
    { id: "history", component: "runly.inventory:HistorySection" },
    3,
    "Historial de auditoría",
    "History",
  );
  assert.deepEqual(section, {
    id: "history",
    title: "Historial de auditoría",
    type: "component",
    icon: "History",
    component: "runly.inventory:HistorySection",
  });
});

test("normalizeComponentSection falls back to a generated id", () => {
  const section = normalizeComponentSection(
    { component: "runly.inventory:AssignmentSection" },
    2,
    null,
    null,
  );
  assert.equal(section.id, "section-2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js`
Expected: FAIL with `normalizeComponentSection is not defined` (not exported yet).

- [ ] **Step 3: Implement**

In `packages/ui/src/runly-renderer/detail-presentation.js`, add this exported function (after `splitSectionsByColumn`, at the end of the file):

```js
export function normalizeComponentSection(entry, sectionIndex, title, icon) {
  const componentKey =
    typeof entry?.component === "string" && entry.component.trim()
      ? entry.component.trim()
      : "";
  if (!componentKey) return null;
  return {
    id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
    title: title ?? null,
    type: "component",
    icon: icon ?? null,
    component: componentKey,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js`
Expected: PASS — all tests in the file green (existing `getByPath`/`replacePathTokens`/`buildChipList`/`resolveHeroModel`/`resolveKpis`/`splitSectionsByColumn` tests plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/runly-renderer/detail-presentation.js packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js
git commit -m "feat(ui): add normalizeComponentSection pure helper for RunlyDetail component sections"
```

---

## Task 11: Wire the `"component"` section type + `componentRegistry` prop into `RunlyDetail`

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyDetail.jsx`

- [ ] **Step 1: Implement**

In `packages/ui/src/runly-renderer/RunlyDetail.jsx`:

1. Add the import (alongside the existing `detail-presentation.js` import):

```js
import {
  resolveHeroModel,
  resolveKpis,
  splitSectionsByColumn,
  normalizeComponentSection,
} from "./detail-presentation.js";
```

2. In the local `normalizeSections(schema, fieldMap)` function, add a branch for `sectionType === "component"` right after the existing `relation-list` branch (before the `fieldDefs` block that handles the default `"fields"` case):

```js
      if (sectionType === "component") {
        return normalizeComponentSection(entry, sectionIndex, sectionTitle, sectionIcon);
      }
```

3. Add a new `componentRegistry` prop to the `RunlyDetail` function signature:

```js
export function RunlyDetail({
  blueprint,
  fields,
  data,
  onEdit,
  onBack,
  heroActions,
  token,
  apiBaseUrl,
  companyId = null,
  componentRegistry = null,
}) {
```

4. In `renderSection`, add a new branch for `section.type === "component"` right after the existing `relation-list` branch and before the `fields` branch:

```jsx
      {section.type === "component" ? (() => {
        const Comp = componentRegistry?.resolve?.(section.component) ?? null;
        if (!Comp) {
          return (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
              Componente "{section.component}" no está registrado.
            </div>
          );
        }
        return (
          <Comp data={data} apiBaseUrl={apiBaseUrl} token={token} companyId={companyId} />
        );
      })() : null}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyDetail.jsx
git commit -m "feat(ui): add \"component\" section type to RunlyDetail, resolved via componentRegistry"
```

---

## Task 12: `"custom-fields"` section normalization in `runly-form-schema.js`

**Files:**
- Modify: `packages/ui/src/runly-renderer/runly-form-schema.js`
- Test: `packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js` (new file)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSections } from "../runly-form-schema.js";

test("normalizeSections builds a custom-fields section from apiPath/categoryField/valuePrefix", () => {
  const fieldMap = new Map();
  const sections = normalizeSections(
    {
      sections: [
        {
          id: "custom",
          title: "Campos personalizados",
          icon: "SlidersHorizontal",
          type: "custom-fields",
          customFields: {
            apiPath: "/inventory/custom-fields",
            categoryField: "categoryId",
            valuePrefix: "customValues",
          },
        },
      ],
    },
    fieldMap,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "custom-fields");
  assert.equal(sections[0].title, "Campos personalizados");
  assert.equal(sections[0].icon, "SlidersHorizontal");
  assert.deepEqual(sections[0].customFields, {
    apiPath: "/inventory/custom-fields",
    categoryField: "categoryId",
    valuePrefix: "customValues",
  });
});

test("normalizeSections still handles a plain fields section unaffected by the new type", () => {
  const fieldMap = new Map();
  const sections = normalizeSections(
    { sections: [{ title: "Datos", fields: [{ field: "name", label: "Nombre" }] }] },
    fieldMap,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "fields");
  assert.equal(sections[0].fields[0], "name");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`
Expected: FAIL — the `custom-fields` section currently falls through to the default "fields" branch, so `sections[0].type` is `"fields"` and `sections[0].customFields` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/ui/src/runly-renderer/runly-form-schema.js`, inside `normalizeSections`, add a branch for `sectionType === "custom-fields"` right after the existing `"parts"`/`"parts-editor"` branch (before the generic `fields` handling):

```js
      if (sectionType === "custom-fields") {
        const cfg = entry.customFields ?? {};
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: normalizeSpanishLabel(
            entry.title ?? entry.label ?? "Campos personalizados",
          ),
          type: "custom-fields",
          icon:
            typeof entry.icon === "string" && entry.icon.trim()
              ? entry.icon.trim()
              : null,
          ...toSectionMeta(entry),
          customFields: {
            apiPath:
              typeof cfg.apiPath === "string" && cfg.apiPath.trim()
                ? cfg.apiPath.trim()
                : null,
            categoryField:
              typeof cfg.categoryField === "string" && cfg.categoryField.trim()
                ? cfg.categoryField.trim()
                : null,
            valuePrefix:
              typeof cfg.valuePrefix === "string" && cfg.valuePrefix.trim()
                ? cfg.valuePrefix.trim()
                : "customValues",
          },
        };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/runly-renderer/runly-form-schema.js packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js
git commit -m "feat(ui): add custom-fields section normalization to RunlyForm's schema layer"
```

---

## Task 13: `DynamicFieldsSection.jsx` — renders the per-category custom fields inside `RunlyForm`

**Files:**
- Create: `packages/ui/src/runly-renderer/DynamicFieldsSection.jsx`

- [ ] **Step 1: Implement**

Create `packages/ui/src/runly-renderer/DynamicFieldsSection.jsx`. This mirrors `InventoryCustomFieldsForm`'s field-type switch exactly, but drives plain `formValues`/`onChange` instead of `react-hook-form`'s `Controller` (because it lives inside `RunlyForm`, which manages its own local state, not RHF):

```jsx
import { useEffect, useState } from "react";
import {
  TextField,
  NumberField,
  DateField,
  SelectField,
  CheckboxField,
} from "../components/FormFields.jsx";
import { MarkdownField } from "../components/MarkdownField.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function DynamicFieldControl({ definition, value, onChange }) {
  const { label, fieldType, options = [], required } = definition;
  const commonProps = { label, required: Boolean(required) };

  switch (fieldType) {
    case "number":
      return (
        <NumberField {...commonProps} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "date":
      return (
        <DateField {...commonProps} value={value ?? ""} onChange={(val) => onChange(val ?? "")} />
      );
    case "textarea":
      return (
        <MarkdownField {...commonProps} value={value ?? ""} onChange={(e) => onChange(e?.target?.value ?? "")} />
      );
    case "select": {
      const selectOptions = options.map((opt) =>
        typeof opt === "string" ? { label: opt, value: opt } : opt,
      );
      return (
        <SelectField {...commonProps} options={selectOptions} value={value ?? ""} onValueChange={onChange} />
      );
    }
    case "boolean":
      return (
        <CheckboxField
          {...commonProps}
          checked={value === true || value === "true"}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "url":
      return (
        <TextField {...commonProps} type="url" placeholder="https://" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "email":
      return (
        <TextField {...commonProps} type="email" placeholder="correo@ejemplo.com" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "text":
    default:
      return (
        <TextField {...commonProps} type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
  }
}

// Fetches the InvCustomField-style definitions for the current category value and
// renders one control per definition, writing into formValues under
// `${valuePrefix}.${fieldKey}` — RunlyForm's handleSubmit collects these into a
// `customValues: [{ fieldId, value }]` array on submit (see Task 14).
export function DynamicFieldsSection({
  config,
  formValues,
  onFieldChange,
  apiBaseUrl,
  token,
  companyId,
}) {
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const categoryValue = config?.categoryField ? formValues[config.categoryField] : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!config?.apiPath || !categoryValue) {
        setDefinitions([]);
        return;
      }
      setLoading(true);
      try {
        const url = new URL(joinUrl(apiBaseUrl, config.apiPath));
        url.searchParams.set("categoryId", String(categoryValue));
        const res = await fetch(url.toString(), { headers: buildApiHeaders(token, companyId) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
        if (!cancelled) setDefinitions(rows);
      } catch {
        if (!cancelled) setDefinitions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, token, companyId, config?.apiPath, categoryValue]);

  if (!categoryValue) return null;
  if (loading) return <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando campos...</p>;
  if (definitions.length === 0) return null;

  const prefix = config.valuePrefix ?? "customValues";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {definitions.map((def) => {
        const key = `${prefix}.${def.fieldKey}`;
        return (
          <div key={def.id} className={def.fieldType === "textarea" ? "col-span-full" : ""}>
            <DynamicFieldControl
              definition={def}
              value={formValues[key]}
              onChange={(val) => onFieldChange(key, val)}
            />
          </div>
        );
      })}
    </div>
  );
}

// Reads the `${prefix}.` -namespaced keys back out of formValues and returns the
// [{ fieldId, value }] array shape the inventory API's create/update endpoints
// expect for `customValues`. `definitions` must be the same list this component
// last fetched (RunlyForm keeps its own copy via `onDefinitionsChange`).
export function buildCustomFieldsPayload(formValues, definitions, valuePrefix) {
  const prefix = valuePrefix ?? "customValues";
  const byKey = new Map(definitions.map((d) => [d.fieldKey, d]));
  const out = [];
  for (const [formKey, value] of Object.entries(formValues)) {
    if (!formKey.startsWith(`${prefix}.`)) continue;
    const fieldKey = formKey.slice(prefix.length + 1);
    const def = byKey.get(fieldKey);
    if (!def) continue;
    if (value === undefined || value === null || value === "") continue;
    out.push({ fieldId: def.id, value: String(value) });
  }
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/DynamicFieldsSection.jsx
git commit -m "feat(ui): add DynamicFieldsSection for RunlyForm's custom-fields section type"
```

---

## Task 14: Wire the `"custom-fields"` section type into `RunlyForm.jsx`

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx`

- [ ] **Step 1: Implement**

In `packages/ui/src/runly-renderer/RunlyForm.jsx`:

1. Add the import:

```js
import { DynamicFieldsSection, buildCustomFieldsPayload } from "./DynamicFieldsSection.jsx";
```

2. Add a piece of state to track the last-fetched custom field definitions per section (needed at submit time to build the `customValues` payload), right after the existing `const [reportParts, setReportParts] = useState(...)` line:

```js
  const [customFieldDefs, setCustomFieldDefs] = useState({});
```

3. Add `"custom-fields"` to the `MAIN_SECTION_TYPES` set (near the top of the file):

```js
const MAIN_SECTION_TYPES = new Set(["fields", "parts", "attachments", "custom-fields"]);
```

4. In `renderSectionBody()`, add a branch for `section.type === "custom-fields"` right after the existing `if (section.type === "parts") { ... }` block:

```jsx
      if (section.type === "custom-fields") {
        return (
          <DynamicFieldsSection
            config={section.customFields}
            formValues={formValues}
            onFieldChange={handleChange}
            apiBaseUrl={apiBaseUrl}
            token={token}
            companyId={companyId}
            onDefinitionsChange={(defs) =>
              setCustomFieldDefs((prev) => ({ ...prev, [section.id]: defs }))
            }
          />
        );
      }
```

5. `DynamicFieldsSection` needs to report back which definitions it fetched so `handleSubmit` can build the payload — add an `onDefinitionsChange` prop to the component from Task 13. Update `DynamicFieldsSection`'s signature and effect in `packages/ui/src/runly-renderer/DynamicFieldsSection.jsx`:

```jsx
export function DynamicFieldsSection({
  config,
  formValues,
  onFieldChange,
  onDefinitionsChange,
  apiBaseUrl,
  token,
  companyId,
}) {
```

and, inside the existing `load()` function's success path, replace:

```js
        if (!cancelled) setDefinitions(rows);
```

with:

```js
        if (!cancelled) {
          setDefinitions(rows);
          onDefinitionsChange?.(rows);
        }
```

6. Back in `RunlyForm.jsx`'s `handleSubmit`, right after the existing block:

```js
    if (sections.some((section) => section.type === "parts")) {
      payload.parts = normalizeReportParts(reportParts);
    }
```

add:

```js
    const customFieldsSection = sections.find((section) => section.type === "custom-fields");
    if (customFieldsSection) {
      const defs = customFieldDefs[customFieldsSection.id] ?? [];
      const customValues = buildCustomFieldsPayload(
        formValues,
        defs,
        customFieldsSection.customFields?.valuePrefix,
      );
      if (customValues.length > 0) payload.customValues = customValues;
    }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyForm.jsx packages/ui/src/runly-renderer/DynamicFieldsSection.jsx
git commit -m "feat(ui): wire custom-fields section rendering and submit payload into RunlyForm"
```

---

## Task 15: `FormCompletionRing` — opt-in completion indicator

**Files:**
- Create: `packages/ui/src/components/FormCompletionRing.jsx`

- [ ] **Step 1: Implement**

Create `packages/ui/src/components/FormCompletionRing.jsx`:

```jsx
// Presentational only — RunlyForm computes `percent` and passes it in.
export function FormCompletionRing({ percent, filledCount, totalCount }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
      <div className="relative h-11 w-11 shrink-0">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(hsl(var(--primary)) ${pct * 3.6}deg, hsl(var(--border)) 0deg)`,
          }}
        />
        <div className="absolute inset-1 flex items-center justify-center rounded-full bg-[hsl(var(--card))]">
          <span className="text-[11px] font-semibold text-[hsl(var(--foreground))]">{pct}%</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[hsl(var(--foreground))]">Ficha completada</span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {filledCount} de {totalCount} campos
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export it from `packages/ui/src/index.js`**

Add `export { FormCompletionRing } from "./components/FormCompletionRing.jsx";` alongside the other component exports in that file.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/FormCompletionRing.jsx packages/ui/src/index.js
git commit -m "feat(ui): add FormCompletionRing component"
```

---

## Task 16: `FormPreviewPanel` — opt-in live preview panel

**Files:**
- Create: `packages/ui/src/components/FormPreviewPanel.jsx`

- [ ] **Step 1: Implement**

Create `packages/ui/src/components/FormPreviewPanel.jsx`:

```jsx
import * as LucideIcons from "lucide-react";

function GlyphIcon({ name, className }) {
  const Icon = (name && LucideIcons[name]) || LucideIcons.FileText;
  return <Icon className={className} aria-hidden="true" />;
}

// Presentational only.
//   title    string
//   subtitle string ("" hides it)
//   rows     [{ key, label, value }]
export function FormPreviewPanel({ title, subtitle, rows, fallbackIcon = "FileText" }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className="glass sticky top-4 flex flex-col gap-4 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        <GlyphIcon name={fallbackIcon} className="h-3.5 w-3.5" />
        Vista previa
      </div>
      <div>
        <p className="text-base font-semibold text-[hsl(var(--foreground))]">{title || "—"}</p>
        {subtitle ? <p className="text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p> : null}
      </div>
      {list.length > 0 ? (
        <dl className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
          {list.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-[hsl(var(--muted-foreground))]">{row.label}</dt>
              <dd className="truncate text-sm font-medium text-[hsl(var(--foreground))]">{row.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Export it from `packages/ui/src/index.js`**

Add `export { FormPreviewPanel } from "./components/FormPreviewPanel.jsx";`.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/FormPreviewPanel.jsx packages/ui/src/index.js
git commit -m "feat(ui): add FormPreviewPanel component"
```

---

## Task 17: Wire `schema.showCompletion` / `schema.preview` into `RunlyForm.jsx`

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx`

- [ ] **Step 1: Implement**

In `packages/ui/src/runly-renderer/RunlyForm.jsx`:

1. Add the imports:

```js
import { FormCompletionRing } from "../components/FormCompletionRing.jsx";
import { FormPreviewPanel } from "../components/FormPreviewPanel.jsx";
```

2. Add a helper (near the top of the file, alongside `matchesFieldRule`/`isFieldVisible`) that reuses the exact same read-only display formatting `renderFieldControl` already has, so the preview panel and the read-only field view share one formatter instead of duplicating it:

```js
function formatDisplayValue(field, value) {
  if (value === undefined || value === null || value === "") return null;
  if (field.type === "currency" || field.type === "decimal") {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount)
      ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount)
      : null;
  }
  if (field.type === "date") {
    const str = String(value);
    const datePart = str.includes("T") ? str.slice(0, 10) : str;
    const [year, month, day] = datePart.split("-");
    return year && month && day ? `${day}/${month}/${year}` : str;
  }
  if (field.type === "boolean") return value ? "Sí" : "No";
  if (field.type === "select" || field.type === "relation") {
    const options = normalizeOptions(field.options);
    const found = options.find((o) => String(o.value) === String(value));
    return found?.label ?? String(value);
  }
  return String(value);
}
```

3. In `renderFieldControl`'s existing `field.readonly` branch, replace the duplicated inline formatting logic:

```js
    if (field.readonly) {
      let displayValue;
      if (value === undefined || value === null || value === "") {
        displayValue = "—";
      } else if (field.type === "currency" || field.type === "decimal") {
        const amount = Number(value ?? 0);
        displayValue = Number.isFinite(amount)
          ? new Intl.NumberFormat("es-MX", {
              style: "currency",
              currency: "MXN",
            }).format(amount)
          : "—";
      } else if (field.type === "date") {
        const str = String(value);
        const datePart = str.includes("T") ? str.slice(0, 10) : str;
        const [year, month, day] = datePart.split("-");
        displayValue = year && month && day ? `${day}/${month}/${year}` : str;
      } else {
        displayValue = String(value);
      }
```

with:

```js
    if (field.readonly) {
      const displayValue = formatDisplayValue(field, value) ?? "—";
```

(the rest of that branch — the `<div>`/`<p>` markup — is unchanged).

4. Right before the `return (` of the component (i.e., right after the `renderSection` function definition, before `return (<form ...>`), compute the completion/preview data:

```js
  const previewConfig = schema.preview ?? null;
  const showCompletion = schema.showCompletion === true;

  const allFieldNames = [...fieldMap.keys()];
  const filledCount = allFieldNames.filter((name) => {
    const field = fieldMap.get(name);
    if (!isFieldVisible(field, formValues)) return false;
    const value = formValues[name];
    return value !== undefined && value !== null && String(value).trim() !== "";
  }).length;
  const completionPercent = allFieldNames.length > 0 ? (filledCount / allFieldNames.length) * 100 : 0;

  const previewModel = previewConfig
    ? {
        title: previewConfig.titleField ? String(formValues[previewConfig.titleField] ?? "") : "",
        subtitle: (Array.isArray(previewConfig.subtitleFields) ? previewConfig.subtitleFields : [])
          .map((name) => formValues[name])
          .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
          .join(" · "),
        rows: (Array.isArray(previewConfig.rows) ? previewConfig.rows : [])
          .map((row) => {
            const field = fieldMap.get(row.field);
            if (!field) return null;
            return {
              key: row.field,
              label: row.label ?? field.label,
              value: formatDisplayValue(field, formValues[row.field]),
            };
          })
          .filter(Boolean),
      }
    : null;
```

5. In the JSX, right before the existing:

```jsx
      <div
        className={
          asideSections.length > 0
            ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"
            : "space-y-3"
        }
      >
```

add the completion ring (only when `showCompletion` is true — every other blueprint that doesn't set `schema.showCompletion` renders nothing extra here):

```jsx
      {showCompletion ? (
        <FormCompletionRing
          percent={completionPercent}
          filledCount={filledCount}
          totalCount={allFieldNames.length}
        />
      ) : null}
```

6. When `previewModel` is set, the preview panel should render as an extra aside column. Replace the existing two-column wrapper:

```jsx
      <div
        className={
          asideSections.length > 0
            ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"
            : "space-y-3"
        }
      >
        <div className="space-y-3">
          {mainSections.map((section) => renderSection(section))}
        </div>
        {asideSections.length > 0 ? (
          <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
            {asideSections.map((section) => renderSection(section))}
          </div>
        ) : null}
      </div>
```

with:

```jsx
      <div
        className={
          asideSections.length > 0 || previewModel
            ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"
            : "space-y-3"
        }
      >
        <div className="space-y-3">
          {mainSections.map((section) => renderSection(section))}
        </div>
        {asideSections.length > 0 || previewModel ? (
          <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
            {previewModel ? (
              <FormPreviewPanel
                title={previewModel.title}
                subtitle={previewModel.subtitle}
                rows={previewModel.rows}
              />
            ) : null}
            {asideSections.map((section) => renderSection(section))}
          </div>
        ) : null}
      </div>
```

Both `showCompletion` and `preview` default to falsy/`null` when a blueprint's `schema` doesn't declare them (the existing `const schema = blueprint?.schema ?? {};` line already guarantees `schema.preview`/`schema.showCompletion` are `undefined` rather than throwing), so Fleet's and every other existing `FORM` blueprint's `RunlyForm` renders byte-for-byte the same as before this task.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyForm.jsx
git commit -m "feat(ui): wire opt-in schema.showCompletion and schema.preview into RunlyForm"
```

---

## Task 18: Inventory `RunlyDetail` adapter — Asignación

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailAssignmentSection.jsx`

- [ ] **Step 1: Implement**

```jsx
import { InventoryAssignmentPanel } from './InventoryAssignmentPanel.jsx'

// Adapter for RunlyDetail's "component" section type — translates the generic
// { data, apiBaseUrl, token, companyId } contract into InventoryAssignmentPanel's
// existing `item` prop, without changing that component at all.
export default function InventoryDetailAssignmentSection({ data }) {
  return <InventoryAssignmentPanel item={data} />
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/components/InventoryDetailAssignmentSection.jsx
git commit -m "feat(inventory): add RunlyDetail adapter for the assignment panel"
```

---

## Task 19: Inventory `RunlyDetail` adapter — Comentarios

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailCommentsSection.jsx`

- [ ] **Step 1: Implement**

```jsx
import { InventoryCommentThread } from './InventoryCommentThread.jsx'

export default function InventoryDetailCommentsSection({ data }) {
  return <InventoryCommentThread itemId={data?.id} />
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/components/InventoryDetailCommentsSection.jsx
git commit -m "feat(inventory): add RunlyDetail adapter for the comment thread"
```

---

## Task 20: Inventory `RunlyDetail` adapter — Historial de auditoría

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx`

- [ ] **Step 1: Implement**

Mirrors `apps/desktop/src/modules/runly.hr/components/HrEmployeeActivityPanel.jsx` exactly, adapted to the `{ data, token }` contract and `InvItem`:

```jsx
import { ActivityTimeline } from '@runly/ui'
import { runly } from '../../../lib/runly'

export default function InventoryDetailHistorySection({ data, token }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
        <h3 className="text-sm font-semibold">Historial de auditoría</h3>
      </div>
      <ActivityTimeline
        sdk={runly}
        token={token}
        entityType="InvItem"
        entityId={data?.id}
        limit={50}
        heightClass="max-h-[480px]"
        emptyMessage="Sin actividad registrada para este activo."
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx
git commit -m "feat(inventory): add RunlyDetail adapter for the audit history timeline"
```

---

## Task 21: Register the 3 adapters in `moduleComponentRegistry.js`

**Files:**
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`

- [ ] **Step 1: Implement**

In `apps/desktop/src/lib/moduleComponentRegistry.js`, add the imports (alongside the existing `runly.fleet`/`runly.growth` imports):

```js
import InventoryDetailAssignmentSection from "../modules/runly.inventory/components/InventoryDetailAssignmentSection.jsx";
import InventoryDetailCommentsSection from "../modules/runly.inventory/components/InventoryDetailCommentsSection.jsx";
import InventoryDetailHistorySection from "../modules/runly.inventory/components/InventoryDetailHistorySection.jsx";
```

and the registrations (after the existing `componentRegistry.register("runly.growth:LeadPriorityBadge", ...)` line):

```js
componentRegistry.register(
  "runly.inventory:AssignmentSection",
  InventoryDetailAssignmentSection,
);
componentRegistry.register(
  "runly.inventory:CommentsSection",
  InventoryDetailCommentsSection,
);
componentRegistry.register(
  "runly.inventory:HistorySection",
  InventoryDetailHistorySection,
);
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/lib/moduleComponentRegistry.js
git commit -m "feat(inventory): register detail-section adapters in the module component registry"
```

---

## Task 22: `inventory-item-form.blueprint.js`

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`

- [ ] **Step 1: Implement**

```js
import { ITEM_STATUSES, ITEM_TYPES } from '../lib/inventory-constants.js'

const STATUS_OPTIONS = ITEM_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const ITEM_TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))

export const INVENTORY_ITEM_FORM = {
  key: 'inventory.item.form',
  kind: 'FORM',
  schema: {
    entity: 'invItem',
    component: 'RunlyForm',
    apiPath: '/inventory/items',
    formMode: 'page',
    showCompletion: true,
    preview: {
      titleField: 'name',
      subtitleFields: ['model'],
      rows: [
        { field: 'itemType', label: 'Tipo' },
        { field: 'status', label: 'Estado' },
        { field: 'serialNumber', label: 'Serie' },
      ],
    },
    sections: [
      {
        label: 'Identificación',
        icon: 'IdCard',
        collapsible: true,
        fields: [
          { field: 'name', label: 'Nombre', type: 'text', required: true, hint: 'Laptop Dell XPS 15' },
          { field: 'assetTag', label: 'Etiqueta de activo', type: 'text', hint: 'Dejar vacío para auto-generar' },
          { field: 'itemType', label: 'Tipo', type: 'select', options: ITEM_TYPE_OPTIONS },
          { field: 'serialNumber', label: 'Número de serie', type: 'text' },
          {
            field: 'categoryId',
            label: 'Categoría',
            type: 'relation',
            hint: 'Para crear una categoría nueva, ve primero a Inventario > Catálogos.',
            relation: {
              apiPath: '/inventory/categories',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          {
            field: 'brandId',
            label: 'Marca',
            type: 'relation',
            hint: 'Para crear una marca nueva, ve primero a Inventario > Catálogos.',
            relation: {
              apiPath: '/inventory/brands',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          { field: 'model', label: 'Modelo', type: 'text' },
          { field: 'partNumber', label: 'Número de parte', type: 'text' },
        ],
      },
      {
        label: 'Ubicación y estado',
        icon: 'MapPin',
        collapsible: true,
        fields: [
          {
            field: 'locationId',
            label: 'Ubicación',
            type: 'relation',
            hint: 'Para crear una ubicación nueva, ve primero a Inventario > Catálogos.',
            relation: {
              apiPath: '/inventory/locations',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          { field: 'status', label: 'Estado', type: 'select', required: true, options: STATUS_OPTIONS },
        ],
      },
      {
        label: 'Compra',
        icon: 'Receipt',
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          { field: 'purchaseDate', label: 'Fecha de compra', type: 'date' },
          { field: 'purchasePrice', label: 'Precio de compra', type: 'currency', currency: 'USD', locale: 'es-PE' },
          { field: 'vendorName', label: 'Proveedor', type: 'text' },
          { field: 'invoiceNumber', label: 'Número de factura', type: 'text' },
        ],
      },
      {
        label: 'Garantía',
        icon: 'ShieldCheck',
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          { field: 'warrantyExpiry', label: 'Vencimiento de garantía', type: 'date' },
          { field: 'warrantyNotes', label: 'Notas de garantía', type: 'markdown' },
        ],
      },
      {
        id: 'custom-fields',
        type: 'custom-fields',
        label: 'Campos personalizados',
        icon: 'SlidersHorizontal',
        collapsible: true,
        customFields: {
          apiPath: '/inventory/custom-fields',
          categoryField: 'categoryId',
          valuePrefix: 'customValues',
        },
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        collapsible: true,
        defaultCollapsed: true,
        fields: [{ field: 'notes', label: 'Notas adicionales', type: 'markdown' }],
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        collapsible: true,
        attachments: {
          createMode: 'stage-until-parent-create',
          editMode: 'upload-immediately',
          listPath: '/inventory/items/:id/files',
          addPath: '/inventory/items/:id/files',
          removePath: '/inventory/items/:id/files/:docId',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.inventory', entityType: 'InvItem' },
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'fileAssetId' },
          permissions: {
            read: 'inventory.item.read',
            create: 'inventory.item.update',
            remove: 'inventory.item.update',
            fileUpload: 'files.assets.create',
            fileRead: 'files.assets.read',
          },
          limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
        },
      },
    ],
    submitLabel: 'Guardar activo',
    cancelLabel: 'Cancelar',
  },
}

export default INVENTORY_ITEM_FORM
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js
git commit -m "feat(inventory): add inventory.item.form RunlyForm blueprint"
```

---

## Task 23: `inventory-item-detail.blueprint.js`

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js`

- [ ] **Step 1: Implement**

```js
import { ITEM_TYPES } from '../lib/inventory-constants.js'

const ITEM_TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))

export const INVENTORY_ITEM_DETAIL = {
  key: 'inventory.item.detail',
  kind: 'DETAIL',
  schema: {
    entity: 'invItem',
    component: 'RunlyDetail',
    apiPath: '/inventory/items',
    layout: 'two-column',
    hero: {
      titleField: 'name',
      subtitleFields: ['itemType', 'model'],
      statusField: 'status',
      fallbackIcon: 'Package',
      metaChips: [
        { field: 'assetTag', label: 'Etiqueta', icon: 'Hash' },
        { field: 'categoryName', label: 'Categoría', icon: 'Layers' },
        { field: 'brandName', label: 'Marca', icon: 'Tag' },
      ],
    },
    kpis: [
      { label: 'Asignado a', field: 'assignedToName', icon: 'UserCheck' },
      { label: 'Fecha de asignación', field: 'assignedAt', type: 'date', icon: 'CalendarDays' },
      { label: 'Vencimiento de garantía', field: 'warrantyExpiry', type: 'date', icon: 'ShieldCheck' },
      { label: 'Valor de compra', field: 'purchasePrice', type: 'currency', icon: 'Tag' },
    ],
    sections: [
      {
        label: 'Identificación',
        icon: 'IdCard',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'assetTag', label: 'Etiqueta de activo', icon: 'Hash' },
          { field: 'itemType', label: 'Tipo', icon: 'Layers', type: 'select', options: ITEM_TYPE_OPTIONS },
          { field: 'categoryName', label: 'Categoría', icon: 'Layers' },
          { field: 'brandName', label: 'Marca', icon: 'Tag' },
          { field: 'model', label: 'Modelo', icon: 'Package' },
          { field: 'serialNumber', label: 'Número de serie', icon: 'Hash' },
          { field: 'partNumber', label: 'Número de parte', icon: 'Hash' },
        ],
      },
      {
        label: 'Ubicación y compra',
        icon: 'MapPin',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'locationName', label: 'Ubicación', icon: 'MapPin' },
          { field: 'purchaseDate', label: 'Fecha de compra', type: 'date', icon: 'CalendarDays' },
          { field: 'purchasePrice', label: 'Precio de compra', type: 'currency', icon: 'Tag' },
          { field: 'vendorName', label: 'Proveedor', icon: 'Building2' },
          { field: 'invoiceNumber', label: 'Número de factura', icon: 'Hash' },
        ],
      },
      {
        label: 'Garantía',
        icon: 'ShieldCheck',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'warrantyExpiry', label: 'Vencimiento de garantía', type: 'date', icon: 'CalendarDays' },
          { field: 'warrantyNotes', label: 'Notas de garantía', type: 'markdown', icon: 'FileText' },
        ],
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        column: 'main',
        fields: [{ field: 'notes', label: 'Notas', type: 'markdown', icon: 'FileText' }],
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        column: 'aside',
        attachments: {
          listPath: '/inventory/items/:id/files',
          addPath: '/inventory/items/:id/files',
          removePath: '/inventory/items/:id/files/:docId',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.inventory', entityType: 'InvItem' },
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'fileAssetId' },
        },
      },
      {
        id: 'assignment',
        type: 'component',
        label: 'Asignación',
        icon: 'UserCheck',
        column: 'aside',
        component: 'runly.inventory:AssignmentSection',
      },
      {
        id: 'comments',
        type: 'component',
        label: 'Comentarios',
        icon: 'MessageSquare',
        column: 'aside',
        component: 'runly.inventory:CommentsSection',
      },
      {
        id: 'history',
        type: 'component',
        label: 'Historial de auditoría',
        icon: 'History',
        column: 'aside',
        component: 'runly.inventory:HistorySection',
      },
    ],
  },
}

export default INVENTORY_ITEM_DETAIL
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js
git commit -m "feat(inventory): add inventory.item.detail RunlyDetail blueprint"
```

---

## Task 24: Rewrite `InventoryItemForm.jsx` to use `RunlyForm`

**Files:**
- Rewrite: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx`

- [ ] **Step 1: Implement**

Replace the full contents of `apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx`:

```jsx
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem } from '../hooks/useInventoryItems.js'
import { INVENTORY_ITEM_FORM } from '../blueprints/inventory-item-form.blueprint.js'

const API_BASE = getApiUrl()

export default function InventoryItemForm() {
  const { '*': wildcard } = useParams()
  const id = useMemo(() => {
    const parts = (wildcard ?? '').split('/')
    return parts[2] === 'edit' ? parts[1] : null
  }, [wildcard])
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const itemQuery = useInventoryItem(isEdit ? id : null)
  const editItem = itemQuery.data?.data ?? itemQuery.data ?? null

  if (isEdit && itemQuery.isLoading) {
    return <LoadingState message="Cargando activo..." />
  }
  if (isEdit && itemQuery.isError) {
    return <ErrorState message="No se pudo cargar el activo" />
  }

  const title = isEdit ? 'Editar activo' : 'Nuevo activo'

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        title={title}
        subtitle={isEdit ? (editItem?.name ?? '') : 'Completa la información del activo'}
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={INVENTORY_ITEM_FORM}
          initialData={isEdit ? editItem : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          onSuccess={(result) => {
            const savedId = result?.data?.id ?? editItem?.id
            navigate(savedId ? `/app/m/runly.inventory/inventory/${savedId}` : '/app/m/runly.inventory/inventory')
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  )
}
```

Notes on what this drops relative to the previous hand-rolled screen, all deliberate and covered by the blueprint instead:
- `react-hook-form`/`Controller`, `CollapsibleSection`, `mapItemToForm`/`buildApiPayload`, the manual category/brand/location `CreatableComboboxField` + `onCreate` wiring, and the fixed bottom action bar are all now handled generically by `RunlyForm` per the blueprint (sections, `relation` fields with inline `create`, and its own sticky footer).
- The comment thread that used to sit in the edit-mode sidebar (`InventoryCommentThread`) moves to the **detail** screen only (Task 25) — comments on a not-yet-saved-or-currently-being-edited record belong with the record's permanent view, matching how Fleet and every other blueprint-driven module in this codebase surfaces comments.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx
git commit -m "refactor(inventory): rebuild the create/edit screen on RunlyForm"
```

---

## Task 25: Rewrite `InventoryItemDetail.jsx` to use `RunlyDetail`

**Files:**
- Rewrite: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx`

- [ ] **Step 1: Implement**

Replace the full contents of `apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyDetail, LoadingState, ErrorState, ConfirmDialog, Button } from '@runly/ui'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
import { INVENTORY_ITEM_DETAIL } from '../blueprints/inventory-item-detail.blueprint.js'
import { componentRegistry } from '../../../lib/moduleComponentRegistry.js'

const API_BASE = getApiUrl()

export default function InventoryItemDetail() {
  const { '*': wildcard } = useParams()
  const id = useMemo(() => (wildcard ?? '').split('/')[1] ?? null, [wildcard])
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const { data, isLoading } = useInventoryItem(id)
  const deleteItem = useDeleteInventoryItem()

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingState />
      </div>
    )
  }

  const item = data?.data ?? data

  if (!item) {
    return (
      <div className="p-6">
        <ErrorState title="Item no encontrado" />
      </div>
    )
  }

  const handleDelete = async () => {
    await deleteItem.mutateAsync(id)
    toast.success('Activo eliminado correctamente')
    navigate('/app/m/runly.inventory/inventory')
  }

  return (
    <div className="p-6 space-y-6">
      <RunlyDetail
        blueprint={INVENTORY_ITEM_DETAIL}
        data={item}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        onBack={() => navigate('/app/m/runly.inventory/inventory')}
        onEdit={() => navigate(`/app/m/runly.inventory/inventory/${id}/edit`)}
        heroActions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/app/m/runly.inventory/inventory')}>
              Volver
            </Button>
            <Button type="button" size="sm" onClick={() => navigate(`/app/m/runly.inventory/inventory/${id}/edit`)}>
              Editar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Eliminar
            </Button>
          </div>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar activo"
        description={`Esta acción eliminará permanentemente "${item.name}" (${item.assetTag}). No se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx
git commit -m "refactor(inventory): rebuild the detail screen on RunlyDetail"
```

---

## Task 26: Verification pass

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

Run, in order, and confirm each is clean:

```bash
node --check apps/api/src/services/inventory-service.js
node --check apps/api/src/services/activity-bridge.js
node --check apps/api/src/routes/inventory/index.js
node --test apps/api/src/services/__tests__/inventory-service.test.js
node --test apps/api/src/services/__tests__/activity-bridge.test.js
node --test packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js
node --test packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js
pnpm lint
pnpm build
```

Expected: every command exits 0 with no new errors.

- [ ] **Step 2: Manual QA — desktop (1440px)**

With `pnpm dev` running:
1. Open `/app/m/runly.inventory/inventory/new`. Confirm: glass-styled sections with icon headers (no numbers), the completion ring updates as fields fill in, the preview panel on the right updates live, category/brand/location fields let you search and pick an existing catalog entry (no inline "create" button — this is a known, documented trade-off, see spec risk 5), the custom-fields section appears only after a category with custom fields is selected, files can be attached before saving, and saving navigates to the new item's detail page.
2. Open that new item's detail page. Confirm: hero shows name/status/etsiqueta/categoría/marca chips with correct glass styling, KPI strip shows Asignado a / Fecha de asignación / Vencimiento de garantía / Valor de compra, all sections render inside glass panels, Archivos/Asignación/Comentarios/Historial de auditoría all appear in the right column and are functional (upload a file, assign to an employee, post a comment, and confirm the history panel shows real Spanish sentences for "dio de alta", "actualizó", "asignó").
3. Edit the item, confirm the form pre-fills correctly and saving updates it (network tab: request goes to `PATCH /inventory/items/:id` and returns 200).
4. Delete the item from the detail screen's header action; confirm the audit history captured the deletion (re-query directly via `GET /activity?entityType=InvItem&entityId=<id>` with a valid token, or reopen a non-deleted item's detail to confirm nothing else broke).
5. Open `/app/m/runly.fleet/vehicles`, open a vehicle's detail and form screens. Confirm no visual regression from the `RunlyTable`/`RunlyForm`/`RunlyDetail`/`StatStrip` glass restyle (Tasks 5-9).

- [ ] **Step 3: Manual QA — mobile (390px, browser dev tools device toolbar)**

Repeat steps 1-2 above at 390px width. Confirm: single-column layout, `StatStrip` scrolls horizontally, the completion ring and preview panel collapse below the form fields (not beside them) rather than compressing the form, and the fixed submit bar remains usable.

- [ ] **Step 4: Run the 14-aspect UI checklist**

Follow `docs/ai-context/ui-screen-audit-checklist.md` against both rebuilt inventory screens (create/edit and detail). Document the result.

- [ ] **Step 5: Update `docs/TASKS.md`**

Add a line under the relevant section noting completion with verification evidence:

```
Verified: <YYYY-MM-DD> (node --test x4 green, pnpm lint clean, pnpm build clean, manual QA at 390px/1440px on inventory create/edit/detail + Fleet regression check)
```

- [ ] **Step 6: Final commit**

```bash
git add docs/TASKS.md
git commit -m "docs: record inventory glass redesign verification"
```
