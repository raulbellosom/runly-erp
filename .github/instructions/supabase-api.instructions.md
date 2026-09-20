---
description: "Use when writing or reviewing code in apps/api — Supabase Auth admin, Storage uploads, RLS patterns, and safe user creation with rollback."
applyTo: "apps/api/**"
---

# Supabase API Patterns — Runly ERP

All endpoints and paths are examples. Read docs/REPOSITORY_PRIVACY.md and use your private environment configuration; never connect to example addresses.

Self-hosted Supabase at https://supabase.example.com. Not Supabase Cloud.

## Client

The `supabaseAdmin` client (service role) is the only Supabase client in `apps/api/src/index.js`.
Never create a `supabase-js` client in frontend code for data operations — all access goes through the Hono API.

```js
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // never expose via VITE_ prefix
);
```

## Auth Admin

Create users with `email_confirm: true` (self-hosted requires explicit confirmation bypass):

```js
const { data, error } = await supabaseAdmin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
```

**Always roll back** the Supabase auth user if a downstream Prisma transaction fails:

```js
try {
  await prisma.$transaction(async (tx) => {
    /* ... */
  });
} catch (err) {
  await supabaseAdmin.auth.admin.deleteUser(authUserId);
  throw err;
}
```

## Storage Uploads

Buckets: `runly-website` (logos, branding), `runly-files` (general).
Buckets are created idempotently at API startup via `ensureBuckets()`.

Upload pattern — validate size before uploading, use `upsert: true`:

```js
if (file.size > 2 * 1024 * 1024)
  return c.json({ error: "File must be under 2 MB" }, 400);
const { error } = await supabaseAdmin.storage
  .from("runly-website")
  .upload(objectKey, arrayBuffer, { contentType: file.type, upsert: true });
```

Always record upload metadata in a `FileAsset` Prisma row after a successful upload.

## Secrets

Never add to `VITE_` prefix: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `DATABASE_URL`.
Frontend receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
