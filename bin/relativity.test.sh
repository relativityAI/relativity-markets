#!/bin/sh
# E2E test for the docker-mode relativity command: install.sh (link + docker
# requirement) and bin/relativity (update-check / start / browser-poll /
# idempotent / stop). Needs Docker and a FREE port 8501 (stop a running app
# first); the first run downloads images (a few minutes).
#   sh bin/relativity.test.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=http://127.0.0.1:8501
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

# 2b. Windows (Git Bash): installer must add a .cmd shim for cmd/PowerShell and
# register the install dir in the User PATH. Stub the Windows-only tools.
mkdir -p "$FAKE/winstub"
printf '#!/bin/sh\necho MINGW64_NT-10.0\n' >"$FAKE/winstub/uname"
printf '#!/bin/sh\necho "C:\\Users\\tester\\.local\\bin"\n' >"$FAKE/winstub/cygpath"
printf '#!/bin/sh\n[ "$1" = compose ] && [ "$2" = version ]\n' >"$FAKE/winstub/docker"
printf '#!/bin/sh\necho "$@" >"$POWERSHELL_LOG"\nexit 0\n' >"$FAKE/winstub/powershell.exe"
chmod +x "$FAKE/winstub/"*
POWERSHELL_LOG="$FAKE/ps.log" HOME="$FAKE/winhome" PATH="$FAKE/winstub:$PATH" \
  bash "$ROOT/install.sh" >"$FAKE/win.log" 2>&1 || { cat "$FAKE/win.log" >&2; fail "Windows install failed"; }
[ -x "$FAKE/winhome/.local/bin/relativity" ] || fail "Windows: no Git Bash launcher"
[ "$(readlink "$FAKE/winhome/.local/bin/relativity")" = "$ROOT/bin/relativity" ] ||
  fail "Windows: launcher does not point at the repo"
grep -q '%~dp0relativity' "$FAKE/winhome/.local/bin/relativity.cmd" 2>/dev/null ||
  fail "Windows: .cmd shim missing or does not delegate to the launcher"
grep -q 'bash.exe' "$FAKE/winhome/.local/bin/relativity.cmd" ||
  fail "Windows: .cmd shim does not locate Git Bash"
grep -q "SetEnvironmentVariable" "$FAKE/ps.log" || fail "Windows: User PATH was not updated"

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
ss -ltn 2>/dev/null | grep -q '127.0.0.1:8501' || fail "port 8501 is not loopback-only"

# the update check must complete before `up` — otherwise the container is
# recreated from the previous image (the stale-image bug this guards against)
pull_line=$(grep -n "Checking for updates..." "$FAKE/launch.log" | head -1 | cut -d: -f1)
start_line=$(grep -n "Starting Relativity:" "$FAKE/launch.log" | head -1 | cut -d: -f1)
[ -n "$pull_line" ] && [ -n "$start_line" ] && [ "$pull_line" -lt "$start_line" ] ||
  fail "image update check did not run before start"

running_img=$(docker inspect -f '{{.Image}}' "$(docker compose -f "$ROOT/docker-compose.yml" ps -q app)")
latest_img=$(docker image inspect ghcr.io/relativityai/relativity-markets:latest -f '{{.Id}}')
[ "$running_img" = "$latest_img" ] || fail "app is not running the freshly pulled image"

# 5. second invocation, from another directory: still refreshes, then detects
#    the running app (the README promises it works from any folder)
out=$(cd /tmp && "$FAKE/home/.local/bin/relativity")
echo "$out" | grep -q "Checking for updates..." || fail "second run skipped the update check"
echo "$out" | grep -q "already running" || fail "second run did not detect running app"

# 5b. a run against an already-running app on an older image must recreate it.
#     Stub docker/curl so this exercises the launcher's decision, not the daemon.
mkdir -p "$FAKE/refreshstub"
cat >"$FAKE/refreshstub/docker" <<'STUB'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    version|pull) exit 0 ;;
    ps) echo fakecontainer; exit 0 ;;
    up) echo recreated >>"$RECREATE_LOG"; exit 0 ;;
  esac
done
case "$1" in
  image) echo sha256:latest; exit 0 ;;
  inspect) echo sha256:old; exit 0 ;;
esac
exit 1
STUB
printf '#!/bin/sh\nexit 0\n' >"$FAKE/refreshstub/curl"
printf '#!/bin/sh\necho Linux\n' >"$FAKE/refreshstub/uname"
printf '#!/bin/sh\nexit 0\n' >"$FAKE/refreshstub/xdg-open"
chmod +x "$FAKE/refreshstub/"*
: >"$FAKE/recreate.log"
out=$(PATH="$FAKE/refreshstub:$PATH" RECREATE_LOG="$FAKE/recreate.log" "$FAKE/home/.local/bin/relativity")
echo "$out" | grep -q "Update available" || fail "stale running app was not updated"
grep -q recreated "$FAKE/recreate.log" || fail "app container was not recreated on update"

# 6. stop path: kill the launcher + compose client, then compose down
pkill -TERM -P "$LAUNCHER" || fail "no compose process under the launcher"
kill "$LAUNCHER" 2>/dev/null || true
wait "$LAUNCHER" 2>/dev/null || true
LAUNCHER=
docker compose -f "$ROOT/docker-compose.yml" down >/dev/null 2>&1 || true
wait_port_free || fail "port 8501 still serving after stop"

echo "relativity docker command: all checks passed"
