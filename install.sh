#!/bin/sh
# relativity installer — one entry point, no checkout required.
#
#   macOS / Linux:  curl -fsSL <raw>/install.sh | sh
#   Windows:        use install.ps1 in PowerShell (this script points you
#                   there and exits — no Git Bash needed anymore)
#
# From a checkout (`bash install.sh`) it uses the repo's own files, so
# `git pull` keeps the launcher current. Piped, it downloads the stack
# definition into ~/.local/share/relativity. Re-running is safe: packages
# and PATH setup already in place are skipped.
#
# Logic previously split across scripts/install-{common,linux,windows}.sh is
# inlined so `curl | sh` works without a repository.
set -e

BASE=${RELATIVITY_RAW_BASE:-https://raw.githubusercontent.com/relativityAI/relativity-markets/main}
INSTALL_DIR=$HOME/.local/share/relativity

command_exists() { command -v "$1" >/dev/null 2>&1; }

case $(uname -s) in
  MINGW* | MSYS* | CYGWIN*)
    echo "Windows uses the PowerShell installer — run this in PowerShell:" >&2
    echo "  irm $BASE/install.ps1 | iex" >&2
    exit 1
    ;;
esac

# Checkout mode when this script lives in (or is piped from) a repo checkout:
# use its docker-compose.yml + launcher instead of downloading.
ROOT=$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")
LAUNCHER=
if [ -n "$ROOT" ] && [ -f "$ROOT/docker-compose.yml" ] && [ -f "$ROOT/bin/relativity" ]; then
  LAUNCHER=$ROOT/bin/relativity
fi

# --- requirements (Docker, Compose plugin, curl) ---------------------------

have_docker=no
have_compose=no
have_curl=no

# Recheck after installing so a successful run never leaves stale state behind.
check_requirements() {
  have_docker=no
  have_compose=no
  have_curl=no
  if command_exists docker; then
    have_docker=yes
    if docker compose version >/dev/null 2>&1; then have_compose=yes; fi
  fi
  command_exists curl && have_curl=yes
  [ "$have_docker" = yes ] && [ "$have_compose" = yes ] && [ "$have_curl" = yes ]
}

missing_packages() {
  missing=""
  [ "$have_docker" = yes ] || missing="$missing docker"
  [ "$have_compose" = yes ] || missing="$missing docker-compose"
  command_exists curl || missing="$missing curl"
  printf '%s' "$missing"
}

docker_required() {
  echo "Missing or unusable:$(missing_packages)" >&2
  echo "Docker is required to run Relativity." >&2
  echo "Install:  https://docs.docker.com/get-docker/" >&2
  echo "Then re-run this installer." >&2
  exit 1
}

docker_daemon_hint() {
  if [ "$(uname -s)" = Linux ]; then
    echo "Start it with:  sudo systemctl start docker" >&2
    if [ "$(id -u)" -ne 0 ]; then
      echo "If your user is not in the docker group: sudo usermod -aG docker $(id -un) (then log out/in)" >&2
    fi
  else
    echo "Start Docker Desktop and re-run this installer." >&2
  fi
}

verify_docker_daemon() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but its daemon is not reachable." >&2
    docker_daemon_hint
    exit 1
  fi
}

# Missing packages are installed with the system package manager (sudo may
# prompt). Set RELATIVITY_SKIP_PACKAGE_INSTALL=1 to disable.
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

# --- files: checkout when present, otherwise download ----------------------

if [ -n "$LAUNCHER" ]; then
  echo "Using the checkout at $ROOT"
else
  echo "Downloading Relativity to $INSTALL_DIR ..."
  mkdir -p "$INSTALL_DIR/bin"
  mkdir -p "$INSTALL_DIR/services/data"
  curl -fsSL "$BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
  curl -fsSL "$BASE/bin/relativity" -o "$INSTALL_DIR/bin/relativity"
  chmod +x "$INSTALL_DIR/bin/relativity"
  LAUNCHER=$INSTALL_DIR/bin/relativity
fi

# --- the `relativity` command ---------------------------------------------

link=$HOME/.local/bin/relativity
mkdir -p "$HOME/.local/bin"
if [ -L "$link" ] && [ "$(readlink "$link")" = "$LAUNCHER" ]; then
  echo "relativity command is already installed."
elif [ -L "$link" ] || [ ! -e "$link" ]; then
  rm -f "$link"
  ln -s "$LAUNCHER" "$link"
  echo "Linked relativity command into ~/.local/bin."
else
  # Never clobber a real file somebody put there.
  echo "Refusing to overwrite $link — move it aside and re-run." >&2
  exit 1
fi
chmod +x "$LAUNCHER"

case ":$PATH:" in
  *":$HOME/.local/bin:"*)
    echo "~/.local/bin is already on PATH."
    ;;
  *)
    # Idempotent: only append the line if no shell rc already has it.
    found_path_line=no
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
      [ -f "$rc" ] || continue
      if grep -qF 'export PATH="$HOME/.local/bin:$PATH"' "$rc"; then
        found_path_line=yes
        echo "PATH already configured in $rc."
        break
      fi
    done
    if [ "$found_path_line" = no ]; then
      for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
        [ -f "$rc" ] || continue
        printf '\n# relativity CLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
        echo "NOTE: added ~/.local/bin to your PATH in $rc — restart your terminal (or: . $rc)"
        found_path_line=yes
        break
      done
    fi
    if [ "$found_path_line" = no ]; then
      printf 'export PATH="$HOME/.local/bin:$PATH"\n' >"$HOME/.profile"
      echo "NOTE: created ~/.profile with ~/.local/bin on PATH — restart your terminal"
    fi
    ;;
esac

if [ "$(uname -s)" = Linux ] && ! command_exists xdg-open; then
  echo "NOTE: xdg-open not found — open http://127.0.0.1:8501 manually when Relativity starts."
fi

echo ""
echo "Done. Open a NEW terminal and type:  relativity"
echo "  * opens your browser (http://127.0.0.1:8501); \`relativity stop\` stops it"
echo "  * first run downloads the Docker images — a few minutes"
