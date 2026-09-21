#!/usr/bin/env bash
# update-local.sh — one-shot updater for an EXISTING Runly ERP `local` install
# (Linux / macOS / Git Bash). bootstrap-local.sh already refreshes the
# installer's own scripts/compose AND runs `npm run runly:local`
# (pull + migrate + recreate) unless --skip-run is passed — this is a thin,
# discoverable alias for that existing behavior, matching update-external.sh.
#
# Safe to re-run: bootstrap-local.sh never touches .env.local, and never
# touches custom-modules/.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "[runly-update] Refrescando el instalador y actualizando Runly (pull + migrate + recreate)..."
curl -fsSLo bootstrap-local.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-local.sh
exec bash ./bootstrap-local.sh
