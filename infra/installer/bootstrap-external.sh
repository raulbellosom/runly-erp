#!/usr/bin/env bash
set -euo pipefail

base_url="https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer"
# Refresh the file list itself before downloading the installer. Existing VPS
# copies otherwise keep downloading an obsolete list forever.
if [[ "${RUNLY_BOOTSTRAP_REFRESHED-${ATLAS_BOOTSTRAP_REFRESHED:-}}" != "external" ]]; then
  bootstrap_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  bootstrap_download="$(mktemp "${bootstrap_path}.XXXXXX")"
  trap 'rm -f "$bootstrap_download"' EXIT
  curl -fsSLo "$bootstrap_download" "$base_url/bootstrap-external.sh"
  bash -n "$bootstrap_download"
  if ! cmp -s "$bootstrap_path" "$bootstrap_download"; then
    chmod +x "$bootstrap_download"
    mv -f "$bootstrap_download" "$bootstrap_path"
    trap - EXIT
    echo "[runly-bootstrap] Bootstrap actualizado; continuando con la lista vigente."
    exec env RUNLY_BOOTSTRAP_REFRESHED=external ATLAS_BOOTSTRAP_REFRESHED=external bash "$bootstrap_path" "$@"
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
  lib/instance-identity.mjs
  package.json
  setup-external.mjs
  setup-external.sh
  stop-external.mjs
  stop-external.sh
  update-external.sh
  .env.external.example
)

echo "[runly-bootstrap] Descargando instalador external en $(pwd)"

for file in "${files[@]}"; do
  mkdir -p "$(dirname "$file")"
  curl -fsSLo "$file" "$base_url/$file"
done

mkdir -p custom-modules
mkdir -p -m 700 .secrets/firebase

if [[ ! -f .env.external ]]; then
  cp .env.external.example .env.external
fi

echo "[runly-bootstrap] Archivos listos."
echo "[runly-bootstrap] Siguiente paso: edita .env.external y luego ejecuta npm run runly:external"
