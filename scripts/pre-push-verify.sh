#!/usr/bin/env bash
# Verify ONE commit with the checks CI runs, before it is pushed.
#
#   bash scripts/pre-push-verify.sh <sha> [base-ref]
#
# Why this exists: a push to main deploys, and CI's `verify` job runs first.
# Twice in two days it failed on the as-any ratchet (3431 > 3429), which only
# showed up on GitHub after the push and blocked the deploy. This runs the same
# steps locally so a push that would fail never leaves the machine.
#
# It checks the COMMIT, not the working tree: the commit is checked out into a
# temporary worktree, so another session's uncommitted edits in the shared
# checkout can neither hide a failure nor cause one.
#
# Mirrors .github/workflows/ci.yml. When ci.yml changes, change this too.
#   quality   typecheck, rbac, migrations, calc, colors, as-any, math imports,
#             unit tests, lint                         (always)
#   mobile    tsc + tests                              (only if mobile/ changed)
#   db        migrate:all on an empty scratch database, RLS coverage, DB-backed
#             vitest                                   (only if drizzle/ or src/db/ changed)
#
# Exit 0 = every step passed. Anything else blocks the push.

set -u
sha="${1:?usage: pre-push-verify.sh <sha> [base-ref]}"
base="${2:-origin/main}"

common="$(git rev-parse --git-common-dir)"
main_root="$(cd "$common/.." && pwd)"
tmp="$(mktemp -d)"
wt="$tmp/wt"
scratch_db=""
failed=()

is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0;; *) return 1;; esac; }

link_dir() { # link_dir <target> <link>
  if is_windows; then
    powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$(cygpath -w "$2")' -Target '$(cygpath -w "$1")' | Out-Null"
  else
    ln -s "$1" "$2"
  fi
}

unlink_dir() { # remove a link WITHOUT touching what it points at
  if is_windows; then cmd //c rmdir "$(cygpath -w "$1")" >/dev/null 2>&1; else rm -f "$1"; fi
}

cleanup() {
  if [ -n "$scratch_db" ]; then
    PGPASSWORD="$PGPW" "$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -qAt \
      -c "DROP DATABASE IF EXISTS \"$scratch_db\" WITH (FORCE)" >/dev/null 2>&1
  fi
  [ -L "$wt/node_modules" ] || [ -d "$wt/node_modules" ] && unlink_dir "$wt/node_modules"
  [ -L "$wt/mobile/node_modules" ] || [ -d "$wt/mobile/node_modules" ] && unlink_dir "$wt/mobile/node_modules"
  git worktree remove --force "$wt" >/dev/null 2>&1
  rm -rf "$tmp" 2>/dev/null
}
trap cleanup EXIT

step() { # step <label> <command...>
  local label="$1"; shift
  local t0=$SECONDS
  printf '  • %-34s' "$label"
  if out="$("$@" 2>&1)"; then
    printf 'ok   (%ds)\n' $((SECONDS - t0))
  else
    printf 'FAILED (%ds)\n' $((SECONDS - t0))
    printf '%s\n' "$out" | tail -25 | sed 's/^/      /'
    failed+=("$label")
  fi
}

echo "pre-push: verifying $(git log -1 --format='%h %s' "$sha" | cut -c1-80)"
echo "          same checks as CI, run on that exact commit"

git worktree add -q --detach "$wt" "$sha" || { echo "pre-push: cannot check out $sha"; exit 1; }
cd "$wt" || exit 1

changed="$(git diff --name-only "$base" "$sha" 2>/dev/null)"
touched() { printf '%s\n' "$changed" | grep -qE "$1"; }

# Dependencies: reuse the main checkout's, unless this commit changes them.
if touched '^(package\.json|package-lock\.json)$'; then
  echo "  (dependencies changed: running npm ci)"
  npm ci --silent >/dev/null 2>&1 || { echo "pre-push: npm ci failed"; exit 1; }
else
  [ -d "$main_root/node_modules" ] || { echo "pre-push: $main_root/node_modules is missing; run npm ci there"; exit 1; }
  link_dir "$main_root/node_modules" "$wt/node_modules"
fi

export NODE_OPTIONS="--max-old-space-size=6144"

# Cheap guards first, so the usual failure shows in seconds, not after tsc.
step "RBAC guard"              npm run -s check:rbac
step "Migration numbering"     npm run -s check:migrations
step "Calculator math"         npm run -s check:calc
step "Hardcoded colours"       npm run -s check:colors
step "as-any ratchet"          npm run -s check:asany
step "Math import guard"       npm run -s check:mathimports

# A cheap guard failed (the as-any ratchet is the usual one): say so now rather
# than make the push wait four minutes for tsc, tests and lint to say the same.
if [ "${#failed[@]}" -gt 0 ]; then
  echo
  echo "pre-push: BLOCKED. Failed: ${failed[*]}"
  echo "          Stopped early; the slower checks were not run. Nothing was pushed."
  exit 1
fi

step "Typecheck"               npx tsc --noEmit
step "Unit tests"              npm test
step "Lint"                    npm run -s lint

if touched '^mobile/'; then
  if [ -d "$main_root/mobile/node_modules" ]; then
    link_dir "$main_root/mobile/node_modules" "$wt/mobile/node_modules"
    step "Mobile typecheck"    bash -c 'cd mobile && npx tsc --noEmit'
    step "Mobile tests"        bash -c 'cd mobile && npm test -- --runInBand'
  else
    echo "  • Mobile checks               FAILED (mobile/node_modules missing in $main_root/mobile)"
    failed+=("Mobile checks")
  fi
fi

if touched '^(drizzle/|src/db/)'; then
  # Load the local DB connection the same way dev-session does.
  envfile="$main_root/.env.development.local"
  url="$(grep -E '^DATABASE_URL=' "$envfile" 2>/dev/null | head -1 | cut -d= -f2-)"
  PSQL="$(command -v psql || ls /c/Program\ Files/PostgreSQL/*/bin/psql.exe 2>/dev/null | tail -1)"
  if [ -z "$url" ] || [ -z "$PSQL" ]; then
    echo "  • Migrate + RLS + DB tests    FAILED (need a local Postgres: DATABASE_URL in $envfile and psql)"
    failed+=("DB checks (no local Postgres)")
  else
    PGUSER="$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^:]+):.*#\1#')"
    PGPW="$(printf '%s' "$url" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#')"
    PGHOST="$(printf '%s' "$url" | sed -E 's#^[a-z]+://[^@]+@([^:/]+).*#\1#')"
    PGPORT="$(printf '%s' "$url" | sed -E 's#^[a-z]+://[^@]+@[^:/]+:([0-9]+).*#\1#')"
    scratch_db="prepush_$$_$RANDOM"
    if PGPASSWORD="$PGPW" "$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -qAt -c "CREATE DATABASE \"$scratch_db\"" >/dev/null 2>&1; then
      base_url="postgres://$PGUSER:$PGPW@$PGHOST:$PGPORT/$scratch_db"
      # The app role is global to the cluster; give it the CI password so the
      # RLS suite connects as a non-superuser, as in CI.
      (
        export DATABASE_URL="$base_url" ALLOW_SYSTEM_TX=1 APP_DB_PASSWORD="ci-app-role"
        export TEST_DATABASE_URL="postgres://mfd_app:ci-app-role@$PGHOST:$PGPORT/$scratch_db"
        step "Apply migrations (empty DB)" npm run -s migrate:all
        step "RLS coverage"                npm run -s check:rls
        step "Provision app role"          node scripts/provision-app-role.mjs
        # Two workers: a dozen files running beforeAll against one database at
        # once outran the 10 s hook timeout on a laptop Postgres (CI has the
        # database to itself). Fewer in parallel, same tests, none skipped.
        step "DB-backed tests"             npx vitest run --maxWorkers=2
        # step() records failures in this subshell; hand them back by exit code.
        [ "${#failed[@]}" -eq 0 ]
      ) || failed+=("DB checks")
    else
      echo "  • Migrate + RLS + DB tests    FAILED (cannot create a scratch database on $PGHOST:$PGPORT)"
      failed+=("DB checks (cannot reach local Postgres)")
    fi
  fi
fi

echo
if [ "${#failed[@]}" -eq 0 ]; then
  echo "pre-push: all checks passed. Pushing."
  exit 0
fi
echo "pre-push: BLOCKED. Failed: ${failed[*]}"
echo "          Nothing was pushed. Fix it, commit, push again."
exit 1
