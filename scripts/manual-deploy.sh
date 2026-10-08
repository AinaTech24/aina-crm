#!/usr/bin/env bash
# Manual production deploy from your own machine — the same steps as the deploy
# job in .github/workflows/deploy.yml, for when GitHub Actions cannot run it
# (on 8 Oct 2026: "recent account payments have failed or your spending limit
# needs to be increased").
#
#   bash scripts/manual-deploy.sh               # deploy origin/main
#   bash scripts/manual-deploy.sh <commit>      # deploy one commit
#   DRY=1 bash scripts/manual-deploy.sh         # package and check only
#
# Needs: git, node, the AWS CLI logged in with deploy rights (aws sts
# get-caller-identity), and optionally gh (to check CI and running deploys).
#
# What it does:
#   1. refuses unless CI passed on that commit and no GitHub deploy is running
#   2. packages THAT COMMIT with git archive — never the working tree, where
#      other sessions keep uncommitted work
#   3. uploads it to the deploy-artifacts bucket
#   4. runs scripts/ssm-deploy.sh on the box through SSM (blue-green: build,
#      migrate, start the idle colour, health-check, switch) and waits
#   5. prints the result and the live /api/health
# A failed deploy leaves the previous colour serving.
#
# Ctrl+C stops WATCHING, not the deploy. Never `aws ssm cancel-command` a
# running deploy: it takes ~12 minutes.
set -euo pipefail
export PYTHONUTF8=1 AWS_PAGER=""

REGION=ap-south-1
INSTANCE_ID=i-059673ee0da4f877a
BUCKET=aina-crm-deploy-artifacts-972971302420
SITE=https://crm.ainatech.in

cd "$(git rev-parse --show-toplevel)"
git fetch -q origin
REF="${1:-origin/main}"
SHA=$(git rev-parse "$REF^{commit}")
echo "== deploying ${SHA:0:8}: $(git log -1 --format=%s "$SHA")"

aws sts get-caller-identity --query Arn --output text >/dev/null \
  || { echo "AWS CLI is not logged in (aws configure)"; exit 1; }

if command -v gh >/dev/null 2>&1; then
  ci=$(gh run list --commit "$SHA" --workflow CI --json conclusion \
        --jq 'if any(.[]; .conclusion == "success") then "success" else (.[0].conclusion // "no run") end' 2>/dev/null || echo "unknown")
  if [ "$ci" != "success" ] && [ "${FORCE:-}" != "1" ]; then
    echo "CI has not passed on ${SHA:0:8} (${ci}). Wait for it, or run with FORCE=1 if you are sure."
    exit 1
  fi
  busy=$(gh run list --workflow "Deploy to AWS (EC2)" --limit 10 --json status \
          --jq '[.[] | select(.status == "in_progress" or .status == "queued" or .status == "waiting")] | length' 2>/dev/null || echo 0)
  if [ "$busy" != "0" ]; then
    echo "A GitHub deploy is running or waiting — cancel it or let it finish; two deploys must never overlap."
    exit 1
  fi
else
  echo "(gh not found: skipping the CI and running-deploy checks)"
fi

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
win() { command -v cygpath >/dev/null 2>&1 && cygpath -m "$1" || echo "$1"; }
TGZ="$TMPD/app.tgz"
# core.autocrlf=false: Git for Windows sets autocrlf=true system-wide, and
# git archive applies it — the box's bash then fails on "set -euo pipefail\r"
# (8 Oct 2026). The release must carry the files exactly as committed (LF).
git -c core.autocrlf=false -c core.eol=lf archive --format=tar.gz -o "$TGZ" "$SHA" \
  src public drizzle scripts \
  package.json package-lock.json next.config.ts tsconfig.json \
  drizzle.config.ts postcss.config.js tailwind.config.ts vitest.config.ts
if [ "$(tar xzf "$TGZ" -O scripts/ssm-deploy.sh | tr -cd '\r' | wc -c)" != "0" ]; then
  echo "The release has Windows (CRLF) line endings — refusing to send it."
  exit 1
fi
echo "== packaged $(du -h "$TGZ" | cut -f1)"

KEY="releases/manual-$(date -u +%Y%m%d-%H%M%S)-${SHA}.tgz"
node -e '
  const uri = process.argv[1];
  process.stdout.write(JSON.stringify({
    executionTimeout: ["3300"],
    commands: [
      "set -euo pipefail",
      `aws s3 cp "${uri}" /tmp/app.tgz --only-show-errors --region ap-south-1`,
      "chown ec2-user:ec2-user /tmp/app.tgz",
      "tar xzf /tmp/app.tgz -O scripts/ssm-deploy.sh > /tmp/ssm-deploy.sh",
      "chmod 755 /tmp/ssm-deploy.sh",
      "runuser -l ec2-user -c \"bash /tmp/ssm-deploy.sh /tmp/app.tgz\"",
    ],
  }));' "s3://$BUCKET/$KEY" > "$TMPD/params.json"

if [ "${DRY:-}" = "1" ]; then
  echo "== DRY=1: would upload to s3://$BUCKET/$KEY and run the deploy. Nothing sent."
  exit 0
fi

aws s3 cp "$(win "$TGZ")" "s3://$BUCKET/$KEY" --only-show-errors --region "$REGION"
echo "== uploaded s3://$BUCKET/$KEY"

CID=$(aws ssm send-command --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "manual deploy ${SHA:0:8}" \
  --timeout-seconds 600 \
  --parameters "file://$(win "$TMPD/params.json")" \
  --query Command.CommandId --output text)
echo "== SSM command $CID — the box deploy takes about 12 minutes"

status=Pending
start=$(date +%s)
for _ in $(seq 1 220); do   # up to ~55 min
  sleep 15
  status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$INSTANCE_ID" \
            --query Status --output text 2>/dev/null || echo Pending)
  printf '\r   %s · %d min' "$status" $(( ($(date +%s) - start) / 60 ))
  case "$status" in Pending|InProgress|Delayed) continue ;; *) break ;; esac
done
echo

aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text || true
aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$INSTANCE_ID" \
  --query StandardErrorContent --output text | tail -40 || true

if [ "$status" != "Success" ]; then
  echo "Deploy did not succeed (SSM status: $status). The previous colour is still serving."
  exit 1
fi
echo "== deployed. Live: $(curl -s "$SITE/api/health" | head -c 200)"
