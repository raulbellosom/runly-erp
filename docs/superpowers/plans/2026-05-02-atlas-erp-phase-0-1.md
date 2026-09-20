# Atlas ERP Phase 0+1 Implementation Plan

> Superseded in storage policy by Phase 7.1 (2026-05-04): canonical bucket is `atlas-files` for branding and files.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outdated local-lite dev stack with a Supabase-first architecture, write the full numbered documentation suite, and verify that the Atlas API connects to the live Supabase instance at https://supabase.example.com.

**Architecture:** All development connects to a dedicated self-hosted Supabase instance. The Atlas ERP Docker stack (api, worker, web-preview) connects to Supabase via environment variables. No local PostgreSQL, MinIO, or Redis. The InstanceConfig Prisma model is added to support first-run detection in Phase 2.

**Tech Stack:** Node.js 22, Hono, Prisma 6, pnpm 9, React 19, Vite, Tauri 2, TailwindCSS v4, Supabase self-hosted, PostgreSQL, JavaScript only.

---

## File Structure

### Created
- `docs/00_project_status.md`
- `docs/01_erp_architecture.md`
- `docs/02_module_system.md`
- `docs/03_core_modules.md`
- `docs/04_onboarding_setup.md`
- `docs/05_supabase_prisma_strategy.md`
- `docs/06_deployment_strategy.md`
- `docs/07_auth_permissions_strategy.md`
- `docs/08_blueprints.md`
- `docs/09_next_steps.md`

### Deleted
- `docker-compose.local-lite.yml`
- `docs/ARCHITECTURE.md`
- `docs/MODULE_SYSTEM.md`
- `docs/DOCKER.md`
- `docs/SUPABASE_SELF_HOSTED_SCENARIO.md`
- `docs/CODE_STYLE.md`

### Modified
- `.env.example` â€” full rewrite, Supabase-first, dotenv substitution for Vite aliases
- `README.md` â€” remove local infra section, add Supabase setup steps
- `CLAUDE.md` â€” remove infra:* commands, absorb CODE_STYLE.md content, update architecture section, update doc references
- `docs/TASKS.md` â€” update phase status and add Supabase migration as current priority
- `docs/BLUEPRINTS.md` â€” update doc cross-references
- `codex/00_MASTER_PROMPT.md` â€” harden Supabase as real target, update doc references
- `packages/maps/src/core-modules.js` â€” add atlas.branding manifest, update existing permissions
- `prisma/schema.prisma` â€” add InstanceConfig model

---

## Task 1: Delete obsolete files

**Files:**
- Delete: `docker-compose.local-lite.yml`
- Delete: `docs/ARCHITECTURE.md`
- Delete: `docs/MODULE_SYSTEM.md`
- Delete: `docs/DOCKER.md`
- Delete: `docs/SUPABASE_SELF_HOSTED_SCENARIO.md`
- Delete: `docs/CODE_STYLE.md`

- [ ] **Step 1: Delete all six files**

```bash
rm docker-compose.local-lite.yml
rm docs/ARCHITECTURE.md
rm docs/MODULE_SYSTEM.md
rm docs/DOCKER.md
rm docs/SUPABASE_SELF_HOSTED_SCENARIO.md
rm docs/CODE_STYLE.md
```

- [ ] **Step 2: Verify they are gone**

```bash
ls docs/
```

Expected: none of the deleted files appear. `BLUEPRINTS.md`, `TASKS.md`, `CODE_STYLE.md` should not be present. `BLUEPRINTS.md` and `TASKS.md` should still exist.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete local-lite and legacy docs"
```

---

## Task 2: Rewrite .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace .env.example with the following content**

```bash
# Atlas ERP â€” Environment Variables
# Copy this file to .env and fill in real values.
# Never commit .env to version control.

# â”€â”€â”€ Atlas app â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
NODE_ENV=development
ATLAS_APP_NAME="Atlas ERP"
ATLAS_API_PORT=4010
ATLAS_TIME_ZONE=America/Mexico_City
TZ=America/Mexico_City

# â”€â”€â”€ Supabase â€” define once â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Get these from Supabase Studio â†’ Project Settings â†’ API
SUPABASE_URL=https://supabase.example.com
SUPABASE_ANON_KEY=                   # public â€” safe for frontend
SUPABASE_SERVICE_ROLE_KEY=           # SECRET â€” API/worker only, never expose to frontend

# â”€â”€â”€ Prisma / PostgreSQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Get the connection string from Supabase Studio â†’ Settings â†’ Database â†’ URI
# Use the same value for both in self-hosted Supabase (no pgBouncer by default)
DATABASE_URL=postgresql://postgres:[password]@db.supabase.example.com:5432/postgres
DIRECT_URL=postgresql://postgres:[password]@db.supabase.example.com:5432/postgres

# â”€â”€â”€ Security â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
JWT_SECRET=change_me_in_production   # SECRET â€” generate a random 64-char string
CORS_ORIGIN=http://localhost:5173,tauri://localhost

# â”€â”€â”€ Vite aliases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Vite requires VITE_ prefix to expose vars to the React bundle.
# These reference the vars above â€” do not duplicate values manually.
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
VITE_ATLAS_API_URL=http://localhost:4010

# â”€â”€â”€ NEVER add VITE_ aliases for these â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# DATABASE_URL, DIRECT_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
# must never reach the React bundle.
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: rewrite .env.example for Supabase-first architecture"
```

---

## Task 3: Add InstanceConfig to prisma/schema.prisma

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Append InstanceConfig model at the end of prisma/schema.prisma**

Open `prisma/schema.prisma`. After the last model (FinanceTransaction), append:

```prisma
model InstanceConfig {
  id        String   @id @default(uuid(7))
  key       String   @unique
  value     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Generate Prisma client to verify schema is valid**

```bash
pnpm db:generate
```

Expected output: `Generated Prisma Client` with no errors. If errors appear, fix the schema syntax before continuing.

- [ ] **Step 3: Commit schema change**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add InstanceConfig model for first-run detection"
```

---

## Task 4: Update packages/maps/src/core-modules.js

**Files:**
- Modify: `packages/maps/src/core-modules.js`

This task updates existing module permissions to match the spec and adds the new `atlas.branding` manifest.

- [ ] **Step 1: Replace the entire file with the following content**

```js
import { createModuleManifest, MODULE_KINDS } from '@atlas/core'

export const atlasCoreMap = createModuleManifest({
  key: 'atlas.core',
  name: 'Atlas Core',
  description: 'Core runtime, registry, permissions, audit and system configuration.',
  version: '0.1.0',
  kind: MODULE_KINDS.CORE,
  core: true,
  uninstallable: false,
  navigation: [
    { label: 'Dashboard', path: '/', icon: 'LayoutDashboard', layout: 'main' },
    { label: 'MÃ³dulos', path: '/modules', icon: 'Puzzle', layout: 'main' },
    { label: 'ConfiguraciÃ³n', path: '/settings', icon: 'Settings', layout: 'main' }
  ],
  permissions: [
    { key: 'core.read', name: 'Read Core' },
    { key: 'core.manage', name: 'Manage Core' },
    { key: 'modules.install', name: 'Install Modules' },
    { key: 'modules.uninstall', name: 'Uninstall Modules' },
    { key: 'modules.disable', name: 'Disable Modules' },
    { key: 'audit.read', name: 'Read Audit Logs' }
  ],
  blueprints: [
    {
      key: 'atlas.module.entity',
      kind: 'ENTITY',
      version: '0.1.0',
      schema: {
        entity: 'AtlasModule',
        label: 'MÃ³dulo',
        fields: [
          { name: 'key', label: 'Clave', type: 'text', required: true },
          { name: 'name', label: 'Nombre', type: 'text', required: true },
          { name: 'version', label: 'VersiÃ³n', type: 'text', required: true },
          { name: 'kind', label: 'Tipo', type: 'select', options: ['CORE', 'FEATURE', 'INTEGRATION', 'WEBSITE'] },
          { name: 'enabled', label: 'Activo', type: 'boolean' }
        ]
      }
    }
  ]
})

export const identityMap = createModuleManifest({
  key: 'atlas.identity',
  name: 'Identidad',
  description: 'Profiles, companies, roles, permissions and memberships.',
  version: '0.1.0',
  kind: MODULE_KINDS.CORE,
  core: true,
  uninstallable: false,
  dependencies: [{ key: 'atlas.core' }],
  navigation: [
    { label: 'Usuarios', path: '/identity/users', icon: 'Users', layout: 'main' },
    { label: 'Roles', path: '/identity/roles', icon: 'Shield', layout: 'main' }
  ],
  permissions: [
    { key: 'identity.read', name: 'Read Identity' },
    { key: 'identity.manage', name: 'Manage Identity' },
    { key: 'roles.read', name: 'Read Roles' },
    { key: 'roles.manage', name: 'Manage Roles' },
    { key: 'permissions.read', name: 'Read Permissions' },
    { key: 'permissions.manage', name: 'Manage Permissions' }
  ]
})

export const filesMap = createModuleManifest({
  key: 'atlas.files',
  name: 'Archivos',
  description: 'File metadata and Supabase Storage integration.',
  version: '0.1.0',
  kind: MODULE_KINDS.CORE,
  core: true,
  uninstallable: false,
  dependencies: [{ key: 'atlas.core' }],
  permissions: [
    { key: 'files.read', name: 'Read Files' },
    { key: 'files.upload', name: 'Upload Files' },
    { key: 'files.delete', name: 'Delete Files' },
    { key: 'files.manage', name: 'Manage Files' }
  ]
})

export const brandingMap = createModuleManifest({
  key: 'atlas.branding',
  name: 'Marca',
  description: 'Company logo, color palette, theme variables and login screen branding.',
  version: '0.1.0',
  kind: MODULE_KINDS.CORE,
  core: true,
  uninstallable: false,
  dependencies: [{ key: 'atlas.core' }, { key: 'atlas.files' }],
  navigation: [
    { label: 'Marca', path: '/settings/branding', icon: 'Palette', layout: 'main' }
  ],
  permissions: [
    { key: 'branding.read', name: 'Read Branding' },
    { key: 'branding.manage', name: 'Manage Branding' }
  ],
  exposes: {
    logoUrl: 'string',
    primaryColor: 'string',
    companyName: 'string'
  }
})

export const coreModules = [atlasCoreMap, identityMap, filesMap, brandingMap]
```

- [ ] **Step 2: Verify the file imports correctly**

```bash
node -e "import('./packages/maps/src/core-modules.js').then(m => console.log(m.coreModules.map(mod => mod.key)))"
```

Expected output:
```
[ 'atlas.core', 'atlas.identity', 'atlas.files', 'atlas.branding' ]
```

- [ ] **Step 3: Commit**

```bash
git add packages/maps/src/core-modules.js
git commit -m "feat(maps): add atlas.branding module, expand permissions for all core modules"
```

---

## Task 5: Create docs/00_project_status.md

**Files:**
- Create: `docs/00_project_status.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Project Status

**Last verified:** 2026-05-02
**Current phase:** Phase 0 complete / Phase 1 in progress

## What exists and works

### API (apps/api)
- Hono server on port 4010
- Routes: GET /health, GET /modules, POST /modules/install, DELETE /modules/:key, GET /blueprints, GET /contacts, POST /contacts
- Direct Prisma calls (no service layer yet â€” planned for Phase 4+)

### Frontend (apps/desktop)
- React 19 + Vite + Tauri 2, web preview on port 5173
- Single dashboard page (no React Router)
- Hardcoded navigation array
- TanStack Query for server state, glass morphism design

### Packages
- `@atlas/core` â€” ModuleRegistry, AtlasEventBus, createModuleManifest, MODULE_KINDS, time utilities
- `@atlas/maps` â€” 4 core module manifests, 2 feature module manifests
- `@atlas/ui` â€” 28 React components (AppShell, Button, Card, DataTable, Dialog, Form, etc.)
- `@atlas/sdk` â€” createAtlasClient factory
- `@atlas/validators` â€” Zod schemas: moduleInstallSchema, contactCreateSchema

### Database (Prisma, 15 models)
AtlasModule, ModuleDependency, Blueprint, InstanceConfig, Company, UserProfile, Membership, Role, Permission, RolePermission, FileAsset, AuditLog, Contact, FinanceAccount, FinanceTransaction

### Seeded data
- 4 core modules: atlas.core, atlas.identity, atlas.files, atlas.branding
- system.admin role with all core permissions
- All module permissions

## What is stubbed or not yet started

| Area | Status | Planned phase |
|---|---|---|
| React Router | Not started | Phase 5 |
| Supabase Auth integration | Not started | Phase 4 |
| Setup wizard / first-run | Not started | Phase 3 |
| GET /instance/status endpoint | Not started | Phase 2 |
| DynamicForm / DynamicTable | Not started | Phase 3 |
| Service layer in API | Not started | Phase 4+ |
| Worker jobs | Stub only | Phase 8+ |
| File upload/download endpoints | Not started | Phase 7 |
| Auth middleware in API | Not started | Phase 4 |
| Contacts CRUD UI | Not started | Phase 6 |
| Finance CRUD | Not started | Phase 8 |

## Supabase infrastructure

| Endpoint | URL |
|---|---|
| API | https://supabase.example.com |
| Studio | https://studio.supabase.example.com |

Dedicated to Atlas ERP. All development connects to this instance. No local PostgreSQL/MinIO fallback.

## Key constraints

- JavaScript only â€” no TypeScript
- No emojis in UI or documentation
- All UI text in Spanish; code and comments in English
- Prisma pinned to ^6 (do not upgrade to v7)
- Direct DB access from frontend is forbidden
- SUPABASE_SERVICE_ROLE_KEY must never reach the frontend bundle
```

- [ ] **Step 2: Commit**

```bash
git add docs/00_project_status.md
git commit -m "docs: add 00_project_status"
```

---

## Task 6: Create docs/01_erp_architecture.md

**Files:**
- Create: `docs/01_erp_architecture.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Architecture

## Overview

Atlas ERP is a desktop-first, full-stack modular ERP. The desktop app is a Tauri + React shell. All business logic lives in a Node.js/Hono API. Data is stored in a dedicated self-hosted Supabase instance.

## Stack

| Layer | Technology |
|---|---|
| Desktop | React 19, Vite, Tauri 2, JavaScript, TailwindCSS v4 |
| API | Node.js, Hono, Prisma 6 |
| Worker | Node.js (background jobs) |
| Data platform | Supabase self-hosted (PostgreSQL, Auth, Storage, Realtime) |
| Validation | Zod (shared between API and frontend) |
| State | TanStack Query (server state), Zustand (client UI state) |
| Forms | React Hook Form + Zod |

## Monorepo structure

```
apps/
  desktop/     React + Vite + Tauri 2 (desktop shell)
  api/         Node.js + Hono (business logic + REST API)
  worker/      Background job handler
packages/
  core/        Module registry, event bus, manifest contract, time utilities
  maps/        Module manifests: core-modules.js + feature-modules.js
  ui/          Shared React components
  sdk/         Atlas API client (createAtlasClient factory)
  validators/  Zod schemas shared between API and frontend
prisma/
  schema.prisma   Single source of truth for Atlas data models
  seed.js         Seeds core modules, permissions, roles
```

## Layer responsibilities

**apps/desktop** â€” UI only. No business logic. No direct database access. Reads auth session from Supabase Auth client (anon key only). All ERP data goes through Atlas API via `@atlas/sdk`.

**packages/sdk** â€” Typed client factory `createAtlasClient({ baseUrl })`. Groups calls by domain. Attaches JWT bearer token from Supabase session to every API request.

**apps/api** â€” Single authority for all ERP business rules and validation. Verifies JWT via Supabase Auth Admin SDK (service role key â€” never exposed to frontend). Loads UserProfile + Role + Permissions from Prisma on each authenticated request. Architecture: Routes â†’ Services â†’ Prisma.

**apps/worker** â€” Background jobs: reports, file processing, scheduled tasks. Connects to Prisma directly. No public endpoints.

**Supabase (external, self-hosted)** â€” PostgreSQL (Atlas tables via Prisma), Auth (sessions, JWTs, user creation), Storage (physical files), Realtime (future). Studio at https://studio.supabase.example.com for admin use only.

## Data flows

### ERP data
```
React â†’ @atlas/sdk (JWT attached) â†’ Atlas API â†’ Service â†’ Prisma â†’ Supabase PostgreSQL
```

### Authentication
```
React â†’ Supabase Auth client (anon key) â†’ session JWT
Atlas API â† JWT in Authorization header
Atlas API â†’ verifies via Admin SDK â†’ loads UserProfile + permissions via Prisma
```

### File storage
```
React â†’ Atlas API POST /files/upload (JWT) â†’ API â†’ Supabase Storage (service role)
                                                   â†’ FileAsset metadata via Prisma
```

### First-run
```
React â†’ GET /instance/status â†’ { initialized: false }
      â†’ /setup wizard â†’ Atlas API creates Auth user, Company, UserProfile, BrandingConfig
                       â†’ writes InstanceConfig.initialized = "true"
      â†’ /login
```

## Supabase / Prisma boundary

| Concern | Owner | Rule |
|---|---|---|
| `auth.users` | Supabase Auth | Never in Prisma migrations |
| `storage.objects` | Supabase Storage | Never in Prisma migrations |
| `public.*` Atlas tables | Prisma | Never accessed directly from frontend |
| Business rules / validation | Atlas API | Never in React components |
| Session tokens | Supabase Auth | Never stored in Atlas tables |
| File bytes | Supabase Storage | Never on local disk in production |
| File metadata (FileAsset) | Prisma | Never duplicated in Supabase Storage metadata |
| SUPABASE_SERVICE_ROLE_KEY | API only | Never in any VITE_ alias or frontend bundle |

## Supabase endpoints

| Purpose | URL |
|---|---|
| API | https://supabase.example.com |
| Studio | https://studio.supabase.example.com |
```

- [ ] **Step 2: Commit**

```bash
git add docs/01_erp_architecture.md
git commit -m "docs: add 01_erp_architecture"
```

---

## Task 7: Create docs/02_module_system.md

**Files:**
- Create: `docs/02_module_system.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Module System

## What is a module?

Every ERP feature in Atlas is a **module** (also called a **map**). Modules are self-describing via manifests: they declare their permissions, navigation, blueprints, dependencies, and what they expose to or consume from other modules.

Manifests are defined in `packages/maps/` and seeded into the `AtlasModule` table via `prisma/seed.js`.

## Manifest contract

```js
import { createModuleManifest, MODULE_KINDS } from '@atlas/core'

export const myModule = createModuleManifest({
  key: 'atlas.mymodule',        // unique â€” use reverse domain format
  name: 'My Module',
  description: '...',
  version: '0.1.0',             // semver
  kind: MODULE_KINDS.FEATURE,   // CORE | FEATURE | INTEGRATION | WEBSITE
  core: false,
  uninstallable: true,
  dependencies: [{ key: 'atlas.core' }],
  permissions: [
    { key: 'mymodule.read', name: 'Read My Module' },
    { key: 'mymodule.manage', name: 'Manage My Module' }
  ],
  navigation: [
    { label: 'Mi MÃ³dulo', path: '/mymodule', icon: 'Package', layout: 'main' }
  ],
  blueprints: [],
  exposes: {},
  consumes: {}
})
```

Required fields: `key`, `name`, `version`. All others have defaults via `createModuleManifest`.

## Module kinds

| Kind | Description |
|---|---|
| CORE | `core: true`, `uninstallable: false`. Always present. |
| FEATURE | Business module. Installable, removable, versioned. |
| INTEGRATION | Third-party connector. Same lifecycle as FEATURE. |
| WEBSITE | Public-facing module. Same lifecycle as FEATURE. |

## Core vs. feature rules

**Core:** Cannot be removed or disabled via API. `DELETE /modules/:key` returns 403.

**Feature:** Can be installed, disabled, and logically uninstalled. Uninstall sets `status: UNINSTALLED` and `enabled: false` â€” never hard-deletes data.

## Module lifecycle

```
INSTALLED â†’ DISABLED â†’ UNINSTALLED
              â†‘
           re-enable
```

Status stored in `AtlasModule.status` (enum: INSTALLED, DISABLED, UNINSTALLED, ERROR).

## ModuleRegistry (in-memory)

```js
import { ModuleRegistry } from '@atlas/core'
const registry = new ModuleRegistry()
registry.register(myModule)
registry.list()                // all modules
registry.get('atlas.mymodule') // one module
registry.resolveNavigation()   // flattened nav from enabled modules
registry.resolveBlueprints()   // flattened blueprints from all modules
registry.assertDependencies()  // throws if a dependency is missing
```

## AtlasEventBus

```js
import { AtlasEventBus } from '@atlas/core'
const bus = new AtlasEventBus()
const unsubscribe = bus.on('contact.created', async (payload) => { ... })
await bus.emit('contact.created', { id: '...' })
unsubscribe()
```

## Module-to-module communication

Current: modules communicate via declared `exposes`/`consumes` in manifests, Atlas API endpoints, and AtlasEventBus events.

Future: service registry, hooks, workflow engine.

## Versioning (SemVer)

- **Patch** (0.1.1): internal fixes, no API/schema changes
- **Minor** (0.2.0): new features, backwards-compatible
- **Major** (1.0.0): breaking changes â€” requires migration plan

## Adding a new feature module checklist

1. Add manifest to `packages/maps/src/feature-modules.js`
2. Add Prisma model(s) to `prisma/schema.prisma`
3. Run `pnpm db:migrate`
4. Add API routes to `apps/api/src/`
5. Add service to `apps/api/src/services/`
6. Add Zod schema to `packages/validators/src/index.js`
7. Update `docs/TASKS.md`
```

- [ ] **Step 2: Commit**

```bash
git add docs/02_module_system.md
git commit -m "docs: add 02_module_system"
```

---

## Task 8: Create docs/03_core_modules.md

**Files:**
- Create: `docs/03_core_modules.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Core Modules

Four core modules. All have `core: true`, `uninstallable: false`. None can be removed or disabled. All feature modules depend on one or more of these.

## atlas.core

**Owns:** Module registry, installer/uninstaller, navigation shell, dashboard shell, audit logs, system health endpoint, global settings UI, InstanceConfig reads.

**Depends on:** Nothing (root module).

**Permissions:** `core.read`, `core.manage`, `modules.install`, `modules.uninstall`, `modules.disable`, `audit.read`

**Navigation:** Dashboard (`/`), MÃ³dulos (`/modules`), ConfiguraciÃ³n (`/settings`)

## atlas.identity

**Owns:** Supabase Auth bridge, UserProfile records, Company profile, Membership assignments, Role and Permission definitions. Users UI, Roles UI, Permissions UI.

**Does NOT own:** Branding/theming (â†’ atlas.branding). HR employee records (â†’ future atlas.hr).

**Depends on:** `atlas.core`

**Permissions:** `identity.read`, `identity.manage`, `roles.read`, `roles.manage`, `permissions.read`, `permissions.manage`

**Navigation:** Usuarios (`/identity/users`), Roles (`/identity/roles`)

## atlas.files

**Owns:** FileAsset metadata records, Supabase Storage bucket strategy, upload/download proxy endpoints, reusable file picker component exposed to other modules.

**Depends on:** `atlas.core`

**Permissions:** `files.read`, `files.upload`, `files.delete`, `files.manage`

**Navigation:** None (files accessed through other modules' UI)

**Supabase Storage buckets:**
- `atlas-branding` â€” company logos and branding assets
- `atlas-files` â€” general file uploads from any module

## atlas.branding

**Owns:** Company logo (references a FileAsset), color palette, theme variables, login screen branding metadata.

**Why separate from atlas.identity:** Identity is about access control. Branding is about appearance. Different permissions, different UIs, different change frequency.

**Depends on:** `atlas.core`, `atlas.files`

**Permissions:** `branding.read`, `branding.manage`

**Navigation:** Marca (`/settings/branding`)

**Note:** The BrandingConfig Prisma model is added in Phase 3. Phase 0 adds the manifest and seeds the module metadata only.
```

- [ ] **Step 2: Commit**

```bash
git add docs/03_core_modules.md
git commit -m "docs: add 03_core_modules"
```

---

## Task 9: Create docs/04_onboarding_setup.md

**Files:**
- Create: `docs/04_onboarding_setup.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Onboarding Setup Wizard

## Purpose

On first launch, Atlas ERP has no company, no admin user, and no configuration. The setup wizard guides the first administrator through initialization. After it completes, the instance is marked initialized and cannot run setup again.

## First-run detection (Phase 2)

```
GET /instance/status â†’ { initialized: boolean, companyId: string | null }
```

Frontend route guard on startup:
- `initialized: false` â†’ redirect to `/setup`
- `initialized: true` â†’ redirect to `/login`

Initialization state lives in the `InstanceConfig` table (key-value store added in Phase 0):

| key | value | written when |
|---|---|---|
| `instance.initialized` | `"true"` | Setup wizard completes |
| `instance.company_id` | company UUID | Company created |
| `instance.setup_completed_at` | ISO timestamp | Setup wizard completes |

## Setup wizard steps

### Step 1 â€” Administrator account
- First name (required)
- Last name (required)
- Email (required, valid email format)
- Password (required, min 8 chars, uppercase + number + special char)
- Confirm password (must match)
- Phone number (optional)

### Step 2 â€” Company information
- Company name (required)
- RFC / Tax ID (required)
- Contact email (required)
- Phone number (optional)
- Address (optional)
- Industry (optional, select list)
- Country (required)
- State / City (optional)
- Website (optional)

### Step 3 â€” Branding
- Company logo upload (image only, max 5 MB)
- Primary color picker (defaults to dominant color extracted from logo)
- Secondary/accent color picker
- Logo uploaded to Supabase Storage bucket `atlas-branding`. FileAsset metadata record created. Colors saved in BrandingConfig.

### Step 4 â€” Review and confirm
- Summary of all entered data
- Back buttons to edit any step
- Confirm and finish button

## Setup API (Phase 3)

```
POST /setup/initialize
Body: { admin: { firstName, lastName, email, password, phone },
        company: { name, taxId, email, phone, country, ... },
        branding: { logoFile, primaryColor, secondaryColor } }

Steps:
1. Validate all input with Zod
2. If InstanceConfig instance.initialized == "true" â†’ return 409
3. Create Supabase Auth user (Admin SDK, service role key)
4. Create UserProfile via Prisma
5. Create Company via Prisma
6. Upload logo to Supabase Storage (bucket: atlas-branding)
7. Create FileAsset metadata via Prisma
8. Create BrandingConfig via Prisma
9. Mark all 4 core modules as INSTALLED
10. Create system.admin Role (if not seeded)
11. Assign admin role to UserProfile via Membership
12. Write InstanceConfig records
13. Return { success: true }
```

## Security

- `POST /setup/initialize` is unauthenticated (no user exists yet)
- Returns 409 if already initialized
- Endpoint is idempotent per request but permanently blocked after first success
- No "reset instance" admin UI until explicitly designed

## After setup

React redirects to `/login`. Login screen shows company logo, company name, and branding colors loaded from the API.
```

- [ ] **Step 2: Commit**

```bash
git add docs/04_onboarding_setup.md
git commit -m "docs: add 04_onboarding_setup"
```

---

## Task 10: Create docs/05_supabase_prisma_strategy.md

**Files:**
- Create: `docs/05_supabase_prisma_strategy.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Supabase + Prisma Strategy

## Supabase instance

| Endpoint | URL |
|---|---|
| API | https://supabase.example.com |
| Studio | https://studio.supabase.example.com |

Dedicated to Atlas ERP. Not shared with other projects.

## What Atlas uses from Supabase

| Feature | How Atlas uses it |
|---|---|
| PostgreSQL | Primary database for all Atlas business models, accessed via Prisma |
| Auth | Session management, JWT tokens, password recovery, admin user creation |
| Storage | Physical file storage (logos, documents, media) |
| Realtime | Future: live dashboard updates, notifications |

## Prisma owns the Atlas schema

Prisma manages all tables in the `public` schema. Supabase internal schemas (`auth`, `storage`, `realtime`, `extensions`) are **never** touched by Prisma migrations.

**Hard rule:** Never write a Prisma migration that references `auth.*`, `storage.*`, or any Supabase-internal schema.

## Database connection

Get connection strings from Supabase Studio â†’ Settings â†’ Database â†’ Connection String.

```bash
# schema.prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

```bash
# .env
DATABASE_URL=postgresql://postgres:[password]@db.supabase.example.com:5432/postgres
DIRECT_URL=postgresql://postgres:[password]@db.supabase.example.com:5432/postgres
```

Self-hosted Supabase typically does not use pgBouncer by default, so DATABASE_URL and DIRECT_URL may have the same value. Verify in Studio.

## Auth bridge: Supabase auth.users â†’ Atlas UserProfile

1. Atlas API calls `supabaseAdmin.auth.admin.createUser(...)` using the service role key
2. Supabase creates the user in `auth.users`
3. Atlas API creates a `UserProfile` row with `authUserId` = Supabase auth UUID

`UserProfile.authUserId` is a string UUID â€” no Prisma foreign key to `auth.users` (Supabase owns that table).

On login:
1. React calls Supabase Auth â†’ gets JWT
2. Every API request sends `Authorization: Bearer <jwt>`
3. Atlas API calls `supabaseAdmin.auth.getUser(jwt)` to verify
4. Loads UserProfile by `authUserId` â†’ loads Membership â†’ Role â†’ Permissions

## Supabase Storage bucket strategy

| Bucket | Contents | Access pattern |
|---|---|---|
| `atlas-branding` | Company logos, branding assets | API-proxied signed URL |
| `atlas-files` | General uploads from any module | API-proxied signed URL |

Frontend never accesses Supabase Storage directly. Atlas API generates signed URLs or proxies bytes.

File metadata stored in `FileAsset` Prisma model (bucket, objectKey, originalName, mimeType, sizeBytes).

## Migration workflow

```bash
# After changing prisma/schema.prisma:
pnpm db:generate   # regenerate Prisma client
pnpm db:migrate    # apply migration to Supabase PostgreSQL
```

Migrations committed to git in `prisma/migrations/`. Never run `prisma migrate reset` on production.

## Hard rules

- Do not access Supabase tables directly from React (`supabase.from('table').select()`)
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` in frontend or VITE_ env vars
- Do not call `supabase.auth.signUp()` from frontend for ERP user creation â€” use Atlas API
- Do not bypass Atlas API for critical ERP writes
```

- [ ] **Step 2: Commit**

```bash
git add docs/05_supabase_prisma_strategy.md
git commit -m "docs: add 05_supabase_prisma_strategy"
```

---

## Task 11: Create docs/06_deployment_strategy.md

**Files:**
- Create: `docs/06_deployment_strategy.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Deployment Strategy

## Two independent stacks

**Supabase stack** (already deployed externally):
- https://supabase.example.com â€” PostgreSQL, Auth, Storage, Realtime, Studio
- Not managed by Atlas ERP's docker-compose
- Credentials in `.env`, never in version control

**Atlas ERP stack** (managed here):
- `apps/api` â€” Hono REST API
- `apps/worker` â€” background job processor
- `apps/desktop` â€” Tauri desktop application
- Connects to Supabase via environment variables

## No local database

There is no local PostgreSQL, Redis, or MinIO in the Atlas ERP dev setup. All development connects to https://supabase.example.com.

## Development setup (local, without Docker)

```bash
# 1. Copy and fill env
cp .env.example .env
# Fill: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DIRECT_URL, JWT_SECRET

# 2. Install dependencies
pnpm install

# 3. First-time database setup
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 4. Start dev servers
pnpm dev           # API + Vite web preview + worker
pnpm dev:tauri     # Native Tauri window + all servers (requires Rust)
```

## Ports (development)

| Service | URL |
|---|---|
| API | http://localhost:4010 |
| Frontend (Vite) | http://localhost:5173 |
| Prisma Studio | http://localhost:5555 |

## docker-compose.yml

Runs Atlas ERP application services only. Does not start any database â€” all services connect to Supabase via env vars.

```bash
docker compose up    # start api + worker + web-preview
docker compose down
```

## Tauri desktop build (Windows only)

```bash
cd apps/desktop
pnpm tauri build   # produces .exe installer
pnpm tauri dev     # native window with hot-reload
```

Requires Rust toolchain + Windows SDK. Not available inside Docker containers.

## Per-company deployment model

Each company deployment:
- Own Atlas ERP instance (API + worker + desktop)
- Own `.env` with company-specific DATABASE_URL and credentials
- Own Supabase stack (strong isolation) OR shared Supabase with company-scoped data (future multi-company mode using existing Company/Membership schema)

Current priority: single-company per deployment.
```

- [ ] **Step 2: Commit**

```bash
git add docs/06_deployment_strategy.md
git commit -m "docs: add 06_deployment_strategy"
```

---

## Task 12: Create docs/07_auth_permissions_strategy.md

**Files:**
- Create: `docs/07_auth_permissions_strategy.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Authentication and Permissions Strategy

## Two-layer architecture

| Concern | Owner |
|---|---|
| Email/password login | Supabase Auth |
| Session tokens (JWT) | Supabase Auth |
| Password recovery | Supabase Auth |
| User profiles | Atlas API + Prisma |
| Companies + memberships | Atlas API + Prisma |
| Roles + permissions | Atlas API + Prisma |
| Module access control | Atlas API + Prisma |

## Auth flow

1. React calls `supabase.auth.signInWithPassword({ email, password })` (anon key)
2. Supabase returns a signed JWT
3. Supabase client stores session and handles refresh automatically
4. Every `@atlas/sdk` request includes `Authorization: Bearer <jwt>`
5. Atlas API calls `supabaseAdmin.auth.getUser(jwt)` to verify (service role key)
6. API loads UserProfile by `authUserId` â†’ Membership â†’ Role â†’ Permissions
7. Route handler receives verified user context

## RBAC data model

```
UserProfile (authUserId â†’ Supabase auth.users.id)
  â†“
Membership  (UserProfile â†” Company â†” Role)
  â†“
Role
  â†“
RolePermission  (Role â†” Permission)
  â†“
Permission  (key: 'contacts.read', moduleId, etc.)
```

## User vs. HR employee

```
Supabase auth.users
  â†“ (authUserId)
UserProfile          â† someone who can log in to Atlas ERP
  â†“ (optional)
HREmployee           â† HR/business record (future atlas.hr module)
```

- A `UserProfile` is an Atlas identity with login access.
- An `HREmployee` is a business record that may or may not have a login.
- Employees without user accounts are valid (contractors, archived staff).
- System users without employee records are valid (IT admins, service accounts).

`HREmployee` is added when `atlas.hr` is built. `UserProfile` exists today.

## Permission middleware (Phase 4 implementation)

```js
// apps/api/src/middleware/require-permission.js
export function requirePermission(permissionKey) {
  return async (c, next) => {
    const jwt = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!jwt) return c.json({ error: 'Unauthorized' }, 401)

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(jwt)
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401)

    const profile = await prisma.userProfile.findUnique({
      where: { authUserId: user.id },
      include: {
        memberships: {
          where: { enabled: true },
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } }
              }
            }
          }
        }
      }
    })

    if (!profile || !profile.enabled) return c.json({ error: 'Forbidden' }, 403)

    const has = profile.memberships.some(m =>
      m.role.permissions.some(rp => rp.permission.key === permissionKey)
    )
    if (!has) return c.json({ error: 'Forbidden' }, 403)

    c.set('user', profile)
    await next()
  }
}
```

Usage in routes (Phase 4+):
```js
app.get('/contacts', requirePermission('contacts.read'), async (c) => { ... })
```

## Supabase Auth configuration (in Studio)

Navigate to https://studio.supabase.example.com â†’ Authentication:
- Enable Email provider (email + password)
- JWT secret must match `JWT_SECRET` in `.env`
- Configure SMTP for password recovery emails
```

- [ ] **Step 2: Commit**

```bash
git add docs/07_auth_permissions_strategy.md
git commit -m "docs: add 07_auth_permissions_strategy"
```

---

## Task 13: Create docs/08_blueprints.md

**Files:**
- Create: `docs/08_blueprints.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Blueprint System

## What blueprints are

Blueprints are declarative JSON definitions that describe entities, forms, tables, and other UI structures. They drive `DynamicForm` and `DynamicTable` components (planned for Phase 3).

**Blueprints are not a substitute for:**
- Prisma schema (database structure)
- Zod validators (API validation)
- API routes and services (business logic)
- Custom React components (complex UI)

Source of truth: Prisma â†’ API service â†’ Zod validator â†’ Blueprint (UI hint only).

## Blueprint kinds

| Kind | Purpose |
|---|---|
| ENTITY | Business entity and its field definitions |
| FORM | Form layout with section groupings |
| TABLE | List/grid view with column and filter config |
| DASHBOARD | Dashboard widget layout |
| ACTION | Button/action that triggers a workflow |
| RELATION | Relationship between two entities |
| PERMISSION | Permission-scoped UI element |

## Field types

| Type | Input | Notes |
|---|---|---|
| `text` | Single-line text | Name, reference number |
| `textarea` | Multi-line text | Description, notes |
| `number` | Numeric | Quantity, count |
| `decimal` | Decimal | Price, balance |
| `boolean` | Checkbox / toggle | Active, enabled |
| `select` | Dropdown (single) | Type, status |
| `multiselect` | Dropdown (multiple) | Tags, categories |
| `date` | Date picker | Birth date, due date |
| `datetime` | Date + time picker | Scheduled, created at |
| `email` | Email input | Contact email |
| `phone` | Phone input | Contact phone |
| `relation` | Entity link picker | Contact, company |
| `file` | File upload | Powered by atlas.files |
| `color` | Color picker | Brand color |
| `json` | Raw JSON editor | Metadata, settings |

## Blueprint structure example

```js
{
  key: 'contacts.contact.entity',   // module.entity.kind
  kind: 'ENTITY',
  version: '0.1.0',
  schema: {
    entity: 'Contact',              // Prisma model name
    label: 'Contacto',              // Spanish display name
    fields: [
      {
        name: 'type', label: 'Tipo', type: 'select',
        options: ['customer', 'supplier', 'person', 'company'],
        required: true
      },
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'TelÃ©fono', type: 'phone' }
    ],
    table: { columns: ['type', 'name', 'email', 'phone'] },
    form: {
      sections: [
        { title: 'InformaciÃ³n general', fields: ['type', 'name', 'email', 'phone', 'taxId'] }
      ]
    }
  }
}
```

## Blueprint lifecycle

1. Defined in module manifest under `blueprints` array (`packages/maps/`)
2. Seeded into `Blueprint` table by `prisma/seed.js`
3. Served by `GET /blueprints` with module metadata
4. Consumed by `DynamicForm` / `DynamicTable` (Phase 3)

## Rule

Every blueprint stored in the database must have a corresponding:
- Prisma model
- API routes (minimum: list + create)
- Zod schema in `@atlas/validators`
- UI renderer (DynamicForm/DynamicTable or custom component)

## DynamicForm and DynamicTable (Phase 3)

**DynamicForm** â€” reads ENTITY or FORM blueprint, renders React Hook Form. Field validation sourced from `@atlas/validators` Zod schemas.

**DynamicTable** â€” reads TABLE blueprint, renders TanStack Table with configured columns, sortable headers, and pagination.

Both components live in `packages/ui` and are blueprint-consumer only â€” no module-specific knowledge.
```

- [ ] **Step 2: Commit**

```bash
git add docs/08_blueprints.md
git commit -m "docs: add 08_blueprints"
```

---

## Task 14: Create docs/09_next_steps.md

**Files:**
- Create: `docs/09_next_steps.md`

- [ ] **Step 1: Create the file with the following content**

```markdown
# Atlas ERP â€” Next Steps

## Current: Phase 0+1

### Phase 0 â€” Repository and environment cleanup
Remove obsolete local-lite stack, write numbered docs, align .env.example to Supabase-first, add atlas.branding manifest and InstanceConfig schema model.

**Success:** Repo has one coherent view of the architecture. All docs reference https://supabase.example.com.

### Phase 1 â€” Supabase + Prisma connection
Connect to live Supabase, run migrations, seed 4 core modules, verify API responds.

**Success:** `GET /health` returns 200. `GET /modules` returns 4 core modules from Supabase.

---

## Upcoming phases

Each phase gets its own brainstorm â†’ spec â†’ plan â†’ implement cycle.

### Phase 2 â€” ERP initialization state
- `GET /instance/status` API endpoint
- Frontend route guard: uninitialized â†’ `/setup`, initialized â†’ `/login`

### Phase 3 â€” Onboarding setup wizard
- 4-step wizard UI (admin account, company info, branding, review)
- `POST /setup/initialize` API endpoint
- Create Supabase Auth user, UserProfile, Company, BrandingConfig
- Add BrandingConfig Prisma model
- Mark instance as initialized

### Phase 4 â€” Auth integration
- Login screen (company-branded with logo + colors from API)
- Supabase Auth `signInWithPassword`
- Session persistence and logout
- JWT verification middleware in Atlas API
- UserProfile + permission loading on each request

### Phase 5 â€” Atlas shell and module registry UI
- React Router setup
- Module launcher (home screen, app grid)
- Module-specific layouts and sidebars
- Module catalog: install, disable, view status
- Core module protection enforced in UI and API

### Phase 6 â€” Contacts module (first full business module)
- Full CRUD API with service layer
- Blueprint-driven list and form UI (DynamicForm + DynamicTable)
- Contact types: customer, supplier, person, company
- Expose contact picker to other modules via `exposes`

### Phase 7 â€” Files module
- Supabase Storage bucket creation
- Upload endpoint with FileAsset metadata
- Download/signed URL endpoint
- FileUploader and FileViewer reusable components
- Company logo upload connected to atlas.branding

### Phase 8+ â€” Business modules
Finance, Purchases, Inventory, HR, Fleet, Reports â€” one per brainstorm cycle.

---

## Architecture references

| Document | Contents |
|---|---|
| [01_erp_architecture.md](01_erp_architecture.md) | Full system architecture and data flows |
| [02_module_system.md](02_module_system.md) | Module manifest contract and lifecycle |
| [03_core_modules.md](03_core_modules.md) | Core module definitions |
| [04_onboarding_setup.md](04_onboarding_setup.md) | Setup wizard design |
| [05_supabase_prisma_strategy.md](05_supabase_prisma_strategy.md) | Supabase + Prisma integration |
| [06_deployment_strategy.md](06_deployment_strategy.md) | Deployment guide |
| [07_auth_permissions_strategy.md](07_auth_permissions_strategy.md) | Auth and RBAC strategy |
| [08_blueprints.md](08_blueprints.md) | Blueprint system reference |
```

- [ ] **Step 2: Commit**

```bash
git add docs/09_next_steps.md
git commit -m "docs: add 09_next_steps"
```

---

## Task 15: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README.md with the following content**

```markdown
# Atlas ERP

Desktop-first, full-stack modular ERP built with React + Vite + Tauri, a Node/Hono API, Prisma, and a dedicated self-hosted Supabase instance.

## Quick start

```bash
# 1. Copy and fill environment variables
cp .env.example .env
# Open .env and fill in: SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
# DATABASE_URL, DIRECT_URL, JWT_SECRET
# Get connection strings from https://studio.supabase.example.com

# 2. Install dependencies
pnpm install

# 3. Set up database (first time only)
pnpm db:generate    # generate Prisma client
pnpm db:migrate     # apply migrations to Supabase PostgreSQL
pnpm db:seed        # seed core modules, roles, permissions

# 4. Start dev servers
pnpm dev            # API + Vite web preview + worker
```

Open **http://localhost:5173** in your browser or run `pnpm dev:tauri` for the native window.

## Dev commands

### Servers

| Command | What it does |
|---|---|
| `pnpm dev` | API + Vite web preview + worker (recommended) |
| `pnpm dev:api` | API only â€” port 4010 |
| `pnpm dev:frontend` | Vite web preview only â€” port 5173 |
| `pnpm dev:worker` | Background worker only |
| `pnpm dev:tauri` | Native Tauri window + all servers (requires Rust toolchain) |

### Database

| Command | What it does |
|---|---|
| `pnpm db:generate` | Regenerate Prisma client after schema changes |
| `pnpm db:migrate` | Run pending migrations against Supabase PostgreSQL |
| `pnpm db:seed` | Seed core modules, permissions, roles |
| `pnpm db:studio` | Open Prisma Studio GUI â€” http://localhost:5555 |
| `pnpm db:fresh` | migrate + generate + seed (non-destructive) |

### Build

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages and apps |
| `pnpm icons:generate` | Regenerate Tauri app icons |

## Ports

| Service | URL |
|---|---|
| API | http://localhost:4010 |
| Frontend (Vite) | http://localhost:5173 |
| Prisma Studio | http://localhost:5555 |
| Supabase API | https://supabase.example.com |
| Supabase Studio | https://studio.supabase.example.com |

## Architecture

```
apps/
  desktop/     React + Vite + Tauri 2 (desktop shell)
  api/         Node.js + Hono (business logic + REST API)
  worker/      Background job handler
packages/
  core/        Module registry, event bus, manifest contract
  maps/        Module manifests: core-modules.js + feature-modules.js
  ui/          Shared React components
  sdk/         Atlas API client (createAtlasClient)
  validators/  Zod schemas shared between API and frontend
prisma/
  schema.prisma   Database models
  seed.js         Seeds core modules, roles, permissions
```

**Request flow:** `React â†’ @atlas/sdk â†’ Hono API â†’ Zod validation â†’ Prisma â†’ Supabase PostgreSQL`

No direct database access from the frontend. The API owns all business rules and validation.

## Module system

Every ERP feature is a **module**. Modules register via manifests in `packages/maps/`.

- **Core modules** â€” `atlas.core`, `atlas.identity`, `atlas.files`, `atlas.branding` â€” cannot be uninstalled.
- **Feature modules** â€” installable, versioned, with declared dependencies.

See [docs/02_module_system.md](docs/02_module_system.md) and [docs/01_erp_architecture.md](docs/01_erp_architecture.md).

## Notes

- All UI text must be in **Spanish**. Code, docs, and comments are in **English**.
- JavaScript only â€” no TypeScript.
- Tailwind for all styles.
- Prisma is pinned to `^6`. Do not upgrade to v7 (breaking API changes).
- Supabase Studio: https://studio.supabase.example.com (admin use only).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for Supabase-first setup"
```

---

## Task 16: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the Commands section and Development phases section**

The full replacement for `CLAUDE.md` follows. Read the file first, then replace it entirely:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup
cp .env.example .env
# Fill in SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DIRECT_URL, JWT_SECRET
# Get connection strings from https://studio.supabase.example.com

pnpm install          # install all dependencies
pnpm db:generate      # generate Prisma client
pnpm db:migrate       # apply migrations to Supabase PostgreSQL
pnpm db:seed          # seed core modules, permissions, roles

# Start dev servers (API + Vite web preview + worker)
pnpm dev              # recommended for daily dev â€” web at http://localhost:5173
pnpm dev:tauri        # full native Tauri window (requires Rust toolchain)

# Start individually
pnpm dev:api          # API on port 4010
pnpm dev:frontend     # Vite web preview on port 5173
pnpm dev:worker       # Background worker

# Database
pnpm db:migrate       # run pending migrations
pnpm db:generate      # regenerate Prisma client after schema changes
pnpm db:seed          # seed core modules, permissions, roles
pnpm db:studio        # open Prisma Studio GUI (http://localhost:5555)
pnpm db:fresh         # migrate + generate + seed (non-destructive)

# Build
pnpm build            # build all packages/apps
```

There is no `pnpm infra:up` or local database stack. All development connects to https://supabase.example.com.

### Desktop native build (Windows only)

```bash
cd apps/desktop
pnpm tauri build   # Produces .exe via Rust/Tauri toolchain
pnpm tauri dev     # Native window with hot-reload
```

Tauri requires Rust toolchain + Windows SDK. For development without Tauri, use `pnpm dev:frontend` (Vite web preview only).

## Architecture

### Monorepo structure

```
apps/
  desktop/     React + Vite + Tauri 2 (desktop shell)
  api/         Node.js + Hono (business logic + API)
  worker/      Node.js background job handler (stub)
packages/
  core/        Module registry, event bus, manifest contract
  maps/        Module manifests: core-modules.js + feature-modules.js
  ui/          Shared React components (AppShell, Button, Card, etc.)
  sdk/         Atlas API client (createAtlasClient factory)
  validators/  Zod schemas shared between API and frontend
prisma/
  schema.prisma   Single source of truth for data models
  seed.js         Seeds core modules, blueprints, permissions
```

### Request flow

```
React (apps/desktop)
  â†’ @atlas/sdk createAtlasClient   (packages/sdk)
  â†’ Hono API (apps/api/src/index.js)
  â†’ Zod validation (@atlas/validators)
  â†’ Prisma â†’ Supabase PostgreSQL
```

No direct database access from the frontend. The API is the authority for all business rules, validation, and permissions.

### Supabase infrastructure

All development uses the dedicated self-hosted Supabase instance:
- API: https://supabase.example.com
- Studio: https://studio.supabase.example.com (admin use only)

### Module system (packages/core + packages/maps)

Every ERP feature is a **map** (module). Modules are registered via manifests defined in `packages/maps/`.

A manifest defines: `key`, `name`, `version`, `kind`, `core`, `uninstallable`, `dependencies`, `permissions`, `navigation`, `blueprints`, `exposes`, `consumes`.

Two categories:
- **Core modules** (`core-modules.js`): `core: true`, `uninstallable: false` â€” atlas.core, atlas.identity, atlas.files, atlas.branding. Cannot be removed via API.
- **Feature modules** (`feature-modules.js`): installable, versioned, can depend on other modules.

The `ModuleRegistry` class (`packages/core/src/module-registry.js`) handles registration, dependency validation, navigation resolution, and blueprint flattening. The API seeds these into `AtlasModule` rows via `prisma/seed.js`.

### Blueprint system

Blueprints are declarative JSON schemas describing UI and entity metadata. They live in module manifests under `blueprints`, are stored in the `Blueprint` table, and are served via `GET /blueprints`.

Blueprint kinds: `ENTITY`, `FORM`, `TABLE`, `DASHBOARD`, `ACTION`, `RELATION`, `PERMISSION`.

See `docs/08_blueprints.md` for field type reference and rendering rules.

### API structure (apps/api/src/index.js)

Current pattern: routes â†’ direct Prisma calls. Planned service layer:

```
routes (Hono handlers)
  â†’ services (business logic)
  â†’ Prisma (database)
```

Key endpoints:
- `GET /health` â€” liveness check
- `GET /modules` / `POST /modules/install` / `DELETE /modules/:key` â€” module lifecycle
- `GET /blueprints` â€” all enabled blueprints with module metadata
- `GET /contacts` / `POST /contacts` â€” first real CRUD module

### Shared validators (packages/validators)

`moduleInstallSchema` and `contactCreateSchema` are Zod schemas shared between API and frontend. Add new schemas here when creating new modules.

### SDK (packages/sdk)

`createAtlasClient({ baseUrl })` returns a typed client grouped by domain (`modules`, `blueprints`, `contacts`). The desktop app instantiates this using `VITE_ATLAS_API_URL`.

### UI components (packages/ui)

`AppShell` is the main layout: fixed sidebar + scrollable main content. Navigation items come from module manifests resolved at runtime. Import from `@atlas/ui`.

Tailwind scans both `src/**` and `../../packages/ui/src/**` (configured in `apps/desktop/tailwind.config.js`).

### Prisma schema highlights

- `AtlasModule` â€” installed modules (status: INSTALLED/DISABLED/UNINSTALLED/ERROR)
- `Blueprint` â€” stored blueprint JSON per module
- `InstanceConfig` â€” key-value store for instance-level state (e.g., initialized flag)
- `Permission` + `Role` + `RolePermission` â€” RBAC
- `Company` + `UserProfile` + `Membership` â€” multi-tenancy foundation
- `AuditLog` â€” entity-level audit trail
- `FileAsset` â€” file metadata only (actual files in Supabase Storage)
- `Contact` â€” first real business entity

## Language and conventions

- **JavaScript only** â€” no TypeScript in this repo yet
- **No emojis** in UI or documentation
- **All UI text in Spanish** â€” code, docs, and comments in English
- **Tailwind** for all styles â€” no CSS modules or styled-components
- **React Hook Form + Zod** for forms
- **TanStack Query** for server state; Zustand for client-only UI state when needed
- **Hono** for API routes â€” keep route files thin, push logic to services
- Business logic stays in `apps/api`, not in React components
- Soft-delete pattern: use `enabled: false` instead of hard-deleting records
- Every new module needs: manifest in `packages/maps`, Prisma model(s), API routes, service, Zod schema in `packages/validators`, and a `docs/TASKS.md` update
- Prisma is pinned to `^6` â€” do not upgrade to v7

## Architecture documentation

Before adding a new feature, read:
- `docs/01_erp_architecture.md` â€” full system architecture
- `docs/02_module_system.md` â€” module system
- `docs/03_core_modules.md` â€” core module definitions
- `docs/08_blueprints.md` â€” blueprint field types and rendering rules
- `docs/TASKS.md` â€” current phase status and roadmap

## Development phases (current state)

See `docs/TASKS.md` for the full phased roadmap.

- Phase 0 (repository cleanup + env alignment) â€” complete
- Phase 1 (Supabase + Prisma connection) â€” current
- Phase 2+ (instance state, setup wizard, auth, shell, contacts) â€” not yet started
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md â€” Supabase-first, absorb CODE_STYLE.md, update references"
```

---

## Task 17: Update docs/TASKS.md

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Replace docs/TASKS.md with the following content**

```markdown
# Atlas ERP â€” Tasks and Roadmap

## Phase 0 â€” Repository and environment cleanup

- [x] Remove docker-compose.local-lite.yml
- [x] Remove obsolete docs (ARCHITECTURE.md, MODULE_SYSTEM.md, DOCKER.md, SUPABASE_SELF_HOSTED_SCENARIO.md, CODE_STYLE.md)
- [x] Rewrite .env.example for Supabase-first with dotenv substitution pattern
- [x] Create numbered docs suite (docs/00â€“09)
- [x] Update README.md, CLAUDE.md, codex/00_MASTER_PROMPT.md
- [x] Add atlas.branding manifest to core-modules.js
- [x] Add InstanceConfig model to prisma/schema.prisma
- [x] Update docs/TASKS.md (this file) and docs/BLUEPRINTS.md

Verified: 2026-05-02

## Phase 1 â€” Supabase + Prisma connection

- [ ] Fill .env with real Supabase credentials (DATABASE_URL, DIRECT_URL, keys)
- [ ] Run pnpm db:generate â€” Prisma client against Supabase PostgreSQL
- [ ] Run pnpm db:migrate â€” apply schema including InstanceConfig migration
- [ ] Run pnpm db:seed â€” 4 core modules, admin role, permissions
- [ ] Verify GET /health returns 200
- [ ] Verify GET /modules returns 4 core modules from live Supabase

## Phase 2 â€” ERP initialization state

- [ ] Add GET /instance/status endpoint
- [ ] Read InstanceConfig.instance.initialized from DB
- [ ] Add frontend route guard (initialized â†’ /login, not initialized â†’ /setup)
- [ ] Test: fresh instance shows /setup, initialized instance shows /login

## Phase 3 â€” Onboarding setup wizard

- [ ] Add BrandingConfig Prisma model and migration
- [ ] Build 4-step wizard UI (admin account, company info, branding, review)
- [ ] Build POST /setup/initialize API endpoint
- [ ] Create Supabase Auth user via Admin SDK
- [ ] Create UserProfile, Company, BrandingConfig via Prisma
- [ ] Upload logo to Supabase Storage (atlas-branding bucket)
- [ ] Write InstanceConfig records (initialized, company_id, completed_at)

## Phase 4 â€” Auth integration

- [ ] Login screen (company-branded, loads logo + colors from API)
- [ ] Supabase Auth signInWithPassword flow
- [ ] Session persistence and logout
- [ ] JWT verification middleware in Atlas API
- [ ] UserProfile + role + permission loading on each authenticated request
- [ ] Password recovery placeholder

## Phase 5 â€” Atlas shell and module registry UI

- [ ] React Router setup
- [ ] Module launcher (app home screen / module grid)
- [ ] Module-specific layouts and sidebars
- [ ] Module catalog: install, disable, view status
- [ ] Core module protection in UI and API

## Phase 6 â€” Contacts module

- [ ] Contacts list page with DynamicTable
- [ ] Contact form page/modal with DynamicForm
- [ ] Full CRUD API with service layer
- [ ] Contact picker component exposed to other modules

## Phase 7 â€” Files module

- [ ] Supabase Storage bucket setup (atlas-branding, atlas-files)
- [ ] Upload endpoint with FileAsset metadata
- [ ] Download/signed URL endpoint
- [ ] FileUploader and FileViewer reusable components

## Phase 8 â€” Finance module

- [ ] Accounts CRUD
- [ ] Transactions CRUD
- [ ] Balances calculation
- [ ] Dashboard widgets
- [ ] Optional contact relation

## Phase 9 â€” Future modules

- [ ] Purchases
- [ ] Inventory
- [ ] HR (hr_employees, org chart)
- [ ] Fleet
- [ ] Reports
- [ ] Website builder / CMS
```

- [ ] **Step 2: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs: update TASKS.md â€” Phase 0 complete, Phase 1 current, full roadmap"
```

---

## Task 18: Update docs/BLUEPRINTS.md

**Files:**
- Modify: `docs/BLUEPRINTS.md`

- [ ] **Step 1: Replace docs/BLUEPRINTS.md with the following content**

```markdown
# Blueprints â€” Quick Reference

For the full blueprint system architecture, see [docs/08_blueprints.md](08_blueprints.md).

## What blueprints are

Blueprints are declarative JSON definitions that describe entities, forms, tables, and other UI structures. They drive `DynamicForm` and `DynamicTable` (Phase 3).

A blueprint does **not** replace Prisma. Prisma defines real persistence. Blueprints help build UI, permissions, and dynamic experiences.

## Types

| Kind | Purpose |
|---|---|
| ENTITY | Business entity and field definitions |
| FORM | Form layout with section groupings |
| TABLE | List/grid view with column config |
| DASHBOARD | Dashboard widget layout |
| ACTION | Button/action triggering a workflow |
| RELATION | Relationship between two entities |
| PERMISSION | Permission-scoped UI element |

## Field types

`text`, `textarea`, `number`, `decimal`, `boolean`, `select`, `multiselect`, `date`, `datetime`, `email`, `phone`, `relation`, `file`, `color`, `json`

## Example

```js
{
  key: 'contacts.contact.entity',
  kind: 'ENTITY',
  version: '0.1.0',
  schema: {
    entity: 'Contact',
    label: 'Contacto',
    fields: [
      { name: 'type', label: 'Tipo', type: 'select', options: ['customer', 'supplier'], required: true },
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email' }
    ],
    table: { columns: ['type', 'name', 'email'] }
  }
}
```

## Rule

Every blueprint stored in the database must have a corresponding Prisma model, API routes, Zod validation schema, and UI renderer.
```

- [ ] **Step 2: Commit**

```bash
git add docs/BLUEPRINTS.md
git commit -m "docs: update BLUEPRINTS.md â€” add cross-reference to 08_blueprints, expand field types"
```

---

## Task 19: Update codex/00_MASTER_PROMPT.md

**Files:**
- Modify: `codex/00_MASTER_PROMPT.md`

- [ ] **Step 1: Replace codex/00_MASTER_PROMPT.md with the following content**

```markdown
# Codex Master Prompt - Atlas ERP

ActÃºa como arquitecto full stack senior y desarrolla Atlas ERP siguiendo estrictamente esta documentaciÃ³n.

## Producto

Atlas ERP es un ERP modular desktop-first construido con React + Vite + Tauri. Aunque se instala como app de escritorio Windows, la arquitectura es full stack y server-backed.

## Infraestructura Supabase

Atlas ERP usa una instancia dedicada de Supabase self-hosted:

- API: https://supabase.example.com
- Studio: https://studio.supabase.example.com (solo administraciÃ³n)

Esta instancia es exclusiva de Atlas ERP. No se comparte con otros proyectos.

## Stack base

- Desktop: Tauri 2
- Frontend: React + Vite + JavaScript
- UI: TailwindCSS + componentes reutilizables propios
- Data fetching: TanStack Query
- State: Zustand cuando sea necesario
- API: Node.js + Hono
- ORM: Prisma (pinned a ^6)
- DB: Supabase PostgreSQL (https://supabase.example.com)
- Auth: Supabase Auth self-hosted
- Storage: Supabase Storage self-hosted
- Realtime: futuro
- Workers: Node.js
- ValidaciÃ³n: Zod

## Principios obligatorios

1. No meter lÃ³gica de negocio crÃ­tica en React.
2. React consume Atlas API mediante `@atlas/sdk`. Nunca accede a Supabase directamente para datos ERP.
3. Prisma es la fuente para modelos persistentes de Atlas ERP.
4. Supabase Auth maneja sesiÃ³n y JWT, pero Atlas maneja perfiles, roles, permisos y compaÃ±Ã­as.
5. Supabase Storage maneja archivos fÃ­sicos, pero PostgreSQL (vÃ­a Prisma FileAsset) guarda metadata.
6. Los mÃ³dulos core (atlas.core, atlas.identity, atlas.files, atlas.branding) no son desinstalables.
7. Los mÃ³dulos feature sÃ­ pueden instalarse, desactivarse y desinstalarse lÃ³gicamente.
8. Cada mÃ³dulo debe declarar su manifest en `packages/maps/`.
9. Cada mÃ³dulo debe declarar permisos, blueprints, navegaciÃ³n y dependencias.
10. Todo componente visual repetible debe vivir en `packages/ui` o en un componente reusable del mÃ³dulo.
11. `SUPABASE_SERVICE_ROLE_KEY` nunca debe llegar al frontend ni a ninguna variable VITE_.

## Tono de implementaciÃ³n

Desarrolla incrementalmente. Antes de crear un mÃ³dulo, revisa:

- `docs/01_erp_architecture.md`
- `docs/02_module_system.md`
- `docs/03_core_modules.md`
- `docs/08_blueprints.md`
- `docs/TASKS.md`

No cambies la arquitectura sin documentarlo.

## Estado verificado

- Phase 0: completo (2026-05-02)
- Phase 1: en progreso â€” conectar Prisma a Supabase PostgreSQL
- Phase 2+: pendiente
```

- [ ] **Step 2: Commit**

```bash
git add codex/00_MASTER_PROMPT.md
git commit -m "docs: update codex/00_MASTER_PROMPT â€” harden Supabase as real target, update doc refs, add 11th principle"
```

---

## Task 20: Verify Phase 0 is complete

**Files:** None (verification only)

- [ ] **Step 1: Confirm all new docs exist**

```bash
ls docs/
```

Expected output includes: `00_project_status.md`, `01_erp_architecture.md`, `02_module_system.md`, `03_core_modules.md`, `04_onboarding_setup.md`, `05_supabase_prisma_strategy.md`, `06_deployment_strategy.md`, `07_auth_permissions_strategy.md`, `08_blueprints.md`, `09_next_steps.md`, `BLUEPRINTS.md`, `TASKS.md`, `superpowers/`

- [ ] **Step 2: Confirm obsolete files are gone**

```bash
ls docs/ARCHITECTURE.md docs/MODULE_SYSTEM.md docs/DOCKER.md 2>&1
```

Expected: file not found errors for all three.

- [ ] **Step 3: Confirm docker-compose.local-lite.yml is gone**

```bash
ls docker-compose.local-lite.yml 2>&1
```

Expected: file not found.

- [ ] **Step 4: Confirm coreModules exports 4 modules**

```bash
node -e "import('./packages/maps/src/core-modules.js').then(m => console.log(m.coreModules.map(mod => mod.key)))"
```

Expected: `[ 'atlas.core', 'atlas.identity', 'atlas.files', 'atlas.branding' ]`

- [ ] **Step 5: Confirm InstanceConfig is in schema**

```bash
grep -n "InstanceConfig" prisma/schema.prisma
```

Expected: line with `model InstanceConfig {`

---

## Task 21: [Phase 1] Fill .env with real Supabase credentials

**Files:**
- Modify: `.env` (local file, never committed)

This task requires manual input from the developer. The agent cannot fill credentials automatically.

- [ ] **Step 1: Open .env and fill in the required values**

Open `.env` (copied from `.env.example`). Fill in:

```bash
SUPABASE_ANON_KEY=<get from Supabase Studio â†’ Project Settings â†’ API â†’ anon public>
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase Studio â†’ Project Settings â†’ API â†’ service_role secret>
DATABASE_URL=<get from Supabase Studio â†’ Settings â†’ Database â†’ Connection String â†’ URI>
DIRECT_URL=<same as DATABASE_URL for self-hosted Supabase>
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
```

The `SUPABASE_URL` is already set to `https://supabase.example.com` in `.env.example`.

- [ ] **Step 2: Verify .env is not tracked by git**

```bash
git status .env
```

Expected: `.env` is listed under "Untracked files" or not listed at all (if in .gitignore). If it shows as tracked, run `git rm --cached .env` immediately.

---

## Task 22: [Phase 1] Generate Prisma client and run migration

**Files:** None modified (generated files only)

- [ ] **Step 1: Generate Prisma client**

```bash
pnpm db:generate
```

Expected output: `Generated Prisma Client` with no errors. If there is a connection error, verify `DATABASE_URL` in `.env` is correct.

- [ ] **Step 2: Run migration**

```bash
pnpm db:migrate
```

Expected output: `All migrations have been successfully applied.` or `1 migration applied.` (for the InstanceConfig migration). If a migration is pending, it will be applied and show the migration name.

- [ ] **Step 3: Verify InstanceConfig table exists in Supabase**

Open Prisma Studio:
```bash
pnpm db:studio
```

Navigate to http://localhost:5555. Verify the `InstanceConfig` table appears in the left sidebar.

Alternatively, check via Supabase Studio at https://studio.supabase.example.com â†’ Table Editor. The `instance_config` table should be visible.

---

## Task 23: [Phase 1] Run seed and verify 4 core modules

**Files:** None modified

- [ ] **Step 1: Run seed**

```bash
pnpm db:seed
```

Expected output: success messages for seeding atlas.core, atlas.identity, atlas.files, atlas.branding, and the system.admin role. No errors.

- [ ] **Step 2: Verify modules in Supabase Studio**

Open https://studio.supabase.example.com â†’ Table Editor â†’ `atlas_module` table.

Expected: 4 rows with keys `atlas.core`, `atlas.identity`, `atlas.files`, `atlas.branding`.

---

## Task 24: [Phase 1] Start API and verify endpoints

**Files:** None modified

- [ ] **Step 1: Start the API**

```bash
pnpm dev:api
```

Expected: `Atlas ERP API running on port 4010` (or similar startup message). No errors in the console.

- [ ] **Step 2: Verify GET /health**

In a new terminal:
```bash
curl http://localhost:4010/health
```

Expected response:
```json
{ "status": "ok", "time": "...", "timezone": "America/Mexico_City", "api": "Atlas ERP" }
```

- [ ] **Step 3: Verify GET /modules returns 4 core modules**

```bash
curl http://localhost:4010/modules
```

Expected response: JSON array with 4 objects. Verify the `key` field of each:
- `atlas.core`
- `atlas.identity`
- `atlas.files`
- `atlas.branding`

- [ ] **Step 4: Commit Phase 1 verification to TASKS.md**

Open `docs/TASKS.md`. Mark the Phase 1 checklist items as complete:

```markdown
## Phase 1 â€” Supabase + Prisma connection

- [x] Fill .env with real Supabase credentials
- [x] Run pnpm db:generate â€” Prisma client against Supabase PostgreSQL
- [x] Run pnpm db:migrate â€” apply schema including InstanceConfig migration
- [x] Run pnpm db:seed â€” 4 core modules, admin role, permissions
- [x] Verify GET /health returns 200
- [x] Verify GET /modules returns 4 core modules from live Supabase
```

```bash
git add docs/TASKS.md
git commit -m "chore: mark Phase 1 complete â€” Supabase connection verified"
```

---

## Phase 0+1 complete

At this point:
- Repository has a single coherent architectural view
- All docs reference https://supabase.example.com as the real target
- No local-lite references remain
- Atlas API is connected to live Supabase PostgreSQL
- 4 core modules seeded and serving via API
- `InstanceConfig` table exists and ready for Phase 2

**Next:** Start Phase 2 with `/superpowers:brainstorming` â€” design the `GET /instance/status` endpoint and frontend route guard.


