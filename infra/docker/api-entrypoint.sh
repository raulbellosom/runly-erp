#!/bin/sh
set -e
echo "[Runly] Applying database migrations..."
pnpm exec prisma migrate deploy
echo "[Runly] Running seed (idempotent)..."
node prisma/seed.js
echo "[Runly] Starting API..."
exec pnpm --filter @runly/api start
