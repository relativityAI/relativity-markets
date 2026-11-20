#!/bin/sh
# Single entry point: detect the platform and delegate to its cleanup script.
# Removes only Relativity artifacts — never system packages or other projects.
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)

case $(uname -s) in
  MINGW* | MSYS* | CYGWIN*)
    exec sh "$ROOT/scripts/cleanup-windows.sh" "$@"
    ;;
  Linux | Darwin)
    exec sh "$ROOT/scripts/cleanup-linux.sh" "$@"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
