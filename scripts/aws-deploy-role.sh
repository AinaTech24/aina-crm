# shellcheck shell=bash
# Source this (`. scripts/aws-deploy-role.sh`) before any manual production
# deploy step. It swaps whatever AWS identity the laptop has for SHORT-LIVED
# credentials of the least-privilege role aina-crm-manual-deploy (2026-10-09):
#   s3:PutObject on the deploy-artifacts bucket's releases/ only,
#   ssm:SendCommand on the production instance + AWS-RunShellScript only,
#   reading command results.
# Nothing else — no RDS, no IAM, no security groups, no other bucket. A deploy
# therefore never runs with the laptop's administrator key.
#
# USE_CURRENT_AWS_CREDENTIALS=1 skips the swap (only for break-glass).
DEPLOY_ROLE_ARN="${DEPLOY_ROLE_ARN:-arn:aws:iam::972971302420:role/aina-crm-manual-deploy}"
if [ "${USE_CURRENT_AWS_CREDENTIALS:-}" != "1" ] && [ -z "${AINA_DEPLOY_ROLE_ACTIVE:-}" ]; then
  _who=$(whoami 2>/dev/null | tr -cd '[:alnum:]._-' | cut -c1-30)
  _creds=$(aws sts assume-role --role-arn "$DEPLOY_ROLE_ARN" \
    --role-session-name "manual-deploy-${_who:-laptop}" --duration-seconds 3600 \
    --query Credentials --output json) || { echo "Could not assume $DEPLOY_ROLE_ARN — not deploying."; return 1 2>/dev/null || exit 1; }
  eval "$(printf '%s' "$_creds" | node -e '
    const c = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const q = (s) => "\x27" + String(s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    console.log(`export AWS_ACCESS_KEY_ID=${q(c.AccessKeyId)} AWS_SECRET_ACCESS_KEY=${q(c.SecretAccessKey)} AWS_SESSION_TOKEN=${q(c.SessionToken)}`);')"
  unset AWS_PROFILE _creds _who
  export AINA_DEPLOY_ROLE_ACTIVE=1
fi
