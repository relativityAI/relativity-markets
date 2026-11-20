#!/bin/sh
# Shared helpers for the Linux and Windows installers.
# Sourced by scripts/install-linux.sh / scripts/install-windows.sh with $ROOT
# set to the repository root. Not meant to be run directly.

command_exists() { command -v "$1" >/dev/null 2>&1; }

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
  echo "Then re-run:  bash install.sh" >&2
  exit 1
}

# Overridden by the Linux installer with systemctl/group hints.
docker_daemon_hint() {
  echo "Start Docker and re-run: bash install.sh" >&2
}

verify_docker_daemon() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but its daemon is not reachable." >&2
    docker_daemon_hint
    exit 1
  fi
}

# Overridden by the Windows installer for the .cmd shim and User PATH entry.
platform_extras() { :; }

# Link bin/relativity to ~/.local/bin so `relativity` works from any folder.
# Adds ~/.local/bin to PATH when missing (first rc found).
install_command() {
  ABS=$ROOT
  target="$ABS/bin/relativity"
  link="$HOME/.local/bin/relativity"
  [ -f "$target" ] || { echo "Missing $target — is this a Relativity checkout?" >&2; return 1; }

  mkdir -p "$HOME/.local/bin"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
    echo "relativity command is already installed."
  elif [ -L "$link" ] || [ ! -e "$link" ]; then
    rm -f "$link"
    ln -s "$target" "$link"
    echo "Linked relativity command into ~/.local/bin."
  else
    # Never clobber a real file somebody put there.
    echo "Refusing to overwrite $link — move it aside and re-run." >&2
    return 1
  fi
  chmod +x "$target"

  platform_extras

  case ":$PATH:" in
    *":$HOME/.local/bin:"*)
      echo "~/.local/bin is already on PATH."
      return 0
      ;;
  esac

  # Idempotent: only append the line if no shell rc already has it.
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    if grep -qF 'export PATH="$HOME/.local/bin:$PATH"' "$rc"; then
      echo "PATH already configured in $rc."
      return 0
    fi
  done
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    printf '\n# relativity CLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
    echo "NOTE: added ~/.local/bin to your PATH in $rc — restart your terminal (or: . $rc)"
    return 0
  done
  printf 'export PATH="$HOME/.local/bin:$PATH"\n' >"$HOME/.profile"
  echo "NOTE: created ~/.profile with ~/.local/bin on PATH — restart your terminal"
}

finish() {
  echo ""
  echo "Done. Open a NEW terminal and type:  relativity"
  echo "  * opens your browser (http://127.0.0.1:8501); Ctrl+C stops it"
  echo "  * first run downloads the Docker images — a few minutes"
}
