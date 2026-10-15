#!/usr/bin/env bash
# Tests for scripts/artifact-verify.sh and scripts/disk-gate.sh. No AWS, no Docker.
#   bash scripts/test-artifact-verify.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
COMMIT=$(printf 'a%.0s' $(seq 1 40)); OTHER=$(printf 'b%.0s' $(seq 1 40))
ARCH=$(uname -m); case "$ARCH" in aarch64) ARCH=arm64;; x86_64) ARCH=amd64;; esac
now() { date -u +%FT%TZ; }

mk() { # mk <dir> [overrides as node expressions on m]  -> a valid artifact dir
  local d="$1"; shift; mkdir -p "$d"; head -c 4096 /dev/urandom > "$d/image.tar.gz"
  local sha bytes; sha=$(sha256sum "$d/image.tar.gz" | cut -d' ' -f1); bytes=$(stat -c %s "$d/image.tar.gz")
  D="$d" C="$COMMIT" S="$sha" B="$bytes" A="$ARCH" N="$(now)" EXTRA="${1:-}" node -e '
    const m={schema:1,shadow:false,commit:process.env.C,ci:{conclusion:"success",runId:"123",workflow:"CI"},arch:process.env.A,
      artifact:{file:"image.tar.gz",sha256:process.env.S,bytes:Number(process.env.B)},image:{id:"sha256:abc",uncompressedBytes:1400000000},builtAt:process.env.N};
    if(process.env.EXTRA) eval(process.env.EXTRA);
    require("fs").writeFileSync(process.env.D+"/manifest.json",JSON.stringify(m,null,1));'
  echo "$sha" > "$d/.sha"
}
expect() { # expect <name> <pass|refuse> <dir> <commit> <sha256>
  local out rc; out=$(bash "$HERE/artifact-verify.sh" "$3" --commit "$4" --sha256 "$5" 2>&1); rc=$?
  if { [ "$2" = pass ] && [ $rc = 0 ]; } || { [ "$2" = refuse ] && [ $rc != 0 ]; }; then PASS=$((PASS+1)); echo "ok   $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 (rc=$rc): $out"; fi
}

mk "$T/good";            expect "valid artifact is accepted"                         pass   "$T/good" "$COMMIT" "$(cat "$T/good/.sha")"
mk "$T/c1";              expect "wrong commit is refused"                            refuse "$T/c1" "$OTHER" "$(cat "$T/c1/.sha")"
mk "$T/ci" 'm.ci.conclusion="failure"'; expect "CI not green is refused"             refuse "$T/ci" "$COMMIT" "$(cat "$T/ci/.sha")"
mk "$T/sh" 'm.shadow=true';             expect "shadow artifact is refused"          refuse "$T/sh" "$COMMIT" "$(cat "$T/sh/.sha")"
# shadow artifact: refused as a release, accepted ONLY with --allow-shadow (SHADOW=1 mode, which never switches anything)
mk "$T/sh2" 'm.shadow=true;m.ci.conclusion="shadow"'
out=$(bash "$HERE/artifact-verify.sh" "$T/sh2" --commit "$COMMIT" --sha256 "$(cat "$T/sh2/.sha")" --allow-shadow 2>&1); rc=$?
[ $rc = 0 ] && { PASS=$((PASS+1)); echo "ok   shadow artifact accepted with --allow-shadow"; } || { FAIL=$((FAIL+1)); echo "FAIL allow-shadow: $out"; }
out=$(bash "$HERE/artifact-verify.sh" "$T/sh2" --commit "$COMMIT" --sha256 "$(cat "$T/sh2/.sha")" 2>&1); rc=$?
[ $rc != 0 ] && { PASS=$((PASS+1)); echo "ok   same shadow artifact refused without the flag"; } || { FAIL=$((FAIL+1)); echo "FAIL shadow accepted as release"; }
# a NON-shadow artifact with CI not green is refused even with --allow-shadow
mk "$T/ci2" 'm.ci.conclusion="failure"'
out=$(bash "$HERE/artifact-verify.sh" "$T/ci2" --commit "$COMMIT" --sha256 "$(cat "$T/ci2/.sha")" --allow-shadow 2>&1); rc=$?
[ $rc != 0 ] && { PASS=$((PASS+1)); echo "ok   --allow-shadow does not excuse a failed CI"; } || { FAIL=$((FAIL+1)); echo "FAIL allow-shadow bypassed CI"; }
mk "$T/ar" 'm.arch="amd64x"';           expect "wrong architecture is refused"       refuse "$T/ar" "$COMMIT" "$(cat "$T/ar/.sha")"
mk "$T/old" 'm.builtAt="2020-01-01T00:00:00Z"'; expect "an old build is refused (replay)" refuse "$T/old" "$COMMIT" "$(cat "$T/old/.sha")"
mk "$T/tamper"; echo X >> "$T/tamper/image.tar.gz"; expect "file changed after the build is refused" refuse "$T/tamper" "$COMMIT" "$(cat "$T/tamper/.sha")"
# attacker swaps the file AND rewrites the manifest to match -> only the independently reported digest catches it
mk "$T/swap"; ORIG=$(cat "$T/swap/.sha"); head -c 4096 /dev/urandom > "$T/swap/image.tar.gz"
NEW=$(sha256sum "$T/swap/image.tar.gz" | cut -d' ' -f1); NB=$(stat -c %s "$T/swap/image.tar.gz")
NEW="$NEW" NB="$NB" D="$T/swap" node -e 'const f=process.env.D+"/manifest.json";const m=JSON.parse(require("fs").readFileSync(f));m.artifact.sha256=process.env.NEW;m.artifact.bytes=Number(process.env.NB);require("fs").writeFileSync(f,JSON.stringify(m))'
expect "swapped file + rewritten manifest is refused (digest from the workflow differs)" refuse "$T/swap" "$COMMIT" "$ORIG"
mkdir -p "$T/nomf"; echo x > "$T/nomf/image.tar.gz"; expect "no manifest is refused" refuse "$T/nomf" "$COMMIT" "$(printf 'c%.0s' $(seq 1 64))"
mk "$T/bad"; echo "{not json" > "$T/bad/manifest.json"; expect "corrupt manifest is refused" refuse "$T/bad" "$COMMIT" "$(cat "$T/bad/.sha")"
mk "$T/path" 'm.artifact.file="../x"'; expect "path traversal in the file name is refused" refuse "$T/path" "$COMMIT" "$(cat "$T/path/.sha")"
expect "short commit is refused" refuse "$T/good" "abc123" "$(cat "$T/good/.sha")"

# ---- disk gate (uses the real filesystem of this machine; tiny numbers so it passes, huge ones so it aborts)
out=$(bash "$HERE/disk-gate.sh" --image-bytes 1000000 --artifact-bytes 1000000 --headroom-bytes 1000 2>&1); rc=$?
[ $rc = 0 ] && { PASS=$((PASS+1)); echo "ok   disk gate passes when space is plentiful"; } || { FAIL=$((FAIL+1)); echo "FAIL disk gate pass: $out"; }
out=$(bash "$HERE/disk-gate.sh" --image-bytes 900000000000000 --artifact-bytes 1 2>&1); rc=$?
[ $rc = 3 ] && { PASS=$((PASS+1)); echo "ok   disk gate aborts (exit 3) when space is short"; } || { FAIL=$((FAIL+1)); echo "FAIL disk gate abort: rc=$rc $out"; }
out=$(bash "$HERE/disk-gate.sh" --image-bytes x --artifact-bytes 1 2>&1); rc=$?
[ $rc = 2 ] && { PASS=$((PASS+1)); echo "ok   disk gate rejects bad input"; } || { FAIL=$((FAIL+1)); echo "FAIL disk gate input: rc=$rc"; }
echo; echo "artifact-verify / disk-gate tests: $PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
