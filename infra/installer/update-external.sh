#!/usr/bin/env bash
# update-external.sh — one-shot updater for an EXISTING Runly ERP `external` install
# (Linux / macOS / Git Bash). Chains the two steps documented in README.md:
#   1. Refresh the installer's own scripts/compose (bootstrap-external.sh).
#   2. Pull the latest images, run migrations, and recreate containers
#      (setup-external.mjs via `npm run runly:external`).
#
# Safe to re-run: bootstrap-external.sh never touches .env.external once it
# exists, and never touches custom-modules/. Refuses to run on a fresh folder
# (no .env.external yet) — a first install needs real Supabase credentials
# filled in before anything can start; use bootstrap-external.sh directly for that.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ ! -f .env.external ]]; then
  echo "[runly-update] .env.external no existe todavia — esto no es una actualizacion." >&2
  echo "[runly-update] Para una instalacion nueva:" >&2
  echo "  curl -fsSLo bootstrap-external.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.sh" >&2
  echo "  chmod +x bootstrap-external.sh && ./bootstrap-external.sh" >&2
  exit 1
fi

echo "[runly-update] 1/2 Refrescando scripts del instalador..."
curl -fsSLo bootstrap-external.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.sh
bash ./bootstrap-external.sh

echo "[runly-update] 2/2 Actualizando Runly (pull + migrate + recreate)..."
exec npm run runly:external
