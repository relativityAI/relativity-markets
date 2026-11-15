#!/bin/sh
# Relativity one-command installer.
# Docker? Starts the prebuilt image with web search included.
# No docker? Downloads the source and runs it with Node (22.13+).
#
# Overrides for testing / pinned versions:
#   RELATIVITY_DIR          install location (default: ./relativity)
#   RELATIVITY_COMPOSE_URL  docker-compose.yml download URL
#   RELATIVITY_TARBALL_URL  source tarball download URL
set -e

REPO=relativityAI/relativity-markets
BRANCH=main
BASE="${RELATIVITY_BASE_URL:-https://raw.githubusercontent.com/$REPO/$BRANCH}"
DIR="${RELATIVITY_DIR:-relativity}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "==> Docker found — starting Relativity (includes web search)"
  mkdir -p "$DIR/services/searxng"
  cd "$DIR"
  curl -fsSL "${RELATIVITY_COMPOSE_URL:-$BASE/docker-compose.yml}" -o docker-compose.yml
  curl -fsSL "$BASE/services/searxng/settings.yml" -o services/searxng/settings.yml
  docker compose up -d
  echo ""
  echo "Relativity is running:  http://localhost:8080"
  echo "Stop:  docker compose down    (in this folder)"
  exit 0
fi

echo "==> No docker — installing from source (needs Node.js 22.13+)"
command -v node >/dev/null 2>&1 || {
  echo "Node.js is missing. Install it from https://nodejs.org and re-run."
  exit 1
}
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "Node.js $NODE_MAJOR.$NODE_MINOR is too old — need 22.13+. Update it from https://nodejs.org and re-run."
  exit 1
fi

mkdir -p "$DIR" && cd "$DIR"
echo "==> Downloading source"
curl -fsSL "${RELATIVITY_TARBALL_URL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH}" | tar -xz --strip-components=1
echo "==> Installing dependencies"
npm install
echo "==> Starting (web app on http://localhost:5173 — stop with Ctrl+C)"
npm run dev
