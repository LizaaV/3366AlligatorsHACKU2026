#!/usr/bin/env bash
# Deploy (and redeploy) Constellation to the EC2 server over SSH. Nothing goes through GitHub:
# your local working tree, including uncommitted changes, is copied with rsync and built there.
#
#   SSH_KEY=~/.ssh/constellation.pem ./deploy/aws/ship.sh <server-ip>
#
# - Copies the repo to /opt/constellation (only changed files; node_modules, .venv, dist,
#   .git and local .env files are skipped).
# - Puts deploy/aws/.env.prod there as backend/.env (secrets: ANTHROPIC_API_KEY, EARTH_IMPL ...).
# - Writes deploy/.env with PUBLIC_BASE_URL=http://<ip> unless PUBLIC_BASE_URL is set.
# - Runs `docker compose up -d --build` and waits for /api/health.
# Redeploys only rebuild the layers whose files changed, so they take seconds to a minute.
set -euo pipefail

HOST="${1:?usage: SSH_KEY=~/.ssh/key.pem $0 <server-ip-or-host>}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/constellation.pem}"
REMOTE_DIR="${REMOTE_DIR:-/opt/constellation}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://$HOST}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_PROD="$ROOT/deploy/aws/.env.prod"

[ -f "$ENV_PROD" ] || { echo "Missing $ENV_PROD: cp deploy/aws/env.prod.example deploy/aws/.env.prod and fill it in." >&2; exit 1; }

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
remote() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "$@"; }

echo "==> Waiting for the server (Docker is installed on first boot)"
for _ in $(seq 1 60); do
  remote 'command -v docker >/dev/null && docker compose version >/dev/null 2>&1' 2>/dev/null && break
  sleep 5
done
remote 'docker compose version' >/dev/null || { echo "Docker is not ready on $HOST; check: ssh ... 'sudo cat /var/log/cloud-init-output.log'" >&2; exit 1; }
remote "sudo mkdir -p '$REMOTE_DIR' && sudo chown \$(id -u):\$(id -g) '$REMOTE_DIR'"

echo "==> Copying $ROOT -> $HOST:$REMOTE_DIR"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.venv/' --exclude 'dist/' \
  --exclude '__pycache__/' --exclude '.pytest_cache/' --exclude '.ruff_cache/' --exclude '*.tsbuildinfo' \
  --exclude 'backend/data/' --include '.env.example' --exclude '.env' --exclude '.env.*' \
  "$ROOT/" "$SSH_USER@$HOST:$REMOTE_DIR/"

echo "==> Settings"
scp "${SSH_OPTS[@]}" -q "$ENV_PROD" "$SSH_USER@$HOST:$REMOTE_DIR/backend/.env"
remote "chmod 600 '$REMOTE_DIR/backend/.env' && printf 'PUBLIC_BASE_URL=%s\nHTTP_PORT=%s\nVITE_API_SOURCE=%s\n' \
  '$PUBLIC_BASE_URL' '${HTTP_PORT:-80}' '${VITE_API_SOURCE:-http}' > '$REMOTE_DIR/deploy/.env'"

echo "==> Building and starting (first time: a few minutes)"
remote "cd '$REMOTE_DIR' && docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build --remove-orphans"

echo "==> Health check"
for _ in $(seq 1 40); do
  if remote "curl -fsS http://localhost:${HTTP_PORT:-80}/api/health" 2>/dev/null; then
    echo
    echo "Live: $PUBLIC_BASE_URL"
    exit 0
  fi
  sleep 3
done
echo "Not healthy yet. Logs: ssh ${SSH_OPTS[*]} $SSH_USER@$HOST 'cd $REMOTE_DIR && docker compose -f deploy/docker-compose.yml logs --tail 80 backend'" >&2
exit 1
