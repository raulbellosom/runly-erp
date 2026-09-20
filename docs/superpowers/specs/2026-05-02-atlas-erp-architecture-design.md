# Atlas ERP — Architecture Design Spec
**Date:** 2026-05-02
**Status:** Approved
**Scope:** Full ERP vision + Phase 0+1 implementation plan

---

## Context

Atlas ERP is a desktop-first, full-stack, modular ERP platform. It runs as a Tauri + React desktop application backed by a Node.js/Hono API, Prisma ORM, and a dedicated self-hosted Supabase instance.

This spec was produced after a full codebase audit of the existing starter bundle and captures all architectural decisions made before Phase 0+1 implementation begins.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Local dev stack (docker-compose.local-lite) | **Remove entirely** | All development connects to the dedicated Supabase at https://supabase.example.com |
| First-run detection | **InstanceConfig table** | Explicit, transactional, supports future reset operations |
| Documentation structure | **Replace old docs with numbered set** | Single source of truth, no drift between overlapping doc sets |
| Implementation plan scope | **Phase 0 + Phase 1** | Phase 0 alone is too thin; together they produce a meaningful milestone: running API connected to real Supabase |
| Env var redundancy | **dotenv substitution pattern** | Define once, alias with VITE_ prefix where required by Vite |

---

## System Architecture

### Stack

```
apps/desktop     React 19 + Vite + Tauri 2 (JavaScript, TailwindCSS v4)
apps/api         Node.js + Hono (business logic, validation, permissions)
apps/worker      Node.js (background jobs, reports, file processing)
packages/core    Module registry, event bus, manifest contract, time utilities
packages/maps    Module manifests: core-modules.js + feature-modules.js
packages/ui      Shared React components (AppShell, Button, Card, DataTable, etc.)
packages/sdk     createAtlasClient factory — typed API client
packages/validators  Zod schemas shared between API and frontend

Supabase (external, self-hosted)
  API:    https://supabase.example.com
  Studio: https://studio.supabase.example.com
  PostgreSQL, Auth, Storage, Realtime
```

### Layer Responsibilities

**apps/desktop**
- UI only. No business logic. No direct database access.
- Reads session from Supabase Auth client using anon key only.
- All ERP data goes through Atlas API via `@atlas/sdk`.

**packages/sdk**
- Typed client factory: `createAtlasClient({ baseUrl })`
- Groups calls by domain: `modules`, `blueprints`, `contacts`, `instance`, `auth`
- Attaches JWT bearer token from Supabase session to every API request.

**apps/api**
- Single authority for all ERP business rules and validation.
- Verifies JWT using Supabase Auth Admin SDK (service role key — server only).
- Loads `UserProfile` + `Role` + `Permissions` from Prisma on each authenticated request.
- Architecture: Routes → Services → Prisma (no business logic in route files).
- Uses Supabase Admin SDK only for: Auth user creation, Storage operations.

**apps/worker**
- Background jobs: reports, file processing, scheduled tasks.
- Connects to Prisma directly (no HTTP layer).
- No public endpoints.

**Supabase**
- PostgreSQL: Atlas tables owned by Prisma migrations. Supabase internal schemas (auth, storage, realtime) never touched by Prisma.
- Auth: session tokens, user creation (via Admin SDK from API only, never from frontend).
- Storage: physical file bytes (API proxies uploads/downloads).
- Studio: admin inspection only, never used at application runtime.

---

## Data Flows

### ERP data
```
React
  → createAtlasClient (attaches JWT)
  → Atlas API (verifies JWT, loads profile + permissions)
  → Service
  → Prisma
  → Supabase PostgreSQL
```

### Auth
```
React
  → Supabase Auth client (anon key) → session JWT stored in client
  → Atlas API (JWT in Authorization header)
  → API verifies with Supabase Admin SDK
  → loads UserProfile + Role + Permissions from Prisma
  → returns user context to route handler
```

### Storage
```
React
  → Atlas API POST /files/upload (JWT required)
  → API streams to Supabase Storage (service role key)
  → API saves FileAsset metadata via Prisma
  → returns FileAsset record to client

React
  → Atlas API GET /files/:id (JWT required)
  → API generates signed URL or proxies bytes
```

### First-run / Setup
```
React app starts
  → GET /instance/status → { initialized: false }
  → React redirects to /setup wizard

Wizard completes
  → Atlas API: create Supabase Auth user (Admin SDK)
  → Atlas API: create UserProfile via Prisma
  → Atlas API: create Company via Prisma
  → Atlas API: save branding config (BrandingConfig model added in Phase 3)
  → Atlas API: install core modules
  → Atlas API: write InstanceConfig { "instance.initialized": "true" }
  → React redirects to /login
```

---

## Supabase / Prisma Boundary

| Concern | Owner | Hard rule |
|---|---|---|
| `auth.users` | Supabase Auth | Never in Prisma migrations |
| `storage.objects` | Supabase Storage | Never in Prisma migrations |
| `public.*` Atlas tables | Prisma | Never accessed directly from frontend |
| Business rules / validation | Atlas API | Never in React components |
| Session tokens | Supabase Auth | Never stored in Atlas tables |
| File bytes | Supabase Storage | Never on local disk in production |
| File metadata (`FileAsset`) | Prisma | Never in Supabase Storage metadata |
| `SUPABASE_SERVICE_ROLE_KEY` | API only | Never in any VITE_ alias or frontend bundle |

---

## Environment Variables

### Strategy
Define each value once. Use dotenv `${VAR}` substitution for Vite aliases. Only vars that must reach the React bundle get a `VITE_` alias.

### Full .env.example pattern

```bash
# ─── Supabase (define once) ─────────────────────────────────────────────────
SUPABASE_URL=https://supabase.example.com
SUPABASE_ANON_KEY=                  # public — safe for frontend
SUPABASE_SERVICE_ROLE_KEY=          # SECRET — API only, never expose to frontend

# ─── Prisma / PostgreSQL ─────────────────────────────────────────────────────
# Self-hosted Supabase exposes PostgreSQL directly — get exact URL from Supabase Studio
# Settings → Database → Connection string (URI)
DATABASE_URL=postgresql://postgres:[password]@db.supabase.example.com:5432/postgres
# DIRECT_URL bypasses pgBouncer — required for Prisma migrations
DIRECT_URL=postgresql://postgres:[password]@db.supabase.example.com:5432/postgres

# ─── Atlas API ───────────────────────────────────────────────────────────────
ATLAS_API_PORT=4010
JWT_SECRET=                         # SECRET — change in production
CORS_ORIGIN=http://localhost:5173,tauri://localhost
ATLAS_TIME_ZONE=America/Mexico_City

# ─── Vite aliases (VITE_ prefix required by Vite for frontend access) ────────
# These reference the vars above — do not duplicate values
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
VITE_ATLAS_API_URL=http://localhost:4010
```

**Never add VITE_ aliases for:** `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`

---

## Schema Additions

### New model: InstanceConfig

```prisma
model InstanceConfig {
  id        String   @id @default(uuid(7))
  key       String   @unique
  value     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Purpose:** Key-value store for Atlas ERP instance-level state. Not for per-company config (that lives in `Company`). Not seeded by `seed.js` — written by the setup wizard only.

**Records written by setup wizard:**

| key | value |
|---|---|
| `instance.initialized` | `"true"` |
| `instance.company_id` | company UUID |
| `instance.setup_completed_at` | ISO timestamp |

**All other models remain unchanged.** The existing 14-model schema is correct and complete for the current phase.

---

## Core Module Definitions

Four core modules. All have `core: true`, `uninstallable: false`. None can be disabled.

### atlas.core
**Owns:** Module registry, module installer/uninstaller, navigation shell, dashboard shell, audit logs, system health endpoint, global settings UI, InstanceConfig reads.

Permissions: `core.read`, `core.manage`, `modules.install`, `modules.uninstall`, `modules.disable`, `audit.read`

Depends on: nothing (root module)

### atlas.identity
**Owns:** Supabase Auth bridge, `UserProfile` records, `Company` profile, `Membership` assignments, `Role` definitions, `Permission` definitions, `RolePermission` assignments. Users UI, Roles UI, Permissions UI.

**Does NOT own:** Branding/theming (see atlas.branding). HR employee records (future atlas.hr).

Permissions: `identity.read`, `identity.manage`, `roles.read`, `roles.manage`, `permissions.read`, `permissions.manage`

Depends on: `atlas.core`

### atlas.files
**Owns:** `FileAsset` metadata records, Supabase Storage bucket strategy, upload/download proxy endpoints, file picker UI component exposed to other modules.

Permissions: `files.read`, `files.upload`, `files.delete`, `files.manage`

Depends on: `atlas.core`

### atlas.branding *(new)*
**Owns:** Company logo (references a `FileAsset`), color palette, theme variables, company-customized login screen metadata.

**Why not in atlas.identity:** Identity is about access control. Branding is about appearance. Different permissions, different UIs, different change frequency.

Permissions: `branding.read`, `branding.manage`

Depends on: `atlas.core`, `atlas.files`

---

## Module System Rules

- Every feature is a **module (map)**. Modules are self-describing via manifests.
- Core modules: `core: true`, `uninstallable: false`. Cannot be removed via API.
- Feature modules: `installable: true`, `removable: true`. Never hard-delete data on uninstall — only mark as `UNINSTALLED`.
- Modules declare: `key`, `name`, `version`, `kind`, `dependencies`, `permissions`, `navigation`, `blueprints`, `exposes`, `consumes`
- Module manifests live in `packages/maps/`. Seeded into `AtlasModule` table via `prisma/seed.js`.
- Each module can define its own sidebar, layout type, routes, and dashboard. Not all modules share a single global sidebar.

---

## Documentation Structure

### Files created (new canonical set)

| File | Contents |
|---|---|
| `docs/00_project_status.md` | Current state inventory — what exists, what's stubbed, known gaps |
| `docs/01_erp_architecture.md` | Full system architecture, layer responsibilities, data flows |
| `docs/02_module_system.md` | Manifest contract, core vs. feature, lifecycle, ModuleRegistry |
| `docs/03_core_modules.md` | Canonical core module definitions with full manifests |
| `docs/04_onboarding_setup.md` | InstanceConfig, setup wizard flow, 4 steps, Supabase Auth user creation |
| `docs/05_supabase_prisma_strategy.md` | DATABASE_URL, Prisma ownership, migration strategy, Storage buckets, Auth bridge |
| `docs/06_deployment_strategy.md` | No local-lite, Atlas ERP stack vs. Supabase stack, per-company deployment model |
| `docs/07_auth_permissions_strategy.md` | Supabase Auth for sessions, Atlas RBAC, JWT middleware, user vs. HR employee |
| `docs/08_blueprints.md` | Blueprint kinds, field types, rendering rules, DynamicForm/DynamicTable architecture |
| `docs/09_next_steps.md` | Phase 0+1 scope, success criteria, what comes after |

### Files deleted (content absorbed into numbered docs)

| File | Absorbed into |
|---|---|
| `docs/ARCHITECTURE.md` | `docs/01_erp_architecture.md` |
| `docs/MODULE_SYSTEM.md` | `docs/02_module_system.md` |
| `docs/DOCKER.md` | `docs/06_deployment_strategy.md` |
| `docs/SUPABASE_SELF_HOSTED_SCENARIO.md` | `docs/05_supabase_prisma_strategy.md` + `docs/06_deployment_strategy.md` |
| `docs/CODE_STYLE.md` | Merged into `CLAUDE.md` |

### Files updated (kept, aligned to new direction)

| File | Key changes |
|---|---|
| `README.md` | Supabase-first setup, no local-lite, correct Supabase URLs |
| `CLAUDE.md` | Remove infra:up/down/reset commands, absorb CODE_STYLE.md, update architecture section |
| `.env.example` | Full rewrite with substitution pattern and server/client boundary comments |
| `docs/TASKS.md` | Phase 0 marked complete, Phase 1 as current, Supabase migration as priority |
| `docs/BLUEPRINTS.md` | Minor alignment only |
| `codex/00_MASTER_PROMPT.md` | Real Supabase URLs, no local-lite, updated verified status |
| `packages/maps/src/core-modules.js` | Add atlas.branding manifest |
| `prisma/schema.prisma` | Add InstanceConfig model |

---

## Phase 0+1 Implementation Scope

### Phase 0 — Repository and environment cleanup

**Deliverables:**
- All files in the "deleted" list above are removed
- All files in the "created" list above exist and are complete
- All files in the "updated" list above are aligned to Supabase-first direction
- `packages/maps/src/core-modules.js` includes `atlas.branding`
- `prisma/schema.prisma` includes `InstanceConfig`
- No reference to local-lite, MinIO as primary, or Redis as required anywhere in the repo

**Success criteria:** The repo contains a single coherent view of the architecture. Every documentation file points to `https://supabase.example.com`. `.env.example` is the single source of truth for configuration with no duplicated values.

### Phase 1 — Supabase + Prisma connection

**Steps:**
1. Developer fills `.env` from `.env.example` with real Supabase credentials
2. `pnpm db:generate` — Prisma client regenerates against Supabase PostgreSQL
3. `pnpm db:migrate` — applies schema including new `InstanceConfig` migration
4. `pnpm db:seed` — seeds 4 core modules, admin role, permissions against real Supabase DB
5. `pnpm dev:api` — API starts, `GET /health` responds
6. `GET /modules` returns 4 seeded core modules from Supabase PostgreSQL

**No application logic written in Phase 1.** Infrastructure verification only.

**Success criteria:** `GET /health` returns 200. `GET /modules` returns 4 core modules from live Supabase. Prisma Studio connects to remote DB and shows seeded data. No local Postgres process needed.

### Not included in Phase 0+1 (deferred)

- Setup wizard UI or backend (Phase 2+3)
- `GET /instance/status` endpoint (Phase 2)
- Login screen (Phase 4)
- React Router (Phase 5)
- Any frontend changes beyond env var references
- Worker jobs
- Contacts or Finance module changes

---

## What Comes After Phase 0+1

Each subsequent phase gets its own brainstorm → spec → plan → implement cycle.

| Phase | Deliverable |
|---|---|
| Phase 2 | `InstanceConfig` API endpoint, frontend route guard (setup vs. login) |
| Phase 3 | 4-step setup wizard (admin, company, branding, review) |
| Phase 4 | Supabase Auth login screen, session persistence, JWT middleware in API |
| Phase 5 | React Router, module-specific layouts, module launcher shell |
| Phase 6 | Contacts module: full CRUD, blueprint-driven table and form |
| Phase 7 | Files module: Supabase Storage, upload endpoint, FileAsset metadata, logo |
| Phase 8 | Finance, Purchases, HR, Inventory — one at a time |

---

## Risks and Open Decisions

| Risk | Mitigation |
|---|---|
| Supabase DATABASE_URL format varies by hosting config (pooled vs. direct) | Document both patterns in `.env.example` with comments |
| dotenv `${VAR}` substitution scope | Only Vite reads the `${VAR}`-substituted aliases (VITE_ vars). The API reads primary vars (SUPABASE_URL, DATABASE_URL) which are literal values — no dotenv-expand needed for the API |
| atlas.branding `BrandingConfig` table not yet in schema | Add in Phase 3 when wizard is built; Phase 0+1 only adds the manifest |
| `seed.js` currently runs against whichever DATABASE_URL is set | Document clearly that running seed against production will overwrite module records (upsert is safe) |
| No tests exist | Accept for now; add integration tests starting Phase 4 |
