# shellcheck shell=bash
# Tiny JSON reader for the deploy scripts. The production host has jq and python3
# but NO node; the laptop and CI have node. The first backend that actually RUNS is
# used (a Windows "python3" stub that only prints an install hint is skipped).
#   jvalid <file>            exit 0 if the file is valid JSON
#   jfield <file> <a.b.c>    prints the value at that path ("" if absent or null)
_JB=""
_jbackend() {
  [ -n "$_JB" ] && return 0
  if command -v jq >/dev/null 2>&1 && jq -n 1 >/dev/null 2>&1; then _JB=jq
  elif command -v python3 >/dev/null 2>&1 && python3 -c 'import json' >/dev/null 2>&1; then _JB=py
  elif command -v node >/dev/null 2>&1 && node -e '1' >/dev/null 2>&1; then _JB=node
  else echo "no JSON tool (jq, python3 or node) available" >&2; return 1; fi
}
jvalid() {
  _jbackend || return 1
  case "$_JB" in
    jq) jq -e . "$1" >/dev/null 2>&1;;
    py) python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" >/dev/null 2>&1;;
    node) node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1" >/dev/null 2>&1;;
  esac
}
jfield() {
  _jbackend || return 1
  case "$_JB" in
    jq) jq -r --arg p "$2" 'getpath($p|split("."))? | if .==null then "" else tostring end' "$1" 2>/dev/null;;
    py) python3 - "$1" "$2" <<'PY' 2>/dev/null
import json, sys
v = json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."):
    v = v.get(k) if isinstance(v, dict) else None
    if v is None: break
print("" if v is None else (str(v).lower() if isinstance(v, bool) else v))
PY
    ;;
    node) node -e 'let v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split(".")){v=(v&&typeof v==="object")?v[k]:undefined;if(v===undefined||v===null)break}console.log(v===undefined||v===null?"":String(v))' "$1" "$2" 2>/dev/null;;
  esac
}
