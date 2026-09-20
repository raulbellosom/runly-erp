# RME3 Custom Modules — AI Reference Guide

This is the single source of truth for creating and modifying custom RME3 modules in Runly ERP v2.
Read this document before touching any file under `modules/custom/`.

---

## 1. What is RME3

Runly ERP v2 uses Runly Module Engine v3 (RME3) for all ERP feature modules. A module is a
self-contained directory under `modules/custom/<moduleKey>/` that declares its own data models,
views, pages, API routes, and permissions. The Atlas Core reads these declarations and drives
all behavior from them.

**The golden rule — a module must never require editing:**
- `prisma/schema.prisma` — RME3 tables are managed by Runly ORM via `defineModel`
- `apps/api/src/index.js` — routes auto-load via Route Loader at boot
- `apps/desktop/src/main.jsx` — pages are declared inside the module
- `packages/validators/src/index.js` — validators live inside `validators/` in the module

---

## 2. Create new modules from the Dev Kit

For installer-mode workspaces, the official authoring flow is:

Existing installations may use `_atlas-devkit/`; use that directory in the steps below when present.

1. Read `custom-modules/_runly-devkit/AGENTS.md`
2. Read `custom-modules/_runly-devkit/docs/ai-context/rme3-modules.md`
3. Read `custom-modules/_runly-devkit/docs/ai-context/rme3-runtime-capabilities.md`
4. Copy `custom-modules/_runly-devkit/golden-path-module/`
5. Rename it to your new module key and edit the files directly

For source-mode workspaces inside this repo, use the same structure and patterns.
Do not assume the scaffolder exists in installer-mode or external deployments.

Every new module must declare:
- `key`, `name`, `version`
- `icon`, `color`, and `pwa: { shortName, startPath }`
- at least one model, one page route, and the matching permissions/navigation entries

`icon`, `color` and `pwa` are required for every new module. `icon` must be a
supported Lucide icon from the Atlas whitelist below, `color` must use six-digit
hexadecimal notation, and `pwa.startPath` must be an internal path relative to
`/app/m/<moduleKey>`. Atlas uses these fields to create an independently
installable PWA identity.

**Valid module icon names** — only these values pass `isModuleIconName()` validation.
Do NOT use any other Lucide icon name or the sync endpoint will reject the manifest.

```
Analytics & Reporting:
  Activity, BarChart3, BarChart4, LineChart, PieChart, TrendingDown, TrendingUp

Finance & Accounting:
  ArrowRightLeft, Banknote, Calculator, Coins, CreditCard, DollarSign, HandCoins,
  Landmark, Percent, PiggyBank, Receipt, Scale, Wallet

Documents & Files:
  BookOpen, BookMarked, ClipboardCheck, ClipboardList, FileCheck, Files, FileSearch,
  FileSpreadsheet, FileText, FolderOpen, Library, ListOrdered, NotebookPen

People & HR:
  Briefcase, Contact, ContactRound, GraduationCap, HeartPulse, Stethoscope,
  UserCheck, UserPlus, Users, UsersRound

Inventory & Logistics:
  Anchor, Archive, Barcode, Box, Boxes, Container, Fuel, Package, Package2, QrCode,
  Route, Ship, ShoppingBag, ShoppingCart, Store, Tag, Truck, Warehouse

Operations & Production:
  ClipboardCopy, Construction, Factory, Gauge, Hammer, Layers, LayoutDashboard,
  LayoutTemplate, ListChecks, ListTree, Plug, Settings, SlidersHorizontal,
  SquareKanban, Target, Wrench

Communication & CRM:
  Bell, Calendar, CalendarDays, Mail, MapPin, Menu, MessageCircle, MessageSquare,
  Phone, Send

Location & Navigation:
  Building2, Globe, Home, Hotel, Map, Network

Security & Admin:
  Award, Crown, Flag, Gavel, Key, Lock, Palette, Puzzle, Shield, ShieldCheck, Star

Time & Scheduling:
  Clock, History, Hourglass, Timer

Tech & System:
  Database, HardDrive, Server, Wifi, Zap
```

Navigation item icons (`navigation[].icon`) are NOT restricted to this list — they
accept any valid Lucide icon name.

Use **direct code editing** when:
- Creating a new module from `golden-path-module/`
- Adding a new field to an existing entity
- Adding a new entity to an existing module
- Adding a custom component or CUSTOM view
- Fixing a bug in service logic

---

## 3. Folder structure

Complete module with two entities:

```
modules/custom/custom.crm/
  module.manifest.js             ← defineRunlyModule — metadata, permissions, nav
  models/
    contact.model.js             ← defineModel for crm_contact table
    company.model.js             ← defineModel for crm_company table
  views/
    contact.table.js             ← defineView kind: TABLE
    contact.form.js              ← defineView kind: FORM
    contact.detail.js            ← defineView kind: DETAIL
    contact.page.js              ← definePage — URL path + layout + which view
    company.table.js
    company.form.js
    company.detail.js
    company.page.js
  api/
    index.js                     ← Hono router factory
    contact-routes.js            ← thin Hono routes, no business logic
    contact-service.js           ← business logic, all inside factory closure
    company-routes.js
    company-service.js
    service-helpers.js           ← shared helpers + module-level error class
  validators/
    contact.validators.js        ← Zod schemas for create + update
    company.validators.js
    index.js                     ← barrel: export * from each validators file
  components/                    ← optional: custom React components
    index.js                     ← register(registry) function
    ContactStatusBadge.jsx
```

---

## 4. Critical patterns with code examples

### 4.1 Service factory closure

**All service functions MUST be declared inside `createXxxService({ prisma })`.**
`prisma` is a dependency injected into the factory. Functions at module scope cannot
see it and will throw `ReferenceError: prisma is not defined` at runtime.

```js
// ✅ CORRECT — all functions inside the factory closure
export function createContactService({ prisma }) {
  async function listContacts({ companyId, page, pageSize, search }) {
    // prisma is in scope here
    const rows = await prisma.$queryRaw`
      SELECT * FROM crm_contact
      WHERE company_id = ${companyId} AND enabled = true
    `
    return rows
  }

  async function getContactById({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM crm_contact
      WHERE id = ${id} AND company_id = ${companyId}
    `
    if (!rows[0]) throw new CrmServiceError('Contacto no encontrado.', 404)
    return rows[0]
  }

  async function createContact({ companyId, data, actorId }) {
    const rows = await prisma.$queryRaw`
      INSERT INTO crm_contact (company_id, full_name, email, enabled, created_at, updated_at)
      VALUES (${companyId}, ${data.full_name}, ${data.email ?? null}, true, NOW(), NOW())
      RETURNING *
    `
    const created = rows[0]
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'custom.crm',
        entityType: 'crm.contact',
        entityId: created.id,
        action: 'contact.create',
        before: null,
        after: JSON.stringify(created),
        metadata: null,
      },
    })
    return created
  }

  async function updateContact({ companyId, id, data, actorId }) {
    const before = await getContactById({ companyId, id })
    const rows = await prisma.$queryRaw`
      UPDATE crm_contact SET
        full_name  = CASE WHEN ${data.full_name  !== undefined} THEN ${data.full_name  ?? null} ELSE full_name  END,
        email      = CASE WHEN ${data.email      !== undefined} THEN ${data.email      ?? null} ELSE email      END,
        updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `
    const updated = rows[0]
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'custom.crm',
        entityType: 'crm.contact',
        entityId: id,
        action: 'contact.update',
        before: JSON.stringify(before),
        after: JSON.stringify(updated),
        metadata: null,
      },
    })
    return updated
  }

  async function setContactEnabled({ companyId, id, enabled, actorId }) {
    const before = await getContactById({ companyId, id })
    await prisma.$queryRaw`
      UPDATE crm_contact
      SET enabled = ${Boolean(enabled)}, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'custom.crm',
        entityType: 'crm.contact',
        entityId: id,
        action: enabled ? 'contact.enable' : 'contact.disable',
        before: JSON.stringify(before),
        after: JSON.stringify({ ...before, enabled }),
        metadata: null,
      },
    })
    return getContactById({ companyId, id })
  }

  return { listContacts, getContactById, createContact, updateContact, setContactEnabled }
}

// ❌ WRONG — function at module scope, prisma not in scope
async function listContacts({ companyId }) {
  return prisma.$queryRaw`SELECT * FROM crm_contact` // ReferenceError at runtime
}
export function createContactService({ prisma }) {
  return { listContacts }
}
```

### 4.2 `prisma.$queryRaw` — tagged template literal

RME3 module tables do NOT exist in `prisma/schema.prisma`. Prisma model accessors like
`prisma.contact.findMany()` will throw at runtime. Use tagged template literals for
static queries and `$queryRawUnsafe` for dynamic WHERE clauses.

```js
// Static query — tagged template (Prisma parameterizes automatically, SQL-injection safe)
const rows = await prisma.$queryRaw`
  SELECT * FROM crm_contact
  WHERE company_id = ${companyId}
    AND enabled = true
  ORDER BY created_at DESC
  LIMIT ${limit} OFFSET ${offset}
`

// Dynamic WHERE — build params array, use $queryRawUnsafe
const conditions = ['company_id = $1', 'enabled = true']
const params = [companyId]
if (search) {
  params.push(`%${search}%`)
  conditions.push(`full_name ILIKE $${params.length}`)
}
if (status) {
  params.push(status)
  conditions.push(`status = $${params.length}`)
}
const rows = await prisma.$queryRawUnsafe(
  `SELECT * FROM crm_contact WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
  ...params
)

// ❌ WRONG
const rows = await prisma.contact.findMany({ where: { companyId } }) // model doesn't exist
```

### 4.3 Table naming

`moduleSlug` = last segment of `moduleKey`. `tableName = ${moduleSlug}_${entityName}`.

| moduleKey | moduleSlug | entity | tableName |
|---|---|---|---|
| `custom.crm` | `crm` | `contact` | `crm_contact` |
| `custom.fleet` | `fleet` | `vehicle` | `fleet_vehicle` |
| `custom.inventory` | `inventory` | `product` | `inventory_product` |

Never prefix with `atlas_` manually — that was the old convention. Runly ORM uses
`${slug}_${entity}` directly.

### 4.4 UUID — the database generates it

Every RME3 table's `id` column has `DEFAULT uuidv7()` in PostgreSQL. Never generate
UUIDs in JavaScript. Use `INSERT ... RETURNING *` to get the generated ID.

```js
// ✅ CORRECT — DB generates the ID
const rows = await prisma.$queryRaw`
  INSERT INTO crm_contact (company_id, full_name, enabled, created_at, updated_at)
  VALUES (${companyId}, ${data.full_name}, true, NOW(), NOW())
  RETURNING *
`
const created = rows[0]  // created.id is the DB-generated UUID v7

// ❌ WRONG
import { uuidv7 } from 'uuidv7'
const id = uuidv7()
await prisma.$queryRaw`INSERT INTO crm_contact (id, ...) VALUES (${id}, ...)`
```

### 4.5 Soft delete — `enabled = false`

Never hard-delete records. Toggle the `enabled` column. Expose a `PATCH /:id/enabled`
route. All list queries filter `enabled = true`.

```js
// Route (in contact-routes.js)
app.patch('/crm/contacts/:id/enabled',
  requirePermission('crm.contact.delete'),
  async (c) => {
    const companyId = c.get('companyId') // validated by requirePermission
    const actorId   = c.get('userContext')?.profile?.id
    const body   = await c.req.json()
    const parsed = enabledSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'Datos invalidos.' }, 400)
    const updated = await service.setContactEnabled({
      companyId, id: c.req.param('id'), enabled: parsed.data.enabled, actorId,
    })
    return c.json({ data: updated })
  }
)

// Always filter in list queries
const rows = await prisma.$queryRaw`
  SELECT * FROM crm_contact
  WHERE company_id = ${companyId} AND enabled = true
`
```

### 4.6 AuditLog on every mutation

Every `create`, `update`, and `setEnabled` call must write an audit log entry.
`prisma.auditLog` IS a Prisma model (it's a core table, not an RME3 table — this
is the one case where you use a Prisma model accessor).

```js
await prisma.auditLog.create({
  data: {
    actorId:    actorId ?? null,
    moduleKey:  'custom.crm',          // the module key
    entityType: 'crm.contact',         // "<slug>.<entityName>"
    entityId:   record.id,
    action:     'contact.create',      // "<entityName>.<verb>": create | update | enable | disable
    before:     null,                  // null for create; JSON.stringify(beforeState) for update/toggle
    after:      JSON.stringify(record),
    metadata:   null,
  },
})
```

### 4.7 Error class — lives in `service-helpers.js`

Place the shared module error class in `api/service-helpers.js`
so all entity services in the module share one class. The reference fleet module defines `FleetServiceError`
directly in `api/fleet-service.js` and other services import it from there — both approaches work.
What matters: **define it in one place per module and import from that same file everywhere.**

```js
// api/service-helpers.js
export class CrmServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'CrmServiceError'
    this.status = status
  }
}

// api/contact-service.js
import { CrmServiceError } from './service-helpers.js'

// api/contact-routes.js
import { createContactService } from './contact-service.js'
import { CrmServiceError } from './service-helpers.js'
```

### 4.8 Complete `module.manifest.js` example

```js
import { defineRunlyModule } from '@runly/module-engine'

export default defineRunlyModule({
  key: 'custom.crm',
  name: 'CRM',
  version: '0.1.0',
  kind: 'FEATURE',
  description: 'Gestión de relaciones con clientes.',
  icon: 'Users',
  color: '#2563eb',
  pwa: {
    shortName: 'CRM',
    startPath: '/crm-contacts',
  },
  dependencies: [{ key: 'atlas.core' }],
  models: [
    './models/contact.model.js',
  ],
  views: [
    './views/contact.table.js',
    './views/contact.form.js',
    './views/contact.detail.js',
    './views/contact.page.js',
  ],
  permissions: [
    { key: 'crm.contact.read',   name: 'Ver contactos' },
    { key: 'crm.contact.create', name: 'Crear contactos' },
    { key: 'crm.contact.update', name: 'Editar contactos' },
    { key: 'crm.contact.delete', name: 'Desactivar contactos' },
  ],
  navigation: [
    {
      label: 'Contactos',
      path: '/app/m/custom.crm/crm-contacts',
      icon: 'Users',
      permissionKey: 'crm.contact.read',
      layout: 'main',
    },
  ],
  lifecycle: {
    installable: true,
    uninstallable: true,
    ownedModels: ['crm.contact'],
    ownedTables: ['crm_contact'],
    resettable: true,
    supportsDataPurge: true,
    defaultUninstallPolicy: 'purge-owned-tables',
  },
})
```

### 4.9 Complete `models/contact.model.js` example

```js
import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'contact',
  name: 'crm.contact',
  label: 'Contacto',
  tableName: 'crm_contact',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'full_name', type: 'text',   label: 'Nombre completo', required: true, maxLength: 200 },
    { name: 'email',     type: 'email',  label: 'Correo electronico' },
    { name: 'status',    type: 'select', label: 'Estado', required: true,
      options: ['activo', 'inactivo'], default: 'activo' },
    { name: 'company_id_ref', type: 'relation', label: 'Empresa',
      relatedModel: 'crm.company' },
  ],
  indexes: [
    { fields: ['company_id', 'email'], unique: true },
    { fields: ['company_id', 'status'] },
  ],
})
```

### 4.10 Complete `api/index.js` example

```js
import { Hono } from 'hono'
import { createContactRouter } from './contact-routes.js'

export default function createCrmRouter({ prisma, requirePermission, moduleContext }) {
  const app = new Hono()
  app.route('', createContactRouter({ prisma, requirePermission, moduleContext }))
  return app
}
```

---

## 5. Field type reference

Source of truth: `packages/module-engine/src/constants.js` (`FIELD_TYPES` export).

| Type | Zod (required) | Zod (optional) | Notes |
|---|---|---|---|
| `text` | `z.string().min(1)` | `z.string().optional()` | |
| `textarea` | `z.string().min(1)` | `z.string().optional()` | |
| `number` | `z.number().int()` | `z.number().int().optional()` | No `.min(1)` — 0 and negatives are valid |
| `decimal` | `z.number()` | `z.number().optional()` | No `.min(1)` |
| `boolean` | `z.boolean()` | `z.boolean().optional()` | |
| `select` | `z.enum([...options])` | `z.enum([...]).optional()` | Options array required in defineModel |
| `multiselect` | `z.array(z.string())` | `z.array(z.string()).optional()` | |
| `date` | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` | same `.optional()` | ISO format YYYY-MM-DD |
| `datetime` | `z.string()` | `z.string().optional()` | |
| `email` | `z.string().email().min(1)` | `z.string().email().optional()` | |
| `phone` | `z.string().min(1)` | `z.string().optional()` | |
| `relation` | `z.string().uuid()` | `z.string().uuid().nullable().optional()` | UUID of related record |
| `file` | `z.string().uuid()` | `z.string().uuid().nullable().optional()` | UUID of FileAsset record |
| `json` | `z.record(z.any())` | `z.record(z.any()).optional()` | |
| `markdown` | `z.string().min(1)` | `z.string().optional()` | |
| `color` | `z.string().min(1)` | `z.string().optional()` | |
| `richtext` | `z.string().min(1)` | `z.string().optional()` | |

---

## 6. Permissions and navigation

Permission key format: `<moduleSlug>.<entityName>.<action>` where action ∈ {read, create, update, delete}.

```js
// Declare in defineRunlyModule
permissions: [
  { key: 'crm.contact.read',   name: 'Ver contactos' },
  { key: 'crm.contact.create', name: 'Crear contactos' },
  { key: 'crm.contact.update', name: 'Editar contactos' },
  { key: 'crm.contact.delete', name: 'Desactivar contactos' },
],

// Use in routes
app.get('/crm/contacts',               requirePermission('crm.contact.read'),   handler)
app.post('/crm/contacts',              requirePermission('crm.contact.create'), handler)
app.patch('/crm/contacts/:id',         requirePermission('crm.contact.update'), handler)
app.patch('/crm/contacts/:id/enabled', requirePermission('crm.contact.delete'), handler)
```

Navigation paths follow the pattern `/app/m/<moduleKey>/<slug>-<entity-kebab>s`:

```js
navigation: [
  {
    label: 'Contactos',
    path: '/app/m/custom.crm/crm-contacts',
    icon: 'Users',
    permissionKey: 'crm.contact.read',
    layout: 'main',
  },
],
```

---

## 7. Anti-patterns

| Never do this | Why | Correct approach |
|---|---|---|
| Edit `prisma/schema.prisma` for a module table | RME3 tables are managed by Runly ORM | Declare fields in `defineModel`, run `/modules/sync` |
| `prisma.contact.findMany()` for RME3 tables | The Prisma model doesn't exist | `prisma.$queryRaw` or `prisma.$queryRawUnsafe` |
| Declare service functions at module scope | `prisma` is not in scope → ReferenceError at runtime | All functions inside `createXxxService({ prisma })` |
| `const id = uuidv7()` in JavaScript | UUIDs must be DB-generated | `INSERT ... RETURNING *` — let the DB produce the ID |
| `DELETE FROM crm_contact WHERE id = $1` | Breaks audit trail, violates soft-delete contract | `UPDATE ... SET enabled = false` via `setXxxEnabled` |
| Skip `prisma.auditLog.create` on mutation | Audit trail is incomplete | Add it to every create / update / setEnabled |
| Import `CrmServiceError` from the entity service file | The class lives in `service-helpers.js` | `import { CrmServiceError } from './service-helpers.js'` |
| Single quotes in label strings (e.g. `"L'étiquette"`) | Breaks generated JS string literals | Avoid apostrophes in label values |

---

## 8. Advanced: Custom components and CUSTOM views

### 8.1 Custom column renderers

Place React components in `components/` and register them via `components/index.js`.
Registry key format: `<moduleKey>:<ComponentName>`. Reference the key in a TABLE or
DETAIL view column declaration via the `component` field.

```js
// components/index.js
export async function register(registry) {
  if (typeof window === 'undefined') return  // safe to import in API/Node context
  const [{ default: ContactStatusBadge }] = await Promise.all([
    import('./ContactStatusBadge.jsx'),
  ])
  registry.register('custom.crm:ContactStatusBadge', ContactStatusBadge)
}

// views/contact.table.js — use the component key in a column
columns: [
  { field: 'full_name', label: 'Nombre', sortable: true },
  { field: 'status',    label: 'Estado', component: 'custom.crm:ContactStatusBadge' },
],
```

### 8.2 CUSTOM view kind

For fully custom pages (dashboards, wizards, immersive screens). The view renders
a registered React component at a specific URL via `ImmersiveShell`.

**Three files required for every CUSTOM view:**

```js
// views/dashboard.custom.js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'crm.dashboard',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: {
    component: 'custom.crm:CrmDashboard',   // must match registry.register() key
    path: '/app/m/custom.crm/dashboard',    // must start with /
    title: 'Dashboard CRM',
    // public: true                         // required only if path starts with /p/
  },
})
```

```js
// components/index.js
export async function register(registry) {
  if (typeof window === 'undefined') return
  const { default: CrmDashboard } = await import('./CrmDashboard.jsx')
  registry.register('custom.crm:CrmDashboard', CrmDashboard)
}
```

```jsx
// components/CrmDashboard.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Skeleton, EmptyState } from '@runly/ui'

export default function CrmDashboard() {
  const [filter, setFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['crm.summary', filter],
    queryFn: async () => {
      const res = await fetch(`/api/crm/summary?filter=${filter}`)
      return res.json()
    },
  })

  if (isLoading) return <div className="p-6"><Skeleton className="h-32 w-full" /></div>

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Dashboard CRM" />
      <Card>
        <CardHeader><CardTitle>Resumen</CardTitle></CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{data?.total ?? 0} contactos</p>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Critical rules:**
- Import hooks as named imports: `import { useState, useEffect } from 'react'`
- Never use `import React from 'react'` and call `React.useState()` — causes null error
- Files must be `.jsx` — TypeScript (`.tsx`) is not supported in module bundles
- Every screen must start with `<PageHeader />`

Rules for the view schema:
- `schema.component` must match pattern `namespace:ComponentName`
- `schema.path` must start with `/`
- If `schema.path` starts with `/p/`, then `schema.public: true` is required

---

## 9. Post-generation steps

```bash
# 1. Syntax-check every generated file
node --check modules/custom/<moduleKey>/module.manifest.js
node --check modules/custom/<moduleKey>/api/index.js

# 2. Ensure the API dev server is running
pnpm dev:api   # port 4010

# 3. Install the module (first time only)
curl -X POST http://localhost:4010/modules/<moduleKey>/install \
  -H "Authorization: Bearer $ATLAS_TOKEN"

# 4. Sync to provision tables and register blueprints
curl -X POST http://localhost:4010/modules/sync \
  -H "Authorization: Bearer $ATLAS_TOKEN"

# 5. Verify blueprints registered
curl http://localhost:4010/blueprints \
  -H "Authorization: Bearer $ATLAS_TOKEN" | grep -i "<moduleKey>"

# 6. If the module has components/ — verify the bundle was compiled
curl http://localhost:4010/modules/<moduleKey>/bundle.js

# 7. After editing components — rebuild without reinstalling
curl -X POST http://localhost:4010/modules/<moduleKey>/sync \
  -H "Authorization: Bearer $ATLAS_TOKEN"

# 8. Test CRUD
curl -X POST http://localhost:4010/<slug>/<entity>s \
  -H "Authorization: Bearer $ATLAS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "full_name": "Test" }'
```

---

## 10. Reference implementation

`modules/custom/custom.fleet/` is the canonical reference. Key files:

| File | Pattern it demonstrates |
|---|---|
| `module.manifest.js` | Full manifest with models, views, permissions, navigation, lifecycle |
| `models/vehicle.model.js` | defineModel with all field types, indexes |
| `api/fleet-service.js` | Factory closure, `$queryRaw`, auditLog, soft-delete |
| `api/service-helpers.js` | Shared helpers: normalizePagination, normalizeSearch, error detection |
| `api/vehicles-routes.js` | Thin Hono routes, permission guards, validation |
| `views/vehicle.table.js` | TABLE view with custom component reference |
| `views/vehicle.form.js` | FORM view with relation fields |
| `components/index.js` | register() pattern for custom components |
