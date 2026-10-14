#!/usr/bin/env bash
# Production refuses an artifact it cannot prove. Runs ON THE BOX (and in tests,
# with no AWS or Docker involved).
#
#   scripts/artifact-verify.sh <dir> --commit <40-hex sha> --sha256 <expected image artifact sha256>
#
# <dir> holds what the build job published for ONE commit:
#   manifest.json   what was built, from which commit, whether CI passed, and the digests
#   image.tar.gz    the docker image (docker save | gzip)
#
# An artifact is accepted only if EVERY check below holds. Any failure exits
# non-zero with the reason, BEFORE anything is loaded into Docker.
#
#  1. manifest.json exists and parses, schema 1
#  2. it is not a shadow/test artifact
#  3. manifest.commit equals the commit the caller asked to deploy (full 40-hex)
#  4. CI passed for that commit: manifest.ci.conclusion == success (the build job
#     runs only `needs: verify`, so a red CI never produces a manifest)
#  5. the architecture matches this machine
#  6. the artifact file's size and SHA-256, recomputed here, equal the manifest
#  7. ...and equal the SHA-256 the caller passed independently (from the workflow
#     that built it), so a swapped file AND a rewritten manifest still fail
#  8. it is not older than ARTIFACT_MAX_AGE_DAYS (default 14): no replaying an
#     old build as if it were current
set -uo pipefail
DIR="${1:?usage: artifact-verify.sh <dir> --commit <sha> --sha256 <hex>}"; shift
COMMIT=""; WANT_SHA256=""; ALLOW_SHADOW=0
while [ $# -gt 0 ]; do case "$1" in --commit) COMMIT="$2"; shift 2;; --sha256) WANT_SHA256="$2"; shift 2;; --allow-shadow) ALLOW_SHADOW=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
MAXAGE="${ARTIFACT_MAX_AGE_DAYS:-14}"
fail() { echo "ARTIFACT REFUSED: $*" >&2; exit 1; }
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]       || fail "--commit must be a full 40-hex commit sha"
[[ "$WANT_SHA256" =~ ^[0-9a-f]{64}$ ]]  || fail "--sha256 must be a 64-hex digest"
MF="$DIR/manifest.json"
[ -f "$MF" ] || fail "no manifest.json in $DIR"

# shellcheck source=lib/json.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/json.sh"
jvalid "$MF" || fail "manifest.json is not valid JSON"
get() { case "$1" in
  SCHEMA) jfield "$MF" schema;; SHADOW) jfield "$MF" shadow;; COMMIT) jfield "$MF" commit;; CI) jfield "$MF" ci.conclusion;; CIRUN) jfield "$MF" ci.runId;;
  ARCH) jfield "$MF" arch;; FILE) jfield "$MF" artifact.file;; SHA256) jfield "$MF" artifact.sha256;; BYTES) jfield "$MF" artifact.bytes;;
  CREATED) jfield "$MF" builtAt;; IMAGEID) jfield "$MF" image.id;; PARSE) echo ok;; esac; }
[ "$(get PARSE)" = ok ]                 || fail "manifest.json is not valid JSON"
[ "$(get SCHEMA)" = 1 ]                 || fail "unsupported manifest schema '$(get SCHEMA)'"
# A shadow artifact is accepted ONLY with --allow-shadow (artifact-deploy.sh passes it
# only in SHADOW=1 mode, which loads the image and stops: nothing is ever switched).
if [ "$(get SHADOW)" = true ] && [ "$ALLOW_SHADOW" != 1 ]; then fail "this is a SHADOW (test) artifact, not a release"; fi
[ "$(get COMMIT)" = "$COMMIT" ]         || fail "manifest commit '$(get COMMIT)' is not the requested commit '$COMMIT'"
if [ "$ALLOW_SHADOW" = 1 ] && [ "$(get SHADOW)" = true ]; then :; else [ "$(get CI)" = success ] || fail "CI did not pass for this commit (manifest says '$(get CI)')"; fi
[ -n "$(get CIRUN)" ]                   || fail "manifest has no CI run id"
want_arch=$(uname -m); case "$want_arch" in aarch64|arm64) want_arch=arm64;; x86_64) want_arch=amd64;; esac
have_arch=$(get ARCH); case "$have_arch" in aarch64|arm64) have_arch=arm64;; x86_64) have_arch=amd64;; esac
[ "$have_arch" = "$want_arch" ]         || fail "built for $have_arch but this machine is $want_arch"
FILE="$DIR/$(get FILE)"
[ -n "$(get FILE)" ] && [ -f "$FILE" ]  || fail "artifact file '$(get FILE)' is missing"
case "$(get FILE)" in */*|..*) fail "artifact file name must be a bare file name";; esac
[ "$(stat -c %s "$FILE")" = "$(get BYTES)" ] || fail "artifact size $(stat -c %s "$FILE") != manifest $(get BYTES)"
ACTUAL=$(sha256sum "$FILE" | cut -d' ' -f1)
[ "$ACTUAL" = "$(get SHA256)" ]         || fail "artifact SHA-256 $ACTUAL != manifest $(get SHA256)"
[ "$ACTUAL" = "$WANT_SHA256" ]          || fail "artifact SHA-256 $ACTUAL != the digest the workflow reported $WANT_SHA256"
CREATED=$(get CREATED); if [ -n "$CREATED" ]; then
  age=$(( ( $(date -u +%s) - $(date -u -d "$CREATED" +%s 2>/dev/null || echo 0) ) / 86400 ))
  [ "$age" -le "$MAXAGE" ] || fail "artifact is $age days old (limit $MAXAGE)"
else fail "manifest has no builtAt"; fi
echo "ARTIFACT VERIFIED: commit=$COMMIT ci=success(run $(get CIRUN)) sha256=$ACTUAL bytes=$(get BYTES) image=$(get IMAGEID)"
