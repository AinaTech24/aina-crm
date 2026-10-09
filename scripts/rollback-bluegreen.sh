#!/usr/bin/env bash
# Roll production back to an earlier image WITHOUT rebuilding — the same
# blue/green swap run-deploy.sh does, on an image that already exists:
#
#   bash ~/app/scripts/rollback-bluegreen.sh mfd-app:prev-20261007-090000
#   bash ~/app/scripts/rollback-bluegreen.sh <image-id>
#
# Run as ec2-user on the box (SSM: runuser -l ec2-user -c "bash …").
# Re-tags the chosen image as mfd-app:latest, starts the idle colour on it,
# waits for healthy, stops the old colour and recreates the worker. If the new
# colour never turns healthy it is stopped, mfd-app:latest is pointed back at
# the image that was serving, and the old colour keeps serving — no downtime.
# Migrations are additive, so an older image runs against the current schema.
# List candidates: docker images mfd-app
set -euo pipefail

TARGET_IMAGE="${1:?usage: rollback-bluegreen.sh <mfd-app:tag | image-id> [who is rolling back]}"
SESSION="${2:-rollback}"
cd "${APP_DIR:-$HOME/app}"
COMPOSE="docker compose -f docker-compose.prod.yml"
STATE="$PWD/.active-color"

exec 9>"$HOME/.deploy.lock"
flock -n 9 || { echo "a deploy is running (lock held) — try again when it finishes"; exit 3; }

# The production change lock (scripts/prod-lock.sh): a rollback is a change too.
# Released only once /api/health answers 200.
PROD_LOCK="$HOME/prod-lock.sh"
if [ -f "$PROD_LOCK" ]; then
  bash "$PROD_LOCK" acquire "rollback to $TARGET_IMAGE" "$SESSION" 0 || exit 3
fi
release_change_lock() {
  [ -f "$PROD_LOCK" ] || return 0
  local health
  health=$(curl -sk --max-time 15 --resolve crm.ainatech.in:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://crm.ainatech.in/api/health || true)
  if [ "$health" = "200" ]; then
    bash "$PROD_LOCK" release "$SESSION" "$1; health 200" || true
  else
    echo "=== production change lock KEPT: /api/health answered ${health:-nothing} ==="
  fi
}

docker image inspect "$TARGET_IMAGE" >/dev/null || { echo "no such image: $TARGET_IMAGE"; exit 2; }
SERVING=$(docker image inspect -f '{{.Id}}' mfd-app:latest)
WANT=$(docker image inspect -f '{{.Id}}' "$TARGET_IMAGE")
echo "=== rollback $(date -u): serving ${SERVING:7:12} → target ${WANT:7:12} ($TARGET_IMAGE) ==="
docker tag "$TARGET_IMAGE" mfd-app:latest

ACTIVE=$(cat "$STATE" 2>/dev/null || echo blue)
if [ "$ACTIVE" = "blue" ]; then NEXT=green; else NEXT=blue; fi
echo "active=$ACTIVE next=$NEXT"
$COMPOSE --profile "$NEXT" up -d --no-deps --force-recreate "web-$NEXT"

ok=0
for i in $(seq 1 36); do
  st=$(docker inspect --format '{{.State.Health.Status}}' "app-web-$NEXT" 2>/dev/null || true)
  [ "$st" = "healthy" ] && { ok=1; break; }
  sleep 5
done
if [ $ok -ne 1 ]; then
  echo "=== $NEXT never healthy — undoing (mfd-app:latest back to ${SERVING:7:12}; $ACTIVE untouched) ==="
  $COMPOSE --profile "$NEXT" stop "web-$NEXT"
  docker tag "$SERVING" mfd-app:latest
  release_change_lock "FAILED rollback to $TARGET_IMAGE, $ACTIVE still serving"
  echo "ROLLBACK_DONE_EXIT=1"
  exit 1
fi

echo "=== $NEXT healthy after ~$((i * 5))s — cutover ==="
$COMPOSE --profile "$ACTIVE" stop "web-$ACTIVE"
$COMPOSE --profile "$ACTIVE" rm -f "web-$ACTIVE"
$COMPOSE up -d --no-deps --force-recreate worker
echo "$NEXT" > "$STATE"
echo "=== done $(date -u) — active colour $NEXT on ${WANT:7:12} ==="
release_change_lock "PASS rollback to $TARGET_IMAGE, active colour $NEXT"
echo "ROLLBACK_DONE_EXIT=0"
