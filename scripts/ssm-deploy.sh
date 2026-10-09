#!/usr/bin/env bash
# Runs ON the production box as ec2-user. Started by .github/workflows/deploy.yml
# through SSM Run Command (GitHub OIDC → IAM role → SSM; no SSH, no long-lived
# AWS keys in GitHub). The workflow uploads the release tarball to the
# deploy-artifacts bucket; the SSM command downloads it with the instance role,
# extracts THIS script from it and runs it:
#
#   bash ssm-deploy.sh /tmp/app.tgz
#
# Same steps the SSH deploy used, plus a rollback image:
#   lock → keep the serving image as mfd-app:prev-<UTC> (newest 2 kept)
#   → extract the tree → drop files no longer shipped
#   → ~/run-deploy.sh (prune → build → migrate → schema guard → start the idle
#     colour → health-check → stop the old colour → refresh the worker)
#   → wait for its DEPLOY_DONE_EXIT marker.
# A failed deploy leaves the previous colour serving. Roll back with
# scripts/rollback-bluegreen.sh mfd-app:prev-<stamp>.
set -euo pipefail

TARBALL="${1:?usage: ssm-deploy.sh /path/to/app.tgz [who is deploying]}"
APP_DIR="${APP_DIR:-$HOME/app}"
# Who holds the production change lock for this deploy (shown to anyone who
# checks it). The GitHub job and scripts/manual-deploy.sh pass one.
DEPLOY_SESSION="${2:-deploy $(basename "$TARBALL")}"

# Serialise deploys on the BOX. fd 9 is inherited by the detached
# run-deploy.sh, so the lock is held until the build itself exits.
exec 9>"$HOME/.deploy.lock"
if ! flock -w 1800 9; then
  echo "another deploy has held the lock for 30 minutes — refusing to overwrite $APP_DIR"
  exit 1
fi
echo "=== deploy lock acquired $(date -u) ==="

# The production CHANGE lock (scripts/prod-lock.sh): one production change at a
# time across every session — a deploy must not run while someone resizes the
# database or edits a security group. Refresh the installed copy from this
# release first, then wait up to 30 minutes for whoever holds it.
if tar tzf "$TARBALL" scripts/prod-lock.sh >/dev/null 2>&1; then
  tar xzf "$TARBALL" -O scripts/prod-lock.sh > "$HOME/prod-lock.sh.new" && mv "$HOME/prod-lock.sh.new" "$HOME/prod-lock.sh"
fi
PROD_LOCK="$HOME/prod-lock.sh"
OWN_LOCK=0
if [ -f "$PROD_LOCK" ]; then
  if bash "$PROD_LOCK" held-by "$DEPLOY_SESSION"; then
    # The caller took the lock for a wider change (deploy + its own checks):
    # run under it and leave the release to the caller.
    echo "=== production change lock already held by $DEPLOY_SESSION — deploying under it ==="
  else
    bash "$PROD_LOCK" acquire "deploy $(basename "$TARBALL")" "$DEPLOY_SESSION" 1800 || {
      echo "Deploy NOT started: another production change holds the lock."
      exit 1
    }
    OWN_LOCK=1
  fi
fi
# Release only once production answers healthy; otherwise keep it held so
# nobody piles a second change onto a broken site.
release_change_lock() {
  [ -f "$PROD_LOCK" ] || return 0
  if [ "$OWN_LOCK" != "1" ]; then
    echo "=== production change lock left with $DEPLOY_SESSION ($1) — it releases after its own checks ==="
    return 0
  fi
  local health
  health=$(curl -sk --max-time 15 --resolve crm.ainatech.in:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://crm.ainatech.in/api/health || true)
  if [ "$health" = "200" ]; then
    bash "$PROD_LOCK" release "$DEPLOY_SESSION" "$1; health 200" || true
  else
    echo "=== production change lock KEPT: /api/health answered ${health:-nothing} — fix production, then release it (scripts/prod-change.sh) ==="
  fi
}

cd "$APP_DIR"

# Rollback target: the image serving right now. run-deploy.sh only prunes
# untagged images, so a tag keeps it. Keep the newest two.
if docker image inspect mfd-app:latest >/dev/null 2>&1; then
  stamp="prev-$(date -u +%Y%m%d-%H%M%S)"
  docker tag mfd-app:latest "mfd-app:$stamp"
  echo "=== rollback image kept: mfd-app:$stamp ==="
  # An EXITED one-off container (a repair or revalue job run with the image)
  # pins it, and `docker rmi` then refuses silently: on 8 Oct 2026 seven 3.5 GB
  # images piled up behind five finished jobs, the disk hit 98% and the next
  # build died with ENOSPC. Remove those exited containers first; a running
  # one is left alone (and keeps its image).
  docker images mfd-app --format '{{.Tag}}' | grep '^prev-' | sort -r | tail -n +3 \
    | while read -r old; do
        docker ps -aq --filter "ancestor=mfd-app:$old" --filter status=exited | xargs -r docker rm >/dev/null 2>&1 || true
        docker rmi "mfd-app:$old" >/dev/null 2>&1 && echo "dropped old rollback image mfd-app:$old" || echo "kept mfd-app:$old (in use)"
      done
fi
df -h / | tail -1 | awk '{print "=== disk: " $3 " used, " $4 " free (" $5 ") ==="}'

# A tarball only ADDS files: delete what git deleted (src, scripts, drizzle).
tar tzf "$TARBALL" | sed 's#/$##' | sort -u > /tmp/shipped.txt
tar xzf "$TARBALL" -C "$APP_DIR"
find src scripts drizzle -type f 2>/dev/null | sort -u > /tmp/onbox.txt
comm -13 /tmp/shipped.txt /tmp/onbox.txt | while read -r stale; do
  [ -n "$stale" ] && rm -f "$stale" && echo "removed stale: $stale"
done

# CI already ran tsc on this exact tree and gates this job.
#
# A build that fails because Docker Hub or the network blipped is retried:
# on 7 Oct 2026 a deploy died in 28 s on "unexpected status from HEAD request
# to https://registry-1.docker.io/…: 500 Internal Server Error" while resolving
# the node base image. A failed build leaves the old colour serving, so running
# it again is exactly what a person would do by hand.
REGISTRY_BLIP='registry-1\.docker\.io|unexpected status from HEAD request|failed to resolve source metadata|failed to do request|TLS handshake timeout|i/o timeout|connection reset by peer|toomanyrequests|503 Service Unavailable|502 Bad Gateway|500 Internal Server Error'
for attempt in 1 2 3; do
  rm -f "$HOME/deploy-current.log"
  SKIP_TYPECHECK=1 nohup bash "$HOME/run-deploy.sh" > "$HOME/deploy-current.log" 2>&1 &

  for _ in $(seq 1 240); do
    grep -aq "DEPLOY_DONE_EXIT" "$HOME/deploy-current.log" 2>/dev/null && break
    sleep 10
  done

  grep -aE "^=== |DEPLOY_DONE_EXIT" "$HOME/deploy-current.log" || true
  # `|| true`: no marker yet (a timeout) must reach the report below, not
  # end the script under `set -e -o pipefail`.
  code=$(grep -ao "DEPLOY_DONE_EXIT=[0-9]*" "$HOME/deploy-current.log" | tail -1 | cut -d= -f2 || true)
  [ "${code:-}" = "0" ] && break
  # Only a BUILD failure is retried, never a failed migration or health check.
  if [ "$attempt" -lt 3 ] && grep -aq "build failed" "$HOME/deploy-current.log" \
     && grep -aqE "$REGISTRY_BLIP" "$HOME/deploy-current.log"; then
    cp "$HOME/deploy-current.log" "$HOME/deploy-failed-attempt-$attempt.log"
    echo "=== build hit a registry / network error (attempt $attempt) — retrying in $((attempt * 60)) s ==="
    sleep $((attempt * 60))
    continue
  fi
  break
done
if [ "${code:-}" != "0" ]; then
  echo "Deploy failed (DEPLOY_DONE_EXIT=${code:-timeout}). The previous colour is still serving."
  tail -80 "$HOME/deploy-current.log"
  release_change_lock "FAILED deploy (DEPLOY_DONE_EXIT=${code:-timeout}), previous colour serving"
  exit 1
fi
echo "Deploy OK — active colour: $(cat "$APP_DIR/.active-color" 2>/dev/null || echo unknown)"
release_change_lock "PASS deploy, active colour $(cat "$APP_DIR/.active-color" 2>/dev/null || echo unknown)"
