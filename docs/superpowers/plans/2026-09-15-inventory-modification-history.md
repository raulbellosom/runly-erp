# Inventory Modification History (Field Diffs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Inventory's "Actividad" feed show exactly what changed on an edit — field-level old→new values, expandable inline — built on a generic diff capability in the shared `activity-bridge.js`/`ActivityTimeline` so other modules can adopt it later without rebuilding it.

**Architecture:** A pure `computeFieldChanges(before, after)` helper in `activity-bridge.js` auto-attaches a `payload.changes` array to any published Activity whenever the caller passes full before/after snapshots (not just today's partial hints). `inventory-service.js`'s `updateItem` starts capturing a real "before" snapshot and sends full flat snapshots (reusing the same shape `getItem()` already computes, so relation fields diff by name). `ActivityTimeline` gains an expand chevron that renders the diff using a field-label/type map the consumer supplies.

**Tech Stack:** Node.js/Hono API (`apps/api`), Prisma, React (`apps/desktop`, `packages/ui`), `node --test` for backend logic tests (no component-render test harness in this repo — JSX changes are verified via `pnpm build`/`pnpm lint` + manual check, per the pattern established in the previous plan in this docs folder).

---

### Task 1: `computeFieldChanges` in `activity-bridge.js`

**Files:**
- Modify: `apps/api/src/services/activity-bridge.js`
- Test: `apps/api/src/services/__tests__/activity-bridge.test.js`

- [x] **Step 1: Write the failing tests**

Add to the end of the `describe("activity-bridge", ...)` block in `apps/api/src/services/__tests__/activity-bridge.test.js` (before the final closing `});`), and add `computeFieldChanges` to the existing import at the top of the file:

```js
import {
  createActivityBridge,
  getTranslator,
  registerTranslator,
  computeFieldChanges,
} from "../activity-bridge.js";
```

```js
  it("computeFieldChanges returns [] when nothing differs", () => {
    const changes = computeFieldChanges(
      { name: "Laptop", purchasePrice: 100 },
      { name: "Laptop", purchasePrice: 100 },
    );
    assert.deepEqual(changes, []);
  });

  it("computeFieldChanges reports only fields whose value differs", () => {
    const changes = computeFieldChanges(
      { name: "Laptop", purchasePrice: 100, model: "XPS" },
      { name: "Laptop", purchasePrice: 150, model: "XPS" },
    );
    assert.deepEqual(changes, [
      { field: "purchasePrice", oldValue: 100, newValue: 150 },
    ]);
  });

  it("computeFieldChanges excludes id/companyId/createdAt/updatedAt/enabled", () => {
    const changes = computeFieldChanges(
      { id: "a", companyId: "c1", createdAt: "t1", updatedAt: "t1", enabled: true, name: "X" },
      { id: "a", companyId: "c1", createdAt: "t1", updatedAt: "t2", enabled: false, name: "Y" },
    );
    assert.deepEqual(changes, [{ field: "name", oldValue: "X", newValue: "Y" }]);
  });

  it("computeFieldChanges treats null and undefined as equal to each other", () => {
    const changes = computeFieldChanges({ notes: null }, { notes: undefined });
    assert.deepEqual(changes, []);
  });

  it("computeFieldChanges reports null -> value and value -> null", () => {
    const changes = computeFieldChanges({ brandName: null }, { brandName: "Asus" });
    assert.deepEqual(changes, [{ field: "brandName", oldValue: null, newValue: "Asus" }]);
  });

  it("computeFieldChanges returns [] when before or after is missing", () => {
    assert.deepEqual(computeFieldChanges(null, { name: "X" }), []);
    assert.deepEqual(computeFieldChanges({ name: "X" }, null), []);
    assert.deepEqual(computeFieldChanges(null, null), []);
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/activity-bridge.test.js`
Expected: FAIL — `computeFieldChanges is not a function` (or similar import error), since it doesn't exist yet.

- [x] **Step 3: Implement `computeFieldChanges`**

In `apps/api/src/services/activity-bridge.js`, add this right after the `getTranslator` function and before `export function createActivityBridge({ activityService, prisma }) {`:

```js
const NEVER_DIFF_FIELDS = new Set(["id", "companyId", "createdAt", "updatedAt", "enabled"]);

// Compares two flat, JSON-serializable snapshots and returns only the fields
// whose value actually changed (string-compared, so type/format differences
// like a Date object vs. its own ISO string never register as a false
// change). Pure and side-effect-free so any service can call it directly, and
// publishFromAudit below uses it to auto-attach payload.changes whenever a
// caller passes full snapshots instead of today's partial hints — see
// docs/superpowers/specs/2026-09-15-inventory-modification-history-design.md.
export function computeFieldChanges(before, after) {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") {
    return [];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    if (NEVER_DIFF_FIELDS.has(key)) continue;
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    const oldStr = oldValue === null ? "" : String(oldValue);
    const newStr = newValue === null ? "" : String(newValue);
    if (oldStr === newStr) continue;
    changes.push({ field: key, oldValue, newValue });
  }
  return changes;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/activity-bridge.test.js`
Expected: PASS, all tests including the 6 new ones.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/services/activity-bridge.js apps/api/src/services/__tests__/activity-bridge.test.js
git commit -m "feat(api): add computeFieldChanges pure diff helper to activity-bridge"
```

---

### Task 2: Wire `computeFieldChanges` into `publishFromAudit`

**Files:**
- Modify: `apps/api/src/services/activity-bridge.js`
- Test: `apps/api/src/services/__tests__/activity-bridge.test.js`

- [x] **Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/activity-bridge.test.js`:

```js
  it("publishFromAudit attaches payload.changes when before/after are full snapshots", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.updated",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        before: { name: "Laptop", purchasePrice: 100 },
        after: { name: "Laptop", purchasePrice: 150 },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.deepEqual(a.payload.changes, [
      { field: "purchasePrice", oldValue: 100, newValue: 150 },
    ]);
  });

  it("publishFromAudit omits payload when before/after produce no changes", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.updated",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        before: { name: "Laptop" },
        after: { name: "Laptop" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.equal(a.payload, undefined);
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/activity-bridge.test.js`
Expected: FAIL — `a.payload` is `undefined` in the first new test (changes never gets attached yet), and the "no changes" test may already incidentally pass (both are worth running to see the actual failure).

- [x] **Step 3: Update `publishFromAudit`**

In `apps/api/src/services/activity-bridge.js`, replace:

```js
    if (!base && !hint) {
      // Ningún translator registrado y sin hint: no publicamos para evitar spam.
      return null;
    }
    const merged = {
      ...base,
      ...hint,
      type: hint?.type ?? base?.type ?? auditEntry.action ?? "system.event",
      summary:
        hint?.summary ??
        base?.summary ??
        `${actorName(actor)} realizó ${auditEntry.action}`,
      severity: hint?.severity ?? base?.severity ?? "info",
      link: hint?.link ?? base?.link,
      payload: hint?.payload ?? base?.payload,
      entityType: hint?.entityType ?? auditEntry.entityType ?? base?.entityType,
      entityId: hint?.entityId ?? auditEntry.entityId ?? base?.entityId,
      companyId,
      actorId: auditEntry.actorId ?? null,
    };
    return activityService.publish({ ...merged, source: "audit_bridge" });
```

with:

```js
    if (!base && !hint) {
      // Ningún translator registrado y sin hint: no publicamos para evitar spam.
      return null;
    }
    const changes = computeFieldChanges(auditEntry.before, auditEntry.after);
    const payload = {
      ...(hint?.payload ?? base?.payload ?? null),
      ...(changes.length > 0 ? { changes } : {}),
    };
    const merged = {
      ...base,
      ...hint,
      type: hint?.type ?? base?.type ?? auditEntry.action ?? "system.event",
      summary:
        hint?.summary ??
        base?.summary ??
        `${actorName(actor)} realizó ${auditEntry.action}`,
      severity: hint?.severity ?? base?.severity ?? "info",
      link: hint?.link ?? base?.link,
      payload: Object.keys(payload).length > 0 ? payload : undefined,
      entityType: hint?.entityType ?? auditEntry.entityType ?? base?.entityType,
      entityId: hint?.entityId ?? auditEntry.entityId ?? base?.entityId,
      companyId,
      actorId: auditEntry.actorId ?? null,
    };
    return activityService.publish({ ...merged, source: "audit_bridge" });
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/activity-bridge.test.js`
Expected: PASS, all tests (existing + 8 new from Task 1/2).

- [x] **Step 5: Commit**

```bash
git add apps/api/src/services/activity-bridge.js apps/api/src/services/__tests__/activity-bridge.test.js
git commit -m "feat(api): auto-attach payload.changes in publishFromAudit from full before/after"
```

---

### Task 3: Capture real before/after snapshots in `inventory-service.js`

**Files:**
- Modify: `apps/api/src/services/inventory-service.js`
- Test: `apps/api/src/services/__tests__/inventory-service.test.js`

- [x] **Step 1: Confirm there's no existing `updateItem` describe block**

Run: `grep -n "describe('updateItem'" apps/api/src/services/__tests__/inventory-service.test.js`
Expected: no output — there is no `updateItem` test today, so Step 2 adds a new `describe('updateItem', ...)` block, placed after the existing `describe('deleteItem', ...)` block (which ends around line 704, right before the file's closing content) — follow that block's exact mocking style (`buildPrismaMock({ invItem: { findFirst, update } })`, `activityBridge.logAndPublish` capturing `capturedAudit`), shown below.

- [x] **Step 2: Write the failing test**

Add this new `describe` block to `apps/api/src/services/__tests__/inventory-service.test.js`, after the `describe('deleteItem', ...)` block's closing `})`:

```js
// ---------------------------------------------------------------------------
// updateItem
// ---------------------------------------------------------------------------

describe('updateItem', () => {
  it('sends full flat before/after snapshots to logAndPublish', async () => {
    let capturedAudit = null
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID, companyId: COMPANY_ID, enabled: true,
          name: 'Laptop XPS', purchasePrice: 100,
          category: null, brand: null, location: null,
        }),
        update: async () => ({
          id: ITEM_ID, name: 'Laptop XPS', purchasePrice: 150,
          category: null, brand: null, location: null,
        }),
      },
    })
    const activityBridge = {
      logAndPublish: async (args) => { capturedAudit = args },
    }
    const svc = createInventoryService({ prisma, activityBridge })
    await svc.updateItem(ITEM_ID, { purchasePrice: 150 }, COMPANY_ID)

    assert.ok(capturedAudit, 'logAndPublish was called')
    assert.equal(capturedAudit.auditEntry.action, 'inventory.item.updated')
    assert.equal(capturedAudit.auditEntry.before.purchasePrice, 100)
    assert.equal(capturedAudit.auditEntry.after.purchasePrice, 150)
    assert.equal(capturedAudit.auditEntry.before.name, 'Laptop XPS')
    assert.equal(capturedAudit.auditEntry.after.name, 'Laptop XPS')
  })
})
```

`ITEM_ID`, `COMPANY_ID`, `buildPrismaMock`, `createInventoryService`, `describe`, `it`, and `assert` are all already in scope at the top of this file (same imports/constants the `deleteItem` block above uses) — no new imports needed.

- [x] **Step 3: Run the test to verify it fails**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: FAIL — `capturedAudit.auditEntry.before` is `undefined` (or the whole `before` key is missing), since `updateItem` doesn't send it yet.

- [x] **Step 4: Add `toFlatSnapshot` and wire it into `updateItem`**

In `apps/api/src/services/inventory-service.js`, add this helper function near `resolveCoverImageFileId` (top-level inside the service factory, same pattern as the other private helpers in this file):

```js
  // Same flat shape getItem()/listItems() already expose (relation IDs
  // resolved to names), used to build before/after audit snapshots so
  // activity-bridge.js's computeFieldChanges can diff them into readable
  // field-level changes instead of raw category/brand/location UUIDs.
  function toFlatSnapshot(item) {
    if (!item) return null
    return {
      name: item.name ?? null,
      assetTag: item.assetTag ?? null,
      itemType: item.itemType ?? null,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      model: item.model ?? null,
      serialNumber: item.serialNumber ?? null,
      partNumber: item.partNumber ?? null,
      status: item.status ?? null,
      purchaseDate: item.purchaseDate ?? null,
      purchasePrice: item.purchasePrice != null ? Number(item.purchasePrice) : null,
      vendorName: item.vendorName ?? null,
      invoiceNumber: item.invoiceNumber ?? null,
      warrantyExpiry: item.warrantyExpiry ?? null,
      warrantyNotes: item.warrantyNotes ?? null,
      notes: item.notes ?? null,
    }
  }
```

Then, still in `inventory-service.js`, change the `existing` fetch at the top of `updateItem` from:

```js
    const existing = await prisma.invItem.findFirst({ where: { id, companyId, enabled: true } });
```

to:

```js
    const existing = await prisma.invItem.findFirst({
      where: { id, companyId, enabled: true },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });
```

Then replace the first `logAndPublish` call (inside the `customValues` branch):

```js
      await bridge.logAndPublish({
        auditEntry: {
          actorId: 'system',
          moduleKey: 'runly.inventory',
          entityType: 'InvItem',
          entityId: id,
          action: 'inventory.item.updated',
          after: { fields: Object.keys(updateData), name: result?.name ?? null },
        },
        hint: { verb: 'updated', label: result?.name ?? id },
        companyId,
      }).catch(() => {});
      return result;
```

with:

```js
      await bridge.logAndPublish({
        auditEntry: {
          actorId: 'system',
          moduleKey: 'runly.inventory',
          entityType: 'InvItem',
          entityId: id,
          action: 'inventory.item.updated',
          before: toFlatSnapshot(existing),
          after: toFlatSnapshot(result),
        },
        hint: { verb: 'updated', label: result?.name ?? id },
        companyId,
      }).catch(() => {});
      return result;
```

And replace the second `logAndPublish` call (the plain, non-custom-values branch):

```js
    await bridge.logAndPublish({
      auditEntry: {
        actorId: 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: id,
        action: 'inventory.item.updated',
        after: { fields: Object.keys(updateData), name: updated?.name ?? null },
      },
      hint: { verb: 'updated', label: updated.name ?? id },
      companyId,
    }).catch(() => {});
    return updated;
```

with:

```js
    await bridge.logAndPublish({
      auditEntry: {
        actorId: 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: id,
        action: 'inventory.item.updated',
        before: toFlatSnapshot(existing),
        after: toFlatSnapshot(updated),
      },
      hint: { verb: 'updated', label: updated.name ?? id },
      companyId,
    }).catch(() => {});
    return updated;
```

- [x] **Step 5: Run the test to verify it passes**

Run: `node --test apps/api/src/services/__tests__/inventory-service.test.js`
Expected: PASS, all tests including the new one from Step 2.

- [x] **Step 6: Run the full API test suite as a regression check**

Run: `node --test apps/api/src/services/__tests__/`
Expected: PASS, no regressions in any other service test (this file is shared across many describe blocks).

- [x] **Step 7: Commit**

```bash
git add apps/api/src/services/inventory-service.js apps/api/src/services/__tests__/inventory-service.test.js
git commit -m "feat(inventory): capture full before/after snapshots on item update for field-diff history"
```

---

### Task 4: Expandable field-diff rows in `ActivityTimeline`

**Files:**
- Modify: `packages/ui/src/components/ActivityTimeline.jsx`

- [x] **Step 1: Add the value-formatting helper and diff-row sub-component**

In `packages/ui/src/components/ActivityTimeline.jsx`, add `ChevronDown` to the existing lucide-react import:

```js
import {
  Activity,
  Info,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
```

Then add this after the existing `actorInitials` function and before `function ActivityItem(...)`:

```js
function formatChangeValue(rawValue, fieldMeta) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";
  const type = fieldMeta?.type ?? "text";
  if (type === "select" && Array.isArray(fieldMeta?.options)) {
    const opt = fieldMeta.options.find((o) => String(o.value) === String(rawValue));
    if (opt?.label) return opt.label;
  }
  if (type === "date" || type === "datetime") {
    const d = new Date(rawValue);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("es-MX");
    return String(rawValue);
  }
  if (type === "currency") {
    const n = Number(rawValue);
    if (Number.isFinite(n)) {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
    }
  }
  const str = String(rawValue);
  if (type === "markdown" && str.length > 80) return `${str.slice(0, 80)}…`;
  return str;
}

function ActivityChanges({ changes, changeLabels }) {
  return (
    <ul className="mt-2 space-y-1 border-t border-[hsl(var(--border))] pt-2 pl-12">
      {changes.map((change) => {
        const meta = changeLabels?.[change.field];
        const label = meta?.label ?? change.field;
        return (
          <li
            key={change.field}
            className="break-words text-xs text-[hsl(var(--muted-foreground))]"
          >
            <span className="font-medium text-[hsl(var(--foreground))]">{label}:</span>{" "}
            {formatChangeValue(change.oldValue, meta)} → {formatChangeValue(change.newValue, meta)}
          </li>
        );
      })}
    </ul>
  );
}
```

- [x] **Step 2: Restructure `ActivityItem` to add the expand chevron without nesting `<button>` elements**

Replace the full `ActivityItem` function:

```js
function ActivityItem({ activity, onNavigate, onSelect }) {
  const Icon = SEVERITY_ICONS[activity.severity] ?? Info;
  const sevClass = SEVERITY_CLASSES[activity.severity] ?? SEVERITY_CLASSES.info;
  const navigable = Boolean(activity.link && onNavigate);
  const selectable = Boolean(onSelect);
  const clickable = navigable || selectable;
  function handleClick() {
    if (selectable) {
      onSelect(activity);
      return;
    }
    if (navigable) onNavigate(activity.link);
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!clickable}
      className={`w-full text-left flex items-start gap-3 rounded-xl p-3 transition-colors ${
        clickable
          ? "hover:bg-[hsl(var(--muted))] cursor-pointer"
          : "cursor-default"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${sevClass}`}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[hsl(var(--foreground))] line-clamp-2">
          {activity.summary}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[hsl(var(--muted))] text-[10px] font-semibold">
            {actorInitials(activity.actor)}
          </span>
          <span className="truncate">{actorLabel(activity.actor)}</span>
          <span>·</span>
          <span>{formatRelative(activity.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}
```

with:

```js
function ActivityItem({ activity, onNavigate, onSelect, changeLabels }) {
  const Icon = SEVERITY_ICONS[activity.severity] ?? Info;
  const sevClass = SEVERITY_CLASSES[activity.severity] ?? SEVERITY_CLASSES.info;
  const navigable = Boolean(activity.link && onNavigate);
  const selectable = Boolean(onSelect);
  const clickable = navigable || selectable;
  const changes = Array.isArray(activity.payload?.changes) ? activity.payload.changes : [];
  const hasChanges = changes.length > 0;
  const [expanded, setExpanded] = useState(false);
  function handleClick() {
    if (selectable) {
      onSelect(activity);
      return;
    }
    if (navigable) onNavigate(activity.link);
  }
  return (
    <div className="w-full rounded-xl p-3 transition-colors hover:bg-[hsl(var(--muted))]">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={handleClick}
          disabled={!clickable}
          className={`flex flex-1 min-w-0 items-start gap-3 text-left ${
            clickable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${sevClass}`}
          >
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-[hsl(var(--foreground))] line-clamp-2">
              {activity.summary}
            </span>
            <span className="mt-1 flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[hsl(var(--muted))] text-[10px] font-semibold">
                {actorInitials(activity.actor)}
              </span>
              <span className="truncate">{actorLabel(activity.actor)}</span>
              <span>·</span>
              <span>{formatRelative(activity.createdAt)}</span>
            </span>
          </span>
        </button>
        {hasChanges ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Ocultar cambios" : "Ver cambios"}
            aria-expanded={expanded}
            className="mt-1 shrink-0 rounded-lg p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {hasChanges && expanded ? (
        <ActivityChanges changes={changes} changeLabels={changeLabels} />
      ) : null}
    </div>
  );
}
```

- [x] **Step 3: Pass `changeLabels` through `ActivityTimeline`**

In the same file, add `changeLabels = null` to the `ActivityTimeline` prop destructure:

```js
export function ActivityTimeline({
  sdk,
  token,
  entityType,
  entityId,
  limit = 50,
  onNavigate,
  onSelect,
  newActivity = null,
  refreshKey = 0,
  emptyMessage = "Sin actividad registrada.",
  heightClass = "max-h-[60dvh]",
  items: controlledItems,
  loading: controlledLoading,
  error: controlledError,
  changeLabels = null,
}) {
```

Then in the render, where `<ActivityItem ... />` is mapped, add the new prop:

```js
            {list.map((a) => (
              <ActivityItem
                key={a.id}
                activity={a}
                onNavigate={onNavigate}
                onSelect={onSelect}
                changeLabels={changeLabels}
              />
            ))}
```

- [x] **Step 4: Build check**

Run: `pnpm --filter @runly/desktop build:web`
Expected: builds with no errors.

- [x] **Step 5: Commit**

```bash
git add packages/ui/src/components/ActivityTimeline.jsx
git commit -m "feat(ui): add expandable field-diff rows to ActivityTimeline"
```

---

### Task 5: Wire field labels into Inventory's Actividad card

**Files:**
- Create: `apps/desktop/src/modules/runly.inventory/lib/activity-field-labels.js`
- Modify: `apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx`

- [x] **Step 1: Create the field-label map**

Create `apps/desktop/src/modules/runly.inventory/lib/activity-field-labels.js`:

```js
import { ITEM_STATUSES, ITEM_TYPES } from './inventory-constants.js'

const STATUS_OPTIONS = ITEM_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const ITEM_TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))

// Maps the flat field keys inventory-service.js's updateItem() puts in its
// before/after audit snapshots (see toFlatSnapshot there) to a display label
// and value type, so ActivityTimeline's expandable diff rows read like the
// rest of the UI instead of raw field keys/values. Kept as its own small,
// deliberately-curated map rather than derived from the FORM/DETAIL
// blueprints automatically: those blueprints use categoryId/brandId/
// locationId (relation fields), while the audit snapshot uses the resolved
// categoryName/brandName/locationName — the key names don't line up, so a
// generic extraction would need as much code as this map does directly.
export const INVENTORY_ACTIVITY_FIELD_LABELS = {
  name: { label: 'Nombre', type: 'text' },
  assetTag: { label: 'Etiqueta de activo', type: 'text' },
  itemType: { label: 'Tipo', type: 'select', options: ITEM_TYPE_OPTIONS },
  categoryName: { label: 'Categoría', type: 'text' },
  brandName: { label: 'Marca', type: 'text' },
  locationName: { label: 'Ubicación', type: 'text' },
  model: { label: 'Modelo', type: 'text' },
  serialNumber: { label: 'Número de serie', type: 'text' },
  partNumber: { label: 'Número de parte', type: 'text' },
  status: { label: 'Estado', type: 'select', options: STATUS_OPTIONS },
  purchaseDate: { label: 'Fecha de compra', type: 'date' },
  purchasePrice: { label: 'Precio de compra', type: 'currency' },
  vendorName: { label: 'Proveedor', type: 'text' },
  invoiceNumber: { label: 'Número de factura', type: 'text' },
  warrantyExpiry: { label: 'Vencimiento de garantía', type: 'date' },
  warrantyNotes: { label: 'Notas de garantía', type: 'markdown' },
  notes: { label: 'Notas', type: 'markdown' },
}
```

- [x] **Step 2: Pass it into `ActivityTimeline`**

Replace the full contents of `apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx`:

```jsx
import { ActivityTimeline } from '@runly/ui'
import { runly } from '../../../lib/runly'
import { INVENTORY_ACTIVITY_FIELD_LABELS } from '../lib/activity-field-labels.js'

export default function InventoryDetailHistorySection({ data, token }) {
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="InvItem"
      entityId={data?.id}
      limit={50}
      heightClass="max-h-[480px]"
      emptyMessage="Sin actividad registrada para este activo."
      changeLabels={INVENTORY_ACTIVITY_FIELD_LABELS}
    />
  )
}
```

- [x] **Step 3: Build check**

Run: `pnpm --filter @runly/desktop build:web`
Expected: builds with no errors.

- [ ] **Step 4: Manual check (dev server)**

Run: `pnpm dev`. Edit an existing inventory item, changing purchase price, category, and notes in the same edit. Open its detail page, find the "actualizó el activo" entry in Actividad, click its chevron.
Expected: three rows appear — "Precio de compra: $X.XX → $Y.YY", "Categoría: OldName → NewName", "Notas: <truncated old> → <truncated new>". An older entry from before this feature (if any test data has one) shows no chevron.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/lib/activity-field-labels.js apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx
git commit -m "feat(inventory): wire field labels into the Actividad diff view"
```

---

### Task 6: Full verification pass

**Files:** None (verification only).

- [x] **Step 1: Full backend test suite**

Run: `node --test apps/api/src/services/__tests__/`
Expected: all tests pass, including the new `activity-bridge.test.js` and `inventory-service.test.js` cases.

- [x] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [x] **Step 3: Full workspace build**

Run: `pnpm build`
Expected: `apps/api`, `apps/desktop`, `packages/ui` all build with no errors.

- [ ] **Step 4: Manual QA — 390px and 1440px**

With `pnpm dev` running, repeat Task 5 Step 4's manual check at both viewports. Expected: no horizontal overflow at 390px; diff rows wrap instead of clipping.

- [ ] **Step 5: Spec acceptance criteria**

Walk through all 6 acceptance criteria in `docs/superpowers/specs/2026-09-15-inventory-modification-history-design.md` section 25 against the running app, confirming each one explicitly (currency format, relation-name resolution, text truncation, no-chevron-when-no-changes, old-entry backward compatibility, 390px no-overflow).
