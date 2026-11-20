#!/bin/sh
# Windows (Git Bash) installer. Normally invoked by install.sh.
# Requires Docker Desktop with the Compose plugin; no OS packages are installed
# here — the .cmd shim and User PATH registration are Windows-specific.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/install-common.sh"

# Extras called by install_command: cmd/PowerShell can't run an extensionless
# shell script, so install a .cmd shim beside the symlink. It delegates to the
# symlink, which points into the repo — so `git pull` keeps the launcher current.
# ponytail: % in the install path would break this; nobody has % in a folder name.
platform_extras() {
  cp -f "$ROOT/bin/relativity.cmd" "$HOME/.local/bin/relativity.cmd"
  wd=$(cygpath -w "$HOME/.local/bin")
  powershell.exe -NoProfile -Command "\$p=[Environment]::GetEnvironmentVariable('Path','User');\$d='$wd';if((\$p+'') -notlike ('*'+\$d+'*')){[Environment]::SetEnvironmentVariable('Path',\$(if(\$p){\$p.TrimEnd(';')+';'+\$d}else{\$d}),'User')}" >/dev/null
}

if ! check_requirements; then
  echo "Required packages missing: $(missing_packages)"
  docker_required
fi

verify_docker_daemon

install_command
finish
