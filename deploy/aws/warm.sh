#!/usr/bin/env bash
# Pre-warm the image cache before a demo: queue every band of every pass, for every saved place
# of one user, on the server. Run it the evening before; the server renders in the background.
#
#   SSH_KEY=~/.ssh/constellation.pem ./deploy/aws/warm.sh <server-ip> [user-id] [periods]
#
# user-id: whose places to warm (default "demo"). The presenter's own id is in their browser:
#   DevTools console -> localStorage.getItem('constellation.userId')
# periods: default "4m 5y" (the recent passes and the 5-year monthly picks).
#
# Why: the server is in Hong Kong for the users, while the Sentinel-2 images live in Oregon, so
# the first look at a place is slow. Warmed views come straight from the server's disk.
set -euo pipefail

HOST="${1:?usage: SSH_KEY=~/.ssh/key.pem $0 <server-ip> [user-id] [periods]}"
USER_ID="${2:-demo}"
PERIODS="${3:-4m 5y}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/constellation.pem}"
SSH_USER="${SSH_USER:-ubuntu}"
PORT="${HTTP_PORT:-80}"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST" \
  USER_ID="$USER_ID" PERIODS="'$PERIODS'" PORT="$PORT" 'bash -s' <<'REMOTE'
set -euo pipefail
api="http://localhost:$PORT/api"
ids=$(curl -fsS -H "X-User-Id: $USER_ID" "$api/places" | python3 -c 'import json,sys; print(" ".join(p["id"] for p in json.load(sys.stdin)))')
[ -n "$ids" ] || { echo "No saved places for user '$USER_ID'."; exit 0; }
for id in $ids; do
  for period in $PERIODS; do
    printf '%-24s %-3s ' "$id" "$period"
    curl -fsS -X POST -H "X-User-Id: $USER_ID" "$api/views/prefetch?place_id=$id&period=$period" || echo "(failed)"
    echo
  done
done
echo
echo "Queued. Rendering runs in the background, one job at a time. Progress (images on disk):"
echo "  docker exec \$(docker ps -qf name=backend) sh -c 'find /data/layers -name \"*.png\" | wc -l'"
REMOTE
