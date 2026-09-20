# Runly ERP — Deployment Strategy

All domains, IPs and paths below are examples. Replace them with your own private
deployment settings; no example endpoint represents an existing Runly service.

## Two independent stacks

**Supabase stack** (self-hosted VPS example):
- https://supabase.example.com — PostgreSQL, Auth, Storage, Realtime
- https://studio.supabase.example.com — Studio (admin use only)
- Not managed by Runly ERP's docker-compose
- Credentials in `.env`, never in version control
- Config source of truth: `/path/to/supabase/docker/.env` on the VPS

**Runly ERP stack** (managed here):
- `apps/api` — Hono REST API
- `apps/worker` — background job processor
- `apps/desktop` — Tauri desktop application
- Connects to Supabase via environment variables

## Database selection

This example uses an external Supabase installation. Configure your own instance
in `.env`; the installer also supports local Supabase. Use a separate development
database. The repository does not supply credentials or a shared production endpoint.

## Development setup (local)

### Prerequisites

- Node.js 22, pnpm 9
- SSH access to the VPS (`deploy@192.0.2.10`)
- Credentials from `/path/to/supabase/docker/.env`

### Steps

```bash
# 1. Copy and fill env
cp .env.example .env
# Fill in all values — see .env.example header for instructions

# 2. Install dependencies
pnpm install

# 3. Open SSH tunnel (keep this terminal open)
ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10
# This maps localhost:54322 → supabase-db container (db.internal.example:5432) on the VPS

# 4. First-time database setup (in a new terminal, tunnel must be open)
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Start dev servers (keep the tunnel open while using this DATABASE_URL)
pnpm dev           # API + Vite web preview + worker
pnpm dev:tauri     # Native Tauri window + all servers (requires Rust)
```

## Ports (development)

| Service | URL |
|---|---|
| API | http://localhost:4010 |
| Frontend (Vite) | http://localhost:5173 |
| Prisma Studio | http://localhost:5555 (requires SSH tunnel) |
| Supabase API | https://supabase.example.com |
| Supabase Studio | https://studio.supabase.example.com |

## SSH tunnel reference

```bash
# Opens local port 54322 → supabase-db container (db.internal.example:5432) on the VPS
ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10
```

When `DATABASE_URL` uses the tunnel, keep it open for migrations, seeds, Studio,
and all API/worker queries. Client generation alone does not need a database connection.

For automatic tunnel startup, export these variables in your shell before `pnpm start`.
The startup scripts read the process environment, not `.env`:

```bash
export RUNLY_SSH_HOST='deploy@192.0.2.10' # replace with your SSH user/host
export RUNLY_DB_REMOTE_ADDR='db.internal.example:5432' # target reachable from SSH host
export RUNLY_DB_LOCAL_PORT=54322
pnpm start
```

PowerShell:

```powershell
$env:RUNLY_SSH_HOST = 'deploy@192.0.2.10'
$env:RUNLY_DB_REMOTE_ADDR = 'db.internal.example:5432'
$env:RUNLY_DB_LOCAL_PORT = '54322'
./scripts/start-dev.ps1
```

Resolve the database target from your deployment configuration. A container name
works only if the SSH host can resolve it; do not assume a fixed container IP.
Without these variables the scripts exit before attempting any connection.

## docker-compose.yml

Runs Runly ERP application services only. Does not start any database — all services connect to Supabase via env vars.

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

## DNS & subdomains

Production installs need several DNS subdomains (main app, Supabase API/Studio,
LiveKit RTC when Calls is enabled, Collabora Office when enabled). See
[docs/deployment/dns-subdomains.md](deployment/dns-subdomains.md) for the full
checklist, required ports, and which env var each domain feeds.

## Multi-tenant model

Runly ERP is a true multi-tenant application: one API/database/instance can securely serve multiple companies at once. `Company` is the tenant root and `Membership` is the join to `UserProfile`; the active company for a request is resolved server-side (never trusted from the client) via the `X-Runly-Company-Id` header, validated against the caller's memberships by `resolveTenantContext` (`apps/api/src/index.js`). Effective permissions are a pure function of `(User, ActiveCompany)` — a user who is admin in one company and a viewer (or non-member) in another never gets admin rights when the other company is active. See `docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md` for the full design and `apps/api/src/__tests__/cross-tenant/` for the opt-in live cross-tenant security suite (`RUN_CROSS_TENANT_TESTS=1`) that verifies this end-to-end.

Two supported deployment shapes, chosen per client, not per code path:
- **Shared instance, multiple companies** — one Runly ERP deployment (API + worker + desktop) and one Supabase stack serve several companies, isolated at the data layer via `Company`/`Membership` + `resolveTenantContext`. This is the default and requires no extra setup.
- **Dedicated instance per company** — a client who wants full infrastructure isolation (separate VPS, separate Supabase stack, separate `.env`/`DATABASE_URL`) can still get one; the application code is the same either way, this only changes how many `Company` rows exist in that deployment's database (typically one).
