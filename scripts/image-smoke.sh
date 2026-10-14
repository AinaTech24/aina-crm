#!/usr/bin/env bash
# Smoke-test a built app image against throwaway Postgres + Redis containers.
# Touches NOTHING outside Docker: no AWS, no production database, no real secret
# (every secret below is generated for this run and dies with the containers).
#
#   scripts/image-smoke.sh <image> [expected-git-sha]
#
# Proves, in the image that would ship:
#   - migrations apply (twice — idempotent), the schema guard and the RLS guard pass
#   - `next start` serves /api/health (db ok), the login page, an API 401, a static asset
#   - the worker boots and keeps running
#   - the RTA import code path loads (every src/lib/rta module) and parses the sample feeds
#   - web and worker resident memory after warm-up
#   - no secret / .env / placeholder credential is inside the image
# Prints `KEY=value` metric lines (and a summary table to $GITHUB_STEP_SUMMARY when set).
set -uo pipefail
IMG="${1:?usage: image-smoke.sh <image> [expected-git-sha]}"
WANT_SHA="${2:-}"
PORT="${SMOKE_PORT:-3000}"
MEMCAP=(${SMOKE_MEMCAP:-})
NET="smoke-net-$"
TMP=".smoke-tmp"; mkdir -p "$TMP"   # relative: works on Linux CI and under Git Bash on Windows
FAILS=0
M() { echo "METRIC $1=$2"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "| $1 | $2 |" >> "$GITHUB_STEP_SUMMARY"; }
ok()   { echo "PASS  $*"; }
bad()  { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
need() { local out; if out=$(eval "$2" 2>&1); then ok "$1"; else bad "$1"; echo "$out" | tail -25 | sed "s/^/      | /"; fi; }
cleanup() { docker rm -f smoke-web smoke-worker smoke-pg smoke-redis >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

[ -n "${GITHUB_STEP_SUMMARY:-}" ] && { echo "### Smoke test of \`$IMG\`"; echo "| check / metric | value |"; echo "|---|---|"; } >> "$GITHUB_STEP_SUMMARY"

rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
APP_PW="app$(rand | head -c 16)"; PG_PW="pg$(rand | head -c 16)"
SECRET="$(rand)"; ENCKEY="$(rand)"; INTERNAL="$(rand)"; HEALTH="$(rand)"

docker network create "$NET" >/dev/null
docker run -d --name smoke-pg --network "$NET" ${MEMCAP[@]+"${MEMCAP[@]}"} -e POSTGRES_PASSWORD="$PG_PW" -e POSTGRES_DB=mfd postgres:16 >/dev/null
docker run -d --name smoke-redis --network "$NET" redis:7-alpine >/dev/null
for i in $(seq 1 40); do docker exec smoke-pg pg_isready -U postgres -d mfd >/dev/null 2>&1 && break; sleep 2; done
sleep 3
MASTER="postgres://postgres:${PG_PW}@smoke-pg:5432/mfd"
APPURL="postgres://mfd_app:${APP_PW}@smoke-pg:5432/mfd"

run() { docker run --rm --network "$NET" "$@"; }

echo "=== image facts"
M image_size_bytes "$(docker image inspect "$IMG" --format '{{.Size}}')"
M image_arch "$(docker image inspect "$IMG" --format '{{.Architecture}}')"
M image_user "$(docker image inspect "$IMG" --format '{{.Config.User}}')"

echo "=== migrations (master role), twice, then guards"
need "migrate:all applies"            "run -e DATABASE_URL='$MASTER' -e ALLOW_SUPERUSER_DB=1 -e ALLOW_SYSTEM_TX=1 '$IMG' npm run migrate:all"
need "migrate:all is idempotent"      "run -e DATABASE_URL='$MASTER' -e ALLOW_SUPERUSER_DB=1 -e ALLOW_SYSTEM_TX=1 '$IMG' npm run migrate:all"
need "check:rls (every tenant table has a policy)" "run -e DATABASE_URL='$MASTER' -e ALLOW_SUPERUSER_DB=1 '$IMG' npm run check:rls"
need "provision the app role"         "run -e DATABASE_URL='$MASTER' -e ALLOW_SUPERUSER_DB=1 -e APP_DB_PASSWORD='$APP_PW' '$IMG' node scripts/provision-app-role.mjs"
need "check:schema (schema guard)"    "run -e DATABASE_URL='$MASTER' -e ALLOW_SUPERUSER_DB=1 -e APP_DATABASE_URL='$APPURL' '$IMG' npm run check:schema"

COMMON=(-e NODE_ENV=production -e APP_DATABASE_URL="$APPURL" -e ALLOW_SYSTEM_TX=1 -e REDIS_URL=redis://smoke-redis:6379
        -e NEXTAUTH_SECRET="$SECRET" -e ENCRYPTION_KEY="$ENCKEY" -e INTERNAL_API_TOKEN="$INTERNAL" -e HEALTH_TOKEN="$HEALTH"
        -e APP_URL=http://localhost:${PORT} -e APP_BASE_URL=http://localhost:${PORT})

echo "=== web (next start)"
docker run -d --name smoke-web --network "$NET" ${MEMCAP[@]+"${MEMCAP[@]}"} -p ${PORT}:3000 "${COMMON[@]}" "$IMG" >/dev/null
UP=0; for i in $(seq 1 60); do code=$(curl -s -o $TMP/health.json -w '%{http_code}' http://localhost:${PORT}/api/health || true); [ "$code" = 200 ] && { UP=1; break; }; sleep 2; done
[ "$UP" = 1 ] && ok "web answers /api/health 200 after ~$((i*2))s" || { bad "web did not become healthy"; docker logs --tail 40 smoke-web; }
need "health reports db ok"            "grep -q '\"db\":\"ok\"' $TMP/health.json"
if [ -n "$WANT_SHA" ]; then need "health build SHA = commit ($WANT_SHA)" "grep -q '${WANT_SHA:0:8}' $TMP/health.json"; M health_build "$(tr -d '\n' < $TMP/health.json | head -c 160)"; fi
need "login page renders (200)"        "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/login)\" = 200 ]"
need "API without session is 401"      "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/api/investors)\" = 401 ]"
ASSET=$(curl -s http://localhost:${PORT}/login | grep -oE '/_next/static/[^"]+\.(js|css)' | head -1)
need "a static asset is served ($ASSET)" "[ -n '$ASSET' ] && [ \"\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}$ASSET)\" = 200 ]"
need "container healthcheck turns healthy" "for i in \$(seq 1 30); do [ \"\$(docker inspect -f '{{.State.Health.Status}}' smoke-web)\" = healthy ] && exit 0; sleep 3; done; exit 1"
need "web did not log a module/import error" "! docker logs smoke-web 2>&1 | grep -E 'Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND'"

echo "=== worker"
docker run -d --name smoke-worker --network "$NET" ${MEMCAP[@]+"${MEMCAP[@]}"} "${COMMON[@]}" "$IMG" npm run worker:prod >/dev/null
sleep 45
need "worker container is still running" "[ \"\$(docker inspect -f '{{.State.Running}}' smoke-worker)\" = true ]"
need "worker did not log a module/import error" "! docker logs smoke-worker 2>&1 | grep -E 'Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND'"
M worker_log_lines "$(docker logs smoke-worker 2>&1 | wc -l)"

echo "=== RTA import code path"
cat > "$TMP/rta-smoke.ts" <<'EOF'
import { readFileSync, readdirSync } from "node:fs";
(async () => {
  const dir = "/app/src/lib/rta";
  let loaded = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) { await import(`${dir}/${f}`); loaded++; }
  const { parseCsv } = await import(`${dir}/csv.ts`);
  const { isKfintechFolioMaster } = await import(`${dir}/kfintech.ts`);
  const { decodeRtaToText } = await import(`${dir}/decode.ts`);
  const sample = readFileSync("/app/public/sample-rta/kfintech_daily_transaction_feed.csv");
  const rows = parseCsv(decodeRtaToText(sample, "kfintech_daily_transaction_feed.csv"));
  console.log(JSON.stringify({ modulesLoaded: loaded, sampleRows: rows.length, header: rows[0]?.length, isMaster: isKfintechFolioMaster(rows[0] ?? []) }));
  if (loaded < 15 || rows.length < 3) process.exit(1);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
EOF
docker exec -i smoke-worker sh -c 'cat > /tmp/rta-smoke.ts' < "$TMP/rta-smoke.ts"
RTA_ALL=$(docker exec smoke-worker npx tsx /tmp/rta-smoke.ts 2>&1)
RTA_OUT=$(echo "$RTA_ALL" | grep modulesLoaded | tail -1)
echo "$RTA_OUT"
if [ -n "$RTA_OUT" ]; then ok "every RTA module loads and a sample feed parses"; else bad "RTA code path failed"; echo "$RTA_ALL" | tail -15 | sed "s/^/      | /"; fi

echo "=== memory after warm-up (RSS, MiB)"
for i in 1 2 3 4 5; do curl -s -o /dev/null http://localhost:${PORT}/login; curl -s -o /dev/null http://localhost:${PORT}/api/health; done
sleep 20
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' smoke-web smoke-worker | tee $TMP/stats.txt
M web_ram "$(grep smoke-web $TMP/stats.txt | awk '{print $2}')"
M worker_ram "$(grep smoke-worker $TMP/stats.txt | awk '{print $2}')"

echo "=== secrets / hygiene inside the image"
ENVOUT=$(docker image inspect "$IMG" --format '{{range .Config.Env}}{{println .}}{{end}}')
echo "$ENVOUT" | sed -E 's/=.*/=…/'
for v in DATABASE_URL APP_DATABASE_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY NEXTAUTH_SECRET ENCRYPTION_KEY S3_SECRET_ACCESS_KEY RESEND_API_KEY ANTHROPIC_API_KEY INTERNAL_API_TOKEN; do
  echo "$ENVOUT" | grep -q "^${v}=" && bad "image ENV contains $v" || true
done
[ "$FAILS" = 0 ] && ok "no secret variable is set in the image environment"
need "no .env files in the image"     "[ -z \"\$(docker run --rm --entrypoint sh '$IMG' -c 'find /app -maxdepth 2 -name \".env*\" | head -1')\" ]"
need "no build placeholder DATABASE_URL in the image" "! docker run --rm --entrypoint sh '$IMG' -c 'env' | grep -q 'build:build@'"
need "no private key material in /app (excluding node_modules)" "[ -z \"\$(docker run --rm --entrypoint sh '$IMG' -c 'grep -rlE \"BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY\" /app/src /app/scripts /app/.next /app/public /app/drizzle 2>/dev/null | head -1')\" ]"
need "no AKIA access key id in app files" "[ -z \"\$(docker run --rm --entrypoint sh '$IMG' -c 'grep -rlE \"AKIA[0-9A-Z]{16}\" /app/src /app/scripts /app/.next /app/public /app/drizzle 2>/dev/null | head -1')\" ]"
need "no .next/cache in the image"    "! docker run --rm --entrypoint sh '$IMG' -c 'test -d /app/.next/cache'"
need "runs as the non-root user"      "[ \"\$(docker run --rm --entrypoint id '$IMG' -un)\" = app ]"

echo
[ "$FAILS" = 0 ] && { echo "SMOKE: ALL CHECKS PASSED"; exit 0; } || { echo "SMOKE: $FAILS CHECK(S) FAILED"; exit 1; }
