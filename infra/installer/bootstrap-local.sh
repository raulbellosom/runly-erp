#!/usr/bin/env bash
set -euo pipefail

# The files array below is parsed literally (whitespace-split) by
# bootstrap-refresh.test.js, so no comments or blank lines inside it —
# put explanatory notes here, above the array, instead.
#
# docker-compose.supabase.yml's own volume mounts (kong.yml,
# kong-entrypoint.sh, the *.sql init scripts) must be listed alongside it —
# without them, an update keeps whatever stale copies already happen to be
# on disk regardless of what changed in the repo. Missed once already: this
# exact gap is why the 2026-09-22 S3_PROTOCOL_ACCESS_KEY_ID/SECRET fix to
# docker-compose.supabase.yml never reached a real VPS via update-local.sh.
base_url="https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer"
if [[ "${RUNLY_BOOTSTRAP_REFRESHED-${ATLAS_BOOTSTRAP_REFRESHED:-}}" != "local" ]]; then
  bootstrap_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  bootstrap_download="$(mktemp "${bootstrap_path}.XXXXXX")"
  trap 'rm -f "$bootstrap_download"' EXIT
  curl -fsSLo "$bootstrap_download" "$base_url/bootstrap-local.sh"
  bash -n "$bootstrap_download"
  if ! cmp -s "$bootstrap_path" "$bootstrap_download"; then
    chmod +x "$bootstrap_download"
    mv -f "$bootstrap_download" "$bootstrap_path"
    trap - EXIT
    echo "[runly-bootstrap] Bootstrap actualizado; continuando con la lista vigente."
    exec env RUNLY_BOOTSTRAP_REFRESHED=local ATLAS_BOOTSTRAP_REFRESHED=local bash "$bootstrap_path" "$@"
  fi
  rm -f "$bootstrap_download"
  trap - EXIT
fi
files=(
  docker-compose.yml
  docker-compose.linux.yml
  lib/devkit-installer.mjs
  lib/env-compat.mjs
  lib/office-config.mjs
  lib/firebase-config.mjs
  lib/livekit-config.mjs
  lib/transcriber-db.mjs
  lib/instance-identity.mjs
  lib/supabase-selfhosted-config.mjs
  package.json
  setup-local.mjs
  setup-local.ps1
  setup-local.sh
  stop-local.mjs
  stop-local.ps1
  stop-local.sh
  update-local.sh
  supabase/docker-compose.supabase.yml
  supabase/volumes/api/kong.yml
  supabase/volumes/api/kong-entrypoint.sh
  supabase/volumes/db/realtime.sql
  supabase/volumes/db/webhooks.sql
  supabase/volumes/db/roles.sql
  supabase/volumes/db/jwt.sql
)

echo "[runly-bootstrap] Descargando instalador local en $(pwd)"

for file in "${files[@]}"; do
  mkdir -p "$(dirname "$file")"
  curl -fsSLo "$file" "$base_url/$file"
  # curl never preserves or sets the executable bit — every .sh entry point
  # downloaded fresh here would otherwise need a manual `chmod +x` before it
  # could be run as `./file.sh` (running it as `sh file.sh` sidesteps this,
  # but then hits dash's lack of `set -o pipefail`/parameter-expansion
  # support instead — see the 2026-09-22 recording-fix session).
  [[ "$file" == *.sh ]] && chmod +x "$file"
done

mkdir -p custom-modules
mkdir -p -m 700 .secrets/firebase

echo "[runly-bootstrap] Archivos listos."
if [[ "${1:-}" == "--skip-run" ]]; then
  echo "[runly-bootstrap] Ejecucion omitida. Usa: npm run runly:local"
  exit 0
fi

echo "[runly-bootstrap] Iniciando instalacion local..."
exec npm run runly:local
