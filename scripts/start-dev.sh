#!/bin/bash
# Runly ERP — local dev startup
# Opens the SSH tunnel to the VPS Postgres container, then starts all dev servers.
# Runs automatically via: pnpm start

SSH_HOST="${RUNLY_SSH_HOST:-}"
LOCAL_PORT="${RUNLY_DB_LOCAL_PORT:-54322}"
REMOTE_ADDR="${RUNLY_DB_REMOTE_ADDR:-}"
if [ -z "$SSH_HOST" ] || [ -z "$REMOTE_ADDR" ]; then
  echo "Set RUNLY_SSH_HOST and RUNLY_DB_REMOTE_ADDR in your shell before pnpm start. See docs/06_deployment_strategy.md." >&2
  exit 1
fi
TUNNEL_OWNED=0

check_port() {
  (echo "" > /dev/tcp/127.0.0.1/$LOCAL_PORT) 2>/dev/null
}

if check_port; then
  echo "Port $LOCAL_PORT already bound — tunnel already running, skipping."
else
  echo "Opening SSH tunnel: 127.0.0.1:$LOCAL_PORT -> $REMOTE_ADDR ..."
  ssh -f -N \
    -o ServerAliveInterval=60 \
    -o StrictHostKeyChecking=accept-new \
    -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:${LOCAL_PORT}:${REMOTE_ADDR}" \
    "$SSH_HOST"

  sleep 2

  if ! check_port; then
    echo "ERROR: SSH tunnel did not start. Check SSH access to $SSH_HOST." >&2
    exit 1
  fi

  echo "SSH tunnel ready."
  TUNNEL_OWNED=1
fi

cleanup() {
  if [ $TUNNEL_OWNED -eq 1 ]; then
    echo "Closing SSH tunnel..."
    pkill -f "ssh.*-L.*${LOCAL_PORT}:${REMOTE_ADDR}" 2>/dev/null || true
  fi
  echo "Runly ERP dev environment stopped."
}
trap cleanup EXIT INT TERM

echo "Starting dev servers (API + web + worker)..."
pnpm dev
