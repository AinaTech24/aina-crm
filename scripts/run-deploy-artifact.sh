#!/bin/bash
# Zero-downtime blue-green switch for a PRE-BUILT, VERIFIED image. Runs on the box.
# Called by scripts/artifact-deploy.sh AFTER the artifact was verified and loaded
# and `mfd-app:latest` points at it. Unlike ~/run-deploy.sh it does NOT:
#   - build the application (CI built it; the box has no compiler load),
#   - run a second type-check (CI ran tsc on this exact commit),
#   - clear the Docker build cache (there is no build here).
# It still does everything that protects production:
#   migrate -> schema guard -> start the idle colour -> health-check ->
#   check the running build is the commit we meant -> stop the old colour -> worker.
# A failure at any step leaves the previous colour serving (zero downtime).
#
#   EXPECT_COMMIT=<40-hex> bash run-deploy-artifact.sh
exec > ~/deploy-current.log 2>&1
cd ~/app || { echo "DEPLOY_DONE_EXIT=1 (no ~/app)"; exit 1; }
COMPOSE="docker compose -f docker-compose.prod.yml"
STATE=~/app/.active-color
WANT="${EXPECT_COMMIT:-}"
echo "--- mem ---"; free -m | grep -E "Mem|Swap"
df -h / | tail -1 | awk '{print "--- disk: " $3 " used, " $4 " free (" $5 ") ---"}'

echo "=== image in use $(date) ==="
docker image inspect mfd-app:latest --format '{{.Id}} {{.Size}}' || { echo "DEPLOY_DONE_EXIT=1 (no mfd-app:latest)"; exit 1; }

echo "=== migrate $(date) ==="; echo "MARK migrate_start $(date +%s)"
$COMPOSE run --rm migrate
echo "MARK migrate_end $(date +%s)"
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (migrate failed  old colour still serving)"; exit $RC; }

echo "=== schema guard $(date) ==="
$COMPOSE run --rm migrate npm run check:schema
echo "MARK schema_end $(date +%s)"
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (schema drift  old colour still serving)"; exit $RC; }

ACTIVE=$(cat $STATE 2>/dev/null)
if [ "$ACTIVE" = "blue" ]; then TARGET=green; else TARGET=blue; fi
echo "=== active=${ACTIVE:-none} target=$TARGET $(date) ==="

echo "=== start $TARGET (verified image) ==="; echo "MARK colour_start $(date +%s)"
$COMPOSE --profile "$TARGET" up -d --no-deps "web-$TARGET"
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (could not start $TARGET  old colour still serving)"; exit $RC; }

echo "=== wait for $TARGET healthy ==="
ok=0
for i in $(seq 1 36); do
  st=$(docker inspect --format '{{.State.Health.Status}}' "app-web-$TARGET" 2>/dev/null)
  echo "  [$i] app-web-$TARGET health=$st"
  [ "$st" = "healthy" ] && { ok=1; break; }
  sleep 5
done
stop_target() { $COMPOSE --profile "$TARGET" stop "web-$TARGET"; }
if [ $ok -ne 1 ]; then
  echo "=== $TARGET never healthy  rolling back (old colour untouched) ==="
  stop_target
  echo "DEPLOY_DONE_EXIT=1 (new colour unhealthy  NO downtime, ${ACTIVE:-old} still serving)"
  exit 1
fi

echo "MARK colour_healthy $(date +%s)"
# The new colour must be running the commit that was verified, not just "a" build.
if [ -n "$WANT" ]; then
  HEALTH=$(docker exec "app-web-$TARGET" curl -fsS http://localhost:3000/api/health 2>/dev/null)
  echo "health: $HEALTH"
  if ! echo "$HEALTH" | grep -q "${WANT:0:8}"; then
    echo "=== $TARGET reports a different build than commit ${WANT:0:12}  rolling back ==="
    stop_target
    echo "DEPLOY_DONE_EXIT=1 (running build is not the verified commit; ${ACTIVE:-old} still serving)"
    exit 1
  fi
  echo "=== build matches commit ${WANT:0:12} ==="
fi

# New colour healthy  Caddy is already routing to it. Stop the old colour.
if [ -n "$ACTIVE" ] && [ "$ACTIVE" != "$TARGET" ]; then
  echo "=== cutover: stop old colour $ACTIVE $(date) ==="
  $COMPOSE --profile "$ACTIVE" stop "web-$ACTIVE"
  $COMPOSE --profile "$ACTIVE" rm -f "web-$ACTIVE"
fi

echo "MARK cutover_done $(date +%s)"
echo "=== refresh worker to new image $(date) ==="
$COMPOSE up -d --no-deps worker

echo "$TARGET" > $STATE
echo "--- mem ---"; free -m | grep -E "Mem|Swap"
df -h / | tail -1 | awk '{print "--- disk: " $3 " used, " $4 " free (" $5 ") ---"}'
echo "=== done $(date)  active colour is now $TARGET ==="
echo "DEPLOY_DONE_EXIT=0"
