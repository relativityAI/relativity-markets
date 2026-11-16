#!/bin/sh
# E2E test for the docker-mode relativity command: install.sh (link + docker
# requirement) and bin/relativity (start / browser-poll / idempotent / stop).
# Needs Docker and a FREE port 8080 (stop a running app first); pulls images
# on the first run (a few minutes).
#   sh bin/relativity.test.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=http://127.0.0.1:8080
FAKE=$(mktemp -d)
LAUNCHER=

cleanup() {
  if [ -n "$LAUNCHER" ]; then
    pkill -TERM -P "$LAUNCHER" 2>/dev/null || true
    kill "$LAUNCHER" 2>/dev/null || true
    wait "$LAUNCHER" 2>/dev/null || true
  fi
  docker compose -f "$ROOT/docker-compose.yml" down >/dev/null 2>&1 || true
  rm -rf "$FAKE"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

wait_port_free() {
  n=0
  while [ "$n" -lt 30 ]; do
    if ! curl -fsS -o /dev/null --max-time 2 "$URL/health" 2>/dev/null; then return 0; fi
    sleep 1
    n=$((n + 1))
  done
  return 1
}

wait_healthy() {
  n=0
  while [ "$n" -lt 600 ]; do
    if curl -fsS -o /dev/null --max-time 2 "$URL/health" 2>/dev/null; then return 0; fi
    sleep 1
    n=$((n + 1))
  done
  return 1
}

# 1. install.sh refuses without Docker (broken docker stub) — real file, fake HOME
mkdir -p "$FAKE/stub"
printf '#!/bin/sh\nexit 1\n' >"$FAKE/stub/docker"
chmod +x "$FAKE/stub/docker"
if HOME="$FAKE/home-bad" PATH="$FAKE/stub:$PATH" bash "$ROOT/install.sh" >"$FAKE/bad.log" 2>&1; then
  fail "install.sh succeeded without Docker"
fi
grep -q "Docker is required" "$FAKE/bad.log" || fail "install.sh: missing docker-required message"

# 2. install.sh links the command (real repo, fake HOME — real HOME untouched)
HOME="$FAKE/home" bash "$ROOT/install.sh" >/dev/null
[ -x "$FAKE/home/.local/bin/relativity" ] || fail "install.sh did not link the command"
[ "$(readlink "$FAKE/home/.local/bin/relativity")" = "$ROOT/bin/relativity" ] ||
  fail "symlink does not point at the real repo"

# 3. port must be free (an app typed by a human beats the test)
command -v docker >/dev/null 2>&1 || fail "docker missing"
if curl -fsS -o /dev/null --max-time 2 "$URL/health" 2>/dev/null; then
  echo "SKIP: app already running on $URL — press Ctrl+C in its terminal (or docker compose down), then re-run this test."
  exit 0
fi

# 4. start via the symlink, backgrounded like a terminal job; wait out the pull
"$FAKE/home/.local/bin/relativity" >"$FAKE/launch.log" 2>&1 &
LAUNCHER=$!
wait_healthy || { tail -30 "$FAKE/launch.log" >&2; fail "app not healthy after start"; }
kill -0 "$LAUNCHER" 2>/dev/null || { tail -30 "$FAKE/launch.log" >&2; fail "launcher exited instead of staying in the foreground"; }
ss -ltn 2>/dev/null | grep -q '127.0.0.1:8080' || fail "port 8080 is not loopback-only"

# 5. second invocation detects the running app
out=$("$FAKE/home/.local/bin/relativity")
echo "$out" | grep -q "already running" || fail "second run did not detect running app"

# 6. stop path: kill the launcher + compose client, then compose down
pkill -TERM -P "$LAUNCHER" || fail "no compose process under the launcher"
kill "$LAUNCHER" 2>/dev/null || true
wait "$LAUNCHER" 2>/dev/null || true
LAUNCHER=
docker compose -f "$ROOT/docker-compose.yml" down >/dev/null 2>&1 || true
wait_port_free || fail "port 8080 still serving after stop"

echo "relativity docker command: all checks passed"
