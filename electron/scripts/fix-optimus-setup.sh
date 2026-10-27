#!/usr/bin/env bash
# Fixes common optimus-manager setup failures on Fedora (and similar).
# - Restores a real /etc config if missing/stub
# - Enables RPM Fusion
# - Installs proprietary NVIDIA (akmod-nvidia)
# - Blacklists nouveau for next boot
set -euo pipefail

log() { echo "[OMEN optimus] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  log "Must run as root (pkexec)."
  exit 1
fi

SHARE_CONF="/usr/share/optimus-manager/optimus-manager.conf"
ETC_CONF="/etc/optimus-manager/optimus-manager.conf"

mkdir -p /etc/optimus-manager

if [ ! -f "$SHARE_CONF" ]; then
  log "Missing $SHARE_CONF — reinstall optimus-manager first."
  exit 2
fi

# Restore /etc config if it's missing or just a stub comment line
lines="$(grep -cve '^[[:space:]]*$' "$ETC_CONF" 2>/dev/null || echo 0)"
if [ ! -f "$ETC_CONF" ] || [ "${lines:-0}" -lt 5 ]; then
  log "Writing a usable /etc/optimus-manager/optimus-manager.conf…"
  # Prefer hybrid startup until the user picks Performance in the app.
  sed -E 's/^startup_mode=.*/startup_mode=hybrid/' "$SHARE_CONF" > "$ETC_CONF"
fi

if command -v dnf >/dev/null 2>&1; then
  FEDORA_VER="$(rpm -E %fedora 2>/dev/null || true)"
  if [ -n "$FEDORA_VER" ]; then
    log "Ensuring RPM Fusion (needed for NVIDIA drivers)…"
    dnf install -y \
      "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm" \
      "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm" \
      || true
  fi

  log "Installing proprietary NVIDIA drivers (akmod-nvidia)…"
  dnf install -y akmod-nvidia xorg-x11-drv-nvidia-cuda || dnf install -y akmod-nvidia

  log "Blacklisting nouveau for next boot…"
  cat >/etc/modprobe.d/blacklist-nouveau-omen.conf <<'EOF'
blacklist nouveau
options nouveau modeset=0
EOF

  if command -v dracut >/dev/null 2>&1; then
    log "Rebuilding initramfs (can take a minute)…"
    dracut -f --regenerate-all || dracut -f || true
  fi
else
  log "Non-dnf system: install proprietary NVIDIA drivers for your distro, then reboot."
fi

systemctl daemon-reload || true
systemctl enable optimus-manager.service 2>/dev/null || true

# Unblock optimus-manager’s GDM check (no Arch gdm-prime package on Fedora).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "${SCRIPT_DIR}/fix-gdm-prime.sh" ]; then
  log "Installing GDM Prime hooks (Fedora stand-in for gdm-prime)…"
  bash "${SCRIPT_DIR}/fix-gdm-prime.sh" || true
fi

log "Done."
log "Reboot required so NVIDIA modules load and nouveau is gone."
log "After reboot, open Graphics and pick Battery / Hybrid / Performance."
exit 0
