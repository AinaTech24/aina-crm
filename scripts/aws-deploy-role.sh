# shellcheck shell=bash
# Source this (`. scripts/aws-deploy-role.sh`) before any manual production
# deploy step. Since 2026-10-14 it signs in with IAM Identity Center: the laptop
# uses the SSO profile `aina-deploy` (permission set AinaDeploy), whose
# credentials are temporary (1 hour) and need MFA at `aws sso login`:
#   s3:PutObject on the deploy-artifacts bucket's releases/ only,
#   ssm:SendCommand on the production instance + AWS-RunShellScript only,
#   reading command results.
# Nothing else — no RDS, no IAM, no security groups, no other bucket. No
# long-lived AWS key is used or needed: sign in with
#   aws sso login --profile aina-deploy
# AINA_DEPLOY_PROFILE picks another profile name. USE_CURRENT_AWS_CREDENTIALS=1
# skips all of this (only for break-glass).
AINA_DEPLOY_PROFILE="${AINA_DEPLOY_PROFILE:-aina-deploy}"
if [ "${USE_CURRENT_AWS_CREDENTIALS:-}" != "1" ] && [ -z "${AINA_DEPLOY_ROLE_ACTIVE:-}" ]; then
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  if ! AWS_PAGER="" aws sts get-caller-identity --profile "$AINA_DEPLOY_PROFILE" >/dev/null 2>&1; then
    echo "Not signed in to AWS. Run:  aws sso login --profile $AINA_DEPLOY_PROFILE   (then retry) — not deploying."
    return 1 2>/dev/null || exit 1
  fi
  export AWS_PROFILE="$AINA_DEPLOY_PROFILE"
  export AINA_DEPLOY_ROLE_ACTIVE=1
fi
