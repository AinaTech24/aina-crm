#!/usr/bin/env bash
# Shadow build + measurement of the app image. Runs on a GitHub ARM64 runner.
# SHADOW: builds and measures only. No AWS, no deploy, no production contact.
#
#   scripts/image-shadow-measure.sh            # new image (Dockerfile) only
#   BUILD_OLD=1 scripts/image-shadow-measure.sh  # also builds main's Dockerfile as the baseline
#
# Output: METRIC key=value lines, a markdown summary in $GITHUB_STEP_SUMMARY, and
# ./out/{image.tar.gz,image.tar.zst,manifest.json} (the packaged artifact).
set -uo pipefail
OUT="$PWD/out"; mkdir -p "$OUT"
SUM="${GITHUB_STEP_SUMMARY:-/dev/null}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
ARGS=(--build-arg NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-https://crm.ainatech.in}"
      --build-arg NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://crm.ainatech.in}"
      --build-arg NEXT_PUBLIC_S3_PUBLIC_URL="${NEXT_PUBLIC_S3_PUBLIC_URL:-https://crm.ainatech.in}"
      --build-arg BUILD_GIT_SHA="$SHA")
m() { echo "METRIC $1=$2"; echo "| $1 | $2 |" >> "$SUM"; }
hr() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 B"; }
secs() { echo $(( $(date +%s) - $1 )); }
{ echo "## Shadow image build — $SHA"; echo "| metric | value |"; echo "|---|---|"; } >> "$SUM"

echo "=== runner"; nproc; free -m | head -2; df -h / | tail -1; uname -m
m runner_arch "$(uname -m)"; m runner_vcpu "$(nproc)"; m runner_ram_mb "$(free -m | awk '/Mem:/{print $2}')"

# Largest layer of an image, from `docker history` (SI units like Docker prints them).
largest_layer() {
  docker history --no-trunc --format '{{.Size}}|{{.CreatedBy}}' "$1" | awk -F'|' '
    function tob(s,  n,u){ n=s+0; u=s; gsub(/[0-9.]/,"",u); if(u=="GB")return n*1e9; if(u=="MB")return n*1e6; if(u=="kB")return n*1e3; return n }
    { b=tob($1); if (b>max) { max=b; what=substr($2,1,70) } } END { printf "%.0f|%s", max, what }'
}

# ---------------------------------------------------------------- OLD (baseline)
if [ "${BUILD_OLD:-0}" = 1 ]; then
  echo "=== baseline: main's Dockerfile"
  git show origin/main:Dockerfile > Dockerfile.old
  t=$(date +%s)
  docker buildx build --load -f Dockerfile.old -t shadow-old "${ARGS[@]}" . 2>&1 | tail -5
  m old_build_seconds "$(secs $t)"
  m old_image_bytes "$(docker image inspect shadow-old --format '{{.Size}}')"
  IFS='|' read -r LB LW <<<"$(largest_layer shadow-old)"
  m old_largest_layer_bytes "$LB"; m old_largest_layer "$LW"
  t=$(date +%s); docker save shadow-old | gzip -6 > "$OUT/old.tar.gz"; m old_targz_bytes "$(stat -c %s "$OUT/old.tar.gz")"; m old_gzip_seconds "$(secs $t)"; rm -f "$OUT/old.tar.gz"
  docker image rm -f shadow-old >/dev/null 2>&1; docker builder prune -af >/dev/null 2>&1
fi

# ---------------------------------------------------------------- NEW: cold build
echo "=== new image: cold build"
t=$(date +%s)
docker buildx build --load -f Dockerfile -t shadow-new "${ARGS[@]}" . 2>&1 | tail -8
RC=${PIPESTATUS[0]}
[ "$RC" != 0 ] && { echo "BUILD FAILED"; exit 1; }
m new_build_seconds_cold "$(secs $t)"
m new_image_bytes "$(docker image inspect shadow-new --format '{{.Size}}')"
IFS='|' read -r LB LW <<<"$(largest_layer shadow-new)"
m new_largest_layer_bytes "$LB"; m new_largest_layer "$LW"
echo "--- layers (size | created-by)"; docker history --format '{{.Size}}|{{.CreatedBy}}' shadow-new | cut -c1-110 | head -16
m new_layer_list "$(docker history --format '{{.Size}}' shadow-new | grep -v '^0B$' | tr '\n' ' ')"

# ---------------------------------------------------------------- packaging (what a deploy would download)
echo "=== packaging: docker save | gzip / zstd"
t=$(date +%s); docker save shadow-new | gzip -6 > "$OUT/image.tar.gz"; m new_gzip_seconds "$(secs $t)"; m new_targz_bytes "$(stat -c %s "$OUT/image.tar.gz")"
if command -v zstd >/dev/null 2>&1; then
  t=$(date +%s); docker save shadow-new | zstd -T0 -3 -q -o "$OUT/image.tar.zst" -f; m new_zstd_seconds "$(secs $t)"; m new_tarzst_bytes "$(stat -c %s "$OUT/image.tar.zst")"
fi
IMGID=$(docker image inspect shadow-new --format '{{.Id}}')
m new_image_id "$IMGID"

# ---------------------------------------------------------------- registry-style layer comparison (OCI export = compressed layers)
oci() { # oci <name> -> exports compressed layers; echoes "digest size" per layer blob
  docker buildx build -f Dockerfile -o "type=oci,dest=$OUT/$1.tar,compression=gzip" "${ARGS[@]}" . >/dev/null 2>&1 || return 1
  tar -tvf "$OUT/$1.tar" | awk '/blobs\/sha256\//{n=split($6,p,"/"); print p[n], $3}' | sort
}
echo "=== registry-style comparison (compressed layers)"
oci A > "$OUT/A.blobs"                       # same source as the cold build (cached)
m registry_full_image_compressed_bytes "$(awk '$2>100000{s+=$2} END{print s+0}' "$OUT/A.blobs")"
# B: a normal release = a one-line source change
echo "// shadow-release-marker $(date +%s)" >> src/lib/utils.ts
t=$(date +%s); oci B > "$OUT/B.blobs"; m new_build_seconds_normal_release "$(secs $t)"
git checkout -q -- src/lib/utils.ts
CH_B=$(awk 'NR==FNR{a[$1]=1;next} !($1 in a) && $2>1000{s+=$2} END{print s+0}' "$OUT/A.blobs" "$OUT/B.blobs")
m registry_changed_layers_normal_release_bytes "$CH_B"
# C: dependencies change (package.json differs → install layers rebuild)
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p["x-shadow-bump"]=String(Date.now());fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
t=$(date +%s); oci C > "$OUT/C.blobs"; m new_build_seconds_dependency_change "$(secs $t)"
git checkout -q -- package.json
CH_C=$(awk 'NR==FNR{a[$1]=1;next} !($1 in a) && $2>1000{s+=$2} END{print s+0}' "$OUT/A.blobs" "$OUT/C.blobs")
m registry_changed_layers_dependency_change_bytes "$CH_C"
# storage for 5 releases in a registry = one full image + 4 normal-release deltas
FULL=$(awk '$2>100000{s+=$2} END{print s+0}' "$OUT/A.blobs")
m registry_storage_5_releases_bytes "$(( FULL + 4 * CH_B ))"
rm -f "$OUT"/A.tar "$OUT"/B.tar "$OUT"/C.tar

# ---------------------------------------------------------------- manifest (ties the artifact to commit + digest)
SHA256=$(sha256sum "$OUT/image.tar.gz" | cut -d' ' -f1)
cat > "$OUT/manifest.json" <<EOF
{ "commit": "$SHA", "imageId": "$IMGID", "artifact": "image.tar.gz", "artifactSha256": "$SHA256",
  "artifactBytes": $(stat -c %s "$OUT/image.tar.gz"), "builtAt": "$(date -u +%FT%TZ)", "arch": "$(uname -m)",
  "workflowRun": "${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-0}", "shadow": true }
EOF
cat "$OUT/manifest.json"

# ---------------------------------------------------------------- smoke tests on the exact image
echo "=== smoke tests"
bash scripts/image-smoke.sh shadow-new "$SHA"; SMOKE=$?
m smoke_exit_code "$SMOKE"
exit "$SMOKE"
