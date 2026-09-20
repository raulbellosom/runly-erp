# Runly ERP

Renamed from Atlas ERP. Distribution targets GitHub
`raulbellosom/runly-erp` and Docker Hub `raulbellosom/runlyerp`. Workspace
packages use `@runly/*`, with `@atlas/*` aliases kept only for existing custom
modules authored against the old import scope. Installer commands use `runly:*`.
Environment inputs use `RUNLY_*` and `VITE_RUNLY_*` — there is no `ATLAS_*`
fallback. Module keys and Docker service/volume identities are already renamed.
New images and `Runly-ERP-Setup.exe` must be published before existing
installations pick up these changes. See the [migration plan](docs/superpowers/plans/2026-09-13-runly-distribution.md) for the historical record.

Desktop-first, full-stack modular ERP built with React + Vite + Tauri, a Node/Hono API, Prisma, and a dedicated self-hosted Supabase instance.

## Quick start

## Docker installer (external/local Supabase)

Installer files live in `infra/installer/`.

- `external` profile: Runly ERP against an existing Supabase instance.
- `local` profile: Runly ERP + local Supabase (fully automated via `setup-local.mjs`).
- Custom modules mount path: `infra/installer/custom-modules/` on the host -> `/app/modules/custom` inside the container.

Images: `raulbellosom/runlyerp:api-latest`, `worker-latest`, `web-latest` (single web image for both profiles — Supabase URL and API URL are injected at container startup via env vars, not baked into the image).

Quick install on any machine without cloning the repo:

```powershell
# Desde la carpeta donde quieras instalar Runly ERP:
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-local.ps1" -OutFile ".\bootstrap-local.ps1"
powershell -ExecutionPolicy Bypass -File .\bootstrap-local.ps1
```

See [infra/installer/README.md](infra/installer/README.md) for full copy/paste steps (Windows, Linux, macOS), external Supabase setup, optional LiveKit calls, image tags, and reset commands.
The installer also downloads an exported RME3 Dev Kit to `custom-modules/_runly-devkit/`, including `capabilities.runtime.json`, `prompt-starter.txt`, `troubleshooting.md`, and a `golden-path-module/` sample for installer-mode module development.
Existing installations reuse `custom-modules/_atlas-devkit/` when present. Both package scopes resolve to the same implementation; no module rewrite is required for this stage. See the [package migration plan](docs/superpowers/plans/2026-09-13-runly-packages-devkit.md).

Stop and reset (from the installer directory):

```bash
npm.cmd run runly:stop:local  # stop, keep data
node stop-local.mjs --reset   # full wipe — removes containers, volumes, generated files
```

## Contributor setup (cloning the repo)

### Runly environment variables

Configuration uses `RUNLY_*` (and `VITE_RUNLY_*` for Vite) only — there is no
`ATLAS_*` fallback. Update any existing `.env` file to the `RUNLY_*` names before
pulling a new image or starting the app; existing custom settings and Office
secrets survive the rename. See the [environment migration evidence](docs/superpowers/plans/2026-09-13-runly-environment.md)
for the historical record.

### 1. Fill environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in values from the self-hosted Supabase VPS (`/path/to/supabase/docker/.env`):

| .env variable                 | Source in VPS .env |
| ----------------------------- | ------------------ |
| `SUPABASE_ANON_KEY`           | `ANON_KEY`         |
| `SUPABASE_SERVICE_ROLE_KEY`   | `SERVICE_ROLE_KEY` |
| `SUPABASE_JWT_SECRET`         | `JWT_SECRET`       |
| `DATABASE_URL` / `DIRECT_URL` | `POSTGRES_PASSWORD` |

Use direct PostgreSQL access on port `5433`:

```bash
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@<SUPABASE_VPS_IP>:5433/postgres
DIRECT_URL=postgresql://postgres:<POSTGRES_PASSWORD>@<SUPABASE_VPS_IP>:5433/postgres
```

### 2. Install dependencies

```bash
pnpm install
```

If PowerShell blocks `pnpm`, use `pnpm.cmd`.

### 3. Validate database connectivity

Before Prisma commands, verify port `5433` is reachable:

```bash
nc -zv <SUPABASE_VPS_IP> 5433
```

No SSH tunnel is required.

### 4. Set up database (first time only)

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### 5. Start dev servers

```bash
pnpm dev
```

Open `http://localhost:5173` or run `pnpm dev:tauri` for the native window.

When Office is enabled in the root `.env` with a localhost CODE URL, both commands
also start `collabora-dev` in the Docker `runlyerp` group. See the
[development Office configuration](docs/deployment/office-collabora.md#development-with-pnpm-dev-on-docker-desktop).

## Dev commands

### Servers

| Command             | What it does |
| ------------------- | ------------ |
| `pnpm dev`          | API + Vite web preview + worker |
| `pnpm dev:api`      | API only (port 4010) |
| `pnpm dev:frontend` | Vite only (port 5173) |
| `pnpm dev:worker`   | Worker only |
| `pnpm dev:tauri`    | Native Tauri window + servers |

### Database

| Command            | What it does |
| ------------------ | ------------ |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm db:migrate`  | Apply pending migrations |
| `pnpm db:seed`     | Seed module lifecycle metadata, roles, permissions |
| `pnpm db:studio`   | Open Prisma Studio (`http://localhost:5555`) |
| `pnpm db:fresh`    | Migrate + generate + seed (non-destructive) |

### Build

| Command               | What it does |
| --------------------- | ------------ |
| `pnpm --filter @runly/desktop build` | Build desktop app and leave the installer as `Runly-ERP-Setup.exe` |
| `pnpm --filter @runly/desktop publish:release` | Upload `Runly-ERP-Setup.exe` to the GitHub release matching `apps/desktop/src-tauri/tauri.conf.json` |
| `pnpm --filter @runly/desktop release` | Build the installer, create/update the matching GitHub release, and mark it as `latest` |

### Desktop release

- The public download URL is always `https://github.com/raulbellosom/runly-erp/releases/latest/download/Runly-ERP-Setup.exe`
- `pnpm --filter @runly/desktop release` reads the version from `apps/desktop/src-tauri/tauri.conf.json`, uploads `apps/desktop/src-tauri/target/release/bundle/nsis/Runly-ERP-Setup.exe`, and marks that release as `latest`
- If the tag does not exist, the script creates it; if it already exists, the script replaces the asset with `--clobber`
| --------------------- | ------------ |
| `pnpm build`          | Build all apps and packages |
| `pnpm icons:generate` | Regenerate Tauri app icons |
| `pnpm brand:build`    | Regenerate desktop/web branding assets |

### Docker images

| Command              | What it does |
| -------------------- | ------------ |
| `pnpm docker:build`  | Build all 3 images (api-latest, worker-latest, web-latest) |
| `pnpm docker:push`   | Push all 3 images to Docker Hub |
| `pnpm docker:release`| Build + push in one step |

## Ports

Supabase URLs below are examples: replace them with your own configuration.
See [repository privacy rules and checks](docs/REPOSITORY_PRIVACY.md) before sharing changes.

| Service         | URL |
| --------------- | --- |
| API             | http://localhost:4010 |
| Frontend (Vite) | http://localhost:5173 |
| Prisma Studio   | http://localhost:5555 |
| Supabase API    | https://supabase.example.com |
| Supabase Studio | https://studio.supabase.example.com |

## Architecture

```txt
apps/
  desktop/     React + Vite + Tauri 2 (desktop shell)
  api/         Node.js + Hono (business logic + REST API)
  worker/      Background job handler
packages/
  core/           Module registry, event bus, manifest contract
  module-engine/  @runly/module-engine (defineRunlyModule, defineModel, defineView, definePage)
  ui/             Shared React components
  sdk/            Runly API client (createRunlyClient)
  validators/     Zod schemas shared between API and frontend
modules/
  custom/      Community and partner modules
  official/    Optional curated official distributions
prisma/
  schema.prisma   Runly Core stable models + RME3 metadata tables
  seed.js         Seeds module lifecycle metadata, roles, permissions
```

Request flow:
`React -> @runly/sdk -> Hono API -> Zod validation -> Prisma / Runly ORM -> Supabase PostgreSQL`

No direct database access from the frontend.

## Module system

Runly ERP is a module engine. New RME3 modules live in `modules/custom/` and declare their own models, views, pages, navigation, permissions, API endpoints, and React components.

- Core modules (`core: true`, `uninstallable: false`):
  - `runly.core`
  - `runly.identity`
  - `runly.files`
  - `runly.company`
  - `runly.contacts`
  - `runly.hr`
- Custom modules: `custom.*` or `community.*` in `modules/custom/`
- Official manifest snapshots: `apps/api/src/manifests/official/`

New modules use `defineRunlyModule` from `@runly/module-engine`.

Modules can include React components in `components/` compiled at install time by esbuild — no web image rebuild is needed for module-local UI changes. The frontend loads bundles via dynamic `import()` at startup. If you change the shared module runtime in `apps/desktop` (for example importmap/shims/externals) or credentialed cross-origin API behavior in `apps/api`, publish fresh `web` and/or `api` images and recreate the installer containers. See `docs/ai-context/rme3-runtime-capabilities.md` for the full `@runly/ui` component inventory and view kind examples (TABLE, FORM, DETAIL, CUSTOM).

For installer-mode workspaces, the authoritative module-authoring bundle lives in `custom-modules/_runly-devkit/`. Start with:
- `README.md`
- `docs/ai-context/rme3-modules.md`
- `docs/ai-context/rme3-runtime-capabilities.md`
- `capabilities.runtime.json`
- `troubleshooting.md`
- `golden-path-module/`

See:
- `docs/02_module_system.md`
- `docs/03_custom_modules.md`
- `docs/architecture/runly-module-engine-v3.md`
- `docs/ai-context/rme3-runtime-capabilities.md`
- `docs/TASKS.md`

## Notes

Office editing is optional: the `office` installer profile adds Collabora CODE for
DOCX/XLSX/PPTX inside Files and supported attachments. Runly retains Storage,
permissions and recoverable revisions. See [Office deployment and troubleshooting](docs/deployment/office-collabora.md)
for configuration, CODE licensing/support limitations and verification.

- UI text in Spanish.
- Code, docs, and comments in English.
- JavaScript only.
- Tailwind for styles.
- Prisma pinned to `^7` via workspace overrides.
- Supabase Studio is admin-only.
