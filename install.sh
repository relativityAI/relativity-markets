#!/bin/sh
# Single entry point: detect the platform and delegate to its installer.
#   Linux / macOS  -> scripts/install-linux.sh
#   Windows (Git Bash) -> scripts/install-windows.sh
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)

case $(uname -s) in
  MINGW* | MSYS* | CYGWIN*)
    exec sh "$ROOT/scripts/install-windows.sh" "$@"
    ;;
  Linux | Darwin)
    exec sh "$ROOT/scripts/install-linux.sh" "$@"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    echo "Install Docker manually: https://docs.docker.com/get-docker/" >&2
    exit 1
    ;;
esac
