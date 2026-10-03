#!/usr/bin/env sh
# Local dev for SANDBOX_IMPL=docker (Docker Desktop). Run from backend/: sh sandbox/dev-up.sh
# 1. builds the sandbox image, 2. creates the internal `earth-only` network (no internet),
# 3. starts `earth-relay` (bridge + earth-only) forwarding :8701 → host earth service.
set -eu
IMAGE="${SANDBOX_IMAGE:-earth-sandbox:latest}"
NET="${SANDBOX_NETWORK:-earth-only}"
PORT="${EARTH_SERVICE_PORT:-8701}"

docker build -q -f sandbox/Dockerfile -t "$IMAGE" . >/dev/null
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
docker rm -f earth-relay >/dev/null 2>&1 || true
docker run -d --name earth-relay --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 64m --pids-limit 32 -e TARGET="host.docker.internal:$PORT" \
  "$IMAGE" python /sandbox/relay.py >/dev/null
docker network connect --alias earth-relay "$NET" earth-relay
echo "sandbox ready: image=$IMAGE network=$NET relay=earth-relay:8701 -> host:$PORT"
