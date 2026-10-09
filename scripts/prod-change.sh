#!/usr/bin/env bash
# The production change lock, from a laptop (any Claude session or a person).
# ONE production-changing change at a time: a deploy, an RDS change, a security
# group change, a container restart. Take the lock first; release it only after
# your health checks pass. If someone else holds it: STOP and wait.
#
#   bash scripts/prod-change.sh status
#   bash scripts/prod-change.sh acquire "Resize RDS to small" "RTA import session"
#   bash scripts/prod-change.sh release "RTA import session" "PASS: health ok"
#   bash scripts/prod-change.sh history
#
# The lock itself lives on the production box (scripts/prod-lock.sh, installed
# as ~/prod-lock.sh); this runs it there through SSM. Exit code 3 = held by
# someone else, 4 = you are not the holder.
set -euo pipefail
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 AWS_PAGER=""
REGION=ap-south-1
INSTANCE_ID=i-059673ee0da4f877a

[ $# -ge 1 ] || { sed -n 2,14p "$0"; exit 2; }
# Short-lived least-privilege credentials, not the laptop's own key.
. "$(dirname "$0")/aws-deploy-role.sh" || exit 1
# Each argument travels base64-encoded, so no quote, $ or backtick in a
# description is ever interpreted by a shell on the way.
remote="set -u"; call="sudo -u ec2-user -H bash /home/ec2-user/prod-lock.sh"; i=0
for a in "$@"; do
  i=$((i + 1))
  remote="$remote; A$i=\$(printf %s '$(printf '%s' "$a" | base64 -w0)' | base64 -d)"
  call="$call \"\$A$i\""
done
remote="$remote; $call"

params=$(REMOTE="$remote" node -e 'process.stdout.write(JSON.stringify({commands:[process.env.REMOTE],executionTimeout:["120"]}))')
cid=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "prod-change-lock $1" --parameters "$params" --query Command.CommandId --output text)
status=Pending
for _ in $(seq 1 40); do
  sleep 3
  status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in Pending|InProgress|Delayed) continue ;; *) break ;; esac
done
aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE_ID" \
  --query "[StandardOutputContent,StandardErrorContent]" --output text | sed '/^\s*$/d'
code=$(aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE_ID" --query ResponseCode --output text)
exit "$code"
