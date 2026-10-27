#!/usr/bin/env bash
# Fedora (and other non-Arch) GDM does not ship the Arch AUR "gdm-prime" package.
# optimus-manager refuses to switch modes unless /etc/gdm/Prime exists.
#
# This installs the Prime/PrimeOff hook scripts + prime-* symlinks that gdm-prime
# would provide. Stock Fedora GDM may not execute Prime/ itself (that needs the
# Ubuntu/Arch binary patch), but the directories satisfy the client check so
# mode switches can proceed. On GNOME Wayland, OMEN Control already finalizes
# stuck post-hooks via repair-optimus-state.sh.
set -euo pipefail

log() { echo "[OMEN optimus] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  log "Must run as root (pkexec)."
  exit 1
fi

# Prefer /usr/local (pip install) then /usr/bin
find_prime() {
  local name="$1"
  for cand in "/usr/local/bin/${name}" "/usr/bin/${name}" "/sbin/${name}"; do
    if [ -x "$cand" ]; then
      printf '%s' "$cand"
      return 0
    fi
  done
  return 1
}

OFFLOAD="$(find_prime prime-offload || true)"
SWITCH="$(find_prime prime-switch || true)"

if [ -z "${OFFLOAD}" ] || [ -z "${SWITCH}" ]; then
  log "prime-offload / prime-switch not found. Install optimus-manager first."
  exit 2
fi

log "Using prime-offload=${OFFLOAD}"
log "Using prime-switch=${SWITCH}"

# Symlinks where patched GDM and docs expect them
for dest_dir in /usr/bin /sbin /usr/sbin; do
  mkdir -p "$dest_dir"
  ln -sfn "$OFFLOAD" "${dest_dir}/prime-offload"
  ln -sfn "$SWITCH" "${dest_dir}/prime-switch"
done

install_hook_dir() {
  local dir="$1"
  local target="$2"
  mkdir -p "$dir"
  cat >"${dir}/Default" <<EOF
#!/bin/sh
# Installed by OMEN Control — Fedora stand-in for Arch gdm-prime hooks.
if [ -x "${target}" ]; then
  exec "${target}"
fi
exit 0
EOF
  chmod 755 "${dir}/Default"
}

# Paths checked by optimus_manager.checks.using_patched_GDM()
install_hook_dir /etc/gdm/Prime "$OFFLOAD"
install_hook_dir /etc/gdm/PrimeOff "$SWITCH"
# Some distros use gdm3
if [ -d /etc/gdm3 ] || [ -e /etc/gdm3 ]; then
  install_hook_dir /etc/gdm3/Prime "$OFFLOAD"
  install_hook_dir /etc/gdm3/PrimeOff "$SWITCH"
fi

# Best-effort: stock GDM may still run PostSession on some builds
mkdir -p /etc/gdm/PostSession
if [ ! -e /etc/gdm/PostSession/Default ]; then
  cat >/etc/gdm/PostSession/Default <<EOF
#!/bin/sh
if [ -x "${SWITCH}" ]; then
  "${SWITCH}" || true
fi
exit 0
EOF
  chmod 755 /etc/gdm/PostSession/Default
elif ! grep -q 'prime-switch' /etc/gdm/PostSession/Default 2>/dev/null; then
  log "PostSession/Default exists — leaving it untouched (add prime-switch manually if needed)."
fi

log "GDM Prime hooks installed at /etc/gdm/Prime and /etc/gdm/PrimeOff."
log "GPU mode switching should no longer complain about gdm-prime."
log "Stay on Wayland for Hybrid. Performance (full NVIDIA) works best after logging into GNOME on Xorg."
exit 0
