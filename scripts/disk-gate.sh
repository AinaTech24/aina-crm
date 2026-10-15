#!/usr/bin/env bash
# Pre-deploy disk safety gate. A deploy must abort BEFORE downloading or loading
# anything if the disk cannot take it, leaving the serving colour untouched.
#
#   scripts/disk-gate.sh --image-bytes N --artifact-bytes N [--path /] [--headroom-bytes N] [--dry-run]
#
# Required free space is CALCULATED, not guessed:
#
#   required = artifact download            (kept on disk until its SHA-256 is verified)
#            + 1.25 x uncompressed image    (docker load extracts every layer; 25% for
#                                            metadata and the temporary layer copy)
#            + 256 MB                       (migrate + the new colour's writable layers and logs)
#   gate     = required + HEADROOM
#
# HEADROOM = 5.5 GB: the LARGEST disk excursion one deploy was measured to cause
# on this server in the last 7 days (5.5 GB, 2026-10-08, the old build-on-server
# path), so anything the new path does not account for still has room, and the
# volume (40 GB) never goes above ~85% during a deploy.
# Override with DISK_GATE_HEADROOM_BYTES only with a reason in the deploy log.
set -uo pipefail
IMG=""; ART=""; P="/"; DRY=0; HEAD="${DISK_GATE_HEADROOM_BYTES:-5905580032}"   # 5.5 GiB
while [ $# -gt 0 ]; do case "$1" in
  --image-bytes) IMG="$2"; shift 2;; --artifact-bytes) ART="$2"; shift 2;; --path) P="$2"; shift 2;;
  --headroom-bytes) HEAD="$2"; shift 2;; --dry-run) DRY=1; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
[[ "$IMG" =~ ^[0-9]+$ && "$ART" =~ ^[0-9]+$ ]] || { echo "need --image-bytes and --artifact-bytes (integers)" >&2; exit 2; }
FREE=$(df -B1 --output=avail "$P" | tail -1 | tr -d ' ')
SIZE=$(df -B1 --output=size "$P" | tail -1 | tr -d ' ')
EXTRA=$((256 * 1024 * 1024))
REQ=$(( ART + IMG * 125 / 100 + EXTRA ))
GATE=$(( REQ + HEAD ))
gb() { awk -v b="$1" 'BEGIN{printf "%.2f GB", b/1073741824}'; }
echo "DISK GATE  CURRENT FREE SPACE : $(gb "$FREE") of $(gb "$SIZE")"
echo "DISK GATE  REQUIRED FREE SPACE: $(gb "$GATE")  (= need $(gb "$REQ") + headroom $(gb "$HEAD"))"
echo "DISK GATE  ARTIFACT SIZE      : $(gb "$ART")"
echo "DISK GATE  IMAGE SIZE         : $(gb "$IMG") uncompressed (loading needs 1.25 x = $(gb $(( IMG * 125 / 100 ))))"
echo "DISK GATE  SAFETY HEADROOM    : $(gb "$HEAD")"
if [ "$FREE" -ge "$GATE" ]; then
  echo "disk gate: PASS (would leave $(gb $((FREE - REQ))) free after loading)"; exit 0
fi
echo "disk gate: ABORT — only $(gb "$FREE") free, $(gb "$GATE") needed. Nothing was downloaded or loaded; the serving colour is untouched." >&2
[ "$DRY" = 1 ] && exit 0
exit 3
