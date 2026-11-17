#!/bin/sh
# Relativity installer — Docker required. Clone, then run once:
#
#   git clone https://github.com/relativityAI/relativity-markets.git
#   cd relativity-markets
#   bash install.sh
#
# Puts the `relativity` command on your PATH. The app runs in Docker.
set -e
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker is required to run Relativity."
  echo "Install:  https://docs.docker.com/get-docker/"
  echo "Then re-run:  bash install.sh"
  exit 1
fi

# Link bin/relativity to ~/.local/bin so `relativity` works from any folder.
# Call with cwd = repo root. Adds ~/.local/bin to PATH when missing (first rc found).
install_command() {
  ABS=$(pwd)
  mkdir -p "$HOME/.local/bin"
  ln -sf "$ABS/bin/relativity" "$HOME/.local/bin/relativity"
  chmod +x "$ABS/bin/relativity"
  # Windows (Git Bash): cmd/PowerShell can't run an extensionless shell script,
  # so install a .cmd shim beside the symlink. It delegates to that symlink,
  # which points into the repo — so `git pull` keeps the launcher up to date.
  # ponytail: % in the install path would break this; nobody has % in a folder name.
  case $(uname -s) in
    MINGW* | MSYS* | CYGWIN*)
      cp -f "$ABS/bin/relativity.cmd" "$HOME/.local/bin/relativity.cmd"
      wd=$(cygpath -w "$HOME/.local/bin")
      powershell.exe -NoProfile -Command "\$p=[Environment]::GetEnvironmentVariable('Path','User');\$d='$wd';if((\$p+'') -notlike ('*'+\$d+'*')){[Environment]::SetEnvironmentVariable('Path',\$(if(\$p){\$p.TrimEnd(';')+';'+\$d}else{\$d}),'User')}" >/dev/null
      ;;
  esac
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) return 0 ;;
  esac
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    if ! grep -qF '.local/bin' "$rc"; then
      printf '\n# relativity CLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
      echo "NOTE: added ~/.local/bin to your PATH in $rc — restart your terminal (or: . $rc)"
    fi
    return 0
  done
  printf 'export PATH="$HOME/.local/bin:$PATH"\n' >"$HOME/.profile"
  echo "NOTE: created ~/.profile with ~/.local/bin on PATH — restart your terminal"
}

install_command

echo ""
echo "Done. Open a NEW terminal and type:  relativity"
echo "  * opens your browser (http://127.0.0.1:8501); Ctrl+C stops it"
echo "  * first run downloads the Docker images — a few minutes"
