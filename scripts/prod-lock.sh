#!/usr/bin/env bash
# Production change lock — ONE production-changing change at a time (the
# firm's change-control rule of 2026-10-09). Lives on the production box,
# because every session, the GitHub deploy and the laptop all reach the box
# (SSM). Installed as ~/prod-lock.sh by scripts/ssm-deploy.sh on every deploy.
#
#   bash ~/prod-lock.sh status
#   bash ~/prod-lock.sh acquire "<change description>" "<session name>" [wait-seconds]
#   bash ~/prod-lock.sh release "<session name>" "<result, e.g. PASS: health ok>"
#   bash ~/prod-lock.sh held-by "<session name>"   # exit 0 if that session holds it
#   bash ~/prod-lock.sh history [n]
#   bash ~/prod-lock.sh force-release "<who is breaking it and why>"   # humans only
#
# From the laptop: scripts/prod-change.sh status|acquire|release (wraps this
# through SSM). A deploy (ssm-deploy.sh) and a rollback (rollback-bluegreen.sh)
# take it themselves. An AWS change made from a laptop (RDS, security groups,
# restarts) must take it first and release it only after its health checks pass.
#
# Atomic: `mkdir` either creates the directory or fails, so two sessions can
# never both hold it. Exit codes: 0 ok · 3 held by someone else · 4 not the
# holder · 2 usage.
set -uo pipefail

DIR="${PROD_LOCK_DIR:-$HOME/.prod-change-lock}"
LOG="${PROD_LOCK_LOG:-$HOME/prod-change.log}"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
clean() { printf '%s' "$1" | tr -d '\r\n\t' | cut -c1-200; }

holder() {
  [ -d "$DIR" ] || return 1
  printf 'HELD by session "%s" since %s — %s\n' \
    "$(cat "$DIR/session" 2>/dev/null)" "$(cat "$DIR/started" 2>/dev/null)" "$(cat "$DIR/description" 2>/dev/null)"
}

cmd="${1:-status}"
case "$cmd" in
  status)
    holder || echo "FREE"
    ;;
  acquire)
    desc=$(clean "${2:-}"); sess=$(clean "${3:-}"); wait_s="${4:-0}"
    [ -n "$desc" ] && [ -n "$sess" ] || { echo "usage: prod-lock.sh acquire <description> <session> [wait-seconds]"; exit 2; }
    deadline=$(( $(date +%s) + wait_s ))
    while ! mkdir "$DIR" 2>/dev/null; do
      if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "LOCK NOT ACQUIRED — $(holder)"
        echo "STOP: another change is running. Wait for it to release; never work around it."
        exit 3
      fi
      sleep 10
    done
    printf '%s' "$desc" > "$DIR/description"
    printf '%s' "$sess" > "$DIR/session"
    now > "$DIR/started"
    echo "$(now) ACQUIRE session=\"$sess\" change=\"$desc\"" >> "$LOG"
    echo "LOCK ACQUIRED by \"$sess\" at $(cat "$DIR/started") — $desc"
    ;;
  release)
    sess=$(clean "${2:-}"); result=$(clean "${3:-released}")
    [ -n "$sess" ] || { echo "usage: prod-lock.sh release <session> <result>"; exit 2; }
    [ -d "$DIR" ] || { echo "lock is already free"; exit 0; }
    if [ "$(cat "$DIR/session" 2>/dev/null)" != "$sess" ]; then
      echo "NOT RELEASED — you are not the holder. $(holder)"
      exit 4
    fi
    desc=$(cat "$DIR/description" 2>/dev/null); started=$(cat "$DIR/started" 2>/dev/null)
    rm -rf "$DIR"
    echo "$(now) RELEASE session=\"$sess\" change=\"$desc\" started=$started result=\"$result\"" >> "$LOG"
    echo "LOCK RELEASED by \"$sess\" — $result"
    ;;
  force-release)
    why=$(clean "${2:-}")
    [ -n "$why" ] || { echo "usage: prod-lock.sh force-release <who and why>"; exit 2; }
    [ -d "$DIR" ] || { echo "lock is already free"; exit 0; }
    h=$(holder); rm -rf "$DIR"
    echo "$(now) FORCE-RELEASE by=\"$why\" was: $h" >> "$LOG"
    echo "LOCK FORCE-RELEASED ($why). Was: $h"
    ;;
  held-by)
    sess=$(clean "${2:-}")
    [ -d "$DIR" ] && [ -n "$sess" ] && [ "$(cat "$DIR/session" 2>/dev/null)" = "$sess" ]
    ;;
  history)
    tail -n "${2:-20}" "$LOG" 2>/dev/null || echo "(no changes recorded yet)"
    ;;
  *)
    echo "usage: prod-lock.sh status|acquire|release|held-by|history|force-release"; exit 2
    ;;
esac
