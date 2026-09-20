# Vendored from supabase/supabase

Source: https://github.com/supabase/supabase (self-hosting reference)
Pinned tag: `v1.26.08` (commit `86854671e95be31e24fa0785cded0579fe692fcb`)
Vendored: 2026-09-20

Files copied verbatim from `docker/`:

- `volumes/api/kong-entrypoint.sh` — unmodified. Renders `kong.yml` from
  `temp.yml` via env-var substitution and builds the `$LUA_AUTH_EXPR` /
  `$LUA_RT_WS_EXPR` values consumed by `volumes/api/kong.yml`.
- `volumes/db/roles.sql`, `volumes/db/jwt.sql`, `volumes/db/realtime.sql`,
  `volumes/db/webhooks.sql` — unmodified Postgres `docker-entrypoint-initdb.d`
  scripts (roles/passwords, JWT GUCs, the `_realtime` schema, and Database
  Webhooks support).

Files adapted (not verbatim — see inline comments in each for the diff):

- `volumes/api/kong.yml` — same routes as upstream, minus: the `DASHBOARD`
  consumer/basic-auth and the catch-all `dashboard`/`/mcp` routes (Studio is
  never reachable through this gateway — see docker-compose.supabase.yml),
  and the `functions-v1` route (Runly does not use Edge Functions). Service
  URLs point at Runly's `supabase-<name>` container names instead of
  upstream's bare `auth`/`rest`/`storage`/`meta` names.
- `docker-compose.supabase.yml` — hand-written for Runly, not a copy of
  upstream's `docker-compose.yml`. Same service set minus `supavisor`
  (pooling isn't needed — every internal Runly service reaches
  `supabase-db:5432` directly on the Compose network), `imgproxy`/
  `ENABLE_IMAGE_TRANSFORMATION` (Runly generates its own image variants),
  and `functions` (no Edge Functions usage). Container names, ports, and
  bind addresses are wired to Runly's per-instance identity
  (`lib/instance-identity.mjs`) and security posture requirements instead
  of upstream's fixed `supabase-*` names and `${KONG_HTTP_PORT}` defaults.

Files intentionally NOT vendored:

- `volumes/db/_supabase.sql`, `volumes/db/pooler.sql`, `volumes/db/logs.sql`
  — only needed by Supavisor and the Logs/Analytics stack, both dropped.
- `docker-compose.s3.yml`, `docker-compose.caddy.yml`,
  `docker-compose.nginx.yml`, `docker-compose.logs.yml`,
  `docker-compose.pg15.yml`, `docker-compose.pg17.yml`, `.env.example`,
  `run.sh`, `setup.sh`, `reset.sh`, `update.sh`, `dev/`, `utils/`, `tests/`
  — upstream's own installer/dev tooling; Runly has its own equivalents in
  `setup-local.mjs`, `stop-local.mjs`, and
  `infra/installer/lib/supabase-selfhosted-config.mjs`.

## Upgrading

To pick up a newer Supabase self-hosting release: re-diff this directory
against the new tag's `docker/` folder (same file list as above), re-apply
the same adaptations, bump the image tags in `docker-compose.supabase.yml`,
and re-run the full local verification in `infra/installer/README.md` before
publishing. Do not blindly overwrite `docker-compose.supabase.yml` — it is
not a verbatim copy and re-diffing loses the Runly-specific changes.
