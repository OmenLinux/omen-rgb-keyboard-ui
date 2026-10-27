#!/usr/bin/env bash
# Installs optimus-manager system-wide (no terminal UI). Invoked via pkexec.
set -euo pipefail

REPO_URL="${OMEN_OPTIMUS_REPO:-https://github.com/Askannz/optimus-manager.git}"
WORKDIR="${TMPDIR:-/tmp}/omen-ui-optimus-src"
log() { echo "[OMEN optimus] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  log "Must run as root (pkexec)."
  exit 1
fi

if command -v optimus-manager >/dev/null 2>&1; then
  log "Already on PATH: $(command -v optimus-manager)"
else
  if command -v dnf >/dev/null 2>&1; then
    log "Installing build dependencies (dnf)…"
    # Fedora 44+: xrandr is its own package; glxinfo comes from glx-utils/mesa-demos.
    dnf install -y git python3 python3-setuptools python3-pip python3-wheel \
      python3-dbus xrandr glx-utils
  elif command -v apt-get >/dev/null 2>&1; then
    log "Installing build dependencies (apt)…"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || true
    apt-get install -y git python3 python3-setuptools python3-pip python3-wheel \
      python3-dbus mesa-utils x11-xserver-utils
  elif command -v pacman >/dev/null 2>&1; then
    if pacman -Si optimus-manager >/dev/null 2>&1; then
      pacman -S --needed --noconfirm optimus-manager
    elif pacman -Si optimus-manager-git >/dev/null 2>&1; then
      pacman -S --needed --noconfirm optimus-manager-git
    else
      log "AUR-only on Arch — install with: yay -S optimus-manager-git"
      exit 3
    fi
  else
    log "No supported package manager."
    exit 2
  fi

  if ! command -v optimus-manager >/dev/null 2>&1; then
    pip_install() {
      # Fedora 40+/PEP 668 often needs --break-system-packages for system Python.
      if python3 -m pip install --help 2>/dev/null | grep -q -- '--break-system-packages'; then
        python3 -m pip install --upgrade --no-warn-script-location --break-system-packages "$@"
      else
        python3 -m pip install --upgrade --no-warn-script-location "$@"
      fi
    }

    log "Ensuring setuptools is available…"
    if ! python3 -c "import setuptools" 2>/dev/null; then
      if command -v dnf >/dev/null 2>&1; then
        dnf install -y python3-setuptools python3-pip python3-wheel
      elif command -v apt-get >/dev/null 2>&1; then
        apt-get install -y python3-setuptools python3-pip python3-wheel
      fi
    fi
    if ! python3 -c "import setuptools" 2>/dev/null; then
      pip_install pip setuptools wheel
    fi
    python3 -c "import setuptools" || {
      log "Python setuptools is still missing. Tried dnf/apt and pip."
      exit 5
    }

    log "Cloning ${REPO_URL}…"
    rm -rf "${WORKDIR}"
    mkdir -p "${WORKDIR}"
    git clone --depth 1 "${REPO_URL}" "${WORKDIR}/optimus-manager"
    cd "${WORKDIR}/optimus-manager"

    log "Installing Python package…"
    if pip_install .; then
      log "Installed via pip."
    else
      python3 -c "import setuptools" 
      python3 setup.py build
      python3 setup.py install --optimize=1
    fi

    log "Installing config + systemd units…"
    install -d /usr/share/optimus-manager
    install -Dm644 optimus-manager.conf /usr/share/optimus-manager/optimus-manager.conf

    if [ -d config ]; then
      mkdir -p /etc/optimus-manager
      cp -a config/. /etc/optimus-manager/
      find /etc/optimus-manager -type f \( -name '*.sh' -o -name '*.py' \) -exec chmod 755 {} +
    fi

    # Real defaults belong in /etc (share copy is reference). Prefer hybrid until NVIDIA is ready.
    if [ -f optimus-manager.conf ]; then
      sed -E 's/^startup_mode=.*/startup_mode=hybrid/' optimus-manager.conf \
        > /etc/optimus-manager/optimus-manager.conf
    fi

    install -Dm644 systemd/optimus-manager.service \
      /usr/lib/systemd/system/optimus-manager.service
    if [ -f systemd/suspend/optimus-manager.py ]; then
      install -Dm755 systemd/suspend/optimus-manager.py \
        /usr/lib/systemd/system-sleep/optimus-manager.py
    fi

    if [ -f modules/optimus-manager.conf ]; then
      install -Dm644 modules/optimus-manager.conf \
        /usr/lib/modprobe.d/optimus-manager.conf
    fi
    if [ -f profile.d/optimus-manager.sh ]; then
      install -Dm644 profile.d/optimus-manager.sh \
        /etc/profile.d/optimus-manager.sh
    fi

    if [ -f login_managers/sddm/20-optimus-manager.conf ]; then
      install -Dm644 login_managers/sddm/20-optimus-manager.conf \
        /etc/sddm.conf.d/20-optimus-manager.conf
    fi
    if [ -f login_managers/lightdm/20-optimus-manager.conf ]; then
      install -Dm644 login_managers/lightdm/20-optimus-manager.conf \
        /etc/lightdm/lightdm.conf.d/20-optimus-manager.conf
    fi

    # Ensure CLI is visible even if setuptools used a non-PATH prefix
    if ! command -v optimus-manager >/dev/null 2>&1; then
      for cand in /usr/local/bin/optimus-manager /usr/bin/optimus-manager; do
        if [ -x "$cand" ]; then
          ln -sf "$cand" /usr/local/bin/optimus-manager 2>/dev/null || true
          break
        fi
      done
    fi
  fi
fi

if ! command -v optimus-manager >/dev/null 2>&1; then
  # setuptools may put scripts under /usr/local/bin
  export PATH="/usr/local/bin:/usr/bin:${PATH}"
fi

if ! command -v optimus-manager >/dev/null 2>&1; then
  log "Install finished but optimus-manager is still not on PATH."
  exit 4
fi

log "Enabling service…"
systemctl daemon-reload
systemctl enable --now optimus-manager.service 2>/dev/null \
  || systemctl enable --now optimus-manager

# Arch ships gdm-prime; Fedora does not. Install hook dirs so optimus-manager
# will allow mode switches under stock GDM.
if [ -L /etc/systemd/system/display-manager.service ] || [ -f /etc/systemd/system/display-manager.service ]; then
  dm="$(basename "$(readlink -f /etc/systemd/system/display-manager.service 2>/dev/null || true)" .service)"
  if [ "$dm" = "gdm" ] || [ "$dm" = "gdm3" ]; then
    log "GDM detected — installing Fedora Prime hook stand-in…"
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ -x "${SCRIPT_DIR}/fix-gdm-prime.sh" ]; then
      bash "${SCRIPT_DIR}/fix-gdm-prime.sh" || log "GDM Prime hook install had issues (you can fix it from Graphics)."
    fi
  fi
fi

log "Done. Mode: $(optimus-manager --print-mode 2>/dev/null || echo unknown)"
exit 0
