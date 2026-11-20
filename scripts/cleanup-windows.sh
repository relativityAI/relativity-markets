#!/bin/sh
# Windows (Git Bash) cleanup. Normally invoked by cleanup.sh.
# Removes the Git Bash launcher, .cmd shim, Windows User PATH entry, installer
# PATH edits, this checkout's Docker containers and this project's images.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/cleanup-common.sh"

cleanup_platform_extras() {
  shim="$HOME/.local/bin/relativity.cmd"
  if [ -f "$shim" ] && grep -qF '%~dp0relativity' "$shim"; then
    rm -f "$shim"
    echo "Removed $shim"
  elif [ -e "$shim" ]; then
    echo "Left $shim untouched — it is not a Relativity shim."
  fi

  wd=$(cygpath -w "$HOME/.local/bin" 2>/dev/null) || return 0
  powershell.exe -NoProfile -Command "\$p=[Environment]::GetEnvironmentVariable('Path','User');\$d='$wd';if(\$p){\$parts=(\$p -split ';') | Where-Object { \$_ -ne \$d };[Environment]::SetEnvironmentVariable('Path',(\$parts -join ';'),'User')}" >/dev/null 2>&1 || true
  echo "Removed Relativity entry from the Windows User PATH."
}

remove_cli
remove_path_entries
cleanup_docker
finish_cleanup
