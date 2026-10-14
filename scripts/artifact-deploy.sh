#!/usr/bin/env bash
# Deploy a PRE-BUILT, VERIFIED image to the production box. Runs ON THE BOX as
# ec2-user (started through SSM by a workflow or by scripts/prod-change tooling).
# The box never builds the application and never runs tsc.
#
#   artifact-deploy.sh <s3://bucket/verified/<sha>/ | local dir> <commit 40-hex> <artifact sha256> [session]
#   SHADOW=1 artifact-deploy.sh ...   verify + disk gate + load under a shadow tag, then STOP
#                                      (nothing is switched, no migration, production untouched)
#
# Order — every step before the switch is safe to abort, and aborts leave the
# serving colour untouched:
#   1. serialise (deploy lock) + the production change lock
#   2. reclaim disk (exited one-off containers, old rollback images beyond the newest 2)
#   3. read the manifest, run the DISK GATE (calculated from the manifest) -> abort if short
#   4. download the artifact, VERIFY it (commit, CI result, SHA-256 twice, arch, age)
#   5. docker load; the loaded image id must equal the manifest's
#   6. keep the serving image as mfd-app:prev-<UTC>; point mfd-app:latest at the new one
#   7. scripts/run-deploy-artifact.sh: migrate -> schema guard -> start idle colour ->
#      health + "running build == verified commit" -> stop the old colour -> worker
#
# Only artifacts under the bucket's verified/ prefix are accepted (the prefix that
# only the CI build job can write). Break-glass: ALLOW_UNVERIFIED_PREFIX=1, which
# still runs every check above and is logged.
set -euo pipefail

SRC="${1:?usage: artifact-deploy.sh <s3 prefix|dir> <commit> <sha256> [session]}"
COMMIT="${2:?commit}"; SHA256="${3:?sha256}"
DEPLOY_SESSION="${4:-artifact-deploy ${COMMIT:0:8}}"
APP_DIR="${APP_DIR:-$HOME/app}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAGE="$HOME/artifact-staging/${COMMIT:0:12}"
SHADOW="${SHADOW:-0}"
BUCKET_OK="s3://aina-crm-deploy-artifacts-972971302420/verified/"
TAG="mfd-app:${COMMIT:0:12}"
[ "$SHADOW" = 1 ] && TAG="mfd-app:shadow-${COMMIT:0:12}"

case "$SRC" in
  s3://*) case "$SRC" in "$BUCKET_OK"*) ;; *) [ "${ALLOW_UNVERIFIED_PREFIX:-0}" = 1 ] \
            && echo "!!! BREAK-GLASS: artifact outside verified/ accepted ($SRC)" \
            || { echo "ARTIFACT REFUSED: $SRC is not under $BUCKET_OK"; exit 1; };; esac;;
esac

# ---- 1. locks (same rules as scripts/ssm-deploy.sh) --------------------------
exec 9>"$HOME/.deploy.lock"
flock -w 1800 9 || { echo "another deploy has held the lock for 30 minutes"; exit 1; }
PROD_LOCK="$HOME/prod-lock.sh"; OWN_LOCK=0
if [ "$SHADOW" != 1 ] && [ -f "$PROD_LOCK" ]; then
  if bash "$PROD_LOCK" held-by "$DEPLOY_SESSION"; then echo "=== change lock already held by $DEPLOY_SESSION ==="
  else bash "$PROD_LOCK" acquire "artifact deploy ${COMMIT:0:8}" "$DEPLOY_SESSION" 1800 || { echo "Deploy NOT started: another production change holds the lock."; exit 1; }; OWN_LOCK=1; fi
fi
release_change_lock() {
  [ "$SHADOW" = 1 ] && return 0; [ -f "$PROD_LOCK" ] || return 0
  [ "$OWN_LOCK" = 1 ] || { echo "=== change lock left with $DEPLOY_SESSION ($1) ==="; return 0; }
  local h; h=$(curl -sk --max-time 15 --resolve crm.ainatech.in:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://crm.ainatech.in/api/health || true)
  if [ "$h" = 200 ]; then bash "$PROD_LOCK" release "$DEPLOY_SESSION" "$1; health 200" || true
  else echo "=== change lock KEPT: /api/health answered ${h:-nothing} ==="; fi
}
abort() { echo "ABORT: $1"; rm -rf "$STAGE"; release_change_lock "ABORTED before the switch ($1); serving colour untouched"; exit "${2:-1}"; }

# ---- 2. reclaim disk ----------------------------------------------------------
# Exited one-off containers (repair / revalue jobs) pin their image; `docker rmi` then
# refuses silently — this is what filled the disk to 98% on 8 Oct 2026.
# ONLY finished one-off jobs of OUR image — never another exited container (an old unrelated
# postgres container lives on this box).
for img in $(docker images mfd-app -q | sort -u); do
  docker ps -aq --filter status=exited --filter "ancestor=$img" | xargs -r docker rm >/dev/null 2>&1 || true
done
docker images mfd-app --format '{{.Tag}}' | grep '^prev-' | sort -r | tail -n +3 | while read -r old; do
  docker rmi "mfd-app:$old" >/dev/null 2>&1 && echo "dropped old rollback image mfd-app:$old" || echo "kept mfd-app:$old (in use)"
done
docker image prune -f >/dev/null 2>&1 || true
rm -rf "$HOME"/artifact-staging/* 2>/dev/null || true          # earlier deploys' downloads
df -h / | tail -1 | awk '{print "=== disk before: " $3 " used, " $4 " free (" $5 ") ==="}'

# ---- 3. manifest + DISK GATE --------------------------------------------------
mkdir -p "$STAGE"
case "$SRC" in s3://*) aws s3 cp "${SRC%/}/manifest.json" "$STAGE/manifest.json" --only-show-errors --region ap-south-1 || abort "cannot fetch manifest.json";;
               *)      cp "$SRC/manifest.json" "$STAGE/manifest.json" || abort "no manifest.json in $SRC";; esac
NUM=$(MF="$STAGE/manifest.json" node -e 'const m=JSON.parse(require("fs").readFileSync(process.env.MF,"utf8"));console.log([m.artifact.file,m.artifact.bytes,m.image.uncompressedBytes].join(" "))') || abort "unreadable manifest"
read -r AFILE ABYTES IBYTES <<<"$NUM"
bash "$HERE/disk-gate.sh" --image-bytes "$IBYTES" --artifact-bytes "$ABYTES" || abort "disk gate: not enough free space" 3

# ---- 4. download + verify (nothing is loaded into Docker yet) ----------------
case "$SRC" in s3://*) aws s3 cp "${SRC%/}/$AFILE" "$STAGE/$AFILE" --only-show-errors --region ap-south-1 || abort "cannot download $AFILE";;
               *)      cp "$SRC/$AFILE" "$STAGE/$AFILE" || abort "no $AFILE in $SRC";; esac
VFLAGS=(); [ "$SHADOW" = 1 ] && VFLAGS=(--allow-shadow)
bash "$HERE/artifact-verify.sh" "$STAGE" --commit "$COMMIT" --sha256 "$SHA256" "${VFLAGS[@]}" || abort "artifact failed verification" 4

# ---- 5. load -----------------------------------------------------------------
echo "=== loading image $(date) ==="
LOADED=$(gzip -dc "$STAGE/$AFILE" | docker load | sed -n 's/^Loaded image: //p' | tail -1)
[ -n "$LOADED" ] || abort "docker load produced no image" 5
WANT_ID=$(MF="$STAGE/manifest.json" node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.MF,"utf8")).image.id)')
GOT_ID=$(docker image inspect "$LOADED" --format '{{.Id}}')
[ "$GOT_ID" = "$WANT_ID" ] || { docker rmi "$LOADED" >/dev/null 2>&1 || true; abort "loaded image id $GOT_ID != manifest $WANT_ID" 5; }
docker tag "$LOADED" "$TAG"
[ "$LOADED" != "$TAG" ] && docker rmi "$LOADED" >/dev/null 2>&1 || true
rm -f "$STAGE/$AFILE"                                   # the compressed download is no longer needed
echo "=== image $TAG verified and loaded (id ${GOT_ID:0:19}) ==="
if [ "$SHADOW" = 1 ]; then
  echo "SHADOW: stopping here. Nothing was switched. Image kept as $TAG for inspection; remove with: docker rmi $TAG"
  df -h / | tail -1 | awk '{print "=== disk after load: " $3 " used, " $4 " free (" $5 ") ==="}'
  rm -rf "$STAGE"; exit 0
fi

# ---- 6. rollback tag, then switch :latest ------------------------------------
cd "$APP_DIR"
if docker image inspect mfd-app:latest >/dev/null 2>&1; then
  stamp="prev-$(date -u +%Y%m%d-%H%M%S)"; docker tag mfd-app:latest "mfd-app:$stamp"; echo "=== rollback image kept: mfd-app:$stamp ==="
fi
docker tag "$TAG" mfd-app:latest

# ---- 7. blue/green switch ----------------------------------------------------
cp "$HERE/run-deploy-artifact.sh" "$HOME/run-deploy-artifact.sh"
rm -f "$HOME/deploy-current.log"
EXPECT_COMMIT="$COMMIT" nohup bash "$HOME/run-deploy-artifact.sh" > "$HOME/deploy-current.log" 2>&1 &
for _ in $(seq 1 120); do grep -aq "DEPLOY_DONE_EXIT" "$HOME/deploy-current.log" 2>/dev/null && break; sleep 5; done
grep -aE "^=== |^--- |DEPLOY_DONE_EXIT" "$HOME/deploy-current.log" || true
code=$(grep -ao "DEPLOY_DONE_EXIT=[0-9]*" "$HOME/deploy-current.log" | tail -1 | cut -d= -f2 || true)
rm -rf "$STAGE"
if [ "${code:-}" != 0 ]; then
  echo "Deploy failed (DEPLOY_DONE_EXIT=${code:-timeout}). The previous colour is still serving."; tail -60 "$HOME/deploy-current.log"
  # :latest must not point at an image that failed: put the previous image back
  prev=$(docker images mfd-app --format '{{.Tag}}' | grep '^prev-' | sort -r | head -1 || true)
  [ -n "$prev" ] && docker tag "mfd-app:$prev" mfd-app:latest && echo "mfd-app:latest restored to mfd-app:$prev"
  release_change_lock "FAILED artifact deploy (DEPLOY_DONE_EXIT=${code:-timeout}), previous colour serving"; exit 1
fi
echo "Deploy OK — active colour: $(cat "$APP_DIR/.active-color" 2>/dev/null || echo unknown) — commit ${COMMIT:0:12}"
release_change_lock "PASS artifact deploy ${COMMIT:0:12}, active colour $(cat "$APP_DIR/.active-color" 2>/dev/null || echo unknown)"
