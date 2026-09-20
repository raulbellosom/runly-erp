# Runly ERP — Architecture

## Overview

Runly ERP is a desktop-first, full-stack modular ERP. The desktop app is a Tauri + React shell. All business logic lives in a Node.js/Hono API. Data is stored in a dedicated self-hosted Supabase instance.

Runly ERP is a **module engine that ships ERP modules**. The Runly Module Engine v3 (RME3) is the primary module architecture. See [docs/architecture/runly-module-engine-v3.md](architecture/runly-module-engine-v3.md) for the full specification.

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
  ui/          Shared React components
  sdk/         Runly API client (createRunlyClient factory)
  validators/  Zod schemas shared between API and frontend
  module-engine/  @runly/module-engine — defineRunlyModule, defineModel, defineView, definePage
modules/
  custom/      Community and partner modules
prisma/
  schema.prisma   Single source of truth for Runly Core data models only
  seed.js         Seeds core modules, permissions, roles
```

`packages/maps/` was decommissioned and removed. All core module manifests live in `apps/api/src/manifests/official/`.

## Layer responsibilities

**apps/desktop** — UI only. No business logic. No direct database access. Reads auth session from Supabase Auth client (anon key only). All ERP data goes through Runly API via `@runly/sdk`.

**packages/sdk** — Typed client factory `createRunlyClient({ baseUrl })`. Groups calls by domain. Attaches JWT bearer token from Supabase session to every API request.

**apps/api** — Single authority for all ERP business rules and validation. Verifies JWT via Supabase Auth Admin SDK (service role key — never exposed to frontend). Loads UserProfile + Role + Permissions from Prisma on each authenticated request. Architecture: Routes → Services → Prisma / Runly ORM.

**apps/worker** — Background jobs: reports, file processing, scheduled tasks. Connects to Prisma directly. No public endpoints.

**modules/custom/** — Community and partner modules. Self-contained directory with manifest, models, API routes, and optional components. Namespace must be `custom.*` or `community.*`.

**Supabase (external, self-hosted)** — PostgreSQL (Runly tables via Prisma), Auth (sessions, JWTs, user creation), Storage (physical files), Realtime (future).

## Data flows

### ERP data
```
React → @runly/sdk (JWT attached) → Runly API → Service → Prisma / Runly ORM → Supabase PostgreSQL
```

### Authentication
```
React → Supabase Auth client (anon key) → session JWT
Runly API ← JWT in Authorization header
Runly API → verifies via Admin SDK → loads UserProfile + permissions via Prisma
```

### File storage
```
React → Runly API POST /files/upload (JWT) → API → Supabase Storage (service role)
                                                 → FileAsset metadata via Prisma
```

### First-run
```
React → GET /instance/status → { initialized: false }
      → /setup wizard → Runly API creates Auth user, Company, UserProfile, BrandingConfig
                       → writes InstanceConfig.initialized = "true"
      → /login
```

## Supabase / Prisma boundary

**Prisma models Runly Core. Runly Module Engine models ERP modules.**

| Concern | Owner | Rule |
|---|---|---|
| `auth.users` | Supabase Auth | Never in Prisma migrations |
| `storage.objects` | Supabase Storage | Never in Prisma migrations |
| Runly Core tables (`RunlyModule`, `Blueprint`, `Permission`, `Role`, `UserProfile`, etc.) | Prisma | Stable — never accessed from frontend |
| Module-owned business tables (Contact, FinanceAccount, HrEmployee, etc.) | Runly ORM (Phase 3+) | Declared via `defineModel`; transitionally in Prisma during Phase 1–4 |
| Business rules / validation | Runly API | Never in React components |
| Session tokens | Supabase Auth | Never stored in Runly tables |
| File bytes | Supabase Storage | Never on local disk in production |
| File metadata (FileAsset) | Prisma | Never duplicated in Supabase Storage metadata |
| `SUPABASE_SERVICE_ROLE_KEY` | API only | Never in any VITE_ alias or frontend bundle |

## Supabase endpoints

| Purpose | URL |
|---|---|
| API | https://supabase.example.com |
| Studio | https://studio.supabase.example.com |
## Optional Office editing

Collabora CODE is an optional external editor behind a small Office provider
interface. Runly authenticates sessions and hosts WOPI; FileAsset and private
Supabase Storage remain authoritative. Stable WOPI resource IDs enable
collaboration. PostgreSQL leases and atomic revision pointer swaps prevent
concurrent overwrites and retain recovery copies. The shared UI editor uses the
SDK, and unsupported parent scopes are denied until their authorization is
integrated. See [deployment and protocol details](deployment/office-collabora.md)
and the [design specification](superpowers/specs/2026-09-07-collabora-office-design.md).
