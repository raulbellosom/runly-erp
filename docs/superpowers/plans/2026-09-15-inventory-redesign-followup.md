# Inventory Redesign Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Inventory create/edit form's sidebar to one column, give the detail page a primary Editar + overflow-menu action bar, reorder the detail sidebar to match the reference layout, and add a left accent + bolder field values to `RunlyDetail`'s section cards — all as specified in `docs/superpowers/specs/2026-09-15-inventory-redesign-followup-design.md`.

**Architecture:** Two shared-renderer changes (`RunlyForm`'s new `asideActions` prop, `RunlyDetail`'s section-card accent styling) plus one new shared component (`DetailActionBar`), consumed by three Inventory-module files (two screens, two blueprints). No API, Prisma, or SDK changes — this is presentation-only.

**Tech Stack:** React (JSX, no TypeScript), Tailwind utility classes, `@runly/ui` component library, `lucide-react` icons. This repo has no JSX/component test runner (Node's built-in `node --test` only covers plain `.js` logic — see `CLAUDE.md`), so verification for the JSX tasks below is `node --check` is not applicable to `.jsx` files; instead each task's validation is `pnpm lint`, `pnpm build`, and a manual browser check, matching how the parent spec (`2026-09-14-inventory-glass-redesign-design.md`) was verified. Tasks that touch plain `.js` logic (none in this plan touch new pure-logic files — the existing `detail-presentation.js` select-label fix already has its own committed test) skip the TDD red/green steps for that reason and are called out explicitly.

---

### Task 1: Add `asideActions` to `RunlyForm` and consolidate the aside column

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx:127-144` (prop destructure), `:1345-1404` (render)

- [x] **Step 1: Add the `asideActions` prop to the destructure**

In `packages/ui/src/runly-renderer/RunlyForm.jsx`, change the prop destructure at the top of `RunlyForm`:

```jsx
export function RunlyForm({
  blueprint,
  fields,
  initialData,
  mode = "create",
  token,
  companyId = null,
  apiBaseUrl,
  onSuccess,
  onCancel,
  blueprints = null,
  resolveBlueprintByKey = null,
  allowInlineCreate = true,
  inlineCreateDepth = 0,
  id,
  showFooter = true,
  onCompletionChange,
  asideActions = null,
}) {
```

(Only the final line, `asideActions = null,`, is new — every other line is unchanged, shown for exact placement.)

- [x] **Step 2: Move the completion ring and preview panel into one aside column**

Find this block (currently around line 1345-1404):

```jsx
  const previewConfig = schema.preview ?? null;
  const showCompletion = schema.showCompletion === true;
  const { allFieldNames, filledCount, completionPercent } = computeCompletion(fieldMap, formValues, isFieldVisible);
  const previewModel = computePreviewModel(previewConfig, fieldMap, formValues);

  // Reported unconditionally (regardless of schema.showCompletion) so a screen
  // that wants to render its own FormCompletionRing in a custom header layout
  // (instead of RunlyForm's default placement above the sections) can do so.
  useEffect(() => {
    onCompletionChange?.({
      percent: completionPercent,
      filledCount,
      totalCount: allFieldNames.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionPercent, filledCount, allFieldNames.length]);

  return (
    <form id={id} className="space-y-6" onSubmit={handleSubmit}>
      {sections.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>Formulario sin secciones</AlertTitle>
          <AlertDescription>
            Esta vista no tiene <code>schema.sections</code> configurado.
          </AlertDescription>
        </Alert>
      )}

      {showCompletion ? (
        <FormCompletionRing
          percent={completionPercent}
          filledCount={filledCount}
          totalCount={allFieldNames.length}
        />
      ) : null}

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

Replace it with:

```jsx
  const previewConfig = schema.preview ?? null;
  const showCompletion = schema.showCompletion === true;
  const { allFieldNames, filledCount, completionPercent } = computeCompletion(fieldMap, formValues, isFieldVisible);
  const previewModel = computePreviewModel(previewConfig, fieldMap, formValues);
  const hasAsideColumn =
    showCompletion || Boolean(asideActions) || Boolean(previewModel) || asideSections.length > 0;

  // Reported unconditionally (regardless of schema.showCompletion) so a screen
  // that wants to react to completion changes elsewhere (e.g. a page title
  // badge) can do so in addition to the ring RunlyForm renders itself below.
  useEffect(() => {
    onCompletionChange?.({
      percent: completionPercent,
      filledCount,
      totalCount: allFieldNames.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionPercent, filledCount, allFieldNames.length]);

  return (
    <form id={id} className="space-y-6" onSubmit={handleSubmit}>
      {sections.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>Formulario sin secciones</AlertTitle>
          <AlertDescription>
            Esta vista no tiene <code>schema.sections</code> configurado.
          </AlertDescription>
        </Alert>
      )}

      <div className={hasAsideColumn ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]" : "space-y-3"}>
        <div className="space-y-3">
          {mainSections.map((section) => renderSection(section))}
        </div>
        {hasAsideColumn ? (
          <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
            {showCompletion ? (
              <FormCompletionRing
                percent={completionPercent}
                filledCount={filledCount}
                totalCount={allFieldNames.length}
              />
            ) : null}
            {asideActions}
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

Everything after this block (the inline-create `Dialog`, closing `</form>`) is unchanged — do not touch it.

- [x] **Step 3: Verify no other blueprint depends on the old ring placement**

Run: `grep -rn "showCompletion" apps/desktop/src packages/ui/src --include=*.js`
Expected: only `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js` and `packages/ui/src/runly-renderer/runly-form-preview.js` (a comment) match — confirming no other module's `FORM` blueprint is affected by moving the ring into the aside column.

- [x] **Step 4: Build check**

Run: `pnpm --filter @runly/ui build`
Expected: builds with no errors.

- [x] **Step 5: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyForm.jsx
git commit -m "feat(ui): add RunlyForm asideActions prop, consolidate aside column"
```

---

### Task 2: Adopt the consolidated sidebar in Inventory's create/edit screen

**Files:**
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js` (line 18)
- Modify: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx` (whole file)

- [x] **Step 1: Turn on `showCompletion` in the form blueprint**

In `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`, change:

```js
    showCompletion: false,
```

to:

```js
    showCompletion: true,
```

- [x] **Step 2: Rewrite `InventoryItemForm.jsx` to use `asideActions` instead of its own outer grid**

Replace the full contents of `apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx` with:

```jsx
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState, Button, ConfirmDialog } from '@runly/ui'
import { Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
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
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const itemQuery = useInventoryItem(isEdit ? id : null)
  const editItem = itemQuery.data?.data ?? itemQuery.data ?? null
  const deleteItem = useDeleteInventoryItem()

  if (isEdit && itemQuery.isLoading) {
    return <LoadingState message="Cargando activo..." />
  }
  if (isEdit && itemQuery.isError) {
    return <ErrorState message="No se pudo cargar el activo" />
  }

  const handleDelete = async () => {
    await deleteItem.mutateAsync(id)
    toast.success('Activo eliminado correctamente')
    navigate('/app/m/runly.inventory/inventory')
  }

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        eyebrow={isEdit ? 'Editar activo' : 'Inventario'}
        title={isEdit ? (editItem?.name || 'Editar activo') : 'Nuevo activo'}
        description={isEdit ? undefined : 'Completa la información del activo'}
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={INVENTORY_ITEM_FORM}
          initialData={isEdit ? editItem : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          asideActions={
            isEdit && editItem?.id ? (
              <div className="glass-shell flex flex-col gap-2 rounded-2xl p-3">
                <Button
                  type="button"
                  variant="glass"
                  className="w-full justify-start"
                  onClick={() => navigate(`/app/m/runly.inventory/inventory/${id}`)}
                >
                  <Eye className="h-4 w-4" />
                  Ver activo
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar activo
                </Button>
              </div>
            ) : null
          }
          onSuccess={(result) => {
            const savedId = result?.data?.id ?? editItem?.id
            navigate(savedId ? `/app/m/runly.inventory/inventory/${savedId}` : '/app/m/runly.inventory/inventory')
          }}
          onCancel={() => navigate(-1)}
        />
      </div>

      {isEdit && editItem ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Eliminar activo"
          description={`Esta acción eliminará permanentemente "${editItem.name}" (${editItem.assetTag}). No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  )
}
```

This drops the old `FormCompletionRing` import/local `completion` state/outer `lg:grid-cols-[minmax(0,1fr)_280px]` wrapper entirely — `RunlyForm` now owns the whole sidebar.

- [x] **Step 3: Build check**

Run: `pnpm --filter @runly/desktop build` (or `pnpm build` for the full workspace if that's the only way this repo exposes it — check `package.json` scripts if the filtered command errors)
Expected: builds with no errors, no unused-import warnings for `FormCompletionRing`/the old grid classes.

- [ ] **Step 4: Manual check (dev server)**

Run: `pnpm dev`
Then open `/app/m/runly.inventory/inventory/:id/edit` for an existing item at 1440px and 390px.
Expected: one right-hand sidebar column containing, top to bottom, the completion ring, "Ver activo"/"Eliminar activo", then "Vista previa" — no third column. On `/app/m/runly.inventory/inventory/new`, the sidebar shows the ring and preview only (no Ver/Eliminar buttons, no empty gap where they'd be).

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js apps/desktop/src/modules/runly.inventory/screens/InventoryItemForm.jsx
git commit -m "fix(inventory): consolidate create/edit sidebar into one column via asideActions"
```

---

### Task 3: Create the shared `DetailActionBar` component

**Files:**
- Create: `packages/ui/src/components/DetailActionBar.jsx`
- Modify: `packages/ui/src/index.js`

- [x] **Step 1: Write the component**

Create `packages/ui/src/components/DetailActionBar.jsx`:

```jsx
import { MoreHorizontal } from "lucide-react";
import { Button } from "./Button.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu.jsx";
import { cn } from "../lib/utils.js";

// A primary action button plus a "..." overflow menu for secondary/destructive
// actions, so a destructive action never competes visually with the primary
// one. Meant for RunlyDetail's `heroActions` slot.
//   primary   { label, onClick, icon? } | null
//   secondary [{ label, onClick, icon?, destructive? }]
export function DetailActionBar({ primary = null, secondary = [] }) {
  const items = (Array.isArray(secondary) ? secondary : []).filter(Boolean);

  return (
    <div className="flex items-center gap-2">
      {primary ? (
        <Button type="button" onClick={primary.onClick}>
          {primary.icon}
          {primary.label}
        </Button>
      ) : null}
      {items.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Más acciones">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map((item) => (
              <DropdownMenuItem
                key={item.label}
                onClick={item.onClick}
                className={cn(
                  item.destructive && "text-red-600 focus:text-red-600 dark:text-red-400",
                )}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
```

- [x] **Step 2: Export it from the package entry point**

In `packages/ui/src/index.js`, next to the existing `export { SectionCard } from "./components/SectionCard.jsx";` line, add:

```js
export { DetailActionBar } from "./components/DetailActionBar.jsx";
```

- [x] **Step 3: Build check**

Run: `pnpm --filter @runly/ui build`
Expected: builds with no errors.

- [x] **Step 4: Commit**

```bash
git add packages/ui/src/components/DetailActionBar.jsx packages/ui/src/index.js
git commit -m "feat(ui): add DetailActionBar (primary action + overflow menu)"
```

---

### Task 4: Adopt `DetailActionBar` in the Inventory detail screen

**Files:**
- Modify: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx`

- [x] **Step 1: Replace the inline `heroActions` buttons**

In `apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx`, change the imports:

```jsx
import { RunlyDetail, LoadingState, ErrorState, ConfirmDialog, DetailActionBar } from '@runly/ui'
import { ArrowLeft, Trash2 } from 'lucide-react'
```

(This drops the now-unused `Button` import and adds `DetailActionBar` + `ArrowLeft`; `Trash2` stays.)

Then replace the `heroActions` prop on `<RunlyDetail ... />`:

```jsx
        heroActions={
          <DetailActionBar
            primary={{
              label: 'Editar',
              onClick: () => navigate(`/app/m/runly.inventory/inventory/${id}/edit`),
            }}
            secondary={[
              {
                label: 'Volver',
                icon: <ArrowLeft className="h-4 w-4" />,
                onClick: () => navigate('/app/m/runly.inventory/inventory'),
              },
              {
                label: 'Eliminar',
                icon: <Trash2 className="h-4 w-4" />,
                onClick: () => setDeleteOpen(true),
                destructive: true,
              },
            ]}
          />
        }
```

The rest of the file (the `ConfirmDialog` block, `handleDelete`, etc.) stays exactly as-is — `setDeleteOpen(true)` from the menu item opens the same dialog it always has.

- [x] **Step 2: Build check**

Run: `pnpm --filter @runly/desktop build`
Expected: builds with no errors, no unused-import warning for `Button`.

- [ ] **Step 3: Manual check (dev server)**

Open `/app/m/runly.inventory/inventory/:id` at 1440px and 390px.
Expected: a filled "Editar" button plus a "···" button; clicking "···" opens a menu with "Volver" and "Eliminar" (Eliminar in red); clicking "Eliminar" opens the same confirm dialog as before.

- [x] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx
git commit -m "fix(inventory): use DetailActionBar for detail page actions"
```

---

### Task 5: Reorder the detail sidebar and rename the history card

**Files:**
- Modify: `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js:75-116`

- [x] **Step 1: Reorder the `aside` sections and rename the history label**

In `apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js`, the `sections` array currently has these four `column: 'aside'` entries in this order: `attachments`, `assignment`, `comments`, `history`. Replace that whole run (from the `attachments` entry's `{` through the `history` entry's closing `},`) with the same four entries in the order `attachments`, `assignment`, `history`, `comments`, and change `history`'s `label`:

```js
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
          coverPath: '/inventory/items/:id/files/:docId/cover',
          reorderPath: '/inventory/items/:id/files/reorder',
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
        id: 'history',
        type: 'component',
        label: 'Actividad',
        icon: 'History',
        column: 'aside',
        component: 'runly.inventory:HistorySection',
      },
      {
        id: 'comments',
        type: 'component',
        label: 'Comentarios',
        icon: 'MessageSquare',
        column: 'aside',
        component: 'runly.inventory:CommentsSection',
      },
```

Nothing else in the file changes — the `main`-column sections above this block, and the closing `],`/`}`/`export default` below it, stay exactly as they are.

- [x] **Step 2: Remove the history component's redundant card/header**

`RunlyDetail`'s own `renderSection` already wraps every section (including `type: "component"` ones) in a `glass-shell` card with a header built from the blueprint's `label`/`icon` — that's how `InventoryDetailAssignmentSection.jsx` and `InventoryDetailCommentsSection.jsx` work today, each returning bare content with no card of its own. `InventoryDetailHistorySection.jsx` is the odd one out: it renders a *second*, nested card (`rounded-2xl border ... overflow-hidden`) with its own `<h3>Historial de auditoría</h3>` header inside the one `RunlyDetail` already provides — a pre-existing double-card/double-header bug that becomes more visible once this task moves the section higher up the sidebar. Fix it to match the other two adapters.

Replace the full contents of `apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx` with:

```jsx
import { ActivityTimeline } from '@runly/ui'
import { runly } from '../../../lib/runly'

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
    />
  )
}
```

`RunlyDetail`'s section wrapper (Task 5's blueprint change from Step 1, `label: 'Actividad'`, `icon: 'History'`) now supplies the one and only card/header for this section.

- [x] **Step 3: Build check**

Run: `pnpm --filter @runly/desktop build`
Expected: builds with no errors.

- [ ] **Step 4: Manual check (dev server)**

Open `/app/m/runly.inventory/inventory/:id` for an item with an assignment, comments, and history.
Expected: sidebar cards appear in the order Archivos, Asignación, Actividad, Comentarios; the "Actividad" card has exactly one header/border (no nested card-inside-a-card), matching the visual weight of the Asignación and Comentarios cards next to it.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js apps/desktop/src/modules/runly.inventory/components/InventoryDetailHistorySection.jsx
git commit -m "fix(inventory): reorder detail sidebar (Archivos, Asignación, Actividad, Comentarios)"
```

---

### Task 6: Add the section-card accent border and bolder field values to `RunlyDetail`

**Files:**
- Modify: `packages/ui/src/runly-renderer/RunlyDetail.jsx:1 (imports)`, `:962-965 (renderSection wrapper)`, `:1050 (dd className)`

- [x] **Step 1: Import `cn`**

In `packages/ui/src/runly-renderer/RunlyDetail.jsx`, add this import alongside the other relative imports near the top of the file (after the `buildApiHeaders` import is fine):

```jsx
import { cn } from "../lib/utils.js";
```

- [x] **Step 2: Add the accent border to `type: "fields"` section cards**

Find:

```jsx
  const renderSection = (section) => (
    <div key={section.id} className="glass-shell rounded-xl px-5 py-4 space-y-4">
```

Replace with:

```jsx
  const renderSection = (section) => (
    <div
      key={section.id}
      className={cn(
        "glass-shell rounded-xl px-5 py-4 space-y-4",
        section.type === "fields" &&
          "border-l-2 border-l-[hsl(var(--primary))] shadow-[inset_10px_0_18px_-16px_hsl(var(--primary)/0.5)]",
      )}
    >
```

- [x] **Step 3: Bold the field values**

Find:

```jsx
                  <dd className="text-sm text-[hsl(var(--foreground))]">
```

Replace with:

```jsx
                  <dd className="text-sm font-semibold text-[hsl(var(--foreground))]">
```

- [x] **Step 4: Existing tests still pass**

Run: `node --test packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js`
Expected: all 14 tests pass (this change doesn't touch `detail-presentation.js`, just `RunlyDetail.jsx`'s JSX, so this is a regression check, not a new test for this task — there is no component-render test harness in this repo to assert JSX/class output against, per the Tech Stack note above).

- [x] **Step 5: Build check**

Run: `pnpm --filter @runly/ui build`
Expected: builds with no errors.

- [ ] **Step 6: Manual check (dev server)**

Open the Inventory detail page and the Fleet vehicle detail page (an existing `RunlyDetail` consumer) at 1440px and 390px.
Expected: every `type: "fields"` section card (Identificación, Ubicación y compra, Garantía, Notas in Inventory; the equivalent cards in Fleet) shows a left accent border/glow in the brand color, and every field value renders bold. No horizontal overflow at 390px. Cards for `attachments`/`component`/`relation-card`/`relation-list` sections do NOT get the accent (only `fields`-type cards do, per spec).

- [x] **Step 7: Commit**

```bash
git add packages/ui/src/runly-renderer/RunlyDetail.jsx
git commit -m "feat(ui): add section-card accent border and bolder field values to RunlyDetail"
```

---

### Task 7: Full verification pass

**Files:** None (verification only).

- [x] **Step 1: Lint**

Run: `pnpm lint`
Expected: no new lint errors introduced by this plan's changes.

- [x] **Step 2: Full workspace build**

Run: `pnpm build`
Expected: `apps/desktop` and `packages/ui` build with no errors.

- [x] **Step 3: Existing automated tests**

Run: `node --test packages/ui/src/runly-renderer/__tests__/detail-presentation.test.js` and `node --test packages/ui/src/hooks/__tests__/useAttachmentsController.test.js`
Expected: both suites green (unchanged by this plan, regression check only).

- [ ] **Step 4: Manual QA — Inventory, 390px and 1440px**

With `pnpm dev` running:
- `/app/m/runly.inventory/inventory/new` — one-column sidebar (ring + preview, no Ver/Eliminar).
- `/app/m/runly.inventory/inventory/:id/edit` — one-column sidebar (ring, Ver/Eliminar, preview, in that order).
- `/app/m/runly.inventory/inventory/:id` — DetailActionBar (Editar primary + "···" with Volver/Eliminar), sidebar order Archivos/Asignación/Actividad/Comentarios, accent border + bold values on the main-column cards.
- Run the 14-aspect checklist (`docs/ai-context/ui-screen-audit-checklist.md`) against the create/edit and detail screens.

- [ ] **Step 5: Manual QA — Fleet regression, 390px and 1440px**

Open Fleet's vehicle/driver detail and form screens (existing `RunlyDetail`/`RunlyForm` consumers). Expected: no layout regression beyond the intentional accent border + bold field values (Task 6) — Fleet doesn't declare `schema.showCompletion`/`schema.preview`, so Task 1/2's sidebar consolidation doesn't change anything there (its detail/form screens had no aside column change in behavior, only style inherited from Task 6).

- [x] **Step 6: Update `docs/TASKS.md` if this repo tracks follow-up work there**

Run: `grep -n "inventory-glass-redesign\|Inventory" docs/TASKS.md | head -20` to see whether the parent redesign has a tracked checklist entry that should note this follow-up's completion. If so, add a line noting this plan's completion with `Verified: 2026-09-15 (...)` evidence per `docs/spec-driven-development.md` Stage 6 rules; if not, skip this step (no entry to update).
