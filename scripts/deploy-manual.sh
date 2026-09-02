#!/usr/bin/env bash
#
# Manual deploy — the laptop-side half of .github/workflows/deploy.yml.
#
# Use this when GitHub Actions can't deploy (e.g. the DEPLOY_SSH_* repo secrets
# aren't set). It does exactly what the workflow does: package the tree, ship it,
# drop files deleted since the last deploy, then run the box's own blue-green
# script (~/run-deploy.sh, sourced from scripts/run-deploy-bluegreen.sh) and wait
# for its verdict.
#
# The box does the safe part: build -> typecheck -> migrate -> schema guard ->
# start the idle colour -> health-check -> stop the old colour -> refresh the
# worker. If anything fails, the previous colour keeps serving. No downtime.
#
# Usage:
#   bash scripts/deploy-manual.sh                 # deploy the working tree
#   DEPLOY_HOST=1.2.3.4 bash scripts/deploy-manual.sh
#   DRY_RUN=1 bash scripts/deploy-manual.sh       # package only, ship nothing
#
# Override any of these:
DEPLOY_HOST="${DEPLOY_HOST:-13.204.102.20}"
DEPLOY_USER="${DEPLOY_USER:-ec2-user}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/mfd-deploy}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_APP_DIR="${DEPLOY_APP_DIR:-/home/ec2-user/app}"
HEALTH_URL="${HEALTH_URL:-https://crm.ainatech.in/api/health}"

set -euo pipefail

say() { printf '\n\033[1m=== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mABORT: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."
[ -f package.json ] || die "run this from the repo (package.json not found)"
# A dry run only packages, so it needs no key.
[ "${DRY_RUN:-}" = "1" ] || [ -r "$DEPLOY_KEY" ] || die "ssh key not found at $DEPLOY_KEY — set DEPLOY_KEY=/path/to/key.pem"

SSH="ssh -i $DEPLOY_KEY -p $DEPLOY_PORT -o StrictHostKeyChecking=accept-new"
SCP="scp -i $DEPLOY_KEY -P $DEPLOY_PORT -o StrictHostKeyChecking=accept-new"
TARGET="$DEPLOY_USER@$DEPLOY_HOST"

# ── Warn about anything that isn't committed ────────────────────────────────
# We ship the WORKING TREE, not HEAD — so uncommitted edits do go live. That is
# occasionally what you want in an incident, and never what you want by accident.
if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '\033[33mNOTE: you have uncommitted changes. They WILL be deployed.\033[0m\n'
  git status --short
  printf 'Continue? [y/N] '; read -r reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "cancelled"
fi

say "packaging $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
# Same file list as the workflow. next-env.d.ts is deliberately NOT here: it is
# gitignored, so it doesn't exist in a clean checkout and tar exits 2 on it.
TARBALL="$(mktemp -t app-XXXXXX).tgz"
tar czf "$TARBALL" \
  --exclude='node_modules' --exclude='.next' --exclude='.git' \
  src public drizzle scripts \
  package.json package-lock.json next.config.ts tsconfig.json \
  drizzle.config.ts postcss.config.js tailwind.config.ts \
  vitest.config.ts
ls -lh "$TARBALL"

if [ "${DRY_RUN:-}" = "1" ]; then
  say "DRY_RUN=1 — packaged only, nothing shipped"
  echo "tarball: $TARBALL"
  exit 0
fi

say "copying to $TARGET"
$SCP "$TARBALL" "$TARGET:/tmp/app.tgz"
rm -f "$TARBALL"

say "deploying (blue-green) — this takes several minutes"
# shellcheck disable=SC2087  # expansion is intentional: values are baked in here.
$SSH "$TARGET" bash -s <<REMOTE
set -euo pipefail
cd "$DEPLOY_APP_DIR"

# A tarball only ADDS files. Anything deleted in git must be deleted here too,
# or removed code keeps shipping.
tar tzf /tmp/app.tgz | sed 's#/\$##' | sort -u > /tmp/shipped.txt
tar xzf /tmp/app.tgz -C "$DEPLOY_APP_DIR"
find src scripts -type f 2>/dev/null | sort -u > /tmp/onbox.txt
comm -13 /tmp/shipped.txt /tmp/onbox.txt | while read -r stale; do
  [ -n "\$stale" ] && rm -f "\$stale" && echo "removed stale: \$stale"
done

# Detached, so a dropped SSH session can't kill a 20-minute build.
rm -f ~/deploy-current.log
nohup bash ~/run-deploy.sh > ~/deploy-current.log 2>&1 &

# run-deploy.sh writes DEPLOY_DONE_EXIT=<code> as its last line. Poll for it.
for _ in \$(seq 1 240); do
  grep -aq "DEPLOY_DONE_EXIT" ~/deploy-current.log 2>/dev/null && break
  sleep 10
done

grep -aE "^=== |DEPLOY_DONE_EXIT" ~/deploy-current.log || true
code=\$(grep -ao "DEPLOY_DONE_EXIT=[0-9]*" ~/deploy-current.log | tail -1 | cut -d= -f2)
if [ "\${code:-}" != "0" ]; then
  echo "--- last 80 lines ---"
  tail -80 ~/deploy-current.log
  echo "DEPLOY FAILED (exit=\${code:-timeout}). The previous colour is still serving."
  exit 1
fi
echo "Deploy OK — active colour: \$(cat ~/app/.active-color 2>/dev/null || echo unknown)"
REMOTE

say "health check"
# builtAt should be seconds old; a single-digit uptimeSec confirms the cutover.
curl -fsS "$HEALTH_URL" || die "health check failed against $HEALTH_URL"
echo

say "deployed"
