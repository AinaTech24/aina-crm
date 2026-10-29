#!/usr/bin/env bash
# Resize the production EC2 box (stop → change type → start) under the
# production change lock. The same command is the rollback: run it again with
# the old type. Runbook: docs/ec2-resize-runbook.md.
#
#   bash scripts/resize-ec2.sh check                              # read-only
#   CONFIRM=yes bash scripts/resize-ec2.sh run t4g.medium <session-name>
#   CONFIRM=yes bash scripts/resize-ec2.sh run t4g.large  <session-name>   # rollback
#
# Needs one SSO sign-in (`aws sso login --profile aina-admin`); that covers both
# profiles used here: aina-deploy for the lock + SSM (as prod-change.sh), and
# aina-admin for the EC2 stop / modify / start / snapshot calls only.
# Expect ~2–4 minutes of site downtime. The Elastic IP stays attached.
set -euo pipefail
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 AWS_PAGER=""
REGION=ap-south-1
INSTANCE_ID=i-059673ee0da4f877a
HEALTH_URL=https://crm.ainatech.in/api/health
ADMIN="--profile aina-admin --region $REGION"
OPS="--profile aina-deploy --region $REGION"
HERE="$(cd "$(dirname "$0")" && pwd)"
ALLOWED="t4g.medium t4g.large"

say() { printf '\n=== %s  %s\n' "$(TZ=IST-5:30 date '+%H:%M:%S IST')" "$*"; }
die() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

# Run a shell snippet on the box through SSM and print its output.
on_box() {
  local params cid st
  params=$(CMD="$1" node -e 'process.stdout.write(JSON.stringify({commands:[process.env.CMD],executionTimeout:["120"]}))')
  cid=$(aws ssm send-command $OPS --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
    --comment "resize-ec2: ${2:-check}" --parameters "$params" --query Command.CommandId --output text)
  for _ in $(seq 1 40); do
    sleep 3
    st=$(aws ssm get-command-invocation $OPS --command-id "$cid" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Pending|InProgress|Delayed) continue ;; *) break ;; esac
  done
  aws ssm get-command-invocation $OPS --command-id "$cid" --instance-id "$INSTANCE_ID" \
    --query "[StandardOutputContent,StandardErrorContent]" --output text | sed '/^\s*$/d'
}

current_type() { aws ec2 describe-instances $ADMIN --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].InstanceType' --output text; }
health() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH_URL" || true; }

BOX_STATE='free -m | sed -n 1,3p; df -h / | tail -1; uptime;
docker ps --format "{{.Names}}  {{.Status}}";
docker stats --no-stream --format "{{.Name}} {{.MemUsage}}"'

preflight() {
  say "Signed in?"
  aws sts get-caller-identity $ADMIN --query Arn --output text || die "run: aws sso login --profile aina-admin"
  aws sts get-caller-identity $OPS --query Arn --output text >/dev/null || die "aina-deploy profile not usable"
  say "Instance type now: $(current_type)"
  say "Public site health: $(health)"
  say "Change lock"
  bash "$HERE/prod-change.sh" status || true
  say "Deploys in progress on GitHub"
  if command -v gh >/dev/null; then
    gh run list -L 10 --json workflowName,status,createdAt \
      -q '.[]|select(.status!="completed")|"\(.workflowName) \(.status) \(.createdAt)"' || true
  else echo "(gh not installed — check GitHub Actions by hand)"; fi
  say "Box"
  on_box "$BOX_STATE" precheck
}

case "${1:-}" in
  check) preflight ;;
  run)
    TARGET="${2:-}"; SESSION="${3:-}"
    [[ " $ALLOWED " == *" $TARGET "* ]] || die "type must be one of: $ALLOWED"
    [[ -n "$SESSION" && "$SESSION" != *" "* ]] || die "give a session name with no spaces"
    [ "${CONFIRM:-}" = yes ] || die "set CONFIRM=yes to really stop the production server"
    FROM=$(current_type)
    [ "$FROM" != "$TARGET" ] || die "already $TARGET"
    preflight
    OWN_LOCK=0
    if bash "$HERE/prod-change.sh" held-by "$SESSION" >/dev/null 2>&1; then
      # A rollback inside the same change: the lock is already ours and the
      # site may well be down, so no healthy-before check.
      say "Change lock already held by $SESSION — continuing (rollback)"
    else
      [ "$(health)" = 200 ] || die "site is not healthy BEFORE the change — not touching it"
      # A deploy that is still in CI does not hold the lock yet, but its SSM
      # step would land on a stopped box. Let it finish first.
      if command -v gh >/dev/null && gh run list -L 10 --json workflowName,status \
          -q '.[]|select(.status!="completed" and (.workflowName|test("Deploy")))|.workflowName' | grep -q .; then
        die "a deploy is in progress on GitHub — wait for it to finish, then run again"
      fi
      say "Taking the change lock"
      bash "$HERE/prod-change.sh" acquire "Resize EC2 $FROM -> $TARGET" "$SESSION" \
        || die "lock not acquired — someone else is changing production. Wait."
      OWN_LOCK=1
    fi

    # Reserve the target capacity BEFORE stopping anything. On 2026-10-24 a
    # plain stop/modify/start hit InsufficientInstanceCapacity for t4g.medium
    # in ap-south-1b and cost 97 s of downtime for nothing. An open capacity
    # reservation is used automatically by the start, and is billed per second
    # at the on-demand rate only while it exists (cancelled right after).
    AZ=$(aws ec2 describe-instances $ADMIN --instance-ids "$INSTANCE_ID"       --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text)
    say "Reserving 1 x $TARGET in $AZ (site still up)"
    if ! CR=$(aws ec2 create-capacity-reservation $ADMIN --instance-type "$TARGET"         --instance-platform Linux/UNIX --availability-zone "$AZ" --instance-count 1         --instance-match-criteria open --end-date-type unlimited         --tag-specifications "ResourceType=capacity-reservation,Tags=[{Key=purpose,Value=resize-$SESSION}]"         --query CapacityReservation.CapacityReservationId --output text); then
      [ "$OWN_LOCK" = 1 ] && bash "$HERE/prod-change.sh" release "$SESSION" "NOT DONE: no $TARGET capacity in $AZ; nothing stopped"
      die "AWS has no $TARGET capacity in $AZ right now. Nothing was stopped. Try again later."
    fi
    echo "$CR"
    cancel_cr() { [ -n "${CR:-}" ] && aws ec2 cancel-capacity-reservation $ADMIN --capacity-reservation-id "$CR" --output text >/dev/null && echo "capacity reservation $CR cancelled"; CR=""; }
    trap cancel_cr EXIT

    say "Snapshot of the root disk (point-in-time at start; finishes in the background)"
    VOL=$(aws ec2 describe-instances $ADMIN --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)
    SNAP=$(aws ec2 create-snapshot $ADMIN --volume-id "$VOL" \
      --description "pre-resize $FROM->$TARGET $(date -u +%FT%TZ) ($SESSION)" \
      --tag-specifications "ResourceType=snapshot,Tags=[{Key=purpose,Value=pre-resize},{Key=delete-after,Value=$(date -u -d '+14 days' +%F 2>/dev/null || date -u +%F)}]" \
      --query SnapshotId --output text)
    echo "$SNAP of $VOL"

    REVERTED=0
    T0=$(date +%s)
    say "Stopping $INSTANCE_ID (site goes down now)"
    aws ec2 stop-instances $ADMIN --instance-ids "$INSTANCE_ID" --query 'StoppingInstances[0].CurrentState.Name' --output text
    aws ec2 wait instance-stopped $ADMIN --instance-ids "$INSTANCE_ID"
    say "Stopped after $(( $(date +%s) - T0 )) s. Changing type $FROM -> $TARGET"
    aws ec2 modify-instance-attribute $ADMIN --instance-id "$INSTANCE_ID" --instance-type "{\"Value\":\"$TARGET\"}"

    say "Starting"
    if ! aws ec2 start-instances $ADMIN --instance-ids "$INSTANCE_ID" --query 'StartingInstances[0].CurrentState.Name' --output text; then
      # Usually InsufficientInstanceCapacity for the new type: go straight back.
      say "Start on $TARGET FAILED — putting it back to $FROM and starting"
      aws ec2 modify-instance-attribute $ADMIN --instance-id "$INSTANCE_ID" --instance-type "{\"Value\":\"$FROM\"}"
      aws ec2 start-instances $ADMIN --instance-ids "$INSTANCE_ID" >/dev/null
      TARGET="$FROM"; REVERTED=1
    fi
    aws ec2 wait instance-running $ADMIN --instance-ids "$INSTANCE_ID"
    say "Running as $(current_type). Waiting for the site (up to 10 min)"
    ok=0
    for _ in $(seq 1 60); do
      c=$(health); printf '%s ' "$c"
      [ "$c" = 200 ] && { ok=1; break; }
      sleep 10
    done
    echo; say "Downtime ≈ $(( $(date +%s) - T0 )) s"

    say "Box after start (worker and redis must be Up; start the worker if it is not)"
    on_box "docker start app-worker-1 >/dev/null 2>&1 || true; sleep 5; $BOX_STATE; swapon --show" postcheck
    cancel_cr

    if [ "$ok" = 1 ] && [ "$REVERTED" = 1 ]; then
      bash "$HERE/prod-change.sh" release "$SESSION" "REVERTED: $(current_type) again, health 200, snapshot $SNAP"
      say "NOT RESIZED: the new type would not start, so it is back on $(current_type) and healthy."
      exit 2
    elif [ "$ok" = 1 ]; then
      bash "$HERE/prod-change.sh" release "$SESSION" "PASS: now $(current_type), health 200, snapshot $SNAP"
      say "DONE. Watch memory/swap for 7 days; roll back with: CONFIRM=yes bash scripts/resize-ec2.sh run $FROM $SESSION"
    else
      say "Site NOT healthy. Lock KEPT by $SESSION. Roll back now:"
      echo "  CONFIRM=yes bash scripts/resize-ec2.sh run $FROM $SESSION"
      echo "  (the lock is already yours; acquire will say so and continue)"
      exit 1
    fi
    ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
