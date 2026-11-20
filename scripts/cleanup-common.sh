#!/bin/sh
# Shared helpers for the Linux and Windows cleanup scripts.
# Sourced with $ROOT set to the repository root. Not meant to be run directly.

command_exists() { command -v "$1" >/dev/null 2>&1; }

# Only images owned by this project. Third-party images (searxng, postgres,
# yfmcp, ...) are deliberately left alone.
APP_IMAGE=ghcr.io/relativityai/relativity-markets:latest
TV_IMAGE=relativity/tradingview-mcp:0.8.1

# Overridden by cleanup-windows.sh for the .cmd shim and Windows User PATH.
cleanup_platform_extras() { :; }

remove_cli() {
  link="$HOME/.local/bin/relativity"
  target="$ROOT/bin/relativity"

  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "$target" ]; then
      rm -f "$link"
      echo "Removed $link"
    else
      echo "Left $link untouched — it points to another install."
    fi
  elif [ -e "$link" ]; then
    echo "Left $link untouched — it is not a Relativity symlink."
  fi

  cleanup_platform_extras
}

# Remove only the exact block installers add; leave the rest of each rc alone.
remove_path_entries() {
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    tmp="$rc.relativity-cleanup.$$"
    if ! awk -v export_line='export PATH="$HOME/.local/bin:$PATH"' '
      { line[NR] = $0 }
      END {
        skip_comment = 0
        skip_blank = 0
        i = 1
        while (i <= NR) {
          if (line[i] == export_line) {
            if ((i - 1) >= 1 && line[i - 1] == "# relativity CLI") {
              skip_comment = i - 1
              if ((i - 2) >= 1 && line[i - 2] == "") skip_blank = i - 2
            }
            i++
            continue
          }
          if (i == skip_comment || i == skip_blank) {
            i++
            continue
          }
          print line[i]
          i++
        }
      }
    ' "$rc" >"$tmp"; then
      rm -f "$tmp"
      echo "WARNING: could not clean $rc" >&2
      continue
    fi
    if cmp -s "$tmp" "$rc"; then
      rm -f "$tmp"
    else
      if [ -s "$tmp" ]; then
        mv "$tmp" "$rc"
      else
        : >"$rc"
        rm -f "$tmp"
      fi
      echo "Removed Relativity PATH entry from $rc"
    fi
  done
}

# Project-scoped Docker cleanup: this checkout's containers, then only the two
# images this project owns. No prune, no volumes, no other projects' resources.
cleanup_docker() {
  if ! command_exists docker; then
    echo "Docker not found — skipped container/image cleanup."
    return 0
  fi

  if docker compose version >/dev/null 2>&1; then
    echo "Stopping containers for this checkout only..."
    if ! docker compose -f "$ROOT/docker-compose.yml" down --remove-orphans; then
      echo "WARNING: could not stop this checkout's containers." >&2
    fi
  else
    echo "Docker Compose not available — skipped container cleanup."
  fi

  for image in "$APP_IMAGE" "$TV_IMAGE"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      echo "Removing image $image"
      if ! docker image rm "$image" >/dev/null 2>&1; then
        echo "WARNING: could not remove $image (still in use elsewhere?)" >&2
      fi
    fi
  done
}

finish_cleanup() {
  echo ""
  echo "Relativity cleanup done."
  echo "  * local data in services/data was left untouched"
  echo "  * system packages, Docker volumes and other projects were not touched"
  echo "  * re-install anytime with:  bash install.sh"
}
