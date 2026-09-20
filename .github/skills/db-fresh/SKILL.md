---
name: db-fresh
description: "Run the full Runly ERP database setup: SSH tunnel check, migrate, generate Prisma client, and seed. Use when setting up a fresh environment or after schema changes."
argument-hint: "Optional: specific step to run (migrate | generate | seed)"
---

# db-fresh — Runly ERP Database Setup

All endpoints and paths are examples. Read docs/REPOSITORY_PRIVACY.md and use your private environment configuration; never connect to example addresses.

Runs the full database setup sequence for Runly ERP against the self-hosted Supabase PostgreSQL instance.

## When to Use

- First-time project setup
- After pulling schema changes from another dev
- After editing `prisma/schema.prisma`
- After wiping/resetting the database

## Prerequisites

PostgreSQL is not publicly exposed. All Prisma commands **require** an SSH tunnel to be open:

```bash
ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10
```

Keep this terminal open for the duration of the workflow.

## Procedure

### 1. Verify the SSH tunnel is active

Test that port 54322 is reachable:

```powershell
# Windows (PowerShell)
Test-NetConnection -ComputerName 127.0.0.1 -Port 54322
```

If `TcpTestSucceeded: False`, open the tunnel first — do not proceed.

### 2. Stop dev servers (Windows — prevents Prisma DLL lock)

```powershell
# Stop any running API/dev process holding query_engine-windows.dll.node
# In VS Code: stop the dev terminal, or kill node processes
```

If `db:generate` fails with `EPERM` renaming `query_engine-windows.dll.node`, a dev server is holding the Prisma DLL. Stop it and retry.

### 3. Run the sequence

```powershell
pnpm.cmd db:migrate   # applies pending migrations (prisma migrate dev)
pnpm.cmd db:generate  # regenerates Prisma client
pnpm.cmd db:seed      # seeds core modules, admin role, permissions
```

Or run all three in one command:

```powershell
pnpm.cmd db:fresh     # migrate deploy + generate + seed
```

> Note: `db:fresh` uses `prisma migrate deploy` (non-interactive, safe for CI). Use `db:migrate` (`prisma migrate dev`) during active schema development — it prompts for migration names.

### 4. Verify

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4010/health
Invoke-WebRequest -UseBasicParsing http://localhost:4010/modules
```

`/modules` should return 4 core modules: `runly.core`, `runly.identity`, `runly.files`, `runly.company`.

## Connection Details

| Setting           | Value                                  |
| ----------------- | -------------------------------------- |
| Host (via tunnel) | `127.0.0.1:54322`                      |
| VPS               | `deploy@192.0.2.10`                   |
| Container         | `db.internal.example:5432`                      |
| Supabase Studio   | https://studio.supabase.example.com |

`DATABASE_URL` and `DIRECT_URL` in `.env` must point to `127.0.0.1:54322`.
