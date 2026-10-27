#!/usr/bin/env bash
# Finalizes a stuck optimus-manager state after a successful pre-start
# when the Xorg post-start hook never runs (typical on GNOME Wayland + GDM).
set -euo pipefail

STATE="/var/lib/optimus-manager/tmp/state.json"
XORG="/etc/X11/xorg.conf.d/10-optimus-manager.conf"

log() { echo "[OMEN optimus] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  log "Must run as root (pkexec)."
  exit 1
fi

mode=""
switch_id="omen-ui-repair"

if [ -f "$STATE" ]; then
  # Prefer requested_mode from a stuck pending_post / failed post state
  mode="$(python3 - <<'PY'
import json
p="/var/lib/optimus-manager/tmp/state.json"
try:
    s=json.load(open(p))
except Exception:
    raise SystemExit
t=s.get("type")
if t in ("pending_post_xorg_start", "post_xorg_start_failed", "pre_xorg_start_failed"):
    m=s.get("requested_mode") or s.get("current_mode")
    if m in ("nvidia","integrated","hybrid"):
        print(m)
    sid=s.get("switch_id") or ""
    if sid:
        open("/tmp/omen-om-switch-id","w").write(sid)
elif t == "done":
    m=s.get("current_mode")
    if m in ("nvidia","integrated","hybrid"):
        print(m)
PY
)" || true
  if [ -f /tmp/omen-om-switch-id ]; then
    switch_id="$(cat /tmp/omen-om-switch-id)"
    rm -f /tmp/omen-om-switch-id
  fi
fi

if [ -z "$mode" ] && [ -f "$XORG" ]; then
  if grep -q 'AllowNVIDIAGPUScreens' "$XORG" 2>/dev/null; then
    mode="hybrid"
  elif grep -q 'Driver "nvidia"' "$XORG" 2>/dev/null && ! grep -q 'Inactive "nvidia"' "$XORG" 2>/dev/null; then
    mode="nvidia"
  else
    mode="integrated"
  fi
fi

if [ -z "$mode" ]; then
  # Fall back to conf startup_mode
  if [ -f /etc/optimus-manager/optimus-manager.conf ]; then
    mode="$(sed -n 's/^startup_mode=//p' /etc/optimus-manager/optimus-manager.conf | head -1 | tr -d '[:space:]')"
  fi
fi

case "$mode" in
  nvidia|integrated|hybrid) ;;
  *) mode="hybrid" ;;
esac

mkdir -p /var/lib/optimus-manager/tmp
python3 - <<PY
import json
state = {
  "type": "done",
  "switch_id": $(printf '%s' "$switch_id" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "current_mode": "$mode",
}
path = "$STATE"
with open(path, "w") as f:
    json.dump(state, f)
try:
    import os
    os.chmod(path, 0o666)
except Exception:
    pass
print("wrote", state)
PY

CONF="/etc/optimus-manager/optimus-manager.conf"
if [ -f "$CONF" ]; then
  # Disable auto-logout: on GNOME Wayland it is noisy and the UI already asks the user to log out.
  if grep -qE '^auto_logout=' "$CONF"; then
    sed -i 's/^auto_logout=.*/auto_logout=no/' "$CONF"
  else
    printf '\n[optimus]\nauto_logout=no\n' >> "$CONF"
  fi
  log "Set auto_logout=no in $CONF"
fi

log "Marked GPU mode as done: $mode"
log "On GNOME Wayland the Xorg post-start hook never runs — this is expected."
exit 0
