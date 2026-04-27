#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${OMEN_RGB_REPO_URL:-https://github.com/OmenLinux/omen-rgb-keyboard.git}"
WORKDIR="${TMPDIR:-/tmp}/omen-rgb-keyboard-ui"

log() { echo "[omen-ui] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  log "This installer must run as root (use the Install button in OMEN Gaming Hub)."
  exit 1
fi

install_debian() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  if apt-get install -y "linux-headers-$(uname -r)" build-essential dkms git libasound2t64 2>/dev/null; then
    return 0
  fi
  apt-get install -y "linux-headers-$(uname -r)" build-essential dkms git libasound2
}

install_fedora() {
  dnf install -y "kernel-devel-$(uname -r)" kernel-headers dkms git alsa-lib-devel gcc make 2>/dev/null || \
  dnf install -y kernel-devel kernel-headers dkms git alsa-lib-devel gcc make
}

install_arch() {
  pacman -Sy --needed --noconfirm linux-headers base-devel dkms git alsa-lib
}

if command -v apt-get >/dev/null 2>&1; then
  log "Installing build prerequisites (Debian/Ubuntu)…"
  install_debian || log "Warning: some packages may be missing — continuing."
elif command -v dnf >/dev/null 2>&1; then
  log "Installing build prerequisites (Fedora)…"
  install_fedora || log "Warning: some packages may be missing — continuing."
elif command -v pacman >/dev/null 2>&1; then
  log "Installing build prerequisites (Arch)…"
  install_arch || log "Warning: some packages may be missing — continuing."
else
  log "Unknown package manager — ensure kernel headers, gcc, make, dkms, and git are installed."
fi

modprobe -r hp_wmi 2>/dev/null || true
if ! grep -q "blacklist hp_wmi" /etc/modprobe.d/blacklist-hp-wmi-omenrgb.conf 2>/dev/null; then
  echo "blacklist hp_wmi" >> /etc/modprobe.d/blacklist-hp-wmi-omenrgb.conf
fi

mkdir -p "$WORKDIR"
cd "$WORKDIR"
if [ -d omen-rgb-keyboard/.git ]; then
  cd omen-rgb-keyboard
  git pull --ff-only
else
  rm -rf omen-rgb-keyboard
  git clone --depth 1 "$REPO_URL" omen-rgb-keyboard
  cd omen-rgb-keyboard
fi

chmod +x install.sh 2>/dev/null || true
if [ -x ./install.sh ]; then
  ./install.sh
else
  log "install.sh missing — try: make install"
  make install
fi

log "Done. Return to OMEN Gaming Hub — Lighting will connect when the driver is ready."
