# Runly ERP - Supabase + Prisma Strategy

## Supabase instance

The URLs below are reserved examples. Configure your own endpoints in `.env`.
The SSH example also requires replacing the user, host and database destination.

| Endpoint | URL |
|---|---|
| API | https://supabase.example.com |
| Studio | https://studio.supabase.example.com |

Dedicated to Runly ERP. Not Supabase Cloud - self-hosted on a VPS.

## What Runly uses from Supabase

| Feature | How Runly uses it |
|---|---|
| PostgreSQL | Primary database for all Runly business models, accessed via Prisma |
| Auth | Session management, JWT tokens, password recovery, admin user creation |
| Storage | Physical file storage (logos, documents, media) |
| Realtime | Future: live dashboard updates, notifications |

## Prisma owns the Runly schema

Prisma manages all tables in the `public` schema. Supabase internal schemas (`auth`, `storage`, `realtime`, `extensions`) are never touched by Prisma migrations.

**Hard rule:** Never write a Prisma migration that references `auth.*`, `storage.*`, or any Supabase-internal schema.
**Hard rule:** Never manually edit SQL in existing migration folders after a migration was applied.
**Hard rule:** Do not rewrite migration history. If a schema fix is needed, create a new forward migration.

## Database connection

PostgreSQL is not exposed publicly. Local development connects through an SSH tunnel.

### Open the SSH tunnel (required before any Prisma command)

```bash
ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10
```

Keep the terminal open. The tunnel maps local port `54322` to PostgreSQL on the VPS.

### Connection strings in .env

```bash
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:54322/postgres
```

## Supabase Storage bucket strategy

| Bucket | Contents | Access pattern |
|---|---|---|
| `runly-files` | Canonical storage for all uploads (branding, module files, avatars, generated ZIPs) | API-proxied signed URL |

Frontend never accesses Supabase Storage directly. Runly API generates signed URLs or proxies bytes.
Legacy bucket cleanup is manual infra (no destructive auto-delete in API boot).

File metadata is stored in the `FileAsset` Prisma model (`bucket`, `objectKey`, `originalName`, `mimeType`, `sizeBytes`, `moduleKey`, `entityType`, `entityId`, `metadata`).

Canonical objectKey policy:
- Branding/logo: `company/branding/<companyId>/...`
- Module uploads: `modules/<moduleKey>/<entityType>/<entityId>/...`
- System ZIP artifacts: `system/bulk-downloads/<companyId>/...`

## Hard rules

- Do not access Supabase tables directly from React (`supabase.from('table').select()`)
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_JWT_SECRET` in frontend or `VITE_` env vars
- Do not call `supabase.auth.signUp()` from frontend for ERP user creation - use Runly API
- Do not bypass Runly API for critical ERP writes
- Do not expose PostgreSQL publicly without explicit security review
