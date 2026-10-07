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

TARBALL="${1:?usage: ssm-deploy.sh /path/to/app.tgz}"
APP_DIR="${APP_DIR:-$HOME/app}"

# Serialise deploys on the BOX. fd 9 is inherited by the detached
# run-deploy.sh, so the lock is held until the build itself exits.
exec 9>"$HOME/.deploy.lock"
if ! flock -w 1800 9; then
  echo "another deploy has held the lock for 30 minutes — refusing to overwrite $APP_DIR"
  exit 1
fi
echo "=== deploy lock acquired $(date -u) ==="

cd "$APP_DIR"

# Rollback target: the image serving right now. run-deploy.sh only prunes
# untagged images, so a tag keeps it. Keep the newest two.
if docker image inspect mfd-app:latest >/dev/null 2>&1; then
  stamp="prev-$(date -u +%Y%m%d-%H%M%S)"
  docker tag mfd-app:latest "mfd-app:$stamp"
  echo "=== rollback image kept: mfd-app:$stamp ==="
  docker images mfd-app --format '{{.Tag}}' | grep '^prev-' | sort -r | tail -n +3 \
    | while read -r old; do docker rmi "mfd-app:$old" >/dev/null 2>&1 && echo "dropped old rollback image mfd-app:$old" || true; done
fi

# A tarball only ADDS files: delete what git deleted (src, scripts, drizzle).
tar tzf "$TARBALL" | sed 's#/$##' | sort -u > /tmp/shipped.txt
tar xzf "$TARBALL" -C "$APP_DIR"
find src scripts drizzle -type f 2>/dev/null | sort -u > /tmp/onbox.txt
comm -13 /tmp/shipped.txt /tmp/onbox.txt | while read -r stale; do
  [ -n "$stale" ] && rm -f "$stale" && echo "removed stale: $stale"
done

# CI already ran tsc on this exact tree and gates this job.
rm -f "$HOME/deploy-current.log"
SKIP_TYPECHECK=1 nohup bash "$HOME/run-deploy.sh" > "$HOME/deploy-current.log" 2>&1 &

for _ in $(seq 1 240); do
  grep -aq "DEPLOY_DONE_EXIT" "$HOME/deploy-current.log" 2>/dev/null && break
  sleep 10
done

grep -aE "^=== |DEPLOY_DONE_EXIT" "$HOME/deploy-current.log" || true
code=$(grep -ao "DEPLOY_DONE_EXIT=[0-9]*" "$HOME/deploy-current.log" | tail -1 | cut -d= -f2)
if [ "${code:-}" != "0" ]; then
  echo "Deploy failed (DEPLOY_DONE_EXIT=${code:-timeout}). The previous colour is still serving."
  tail -80 "$HOME/deploy-current.log"
  exit 1
fi
echo "Deploy OK — active colour: $(cat "$APP_DIR/.active-color" 2>/dev/null || echo unknown)"
