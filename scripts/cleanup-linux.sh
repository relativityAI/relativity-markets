#!/bin/sh
# Linux/macOS cleanup. Normally invoked by cleanup.sh.
# Removes the relativity command, installer PATH edits, this checkout's Docker
# containers, and only the images this project owns.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/cleanup-common.sh"

remove_cli
remove_path_entries
cleanup_docker
finish_cleanup
