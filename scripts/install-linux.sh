#!/bin/sh
# Linux installer (also used on macOS for Docker verification only).
# Normally invoked by install.sh; can be run directly from the repo root.
# Missing Docker/Compose/curl packages are installed with the system package
# manager (sudo may prompt). Set RELATIVITY_SKIP_PACKAGE_INSTALL=1 to disable.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/install-common.sh"

docker_daemon_hint() {
  if [ "$(uname -s)" = Linux ]; then
    echo "Start it with:  sudo systemctl start docker" >&2
    if [ "$(id -u)" -ne 0 ]; then
      echo "If your user is not in the docker group: sudo usermod -aG docker $(id -un) (then log out/in)" >&2
    fi
  else
    echo "Start Docker Desktop and re-run: bash install.sh" >&2
  fi
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

prepare_sudo() {
  if [ "$(id -u)" -eq 0 ]; then return 0; fi
  if ! command_exists sudo; then
    echo "sudo is required to install the missing packages." >&2
    return 1
  fi
  sudo -v || return 1
}

detect_package_manager() {
  DISTRO_ID=
  DISTRO_LIKE=
  if [ -r /etc/os-release ]; then
    # /etc/os-release is shell assignments (KEY="value"), safe to source.
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO_ID=${ID:-}
    DISTRO_LIKE=${ID_LIKE:-}
  fi

  case " $DISTRO_ID $DISTRO_LIKE " in
    *ubuntu* | *debian*)
      PKG_MANAGER=apt
      DOCKER_PKG=docker.io
      # Docker's own repo provides docker-compose-plugin; plain Debian/Ubuntu
      # ship the standalone v2 package instead.
      COMPOSE_PKG=docker-compose-plugin
      if command_exists apt-cache && ! apt-cache show "$COMPOSE_PKG" >/dev/null 2>&1; then
        COMPOSE_PKG=docker-compose-v2
      fi
      ;;
    *fedora* | *rhel* | *centos* | *rocky* | *alma*)
      PKG_MANAGER=dnf
      DOCKER_PKG=docker
      COMPOSE_PKG=docker-compose-plugin
      ;;
    *arch* | *manjaro*)
      PKG_MANAGER=pacman
      DOCKER_PKG=docker
      COMPOSE_PKG=docker-compose
      ;;
    *)
      return 1
      ;;
  esac
  CURL_PKG=curl
}

install_packages() {
  if [ "$(uname -s)" != Linux ]; then
    echo "Automatic installation is only available on Linux." >&2
    return 1
  fi
  if [ "${RELATIVITY_SKIP_PACKAGE_INSTALL:-0}" = 1 ]; then
    echo "Skipping auto-install (RELATIVITY_SKIP_PACKAGE_INSTALL=1)." >&2
    return 1
  fi
  if ! detect_package_manager; then
    echo "Unsupported Linux distribution — install Docker manually: https://docs.docker.com/get-docker/" >&2
    return 1
  fi

  missing=""
  [ "$have_docker" = yes ] || missing="$missing $DOCKER_PKG"
  [ "$have_compose" = yes ] || missing="$missing $COMPOSE_PKG"
  command_exists curl || missing="$missing $CURL_PKG"
  echo "Installing missing packages:$missing (may prompt for sudo)"

  prepare_sudo || return 1
  set -- $missing
  case "$PKG_MANAGER" in
    apt)
      as_root apt-get update || return 1
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" || return 1
      ;;
    dnf)
      as_root dnf install -y "$@" || return 1
      ;;
    pacman)
      as_root pacman -S --noconfirm --needed "$@" || return 1
      ;;
  esac

  # A fresh install needs the daemon running; group membership takes effect at
  # the user's next login, so say so explicitly.
  if command_exists systemctl; then
    as_root systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if [ "$(id -u)" -ne 0 ] && ! id -nG "$(id -un)" 2>/dev/null | grep -qw docker; then
    if command_exists usermod; then
      as_root usermod -aG docker "$(id -un)" 2>/dev/null || true
      echo "NOTE: added $(id -un) to the docker group — log out and back in for it to take effect."
    fi
  fi
}

if ! check_requirements; then
  echo "Required packages missing: $(missing_packages)"
  if ! install_packages; then
    docker_required
  fi
  check_requirements || docker_required
else
  echo "Required packages already installed — skipping package installation."
fi

verify_docker_daemon

if [ "$(uname -s)" = Linux ] && ! command_exists xdg-open; then
  echo "NOTE: xdg-open not found — open http://127.0.0.1:8501 manually when Relativity starts."
fi

install_command
finish
