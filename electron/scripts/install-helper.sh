#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${OMEN_RGB_REPO_URL:-https://github.com/OmenLinux/omen-rgb-keyboard.git}"
WORKDIR="${TMPDIR:-/tmp}/omen-rgb-keyboard-build"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OMEN RGB keyboard — automated clone + install"
echo "  Repo: $REPO_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkdir -p "$WORKDIR"
cd "$WORKDIR"

if [[ -d omen-rgb-keyboard/.git ]]; then
  echo "[*] Updating existing clone…"
  cd omen-rgb-keyboard
  git pull --ff-only
else
  echo "[*] Cloning repository…"
  rm -rf omen-rgb-keyboard
  git clone --depth 1 "$REPO_URL" omen-rgb-keyboard
  cd omen-rgb-keyboard
fi

echo ""
echo "[*] Run official installer (needs sudo for DKMS / systemd / sysfs)."
echo "    Press Enter to continue or Ctrl+C to cancel."
read -r

if [[ -x ./install.sh ]]; then
  sudo ./install.sh
else
  echo "[!] install.sh not found or not executable. Try: sudo make install"
  sudo make install || true
fi

echo ""
echo "[*] Done. Return to OMEN Gaming Hub — Lighting will connect when the driver is ready."
echo ""
read -r -p "Press Enter to close…" || true
