# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup
cp .env.example .env
# Fill in SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DIRECT_URL, JWT_SECRET
# GROQ_API_KEY is optional (runly.pfm receipt OCR + the runly.pfm assistant sidebar + the runly.chat MirAI assistant); without it receipt OCR degrades to manual entry, the PFM assistant sidebar is disabled, and MirAI is disabled (its conversation still lists; the composer shows "no configurado"). With the key, MirAI also answers general-knowledge questions; a short per-turn classifier picks chat/general/live. Live/internet questions ("cuánto está el dólar hoy") need TAVILY_API_KEY (Tavily free tier) — MirAI searches Tavily then phrases the answer; without it the live route says it can't reach the internet. CHAT_MIRAI_WEB=false disables live entirely. PFM_ASSISTANT_MODEL / CHAT_MIRAI_MODEL / CHAT_MIRAI_ROUTER_MODEL / CHAT_MIRAI_WEB_MODEL (Groq compound fallback, paid plan) optionally override the models.
# Get connection strings from https://studio.supabase.racoondevs.com

pnpm install          # install all dependencies
pnpm db:generate      # generate Prisma client
pnpm db:migrate       # apply migrations to Supabase PostgreSQL
pnpm db:seed          # seed core modules, permissions, roles

# Start dev servers (API + Vite web preview + worker)
pnpm dev              # recommended for daily dev - web at http://localhost:5173
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
pnpm db:reset         # migrate reset --force + seed (destructive - wipes data)

# Build and lint
pnpm build            # build all packages/apps
pnpm lint             # ESLint (root eslint.config.js): guardrail rule banning local-date-from-toISOString(); use @runly/core toLocalIso/toLocalMonth. `pnpm lint:packages` runs the per-package stubs.

# Tests (Node.js built-in test runner — no Vitest/Jest)
node --test packages/module-engine/src/__tests__/          # module-engine unit tests
node --test apps/api/src/services/__tests__/               # API service tests
node --test <path/to/file.test.js>                         # single test file
node --check <path/to/file.js>                             # syntax/static check only
```

There is no `pnpm infra:up` or local database stack. All development connects to the self-hosted Supabase instance. Postgres is available directly on port `5433` of the Supabase VPS (port `5432` is the Supavisor pooler — not suitable for Prisma). Your IP must be allowlisted in the Supabase VPS firewall.

### Desktop native build (Windows only)

```bash
cd apps/desktop
pnpm tauri build   # Produces .exe via Rust/Tauri toolchain
pnpm tauri dev     # Native window with hot-reload
```

Tauri requires Rust toolchain + Windows SDK. For development without Tauri, use `pnpm dev:frontend` (Vite web preview only).

`runly.ledger` desktop offline mode is Tier 2.5: in Tauri builds the account list, account detail, transaction history, and summary charts read from the local SQLite cache when the app is offline; writes, groups/access management, import, and export remain online-only.

## Architecture

### Monorepo structure

```
apps/
  desktop/     React + Vite + Tauri 2 (desktop shell)
  api/         Node.js + Hono (business logic + API)
  worker/      Node.js background job handler (stub)
packages/
  core/           Module registry, event bus, manifest contract
  module-engine/  @runly/module-engine — RME3 primitives: defineRunlyModule, defineModel, defineView, definePage
  ui/             Shared React components (AppShell, Button, RunlyTable, RunlyForm, etc.)
  sdk/            Runly API client (createRunlyClient factory)
  validators/     Zod schemas shared between API and frontend
modules/
  custom/      Custom RME3 modules (e.g. custom.fleet) — self-contained, no core edits needed
  official/    Reserved for optional curated official distributions
prisma/
  schema.prisma   Single source of truth for Prisma-managed models (core + legacy feature models)
  seed.js         Seeds core modules, blueprints, permissions
```

### Request flow

```
React (apps/desktop)
  -> @runly/sdk createRunlyClient   (packages/sdk)
  -> Hono API (apps/api/src/index.js)
  -> Zod validation (@runly/validators)
  -> Prisma -> Supabase PostgreSQL
```

No direct database access from the frontend. The API is the authority for all business rules, validation, and permissions.

### Supabase infrastructure

All development uses the dedicated self-hosted Supabase instance:

- API: https://supabase.racoondevs.com
- Studio: https://studio.supabase.racoondevs.com (admin use only)

### Module system (packages/core + RME3 manifests)

Every ERP feature is a **module**. Official manifest snapshots are maintained in `apps/api/src/manifests/official/`, and RME3 modules are declared under `modules/custom/`.

A manifest defines: `key`, `name`, `version`, `kind`, `core`, `uninstallable`, `dependencies`, `permissions`, `navigation`, `blueprints`, `exposes`, `consumes`.

Two categories:

- **Core modules**: `core: true`, `uninstallable: false` - runly.core, runly.identity, runly.files, runly.company, runly.contacts, runly.hr. Cannot be removed via API.
- **Feature modules**: installable, versioned, can depend on other modules.

The `ModuleRegistry` class (`packages/core/src/module-registry.js`) handles registration, dependency validation, navigation resolution, and blueprint flattening. The API seeds these into `RunlyModule` rows via `prisma/seed.js`.

### RME3 custom module creation

Full reference: `docs/ai-context/rme3-modules.md` — read it before creating or modifying any module.

Critical rules (violating any of these corrupts the project):
- **Never edit `prisma/schema.prisma`** for RME3 module tables — Runly ORM manages them via `defineModel` + `POST /modules/sync`
- **Never use `prisma.<model>` accessors** for RME3 tables — use `prisma.$queryRaw` tagged template literals
- **All service functions must be declared inside `createXxxService({ prisma })`** — functions at module scope cannot access `prisma` and throw `ReferenceError` at runtime
- **Never generate UUIDs in JavaScript** — the DB column has `DEFAULT uuidv7()`, use `INSERT ... RETURNING *`

### Blueprint system

Blueprints are declarative JSON schemas describing UI and entity metadata. They live in module manifests under `blueprints`, are stored in the `Blueprint` table, and are served via `GET /blueprints`.

Blueprint kinds: `ENTITY`, `FORM`, `TABLE`, `DASHBOARD`, `ACTION`, `RELATION`, `PERMISSION`.

See `docs/08_blueprints.md` for field type reference and rendering rules.

### API structure (apps/api/src/)

```
apps/api/src/
  index.js                  entry point — bootstraps Hono, loads services, registers middleware
  routes/
    modules.js              12-endpoint module lifecycle router (install/enable/disable/uninstall/reset/sync...)
    ledger.js               runly.ledger routes
  services/
    route-loader-service.js RME3 Route Loader — dynamically mounts api/index.js from modules/custom/* at boot
    module-lifecycle-service.js
    finance-service.js, finance-documents-service.js, finance-posting-service.js, ...
    hr-service.js, contacts-service.js, files-service.js, company-service.js, ledger-service.js, ...
  permission-catalog.js     granular RBAC permission definitions
```

Route Loader behavior: on API boot, `route-loader-service.js` reads all `INSTALLED` + `enabled` modules from DB, looks for `modules/custom/<moduleKey>/api/index.js`, imports it as a Hono router factory, and delegates matching requests at runtime. No `index.js` edits needed when adding a new RME3 module.

Key endpoints:

- `GET /health` - liveness check
- `GET|POST /modules`, `POST /modules/:key/install|disable|enable|uninstall|reset|sync` - module lifecycle
- `GET /blueprints` - all enabled blueprints with module metadata
- `GET|POST|PUT|PATCH /contacts...` - contacts CRUD + picker
- `POST|GET|PATCH /files...` - files upload/list/detail/signed-url/rename/bulk-download/lifecycle
- `GET|POST|PATCH /finance/...` - accounts, entries, documents (AR/AP), applications, tax-rates, FX rates

### Shared validators (packages/validators)

Zod schemas are shared between API and frontend. Add new schemas here when creating new module contracts.

### SDK (packages/sdk)

`createRunlyClient({ baseUrl })` returns a client grouped by domain (`modules`, `blueprints`, `identity`, `contacts`, `files`, etc.). The desktop app instantiates this using `VITE_RUNLY_API_URL`.

### UI components (packages/ui)

`AppShell` is the main layout: fixed sidebar + scrollable main content. Navigation items come from module manifests resolved at runtime. Import from `@runly/ui`.

Tailwind scans both `src/**` and `../../packages/ui/src/**` (configured in `apps/desktop/tailwind.config.js`).

#### UI-first policy — mandatory

Before writing any UI element, check `@runly/ui` first. This is non-negotiable.

**Never use native HTML form elements or native browser dialogs when a `@runly/ui` equivalent exists:**

| Instead of | Use |
|---|---|
| `<select>` | `SelectField` or `CreatableComboboxField` |
| `<input type="text">` | `TextField` or `Input` |
| `<textarea>` | `TextareaField` or `Textarea` |
| `<input type="checkbox">` | `CheckboxField` or `Checkbox` |
| `<input type="date">` | `DateField` or `DatePickerField` |
| hand-rolled table | `RunlyTable` / `DataTable` |
| hand-rolled modal | `Dialog` or `Sheet` |
| hand-rolled dropdown | `DropdownMenu` |
| `window.confirm()` / `window.alert()` / `window.prompt()` | `ConfirmDialog` (destructive actions) or `Dialog` |

**Native browser dialogs (`window.confirm`, `window.alert`, `window.prompt`) are strictly forbidden.** They break the design system, cannot be styled, and are not part of the Runly UX. Always use `ConfirmDialog` from `@runly/ui` for any destructive confirmation. Manage open state with `useState`.

**Key components to know:**

- `CreatableComboboxField` — searchable combobox with inline "+ Crear «X»" option; use whenever a select needs to allow new entries. `placeholder="Buscar o crear..."` is the canonical UX.
- `ComboboxField` — same as above without the create option; use for read-only option sets.
- `SelectField` — plain controlled select (no search). Use only for short, fixed lists.
- `RunlyTable` / `RunlyCrudView` / `RunlyForm` / `RunlyDetail` — blueprint-driven renderers; use for all standard module CRUD screens.
- `PageHeader` — every screen must start with `PageHeader`.
- `EmptyState` / `ErrorState` — standard empty/error placeholders; never render plain text instead.
- `ConfirmDialog` — for all destructive action confirmations.
- `AttachmentsPanel` / `FileUploader` — for all file attachment UX within a module; never require the user to navigate to runly.files.

**Adding a new reusable component:**

1. Create it in `packages/ui/src/components/<ComponentName>.jsx`.
2. Export it from `packages/ui/src/index.js`.
3. Document it in `docs/ai-context/rme3-runtime-capabilities.md` under the correct table.

Never hardcode a one-off component inside a module screen when the same pattern could apply to other modules. Extract it to `@runly/ui` instead.

### Prisma schema highlights

- `RunlyModule` - installed modules (status: INSTALLED/DISABLED/UNINSTALLED/ERROR)
- `Blueprint` - stored blueprint JSON per module
- `InstanceConfig` - key-value store for instance-level state
- `Permission` + `Role` + `RolePermission` - RBAC
- `Company` + `UserProfile` + `Membership` - multi-tenancy foundation
- `AuditLog` - entity-level audit trail
- `FileAsset` - file metadata only (actual files in Supabase Storage)
- `Contact` - contacts entity
- `FinanceAccount` + `FinanceTransaction` - initial finance models (to be evolved in Phase 8)

## Language and conventions

- **JavaScript only** - no TypeScript in this repo yet
- **No emojis** in UI or documentation
- **Current release edition**: **"Jaguar"** (previously "Meridian"). This is a marketing/edition name, separate from the semver in `package.json`. Single source of truth: `RUNLY_EDITION_NAME` in `apps/desktop/src/lib/appConfig.js` — import and reuse it, never re-hardcode the string, wherever an edition/version label appears in the UI (setup wizard hero badge + footer, login footer, an eventual "About" screen, etc.). When the edition changes again, update only that constant.
- **All UI text in Spanish** - code, docs, and comments in English
- **Tailwind** for all styles - no CSS modules or styled-components
- **React Hook Form + Zod** for forms
- **TanStack Query** for server state; Zustand for client-only UI state when needed
- **Hono** for API routes - keep route files thin, push logic to services
- Business logic stays in `apps/api`, not in React components
- **Global ID policy**: UUID v7 only. New or modified entity identifiers must use UUID v7 semantics; `cuid` is deprecated and must not be reintroduced in source code.
- **Atomic file size limit** — No source file may exceed **1000 lines**. Hard ceiling is **1500 lines** (treat as a build-blocking violation). Files approaching 800 lines should be proactively split. Strategies: extract sub-components, split routes by domain, separate sheets/dialogs from list screens, move helpers into `lib/` or `utils/`. Known violators that must be decomposed: `FinanceScreen.jsx` (4462), `apps/api/src/index.js` (3583), `FormFields.jsx` (2153), `HrEmployeeDetail.jsx` (1704), `finance-documents-service.js` (1118), `finance-service.js` (1076), `ModuleCatalog.jsx` (1033), `apps/api/src/routes/chat/index.js` (1235, apps/api/src/routes/chat/ — over the 1000-line limit; `moderation-routes.js` + `template-routes.js` were already extracted and it grew back. The next change to this file should extract another cohesive route block, e.g. the channels/roles routes into a sibling `channel-routes.js`, rather than adding more lines to it directly). `chat-service.js` (1248, apps/api/src/routes/chat/ — over the 1000-line soft limit, under the 1500 hard ceiling as of 2026-09-09 after `chat-conversations-write-service.js` was split out. `sendMessage` (~384 lines) is the next extraction candidate but is deeply coupled to mentions/entityRefs/notifications/broadcaster — do it as a dedicated pass). `MessageComposer.jsx` (1105, apps/desktop/src/modules/runly.chat/components/ — over 1000; extract `AttachmentPreviewCard` + the voice-recording block into siblings before adding more lines).
- Soft-delete pattern: use `enabled: false` instead of hard-deleting records
- Every **new RME3 module** lives in `modules/custom/<moduleKey>/` — requires only `module.manifest.js`, `models/`, `views/`, `api/index.js`, `validators/index.js`. Optional: `components/index.js` for React components compiled at install time (no web image rebuild needed). No edits to `prisma/schema.prisma`, `apps/api/src/index.js`, or `packages/validators/`. See `docs/03_custom_modules.md` and `docs/ai-context/rme3-runtime-capabilities.md` for the `@runly/ui` component inventory and CUSTOM kind view examples.
- Official manifest snapshots are maintained in `apps/api/src/manifests/official/` and represent the internal baseline modules.
- In docs checklists, mark `[x]` only with explicit verification evidence and `Verified: YYYY-MM-DD (...)`
- Prisma is at `^7` - root `package.json` overrides all workspace packages to `^7.8.0`
- Applied Prisma migrations are immutable: never edit existing `prisma/migrations/**/migration.sql`
- Never "fix" migration history by rewriting old SQL; always create a new forward migration
- RME3 module tables are managed by Runly ORM (`RunlyModel`/`RunlyField` in Prisma + `defineModel` in module). Do not create Prisma models for RME3 module tables.

## Architecture documentation

Before adding a new feature, read:

- `docs/01_erp_architecture.md` - full system architecture
- `docs/02_module_system.md` - module system (RME3-first)
- `docs/03_core_modules.md` - core module definitions
- `docs/03_custom_modules.md` - how to build an RME3 custom module (13-step workflow)
- `docs/08_blueprints.md` - blueprint field types and rendering rules
- `docs/architecture/runly-module-engine-v3.md` - RME3 full architecture, roadmap, and required spec sections
- `docs/TASKS.md` - current phase status and roadmap
- `docs/ai-context/ui-screen-audit-checklist.md` - 14-aspect UI checklist for all module screens; run before marking any screen complete

## Spec-Driven Development

All new features and modules follow the spec -> plan -> implementation -> verification workflow. Implementation must not begin without an approved spec in `docs/superpowers/specs/` and an approved plan in `docs/superpowers/plans/`. See `docs/spec-driven-development.md` for the full methodology, required spec sections, module checklist, and agent mode rules.

## Development phases (current state)

See `docs/TASKS.md` for the full phased roadmap.

- Phase 0–7.1.1: complete (repo setup, auth, shell, contacts, files)
- Phase 8 (Finance): complete — double-entry accounting, AR/AP, FX, taxes, aging, applications, reversal (phases 8.1–8.6)
- Phase 9 (HR): complete — dedicated routes, detail workflow, files dossier, and audit timeline
- Phase 9.5 (Module Lifecycle v2): complete — Permission.active, dry-run uninstall/reset, cleanup registry
- RME3 Phase 1 (Module Engine foundation): complete — `packages/module-engine` with `defineRunlyModule`, `defineModel`, `defineView`, `definePage`, SQL generator, checksum
- RME3 Phase 2 (Route Loader + custom module): complete — `route-loader-service.js`, `custom.fleet` module operational
- RME3 Phase 3 (Runly ORM + Blueprint Renderer): complete — Runly ORM provisions tables from `defineModel`; blueprint renderer (`RunlyTable`, `RunlyForm`, `RunlyDetail`, `RunlyCrudView`) in `@runly/ui`
- RME3 Phase 4 (Discovery as primary source + route/component lifecycle sync): complete
- RME3 Phase 5 (official module relocation): retired by architecture decision (2026-05-25)
- RME3 Phase 6 (generic CRUD renderer baseline) and Phase 7 (maps decommission) are complete; follow-on refinements are tracked in `docs/TASKS.md`

## Local command permissions and secret safety

When working in this repository, prefer executing required local verification commands directly instead of asking for permission for every safe command.

Safe commands include:

- git status, git diff, git add, git commit, git push
- pnpm, pnpm.cmd, npm, npx
- node scripts used for local verification
- build, lint, test, node --check
- local curl requests against localhost
- process inspection and restart commands for local dev servers

Never print secrets, access tokens, service role keys, JWTs, database URLs, or .env contents in the chat.

Never include raw Authorization bearer tokens in the response.

When a token is required for a curl command:

- use an environment variable placeholder
- or ask the user to run the command locally
- or use the already configured app/session flow

Do not create scripts that log full environment variables.

Temporary scripts are allowed for local diagnostics, but they must:

- avoid printing secrets
- be deleted after use
- not be committed unless explicitly requested

Never modify or delete production data unless the user explicitly asks for it and the action is documented.

Never paste real tokens into curl examples. Use placeholders like $RUNLY_TOKEN or <TOKEN>. Never echo .env values. Never print DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, access tokens, refresh tokens, or cookies.
