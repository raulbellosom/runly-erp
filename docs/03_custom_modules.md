# Runly ERP — Custom Modules

This document explains how to create a custom module for Runly ERP using Runly Module Engine v3 (RME3). For the full architectural rationale and roadmap, see [docs/architecture/runly-module-engine-v3.md](architecture/runly-module-engine-v3.md).

For installer-mode runtime limits/capabilities (blueprints, components, and available frontend libraries), read:
- [docs/ai-context/rme3-runtime-capabilities.md](ai-context/rme3-runtime-capabilities.md)

---

## Before you start: Spec-Driven Development

Every new module requires an approved spec and implementation plan before any code is written. This is not optional.

| Document | Path convention | Required sections |
|---|---|---|
| Spec | `docs/superpowers/specs/YYYY-MM-DD-rme3-<moduleKey>-design.md` | 15 required — see Section 14.3 of [runly-module-engine-v3.md](architecture/runly-module-engine-v3.md) |
| Plan | `docs/superpowers/plans/YYYY-MM-DD-rme3-<moduleKey>.md` | 7 required — see Section 14.4 of [runly-module-engine-v3.md](architecture/runly-module-engine-v3.md) |

**Module creation workflow (14 steps):**

1. Write module spec at `docs/superpowers/specs/YYYY-MM-DD-rme3-<moduleKey>-design.md`
2. Get spec approved (explicit confirmation — not implied)
3. Write implementation plan at `docs/superpowers/plans/YYYY-MM-DD-rme3-<moduleKey>.md`
4. Get plan approved (explicit confirmation — not implied)
5. Create module folder at `modules/custom/<moduleKey>/`
6. Write `module.manifest.js` using `defineRunlyModule`
7. Declare models in `models/*.model.js` using `defineModel`
8. Declare views in `views/*.view.js` using `defineView` (TABLE, FORM, DETAIL, CUSTOM kinds)
9. Declare pages in `pages/*.page.js` using `definePage`
10. Write `api/index.js` route factory and service files
11. Write `validators/index.js`
12. Register cleanup handler if `resettable: true` or `supportsDataPurge: true`
13. If the module has React components: write `components/index.js` exporting `register()` and place component files in `components/`
14. Call `POST /modules/sync`, install from catalog, run the RME3 checklist below

If any step reveals a deviation from the approved spec or plan, stop and revise before continuing.

---

## Quality standards

Custom modules are evaluated against the same [Module Quality Standards](module-quality-standards.md) used for core modules. For custom modules, criteria marked REQUIRED in that document are still mandatory (layout, UI components, dialogs, loading states, empty/error states, toast notifications). Criteria marked RECOMMENDED are strong guidelines — follow them unless your module's design explicitly does not include the relevant surface.

Run the 17-point audit checklist before submitting a custom module for review or deploying to a production instance.

---

## The core rule

A custom module must never require editing any of the following files:

| File | Reason it must not be touched |
|---|---|
| `packages/maps/src/feature-modules.js` | Deprecated |
| `prisma/schema.prisma` | Module tables are managed by Runly ORM |
| `apps/api/src/index.js` | Routes are auto-loaded by Route Loader |
| `apps/desktop/src/main.jsx` or any hardcoded route file | Pages are declared in the module |
| `packages/validators/src/index.js` | Validators live in `validators/index.js` inside the module |

If the RME3 layer needed to avoid these edits is not yet available, wait for it. Do not extend the old system.

---

## Namespace rules

| Prefix | Who | Example |
|---|---|---|
| `runly.*` | Runly core team only | `runly.catalog` |
| `custom.*` | Private / company modules | `custom.deliveries` |
| `community.*` | Open-source community modules | `community.crm` |
| `runly.*`, `atlas.*`, `core.*`, `system.*`, `identity.*` | Reserved — rejected by discovery | — |

---

## Folder structure

```
modules/custom/<moduleKey>/
  module.manifest.js       ← REQUIRED — defineRunlyModule export
  models/
    shipment.model.js      ← defineModel declarations
    carrier.model.js
  views/
    shipment.list.view.js  ← defineView declarations (TABLE, FORM, DETAIL, etc.)
    shipment.form.view.js
  pages/
    deliveries.page.js     ← definePage declarations (full page layouts)
  api/
    index.js               ← Hono router factory (optional)
    deliveries-service.js  ← business logic
    deliveries-cleanup.js  ← data purge handler
  components/
    ShipmentStatusBadge.jsx
    index.js               ← Component Registry entries
  validators/
    index.js               ← Zod schemas for this module
  migrations/
    0001_create_shipment.sql  ← module-local forward migrations (Phase 3+)
```

---

## Module manifest

`module.manifest.js` must use `defineRunlyModule` from `@runly/module-engine`. This is the only supported manifest API for new modules.

```js
// modules/custom/custom.deliveries/module.manifest.js
import { defineRunlyModule } from '@runly/module-engine'

export default defineRunlyModule({
  key: 'custom.deliveries',
  name: 'Envios',
  description: 'Gestion de envios, transportistas y seguimiento de entregas.',
  version: '0.1.0',
  kind: 'FEATURE',
  icon: 'Package',
  color: '#0f766e',
  category: 'operaciones',

  dependencies: [
    { key: 'runly.core' },
    { key: 'runly.identity' },
    { key: 'runly.files', optional: true },
  ],

  lifecycle: {
    installable: true,
    uninstallable: true,
    resettable: true,
    supportsDataPurge: true,
    defaultUninstallPolicy: 'preserve-data',
    ownedEntities: ['Shipment', 'Carrier'],
    sharedEntities: ['Company', 'UserProfile', 'FileAsset', 'AuditLog'],
    purgeStrategy: 'service-defined',
    resetStrategy: 'service-defined',
  },

  permissions: [
    { key: 'deliveries.access',           name: 'Access Deliveries' },
    { key: 'deliveries.shipments.read',   name: 'Read Shipments' },
    { key: 'deliveries.shipments.create', name: 'Create Shipments' },
    { key: 'deliveries.shipments.update', name: 'Update Shipments' },
    { key: 'deliveries.shipments.delete', name: 'Delete Shipments' },
    { key: 'deliveries.carriers.read',    name: 'Read Carriers' },
    { key: 'deliveries.carriers.manage',  name: 'Manage Carriers' },
  ],

  acl: {
    module: 'deliveries.access',
    actions: {
      'deliveries.shipments.read':   'deliveries.shipments.read',
      'deliveries.shipments.create': 'deliveries.shipments.create',
      'deliveries.shipments.update': 'deliveries.shipments.update',
      'deliveries.shipments.delete': 'deliveries.shipments.delete',
      'deliveries.carriers.read':    'deliveries.carriers.read',
      'deliveries.carriers.manage':  'deliveries.carriers.manage',
    },
    models: {
      Shipment: {
        read:   'deliveries.shipments.read',
        create: 'deliveries.shipments.create',
        update: 'deliveries.shipments.update',
        delete: 'deliveries.shipments.delete',
      },
      Carrier: {
        read:   'deliveries.carriers.read',
        create: 'deliveries.carriers.manage',
        update: 'deliveries.carriers.manage',
        delete: 'deliveries.carriers.manage',
      },
    },
  },

  navigation: [
    {
      label: 'Envios',
      path: '/deliveries/shipments',
      icon: 'Package',
      layout: 'main',
      permissionKey: 'deliveries.shipments.read',
    },
    {
      label: 'Transportistas',
      path: '/deliveries/carriers',
      icon: 'Truck',
      layout: 'main',
      permissionKey: 'deliveries.carriers.read',
    },
  ],
})
```

> `createModuleManifest` from `@runly/core` is deprecated. Do not use it for new modules.

---

## Model declarations

Models define the entities owned by the module. The Runly ORM reads these and provisions the physical tables, with no Prisma migration authored by the module developer.

```js
// modules/custom/custom.deliveries/models/shipment.model.js
import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'shipment',
  label: 'Envio',
  tableName: 'deliveries_shipment',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'tracking_number', type: 'text',    required: true, maxLength: 50,  label: 'No. seguimiento' },
    { name: 'origin',          type: 'text',    required: true, maxLength: 200, label: 'Origen' },
    { name: 'destination',     type: 'text',    required: true, maxLength: 200, label: 'Destino' },
    {
      name: 'status',
      type: 'select',
      required: true,
      label: 'Estado',
      options: ['pending', 'in_transit', 'delivered', 'returned'],
      default: 'pending',
    },
    { name: 'carrierId', type: 'relation', relatedModel: 'carrier', label: 'Transportista' },
    { name: 'notes',     type: 'textarea', label: 'Notas' },
  ],
  indexes: [
    { fields: ['companyId', 'tracking_number'], unique: true },
    { fields: ['companyId', 'status'] },
  ],
})
```

Available in Phase 3. In Phase 1–2, module-owned tables must be added as transitional Prisma models and migrated into Runly ORM during Phase 5.

---

## View declarations

Views are blueprint definitions that describe how to render an entity. They replace manually written React screens for standard CRUD.

```js
// modules/custom/custom.deliveries/views/shipment.list.view.js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'deliveries.shipment.list',
  kind: 'TABLE',
  version: '0.1.0',
  schema: {
    entity: 'shipment',
    label: 'Envios',
    shell: 'runly.dashboardShell',
    layout: 'runly.crudLayout',
    component: 'RunlyTable',
    columns: ['tracking_number', 'origin', 'destination', 'status'],
    defaultSort: { field: 'tracking_number', direction: 'asc' },
    filters: [
      { field: 'status', type: 'select', label: 'Estado' },
    ],
    actions: [
      { key: 'create', label: 'Nuevo envio', permissionKey: 'deliveries.shipments.create' },
    ],
  },
})
```

```js
// modules/custom/custom.deliveries/views/shipment.form.view.js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'deliveries.shipment.form',
  kind: 'FORM',
  version: '0.1.0',
  schema: {
    entity: 'shipment',
    label: 'Envio',
    layout: 'runly.crudLayout',
    component: 'RunlyForm',
    sections: [
      {
        title: 'Identificacion',
        columns: 2,
        fields: ['tracking_number', 'carrierId'],
      },
      {
        title: 'Ruta',
        columns: 2,
        fields: ['origin', 'destination'],
      },
      {
        title: 'Estado y notas',
        columns: 2,
        fields: ['status', 'notes'],
      },
    ],
  },
})
```

Available from Phase 3. In Phase 1–2, write standard React screens.

---

## Page declarations

Pages compose views and components into a full routed screen.

```js
// modules/custom/custom.deliveries/pages/deliveries.page.js
import { definePage } from '@runly/module-engine'

export default definePage({
  key: 'deliveries.shipments.index',
  path: '/deliveries/shipments',
  title: 'Envios',
  permissionKey: 'deliveries.shipments.read',
  view: 'deliveries.shipment.list',
})
```

Available from Phase 3. In Phase 1–2, register screens manually in `apps/desktop/src/`.

---

## API route factory

`api/index.js` exports a default factory function that returns a Hono router. The Route Loader mounts this automatically in Phase 4. In Phase 1–2, import and mount it manually in `apps/api/src/index.js`.

`requirePermission` and `moduleContext` are not importable — they are injected by the Route Loader as parameters to the factory function (`apps/api/src/services/route-loader-service.js`). There is no resolvable `@runly/api` package to import them from.

```js
// modules/custom/custom.deliveries/api/index.js
import { Hono } from 'hono'
import { deliveriesService } from './deliveries-service.js'
import { deliveriesCleanupHandler } from './deliveries-cleanup.js'

export default function createDeliveriesRouter({ prisma, requirePermission, moduleContext }) {
  // Bound to this module's own key by the Route Loader — see "Cleanup handler" below.
  moduleContext?.cleanup?.registerHandler(deliveriesCleanupHandler)

  const app = new Hono()

  app.get('/deliveries/shipments', requirePermission('deliveries.shipments.read'), async (c) => {
    const user = c.get('user')
    const data = await deliveriesService.listShipments(user.companyId)
    return c.json({ data })
  })

  app.post('/deliveries/shipments', requirePermission('deliveries.shipments.create'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const data = await deliveriesService.createShipment(user.companyId, body)
    return c.json({ data }, 201)
  })

  return app
}
```

**Route conventions:**
- Every route must be guarded with `requirePermission` or `requireAnyPermission`.
- Business logic lives in `api/*-service.js`, not in route handlers.
- Route URL prefix must match the module's declared navigation paths.

---

## Validators

```js
// modules/custom/custom.deliveries/validators/index.js
import { z } from 'zod'

export const createShipmentSchema = z.object({
  tracking_number: z.string().min(1).max(50),
  origin:          z.string().min(1).max(200),
  destination:     z.string().min(1).max(200),
  status:          z.enum(['pending', 'in_transit', 'delivered', 'returned']).default('pending'),
  notes:           z.string().max(5000).optional(),
})

export const updateShipmentSchema = createShipmentSchema.partial()
```

---

## Cleanup handler

Required when `resettable: true` or `supportsDataPurge: true`. Must scope all deletes to the active company. Delete child rows before parent rows to respect FK constraints.

RME3 tables are not Prisma models — use `prisma.$queryRaw`/`tx.$executeRaw` tagged template literals, never `prisma.<model>` accessors.

Register the handler by calling `moduleContext.cleanup.registerHandler(handler)` from inside the `api/index.js` factory function (see above) — it is bound to this module's own key, so there is no `moduleKey` argument to get wrong. `count` receives the real `prisma` client (used for dry-run reporting outside a transaction); `purge` receives `tx`, the transaction client the platform runs the whole reset/uninstall inside — mixing these up silently breaks the transaction. Use `$executeRaw` for the deletes, not `$queryRaw`: `$executeRaw` returns the affected row count directly, while a `DELETE ... RETURNING COUNT(*)` (aggregating inside `RETURNING`) is invalid SQL — `RETURNING` is evaluated per affected row, it cannot contain an aggregate.

```js
// modules/custom/custom.deliveries/api/deliveries-cleanup.js

export const deliveriesCleanupHandler = {
  async count({ prisma, companyId }) {
    const [shipmentRows] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count FROM deliveries_shipment WHERE company_id = ${companyId}::uuid
    `
    const [carrierRows] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count FROM deliveries_carrier WHERE company_id = ${companyId}::uuid
    `
    return [
      { entity: 'Shipment', rows: shipmentRows.count, companyScoped: true },
      { entity: 'Carrier',  rows: carrierRows.count,  companyScoped: true },
    ]
  },

  async purge({ tx, companyId }) {
    // Shipment references Carrier — delete it first.
    const shipmentsDeleted = await tx.$executeRaw`
      DELETE FROM deliveries_shipment WHERE company_id = ${companyId}::uuid
    `
    const carriersDeleted = await tx.$executeRaw`
      DELETE FROM deliveries_carrier WHERE company_id = ${companyId}::uuid
    `
    return shipmentsDeleted + carriersDeleted
  },
}
```

---

## Custom components

Modules can include React components compiled at install time by esbuild. No web image rebuild is required for module-local UI changes inside `modules/custom/<moduleKey>/components/`.

### Structure

```
modules/custom/<moduleKey>/
  components/
    index.js                  ← required entry point — exports register()
    ShipmentStatusBadge.jsx
    ShipmentDetailScreen.jsx
```

### `components/index.js` contract

```js
// modules/custom/custom.deliveries/components/index.js
export async function register(registry) {
  if (typeof window === 'undefined') return

  const [
    { default: ShipmentStatusBadge },
    { default: ShipmentDetailScreen },
  ] = await Promise.all([
    import('./ShipmentStatusBadge.jsx'),
    import('./ShipmentDetailScreen.jsx'),
  ])

  registry.register('custom.deliveries:ShipmentStatusBadge',  ShipmentStatusBadge)
  registry.register('custom.deliveries:ShipmentDetailScreen', ShipmentDetailScreen)
}
```

Registry key convention: `<moduleKey>:<ComponentName>`

The bundle is compiled automatically on install and sync. On API boot, modules with no bundle are auto-built. The bundle is stored in `apps/api/bundles/<key>.js` and Supabase Storage for persistence across restarts.

Use the project's default automatic JSX runtime. Do not add `/** @jsxRuntime classic */`,
`/** @jsx createElement */`, or `import { createElement } from 'react'` in custom module
components.

For toast notifications inside module React components, use:

```js
import { toast } from 'sonner'
```

### Available imports in components

| Import | Available | Notes |
|---|---|---|
| `react`, `react-dom`, `react/jsx-runtime` | Yes | External — in main Vite bundle |
| `@tanstack/react-query` | Yes | External — in main Vite bundle |
| `zustand` | Yes | External — in main Vite bundle |
| `@runly/ui` | Yes | External — full component library |
| `@runly/sdk` | Yes | External — Atlas API client |
| `react-router-dom` | Yes | External — in main Vite bundle |
| Packages in root `node_modules` | Yes | esbuild bundles them into the module bundle |
| CDN: `https://esm.sh/<pkg>` | Yes | Browser fetches at runtime |
| Node.js built-ins (`fs`, `path`) | No | Browser environment only |
| `exceljs`, `pdfkit`, `sharp` | No | API-only; use in `api/` not `components/` |

See `docs/ai-context/rme3-runtime-capabilities.md` for the full `@runly/ui` component inventory.

### CUSTOM kind view — full screen

When a module needs a full custom screen, declare it as a CUSTOM kind view. No SCREEN_MAP entry needed.

```js
// modules/custom/custom.deliveries/views/shipment-detail.custom.js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'deliveries.shipment-detail',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: {
    path: '/deliveries/shipments/:id',
    component: 'custom.deliveries:ShipmentDetailScreen',
    title: 'Detalle de envio',
  },
})
```

`BlueprintCrudScreen` resolves `component` from the registry automatically.

Cell components (badge renderers, custom table cells) used in TABLE blueprints do not need a CUSTOM view — register them by key and reference via `schema.columns[].component`.

### Bundle lifecycle

| Trigger | Bundle action |
|---|---|
| `POST /modules/<key>/install` | Built automatically |
| `POST /modules/<key>/sync` | Rebuilt (skipped if source hash unchanged) |
| `POST /modules/<key>/reset` | Force-rebuilt |
| `POST /modules/<key>/uninstall` | Deleted |
| API boot | Auto-built for installed modules without a bundle |

Important distinction:
- Editing only files inside `modules/custom/<moduleKey>/` does not require publishing a new web image.
- Editing the shared module host/runtime in `apps/desktop` (importmap, external shims, externals wiring) does require publishing a new `web` image.
- Editing credentialed browser/API behavior in `apps/api` (for example CORS with `credentials: 'include'`) does require publishing a new `api` image.

---

## Module checklist

Use this checklist after completing the 13-step SDD workflow above. An item is complete only when tested.

**Prerequisite:** Approved spec at `docs/superpowers/specs/YYYY-MM-DD-rme3-<moduleKey>-design.md` and approved plan at `docs/superpowers/plans/YYYY-MM-DD-rme3-<moduleKey>.md` must exist before any item below is checked.

### RME3 checklist (Phase 2+)

- [ ] Create `modules/custom/<moduleKey>/module.manifest.js` using `defineRunlyModule`
- [ ] Module key uses `custom.*` or `community.*` namespace
- [ ] `lifecycle` block declares `ownedEntities` and `sharedEntities`
- [ ] All permission keys declared in `manifest.permissions`
- [ ] All navigation entries have `permissionKey`
- [ ] ACL block covers `acl.module`, `acl.actions`, `acl.models`
- [ ] Models declared with `defineModel` in `models/*.model.js` (Phase 3+)
- [ ] Views declared with `defineView` in `views/*.view.js` (Phase 3+)
- [ ] Pages declared with `definePage` in `pages/*.page.js` (Phase 3+)
- [ ] `api/index.js` exports a Hono router factory with all routes guarded by `requirePermission`
- [ ] Business logic in `api/*-service.js`, not in route handlers
- [ ] Module-local validators in `validators/index.js`
- [ ] Cleanup handler registered if `resettable: true` or `supportsDataPurge: true`
- [ ] Cleanup handler uses `prisma.$queryRaw` — never `prisma.<model>` accessors for RME3 tables
- [ ] If module has components: `components/index.js` exports async `register(registry)` function
- [ ] If module has components: CUSTOM kind views declared in `views/*.custom.js` for full screens
- [ ] Call `POST /modules/sync` after placing the module directory
- [ ] Module appears in catalog with `status: UNINSTALLED`
- [ ] Install from catalog succeeds
- [ ] If module has components: `GET /modules/<key>/bundle.js` returns 200 after install
- [ ] API returns 403 when module is uninstalled (fail-closed test)
- [ ] API returns 200 with correct permission when installed
- [ ] Dry-run returns expected row counts
- [ ] Reset with `{ confirmation: "ACEPTO" }` succeeds; module remains installed
- [ ] AuditLog entry exists for each lifecycle operation

### Phase 1–2 temporary steps (until RME3 layers are available)

These steps are required only while the Runly ORM, Route Loader, and Blueprint renderer are not yet built. They are not part of the target architecture.

| Temporary step | Replaced by |
|---|---|
| Add Prisma model to `prisma/schema.prisma` | Runly ORM `defineModel` (Phase 3) |
| Mount routes in `apps/api/src/index.js` | Route Loader auto-discovery (Phase 4) |
| Add screens to `apps/desktop/src/` | Blueprint-driven pages via `definePage` (Phase 6) |
| Add validators to `packages/validators/src/index.js` | Module-local `validators/index.js` (Phase 2) |

Document these as temporary when you add them. Add a `// TODO: remove when Phase N complete` comment.

---

## Permission conventions

Every module must follow the granular permission pattern:

```
module.access
module.feature.read
module.feature.create
module.feature.update
module.feature.delete
```

Only add non-CRUD keys when strictly required (e.g., `deliveries.reports.export`).

---

## Installing a custom module (Phase 1–2 flow)

**Required before step 1:** Approved spec and plan must exist (see "Before you start" section above).

1. Write and approve spec → Write and approve plan
2. Place directory at `modules/custom/<moduleKey>/module.manifest.js`
3. For Phase 1–2 only: add transitional Prisma models, run `pnpm db:migrate && pnpm db:generate`
4. For Phase 1–2 only: import and mount route factory in `apps/api/src/index.js`
5. For Phase 1–2 only: add screens to `apps/desktop/src/`
6. Call `POST /modules/sync` or restart `pnpm dev:api`
7. Find the module in the catalog at `/modules` and click "Instalar"

From Phase 3 onwards: steps 3–5 are eliminated.

---

## Uninstalling

### Preserve-data (default)

```
DELETE /modules/custom.deliveries
```

or

```json
POST /modules/custom.deliveries/uninstall
{ "mode": "preserve-data" }
```

### Purge-data

```json
POST /modules/custom.deliveries/uninstall/dry-run
{ "mode": "purge-data" }

POST /modules/custom.deliveries/uninstall
{ "mode": "purge-data", "confirmation": "ACEPTO" }
```

### Reset (stay installed, wipe data)

```json
POST /modules/custom.deliveries/reset/dry-run

POST /modules/custom.deliveries/reset
{ "confirmation": "ACEPTO" }
```

---

## Versioning

| Bump | When | Required action |
|---|---|---|
| Patch (0.1.1) | Bug fix, no schema or API change | Sync manifest |
| Minor (0.2.0) | New feature, backwards-compatible | Sync manifest; run migration if schema changed |
| Major (1.0.0) | Breaking API or schema change | Write upgrade hook; coordinate with operators |

---

## Troubleshooting

**Module discovered with `status: ERROR`**
- Check API logs for the specific validation error.
- Common causes: missing `key` / `name` / `version`, reserved namespace, syntax error in `module.manifest.js`.

**Module not discovered after placing directory**
- Verify `module.manifest.js` exists at the root of the module directory.
- Call `POST /modules/sync` — discovery does not watch the file system in Phase 1–2.

**API returns 403 after install**
- Verify the user's role has the required permission assigned in Identity.
- Verify `Permission.active = true` for the key (Prisma Studio: filter Permission by moduleKey).

**Cleanup handler failed, module stuck**
- The Prisma transaction rolled back. Module status unchanged.
- Check the API error for the specific exception. Fix the handler, redeploy, retry.
