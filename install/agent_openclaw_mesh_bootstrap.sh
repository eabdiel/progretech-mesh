#!/usr/bin/env bash
set -euo pipefail

# ProgreTech Mesh — agent-operated OpenClaw bootstrap
#
# Intended to be run by the agent under its existing local authorization policy.
# It never requires the human user to log into the workstation.
#
# Non-interference rule:
# - stage first
# - wait until OpenClaw reports no active/running session
# - only then activate plugin and restart Gateway
# - never force a restart while work is active

OPENCLAW="${OPENCLAW:-$HOME/.openclaw/bin/openclaw}"
ROOT="${MESH_PACKAGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PLUGIN_SRC="${MESH_PLUGIN_STAGED_DIR:-$ROOT/openclaw-plugin-progretech-mesh}"
EXT_ROOT="${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}"
PLUGIN_DST="$EXT_ROOT/progretech-mesh"
STATE="${MESH_AGENT_STATE_DIR:-$HOME/.progretech-mesh}"
LOG_DIR="$STATE/logs"
STATUS_FILE="$STATE/openclaw-bootstrap-status.json"

mkdir -p "$LOG_DIR" "$EXT_ROOT"
chmod 700 "$STATE" "$LOG_DIR" 2>/dev/null || true

log() {
  printf '[%s] %s\n' "$(date -Is 2>/dev/null || date)" "$*" | tee -a "$LOG_DIR/openclaw-bootstrap.log"
}

write_status() {
  local state="$1"
  local detail="$2"
  python3 - "$STATUS_FILE" "$state" "$detail" <<'PY'
import json, pathlib, sys, datetime
p=pathlib.Path(sys.argv[1])
p.parent.mkdir(parents=True, exist_ok=True)
tmp=p.with_suffix(".tmp")
tmp.write_text(json.dumps({
    "state": sys.argv[2],
    "detail": sys.argv[3],
    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, indent=2), encoding="utf-8")
tmp.replace(p)
try:
    p.chmod(0o600)
except OSError:
    pass
PY
}

if [ ! -x "$OPENCLAW" ]; then
  write_status "error" "OpenClaw executable not found"
  log "ERROR: OpenClaw executable not found: $OPENCLAW"
  exit 2
fi

if [ ! -f "$PLUGIN_SRC/openclaw.plugin.json" ] || [ ! -f "$PLUGIN_SRC/index.js" ]; then
  write_status "error" "Mesh OpenClaw plugin package is incomplete"
  log "ERROR: plugin package incomplete: $PLUGIN_SRC"
  exit 3
fi

VERSION="$("$OPENCLAW" --version 2>/dev/null | head -n1 || true)"
log "Detected: ${VERSION:-unknown OpenClaw version}"

# Stage atomically. This copies code only; it does not change the running Gateway.
STAGE="$EXT_ROOT/.progretech-mesh.stage.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -a "$PLUGIN_SRC/." "$STAGE/"
rm -rf "$PLUGIN_DST.prev"
if [ -d "$PLUGIN_DST" ]; then
  mv "$PLUGIN_DST" "$PLUGIN_DST.prev"
fi
mv "$STAGE" "$PLUGIN_DST"
write_status "staged" "Mesh plugin staged; waiting for OpenClaw to become idle"
log "Mesh plugin staged at $PLUGIN_DST"
log "No Gateway restart has occurred."

# Detect active agent/session work. Unknown/parsing failures are treated as busy.
openclaw_idle() {
  local raw
  if ! raw="$("$OPENCLAW" sessions --all-agents --json 2>/dev/null)"; then
    return 1
  fi
  python3 - <<'PY' <<<"$raw"
import json, sys
try:
    data=json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
busy={"running","processing","active","starting","queued","waiting_for_tool","tool_running"}
for s in data.get("sessions", []):
    status=str(s.get("status") or "").strip().lower()
    if status in busy:
        raise SystemExit(1)
raise SystemExit(0)
PY
}

# The enrollment request itself may be executing inside a Telegram turn.
# Let that turn finish and then require three consecutive idle observations.
write_status "waiting_for_idle" "Waiting for current OpenClaw work to finish"
log "Waiting for OpenClaw to become idle before activation."
sleep "${MESH_BOOTSTRAP_INITIAL_DELAY_SECONDS:-10}"

stable=0
while [ "$stable" -lt 3 ]; do
  if openclaw_idle; then
    stable=$((stable + 1))
    log "Idle check $stable/3 passed."
  else
    stable=0
    log "OpenClaw is busy or status is uncertain; leaving it untouched."
  fi
  sleep "${MESH_BOOTSTRAP_IDLE_POLL_SECONDS:-5}"
done

write_status "activating" "OpenClaw idle; enabling Mesh integration"
log "OpenClaw remained idle across three checks. Activating Mesh."

# Enabling an already-staged plugin is a policy/config action. It is done only
# after the idle gate above. Capability consent is explicit for this trusted
# development package.
"$OPENCLAW" plugins enable progretech-mesh --accept-capabilities >>"$LOG_DIR/openclaw-bootstrap.log" 2>&1 || {
  # Some builds discover local extensions as already enabled. Verify before failing.
  if ! "$OPENCLAW" plugins list --json 2>/dev/null | grep -q '"progretech-mesh"'; then
    write_status "error" "Could not enable/discover progretech-mesh"
    log "ERROR: plugin could not be enabled/discovered."
    exit 4
  fi
}

# Re-check immediately before restart. Never use --force or bounded safe restart.
if ! openclaw_idle; then
  write_status "waiting_for_idle" "New work appeared before restart; activation deferred"
  log "New OpenClaw work appeared before restart; returning to idle wait."
  stable=0
  while [ "$stable" -lt 3 ]; do
    if openclaw_idle; then
      stable=$((stable + 1))
    else
      stable=0
    fi
    sleep "${MESH_BOOTSTRAP_IDLE_POLL_SECONDS:-5}"
  done
fi

log "Restarting Gateway now that OpenClaw is idle."
"$OPENCLAW" gateway restart --wait 30s >>"$LOG_DIR/openclaw-bootstrap.log" 2>&1

# Verification is read-only.
write_status "verifying" "Gateway restarted; verifying Mesh runtime and Telegram"
log "Verifying plugin runtime."
"$OPENCLAW" plugins inspect progretech-mesh --runtime --json >"$LOG_DIR/progretech-mesh-runtime.json" 2>&1
"$OPENCLAW" channels status --probe >"$LOG_DIR/channel-probe.txt" 2>&1 || true
"$OPENCLAW" health --verbose >"$LOG_DIR/openclaw-health.txt" 2>&1 || true

if grep -qi 'telegram.*\(ok\|works\|connected\)' "$LOG_DIR/channel-probe.txt"; then
  telegram="healthy"
else
  telegram="check-required"
fi

write_status "ready" "Mesh OpenClaw plugin active; Telegram status: $telegram"
log "Mesh OpenClaw bootstrap complete. Telegram: $telegram"
log "Status file: $STATUS_FILE"
