#!/usr/bin/env bash
set -euo pipefail

# ProgreTech Mesh OpenClaw self-bootstrap helper
# Intended to be fetched/executed by the agent itself from a PTM1-directed enrollment flow.
# It never grants privileges and never installs while OpenClaw reports active work.

OPENCLAW="${OPENCLAW:-$(command -v openclaw || true)}"
PACKAGE_URL="${MESH_PLUGIN_PACKAGE_URL:-}"
EXPECTED_SHA256="${MESH_PLUGIN_SHA256:-3e22b589fdb8409cef680e49cd2f34f4a401b9fb04a171a5c9f6f81cbd618271}"
WORK="${MESH_BOOTSTRAP_WORK_DIR:-${XDG_RUNTIME_DIR:-/tmp}/progretech-mesh-enroll}"
ARCHIVE="$WORK/progretech-mesh-openclaw.tgz"

fail() {
  printf 'Mesh enrollment bootstrap: %s\n' "$*" >&2
  exit 1
}

[ -n "$OPENCLAW" ] || fail "OpenClaw executable not found"
[ -n "$PACKAGE_URL" ] || fail "MESH_PLUGIN_PACKAGE_URL is required"

mkdir -p "$WORK"
chmod 700 "$WORK" 2>/dev/null || true

case "$PACKAGE_URL" in
  https://*) ;;
  http://127.0.0.1:*|http://localhost:*)
    [ "${MESH_ALLOW_INSECURE_PACKAGE_URL:-0}" = "1" ] || fail "HTTPS is required"
    ;;
  *) fail "HTTPS is required" ;;
esac

"$OPENCLAW" --version

python3 - "$PACKAGE_URL" "$ARCHIVE" <<'PY'
import sys
from urllib.request import Request, urlopen
url, out = sys.argv[1], sys.argv[2]
req = Request(url, headers={"User-Agent":"ProgreTech-Mesh-Agent/1","Accept":"application/gzip"})
with urlopen(req, timeout=30) as r:
    data = r.read(8*1024*1024 + 1)
if len(data) > 8*1024*1024:
    raise SystemExit("package exceeds 8 MiB limit")
open(out, "wb").write(data)
PY
chmod 600 "$ARCHIVE" 2>/dev/null || true

ACTUAL="$(python3 - "$ARCHIVE" <<'PY'
import hashlib, sys
h=hashlib.sha256()
with open(sys.argv[1],"rb") as f:
    for b in iter(lambda:f.read(1024*1024), b""):
        h.update(b)
print(h.hexdigest())
PY
)"
[ "$ACTUAL" = "$EXPECTED_SHA256" ] || fail "SHA-256 mismatch; refusing installation"

# Validate archive shape before handing it to OpenClaw.
python3 - "$ARCHIVE" <<'PY'
import tarfile, sys, json
from pathlib import Path
p=sys.argv[1]
with tarfile.open(p, "r:gz") as tf:
    members=tf.getmembers()
    for m in members:
        q=Path(m.name)
        if q.is_absolute() or ".." in q.parts or m.issym() or m.islnk() or m.isdev():
            raise SystemExit("unsafe archive member")
    names={m.name for m in members}
required={
  "progretech-mesh/openclaw.plugin.json",
  "progretech-mesh/package.json",
  "progretech-mesh/index.js",
}
if not required.issubset(names):
    raise SystemExit("required plugin files missing")
PY

# A failure to determine state counts as busy/unsafe.
is_idle() {
  "$OPENCLAW" sessions --all-agents --json 2>/dev/null | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: raise SystemExit(1)
busy={"running","processing","active","starting","queued","waiting_for_tool","tool_running"}
for s in d.get("sessions",[]):
    if str(s.get("status") or "").strip().lower() in busy:
        raise SystemExit(1)
'
}

printf 'Package downloaded and verified. Waiting for OpenClaw to become idle.\n'
stable=0
while [ "$stable" -lt 3 ]; do
  if is_idle; then
    stable=$((stable+1))
  else
    stable=0
  fi
  sleep 5
done

# Re-check immediately before the supported managed installation.
is_idle || fail "OpenClaw became busy; installation deferred"

# Supported managed archive installation.
"$OPENCLAW" plugins install "$ARCHIVE" --force --accept-capabilities

"$OPENCLAW" plugins inspect progretech-mesh --runtime --json
"$OPENCLAW" channels status --probe

printf 'Mesh OpenClaw adapter installed and existing channels probed.\n'
