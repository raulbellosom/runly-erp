# RME3 Runtime Capabilities (Installer Mode)

This document defines what custom modules can use when Runly ERP is installed from Docker images (without full source build).

## Runly package migration

New modules use `@runly/*`. Existing `@atlas/*` imports remain supported and share the same implementation.
`defineRunlyModule`, `createRunlyClient`, and `RunlyTable`/`RunlyForm` are aliases of the existing factories/renderers.
Use these new imports after deploying the matching Runly API and web images; earlier web images do not resolve the new scope.
Module keys such as `atlas.core` remain unchanged. Use `RUNLY_MODULES_DIR`,
`RUNLY_PROJECT_ROOT`, `RUNLY_API_URL`, and `VITE_RUNLY_API_URL` in new configuration;
the corresponding Atlas variable remains a fallback when the Runly key is absent.
The web runtime exposes `window.__RUNLY_RUNTIME_CONFIG__` and its legacy alias to
the same public object. Storefront `window.ATLAS_CONFIG` and native host globals
keep their existing contracts.

## Scope

Installer mode means:
- API and worker run from published images.
- Web runs from a prebuilt Vite bundle image.
- Operators edit modules in a host `custom-modules/` folder that is mounted into the container at `ATLAS_MODULES_DIR` (for example `/app/modules/custom`).
- If `ATLAS_MODULES_DIR` is not set, Atlas falls back to `<projectRoot>/modules/custom` for source-mode development.

## What Works in Installer Mode

- RME3 module manifest (`defineRunlyModule`)
- Module models (`defineModel`) and Runly ORM provisioning flow
- Module API routes, services, validators
- Module lifecycle operations (`sync`, install, uninstall, reset)
- Blueprint-driven views and pages (TABLE, FORM, DETAIL, CUSTOM)
- **Custom React components via the dynamic module bundler** — no web image rebuild required

## Dynamic Module Bundler

Custom modules can ship React components compiled at install time. The API server compiles `components/` using esbuild and stores the result. The frontend loads the bundle via dynamic `import()` at startup. No Vite rebuild or new web image is needed for module-local code changes.

### How it works

1. Place React components in the module's `components/` directory. In installer mode the module lives under `ATLAS_MODULES_DIR/<moduleKey>/`; in source mode it lives under `modules/custom/<moduleKey>/`.
2. Create `components/index.js` exporting an async `register` function (see contract below).
3. Call `POST /modules/<key>/install` (or `sync` if already installed).
4. esbuild compiles the bundle and stores it in the filesystem and Supabase Storage.
5. The frontend loads the bundle on next page load and calls `register(componentRegistry)`.
6. Registered components are resolved by blueprints using their registry keys.

### `components/index.js` contract

```js
// modules/custom/custom.mymodule/components/index.js
export async function register(registry) {
  if (typeof window === 'undefined') return

  const [
    { default: MyScreen },
    { default: MyBadgeCell },
  ] = await Promise.all([
    import('./MyScreen.jsx'),
    import('./MyBadgeCell.jsx'),
  ])

  registry.register('custom.mymodule:MyScreen',    MyScreen)
  registry.register('custom.mymodule:MyBadgeCell', MyBadgeCell)
}
```

Registry key convention: `<moduleKey>:<ComponentName>`

Use the project's default automatic JSX runtime. Do not add `/** @jsxRuntime classic */`,
`/** @jsx createElement */`, or `import { createElement } from 'react'` in custom module
components.

### Available imports in components

There are two categories. Use **Category A** (external) whenever possible — it keeps module bundles small and avoids duplicate code.

#### Category A — External (shared with the web image, resolved via importmap, zero bundle weight)

| Import | What you get |
|---|---|
| `react` | `useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`, `useContext`, `createContext`, `forwardRef`, `memo`, `Fragment` … |
| `react-dom` | `createPortal`, `flushSync` |
| `@tanstack/react-query` | `useQuery`, `useMutation`, `useQueryClient`, `QueryClient`, `QueryClientProvider` … |
| `zustand` | `create`, `useStore` |
| `@runly/ui` | **Full component library** — cards, inputs, forms, badges, tables, dialogs, datepickers, file uploaders, layout primitives, and the `Toaster` renderer (full list below) |
| `@runly/sdk` | `createRunlyClient` — Atlas API client factory |
| `@runly/validators` | Shared Zod schemas |
| `react-router-dom` | `useNavigate`, `useParams`, `useLocation`, `Link` … |
| `sonner` | `toast()` — trigger toast notifications programmatically |
| `lucide-react` | All Lucide icons (`Music`, `Play`, `Settings`, `Plus` …) |
| `recharts` | `LineChart`, `BarChart`, `PieChart`, `AreaChart`, `ResponsiveContainer`, `Tooltip`, `Legend` … |

#### Category B — Bundled by esbuild (works, but adds weight to the module bundle)

| Import | Notes |
|---|---|
| `react-hook-form` | `useForm`, `Controller` — prefer using `@runly/ui` Form components which already wrap it |
| `motion` (Framer Motion) | ~280 KB — use sparingly |
| `country-state-city` | Geo data helpers |
| Any package resolvable from the module's Node resolution chain | esbuild bundles it at install time |
| CDN: `https://esm.sh/<pkg>` | Browser fetches at runtime — no install needed |

> **Not available** in browser components: Node.js built-ins (`fs`, `path`, `crypto`), `exceljs`, `pdfkit`, `sharp` — use those in `api/` only.

> **Critical rule — React hooks:** Always import hooks as named imports:
> `import { useState, useEffect, useCallback, useMemo, useRef } from 'react'`
> Never do `import React from 'react'` and call `React.useState()` — causes
> `Cannot read properties of null (reading 'useState')` at runtime.

### Bundle lifecycle

| Trigger | Bundle action |
|---|---|
| `POST /modules/<key>/install` | Built automatically after install |
| `POST /modules/<key>/sync` | Rebuilt (skipped if source hash unchanged) |
| `POST /modules/<key>/reset` | Force-rebuilt |
| `POST /modules/<key>/uninstall` | Deleted |
| API boot | Missing bundles restored from Supabase Storage; installed modules with no bundle are auto-built |

Important distinction:
- Editing only files inside `modules/custom/<moduleKey>/` does not require publishing a new web image.
- Editing the shared module host/runtime in `apps/desktop` (importmap, external shims, externals wiring) does require publishing a new `web` image.
- Editing credentialed browser/API behavior in `apps/api` (for example CORS with `credentials: 'include'`) does require publishing a new `api` image.

Verify a bundle was compiled:

```bash
curl http://localhost:4010/modules/custom.mymodule/bundle.js
```

Force rebuild without reinstalling:

```bash
curl -X POST http://localhost:4010/modules/custom.mymodule/sync \
  -H "Authorization: Bearer $ATLAS_TOKEN"
```

---

## View Kinds and Blueprint Contracts

### TABLE — data grid with filters and actions

```js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'mymodule.vehicle.list',
  kind: 'TABLE',
  version: '0.1.0',
  schema: {
    entity: 'vehicle',
    label: 'Vehiculos',
    component: 'RunlyTable',
    columns: ['plate', 'brand', 'model', 'year', 'status'],
    defaultSort: { field: 'plate', direction: 'asc' },
    filters: [
      { field: 'status', type: 'select', label: 'Estado' },
    ],
    actions: [
      { key: 'create', label: 'Agregar vehiculo', permissionKey: 'mymodule.vehicles.create' },
    ],
  },
})
```

### FORM — create / edit form

```js
export default defineView({
  key: 'mymodule.vehicle.form',
  kind: 'FORM',
  version: '0.1.0',
  schema: {
    entity: 'vehicle',
    label: 'Vehiculo',
    component: 'RunlyForm',
    sections: [
      { title: 'Identificacion', columns: 2, fields: ['plate', 'brand', 'model', 'year'] },
      { title: 'Estado y asignacion', columns: 2, fields: ['status', 'driverId'] },
      { title: 'Notas', columns: 1, fields: ['notes'] },
    ],
  },
})
```

### DETAIL — read-only entity detail

```js
export default defineView({
  key: 'mymodule.vehicle.detail',
  kind: 'DETAIL',
  version: '0.1.0',
  schema: {
    entity: 'vehicle',
    label: 'Detalle de vehiculo',
    component: 'RunlyDetail',
    sections: [
      { title: 'Vehiculo', fields: ['plate', 'brand', 'model', 'year', 'status'] },
    ],
  },
})
```

#### Detail presentation layer (opt-in)

A DETAIL `schema` may declare any of the keys below. Omit them all and the detail
renders as a plain stack of `label / value` sections (unchanged behaviour).

- `schema.hero` — `{ titleField, subtitleFields: [], statusField, statusMap?,
  imageField?, imageDocsPath?, fallbackIcon, accentColorField?, metaChips: [] }`.
  Renders `DetailHero` at the top and hands it the page actions (Volver /
  header actions / Editar). `imageField` is a file-asset id resolved to a signed
  URL client-side; if it is empty and `imageDocsPath` (a `:id` template) is set,
  the first `image/*` document at that path is used; otherwise the branded
  `fallbackIcon` panel shows, faintly tinted by `accentColorField`. `statusMap`
  maps a raw status value (e.g. `active` / a boolean) to a display label.
  `metaChips` entries are `{ field, label?, icon?, type? }`; `type: 'color'`
  renders a swatch.
- `schema.kpis` — `[{ label, field, type?, icon?, hrefTemplate? }]`. Renders
  `StatStrip`. `field` supports dotted paths; values are formatted with the same
  rules as detail fields (dates, `boolean` -> Si/No, currency, status pills).
- `schema.layout: 'two-column'` + `section.column: 'main' | 'aside'` — on `lg+`
  the body becomes a main column (2/3) plus an aside column (1/3). Default
  `column` is `main`.
- On a `relation-card` section, `relationCard.avatarField` (a file-asset id) plus
  `relationCard.contactActions: [{ type: 'call', field }]` add an avatar
  (initials fallback) and `tel:` buttons.

### CUSTOM — full custom React screen

Use CUSTOM when TABLE/FORM/DETAIL renderers are insufficient. Requires a component registered via the dynamic bundle. No SCREEN_MAP entry needed.

**Three files are always required together:**

```js
// 1. views/dashboard.custom.js  — declares the route and component key
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'mymodule.dashboard',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: {
    path: '/mymodule/dashboard',
    component: 'custom.mymodule:MyDashboard',
    title: 'Dashboard',
  },
})
```

```js
// 2. components/index.js  — registers the component so the runtime can find it
export async function register(registry) {
  if (typeof window === 'undefined') return
  const { default: MyDashboard } = await import('./MyDashboard.jsx')
  registry.register('custom.mymodule:MyDashboard', MyDashboard)
}
```

```jsx
// 3. components/MyDashboard.jsx  — the actual React component
import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PageHeader,
  Card, CardHeader, CardTitle, CardContent,
  Button,
  EmptyState,
  Skeleton,
} from '@runly/ui'

// Helpers
function useAtlasToken() {
  // The Atlas token is stored in localStorage by the auth provider.
  // Key: sb-<project>-auth-token  (Supabase session)
  // Simplest approach: read from window.__atlas_token if your shell exposes it,
  // or grab it from localStorage directly.
  return localStorage.getItem('atlas_token') ?? ''
}

export default function MyDashboard() {
  const token = useAtlasToken()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mymodule.dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/mymodule/summary', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: Boolean(token),
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          title="Error al cargar"
          description={error.message}
          action={<Button onClick={refetch}>Reintentar</Button>}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Dashboard" description="Resumen general" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Total</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data?.total ?? 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

**Key rules for CUSTOM components:**
- Import hooks as named imports: `import { useState } from 'react'` — never `React.useState()`
- Import UI from `@runly/ui` — all components in the library are available
- Use `useQuery` from `@tanstack/react-query` for API calls — it's external and available
- Every screen must start with `<PageHeader />`
- Use `<Skeleton />` for loading states, `<EmptyState />` for empty/error states
- File must be `.jsx` (not `.tsx` — TypeScript is not supported in module bundles)

`BlueprintCrudScreen` resolves `component` from the registry automatically.

Cell components used in TABLE blueprints (badge renderers, custom cells) do not need a CUSTOM view — register them and reference via `schema.columns[].component`.

---

## Don’t Guess Imports

These imports are guaranteed and should be used exactly as written:

| Need | Import |
|---|---|
| Toasts | `import { toast } from 'sonner'` |
| Page shell / cards / forms | `import { PageHeader, Card, Button, EmptyState, ErrorState, Skeleton } from '@runly/ui'` |
| Data fetching | `import { useQuery, useMutation } from '@tanstack/react-query'` |
| Routing | `import { useNavigate, useParams, Link } from 'react-router-dom'` |

If a component or function is not documented in this file or exported by `@runly/ui`, do not assume it exists.
Never import toast from `@runly/ui`.
The correct import is always `import { toast } from 'sonner'`.

## Troubleshooting CUSTOM Views and Bundles

- Missing `components/index.js`: the bundle cannot register your React components.
- Wrong `schema.component`: it must match the registry key exactly, for example `custom.mymodule:MyDashboard`.
- Wrong file extension: module UI files must be `.jsx`, not `.tsx`.
- Missing build: run `POST /modules/<key>/install` or `POST /modules/<key>/sync`, then verify `GET /modules/<key>/bundle.js`.
- Unsupported import: stay within the documented externals and supported bundled dependencies.
- Stale bundle cache: rebuild with `POST /modules/<key>/sync` and reload the page.

## @runly/ui Component Library

Import from `@runly/ui` in any component. All exports below are available.

For the visual identity rules (glass tiers, radius/z-index scales, brand-token usage, component decision tree, anti-patterns), see `docs/ai-context/design-system-guide.md`. Full audit and fix backlog: `docs/superpowers/decisions/2026-08-24-design-system-unification-audit.md`.

### Core primitives

| Export | Description |
|---|---|
| `Button`, `buttonVariants` | Action button with size/variant props |
| `AssistantWordmark` | Two-tone MirAI label: “Mir” inherits the text color, “AI” uses `var(--brand-primary)`. Accepts `className`; use for assistant names and headings, not flowing prose. |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | Content card container |
| `Badge`, `badgeVariants` | Status and label badge |
| `TypeBadge` | Accent-coloured pill (`accent` hex, e.g. file/asset type). Background/border derived via `color-mix` for light+dark. |
| `Separator` | Horizontal or vertical divider |
| `Skeleton` | Loading placeholder |
| `ProgressBar` | Determinate (`value` 0-100) or indeterminate (`value={null}`) progress bar for long-running background operations |
| `ProgressMeter` | Threshold-aware bar with an optional label/value row. `value`/`max`; `tone="auto"` colours green→amber (`warnAt`, default 0.8)→red (≥1). Use for budgets, quota, reorder points. |
| `RingProgress` | Circular SVG progress ring. `value`/`max`, `size`, `stroke`, `color`; renders `children` centred. Use for goals/completion. |
| `SectionCard` | Glass `Card` with a `title` (+ optional `description`, `action` slot) header and a body. Standardises the "titled card" pattern; `variant` passes through to `Card`. |
| `Avatar`, `AvatarImage`, `AvatarFallback` | User avatar with fallback initials |

### Forms

| Export | Description |
|---|---|
| `Label` | Accessible form label |
| `Input` | Single-line text input |
| `Textarea` | Multi-line text input |
| `Checkbox` | Checkbox control |
| `Switch` | Toggle switch |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`, `SelectLabel`, `SelectGroup`, `SelectSeparator` | Native select dropdown |
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, `FormDescription`, `useFormField` | React Hook Form wrappers |

#### FormFields (controlled — use inside a `<Form>` context)

| Export | Description |
|---|---|
| `TextField` | Controlled text input |
| `PasswordField` | Password with show/hide toggle |
| `TextareaField` | Controlled textarea |
| `MarkdownField` | Markdown editor |
| `NumberField` | Numeric input |
| `CurrencyField` | Currency input with locale formatting |
| `DateField` | Date picker |
| `DateTimeField` | Date + time picker |
| `YearField` | Year-only picker |
| `SelectField` | Controlled select dropdown |
| `ComboboxField` | Searchable select with autocomplete; use for read-only option sets |
| `CreatableComboboxField` | Searchable combobox that shows a "+ Crear «X»" row when the typed term doesn't match any option; calls `onCreate(name)` on select. Use `placeholder="Buscar o crear..."`. Preferred over `SelectField` whenever new entries are possible. |
| `CheckboxField` | Controlled checkbox |
| `SwitchField` | Controlled toggle switch |
| `RadioGroupField` | Controlled radio group |
| `TagsField` | Multi-value tag input |
| `PhoneField` | Phone number input with country prefix |
| `DropzoneField` | File drag-and-drop area |

### Navigation and layout

| Export | Description |
|---|---|
| `AppShell` | Main app layout: fixed sidebar + scrollable content |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Tab navigation |
| `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` | Collapsible sections (Radix accordion). Use `type="single" collapsible` on `Accordion` for one-open-at-a-time; wrap each section in `AccordionItem value="..."` |
| `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuRadioGroup`, `DropdownMenuShortcut`, `DropdownMenuGroup`, `DropdownMenuPortal` | Dropdown / context menu |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` | Breadcrumb navigation |

### Data display

| Export | Description |
|---|---|
| `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` | HTML table primitives |
| `DataTable` | Feature-rich sortable/filterable table |
| `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis` | Paginator |

### Overlays and feedback

| Export | Description |
|---|---|
| `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogPortal`, `DialogOverlay` | Modal dialog |
| `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetClose`, `SheetPortal`, `SheetOverlay` | Slide-in panel |
| `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` | Floating popover |
| `SyncStatusPopover` | One-icon Topbar site status (online/offline/syncing/pending) with a popover detail panel |
| `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` | Tooltip |
| `Toaster` | Toast notification renderer (mount once in app root) |
| `Alert`, `AlertTitle`, `AlertDescription` | Inline alert banner |

### Molecules and organisms

| Export | Description |
|---|---|
| `PageHeader` | Page title bar with actions slot. The actions slot wraps (`flex-wrap`) — pass a fragment or a `flex flex-wrap` container, never a non-wrapping `flex` div (its buttons clip off the right edge on mobile). |
| `UnsavedChangesBar` | Sticky "you have unsaved changes" bar. Props: `message`, `saving`, `onDiscard`, `onSave`, `saveLabel`, `savingLabel`, `discardLabel`, `className`. Stacks vertically below `sm` (primary action on top) and clears the mobile bottom nav via `env(safe-area-inset-bottom)`. Use instead of hand-rolling a save/discard footer. |
| `EmptyState` | Empty list placeholder with icon and message |
| `ErrorState` | Error display with retry option |
| `StatCard` | KPI metric card with label, value, trend |
| `StatStrip` | Responsive key-figures strip — a 6-up grid on desktop, a horizontal snap-scroll carousel on mobile. Consumed by `RunlyDetail` when the DETAIL blueprint declares `schema.kpis`. Items: `[{ key, label, value (node), icon (lucide name), href }]`. |
| `DetailHero` | Redesigned entity-detail header: a representative image (or a branded fallback panel tinted by an accent colour) + title + subtitle + status pill + meta chips + an actions slot. Presentational only; consumed by `RunlyDetail` when the DETAIL blueprint declares `schema.hero`. |
| `SearchInput` | Search text field with icon |
| `FilterBar` | Horizontal filter control bar |
| `DynamicTable` | Blueprint-driven table renderer |
| `DynamicForm` | Blueprint-driven form renderer |
| `ActionMenu` | Row action dropdown button |
| `ConfirmDialog` | Confirmation dialog with destructive variant |
| `ContactPicker` | Contact search and select picker |
| `FileCard` | File display card with metadata |
| `FileUploader` | File upload widget with progress |
| `FileViewer` | File preview (PDF, image, etc.) |
| `AttachmentsPanel` | File attachments list panel |
| `DocumentsPanel` | Documents list panel |
| `ImageViewer` | Image lightbox |
| `ImageUploader` | Image crop and upload widget |
| `ImageSourceSheet` | Camera-vs-gallery picker for touch devices — gate with `useCoarsePointer()`; on a fine-pointer device just open a plain `<input type="file">` directly instead. Props: `open, onOpenChange, onPickFile, accept?`. |
| `SwatchField` | Pick an accent colour from a small preset palette (`swatches` prop, defaults to `DEFAULT_SWATCHES`). Use instead of a raw `<input type="color">` when only a themeable accent is needed. |
| `DatePickerField` | Standalone date picker |
| `PageFooter` | Page footer bar |
| `BrandFooter` | Branded footer with logo |
| `ModuleNavIcon` | Renders a module/navigation `icon` name as a component. Resolves against the full lucide set plus legacy aliases and the custom `FleetVehicle` glyph; falls back to `Box`. Backed by `resolveModuleIcon(name, { fallback })` / `getModuleIconComponent(name)` (returns `null` when unresolved, for initials fallback). Single source of truth for the command palette, module sidebar, and module cards. |

### Atlas blueprint renderer

| Export | Description |
|---|---|
| `RunlyTable` | Renders TABLE kind blueprints |
| `RunlyForm` | Renders FORM kind blueprints |
| `RunlyDetail` | Renders DETAIL kind blueprints |
| `RunlyCrudView` | Combined list + form + detail view |
| `RunlyCardView` | Card grid alternative to RunlyTable |
| `BulkActionBar` | Multi-select action toolbar |
| `CostsSummaryPanel` | Costs summary panel |
| `normalizeSpanishLabel` | Label normalization helper |
| `shouldUsePageMode` | Layout mode helper |

### Responsive patterns

| Export | Description |
|---|---|
| `ViewModeSwitch`, `getStoredViewMode` | Table/card toggle with localStorage persistence |
| `MobileFiltersSheet` | Mobile filter slide-in panel |
| `ListLayout` | Responsive list container |
| `SwipeableRow` | WhatsApp/Telegram-style swipeable list row (touch only; inert on non-coarse pointers). `rightActions` (tray revealed on left-swipe), `onFullSwipeRight` + `fullSwipeLabel`/`fullSwipeIcon`/`fullSwipeTone` (right-swipe past threshold), `onLongPress`, controlled `open`/`onOpenChange`. Axis-locked so vertical list scroll is never hijacked. Pair with `ContextMenu` for the desktop equivalent. |
| `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuCheckboxItem`, `ContextMenuRadioItem`, `ContextMenuLabel`, `ContextMenuSeparator`, `ContextMenuShortcut`, `ContextMenuGroup`, `ContextMenuPortal`, `ContextMenuSub`, `ContextMenuSubContent`, `ContextMenuSubTrigger`, `ContextMenuRadioGroup` | Right-click / long-press context menu (Radix-backed, same visual language as `DropdownMenu`). Anchored at the pointer instead of a trigger element. |

### Hooks

| Export | Description |
|---|---|
| `useAttachmentsController` | Manages file attachment list state |
| `useIsMobile` | `boolean` — true below the given breakpoint (default 768px), updates on resize |
| `useLongPress` | `useLongPress({ onLongPress, delay=450, moveTolerance=10, disabled })` → pointer handlers; fires after a stationary press, cancels on move/scroll, ignores interactive targets, vibrates |
| `useSwipeToReply` | `useSwipeToReply({ onReply, threshold=64, direction, disabled })` → `{ handlers, translateX }`; fires only on a horizontal drag past the threshold, yields to vertical scroll |
| `cn` | Tailwind class merge utility (from `lib/utils`) |

---

## Frontend Libraries Available in the Published Web Image

These libraries ship in every published Docker web image. Custom module components can
use all of them without rebuilding the image when the change stays inside the module
itself.

**Category A (external/shared — no bundle weight):**
`react`, `react-dom`, `@tanstack/react-query`, `zustand`, `@runly/ui`, `@runly/sdk`,
`@runly/validators`, `react-router-dom`, `sonner`, `lucide-react`, `recharts`

**Category B (bundled by esbuild into the module bundle):**
`react-hook-form`, `motion`, `country-state-city`, `@supabase/supabase-js`

Authoritative source of all included packages: `apps/desktop/package.json`

---

## AI Assistant Prompt Starter

Use this instruction before generating module code:

> Read `AGENTS.md`, `docs/ai-context/rme3-modules.md`, and `docs/ai-context/rme3-runtime-capabilities.md` first.
> Follow RME3 rules exactly.
> Custom React components in `components/index.js` are compiled at install time by esbuild and are available without rebuilding the web image — no image rebuild is ever needed for module UI.
> Use the normal automatic JSX runtime. Do not add `/** @jsxRuntime classic */`, `/** @jsx createElement */`, or `import { createElement } from 'react'` in module components.
> Never import `toast` from `@runly/ui`; use `import { toast } from 'sonner'`.
> Prefer blueprint-driven UI (TABLE, FORM, DETAIL kinds) and existing `@runly/ui` primitives whenever possible.
> Use CUSTOM kind blueprints when a screen requires logic that TABLE/FORM/DETAIL cannot express.
> Do not add entries to SCREEN_MAP for new custom modules — use CUSTOM kind views instead.
>
> **UI-first rule:** Never use native HTML form elements (`<select>`, `<input>`, `<textarea>`) — always use the `@runly/ui` equivalent. For any searchable select with optional inline creation, use `CreatableComboboxField` with `placeholder="Buscar o crear..."`. For read-only searchable selects, use `ComboboxField`. Plain `SelectField` only for short fixed lists. All screens start with `PageHeader`. All destructive confirmations use `ConfirmDialog`. File attachments use `AttachmentsPanel` / `FileUploader` inline — never redirect to atlas.files.
>
> If a fix touches the shared runtime host in `apps/desktop` (importmap, shims, externals) or credentialed browser/API CORS behavior in `apps/api`, publish new Docker images for `web` and/or `api`. Dynamic module bundling only avoids rebuilds for module-local code changes.
