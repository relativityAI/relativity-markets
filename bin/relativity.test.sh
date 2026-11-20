#!/bin/sh
# E2E test for the docker-mode relativity command: install.sh dispatcher and
# platform installers (link + docker requirement), plus bin/relativity
# (update-check / start / browser-poll / idempotent / stop). Needs Docker and a
# FREE port 8501 (stop a running app first); the first run downloads images
# (a few minutes).
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
if RELATIVITY_SKIP_PACKAGE_INSTALL=1 HOME="$FAKE/home-bad" PATH="$FAKE/stub:$PATH" \
  bash "$ROOT/install.sh" >"$FAKE/bad.log" 2>&1; then
  fail "install.sh succeeded without Docker"
fi
grep -q "Docker is required" "$FAKE/bad.log" || fail "install.sh: missing docker-required message"

# 2. install.sh links the command (real repo, fake HOME — real HOME untouched)
HOME="$FAKE/home" bash "$ROOT/install.sh" >/dev/null
[ -x "$FAKE/home/.local/bin/relativity" ] || fail "install.sh did not link the command"
[ "$(readlink "$FAKE/home/.local/bin/relativity")" = "$ROOT/bin/relativity" ] ||
  fail "symlink does not point at the real repo"

# 2a. re-running is idempotent: same link, one PATH line, no duplicate edits
out=$(HOME="$FAKE/home" bash "$ROOT/install.sh")
echo "$out" | grep -q "already installed" || fail "install.sh did not report an existing install"
[ "$(readlink "$FAKE/home/.local/bin/relativity")" = "$ROOT/bin/relativity" ] ||
  fail "re-run changed the symlink"
path_lines=$(grep -hF 'export PATH="$HOME/.local/bin:$PATH"' \
  "$FAKE/home/.profile" "$FAKE/home/.bashrc" "$FAKE/home/.zshrc" 2>/dev/null | wc -l)
[ "$path_lines" -le 1 ] || fail "re-run duplicated the PATH line"

# 2b. Windows (Git Bash): installer must add a .cmd shim for cmd/PowerShell and
# register the install dir in the User PATH. Stub the Windows-only tools.
mkdir -p "$FAKE/winstub"
printf '#!/bin/sh\necho MINGW64_NT-10.0\n' >"$FAKE/winstub/uname"
printf '#!/bin/sh\necho "C:\\Users\\tester\\.local\\bin"\n' >"$FAKE/winstub/cygpath"
printf '#!/bin/sh\n[ "$1" = compose ] && [ "$2" = version ] && exit 0\n[ "$1" = info ] && exit 0\nexit 1\n' >"$FAKE/winstub/docker"
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

# 2c. Linux: when Docker/Compose/curl are already present, no package manager
# call is made (stub apt-get would fail loudly if the installer invoked it).
mkdir -p "$FAKE/linuxstub"
printf '#!/bin/sh\necho Linux\n' >"$FAKE/linuxstub/uname"
printf '#!/bin/sh\necho "$@" >>"$APT_LOG"\nexit 99\n' >"$FAKE/linuxstub/apt-get"
chmod +x "$FAKE/linuxstub/"*
: >"$FAKE/skip-apt.log"
APT_LOG="$FAKE/skip-apt.log" HOME="$FAKE/linuxhome" PATH="$FAKE/linuxstub:$PATH" \
  bash "$ROOT/install.sh" >"$FAKE/linux.log" 2>&1 || { cat "$FAKE/linux.log" >&2; fail "Linux install failed"; }
[ ! -s "$FAKE/skip-apt.log" ] || fail "Linux: apt-get called even though packages were present"
grep -q "skipping package installation" "$FAKE/linux.log" ||
  fail "Linux: installer did not report that packages were already present"

# 2d. Linux: a missing Compose plugin is installed via apt (stubbed here), then
# the installer verifies requirements again and links the command.
mkdir -p "$FAKE/autostub"
cat >"$FAKE/autostub/uname" <<'STUB'
#!/bin/sh
echo Linux
STUB
cat >"$FAKE/autostub/id" <<'STUB'
#!/bin/sh
case "$1" in
  -u) echo 1000 ;;
  -nG) echo "tester docker" ;;
  *) exec /usr/bin/id "$@" ;;
esac
STUB
cat >"$FAKE/autostub/docker" <<'STUB'
#!/bin/sh
if [ "$1" = compose ] && [ "$2" = version ]; then
  [ -f "$APT_MARKER" ] || exit 1
  exit 0
fi
[ "$1" = info ] && exit 0
exit 1
STUB
printf '#!/bin/sh\nexit 0\n' >"$FAKE/autostub/apt-cache"
cat >"$FAKE/autostub/apt-get" <<'STUB'
#!/bin/sh
echo "$@" >>"$APT_LOG"
case "$1" in
  update) exit 0 ;;
  install) touch "$APT_MARKER"; exit 0 ;;
esac
exit 1
STUB
cat >"$FAKE/autostub/sudo" <<'STUB'
#!/bin/sh
[ "$1" = -v ] && exit 0
exec "$@"
STUB
printf '#!/bin/sh\nexit 0\n' >"$FAKE/autostub/systemctl"
chmod +x "$FAKE/autostub/"*
: >"$FAKE/auto-apt.log"
APT_LOG="$FAKE/auto-apt.log" APT_MARKER="$FAKE/auto-installed" \
  HOME="$FAKE/autohome" PATH="$FAKE/autostub:$PATH" \
  bash "$ROOT/install.sh" >"$FAKE/auto.log" 2>&1 || { cat "$FAKE/auto.log" >&2; fail "Linux auto-install failed"; }
grep -q 'docker-compose-plugin' "$FAKE/auto-apt.log" ||
  fail "Linux: missing Compose plugin was not installed"
[ -x "$FAKE/autohome/.local/bin/relativity" ] ||
  fail "Linux: auto-install did not link the command"

# 2e. cleanup removes only Relativity artifacts. Stub docker so no real
# containers or images are touched by the test.
mkdir -p "$FAKE/cleanstub"
cat >"$FAKE/cleanstub/docker" <<'STUB'
#!/bin/sh
echo "$@" >>"$DOCKER_LOG"
exit 0
STUB
chmod +x "$FAKE/cleanstub/"*
: >"$FAKE/docker-clean.log"
DOCKER_LOG="$FAKE/docker-clean.log" HOME="$FAKE/home" PATH="$FAKE/cleanstub:$PATH" \
  bash "$ROOT/cleanup.sh" >"$FAKE/clean.log" 2>&1 || { cat "$FAKE/clean.log" >&2; fail "cleanup failed"; }
[ ! -e "$FAKE/home/.local/bin/relativity" ] || fail "cleanup left the symlink behind"
path_lines=$(grep -hF 'export PATH="$HOME/.local/bin:$PATH"' \
  "$FAKE/home/.profile" "$FAKE/home/.bashrc" "$FAKE/home/.zshrc" 2>/dev/null | wc -l)
[ "$path_lines" -eq 0 ] || fail "cleanup left a PATH entry behind"
grep -q 'docker-compose.yml down' "$FAKE/docker-clean.log" ||
  fail "cleanup did not stop this checkout's containers"
grep -q 'ghcr.io/relativityai/relativity-markets:latest' "$FAKE/docker-clean.log" ||
  fail "cleanup did not remove the app image"
grep -q 'relativity/tradingview-mcp:0.8.1' "$FAKE/docker-clean.log" ||
  fail "cleanup did not remove the built image"
if grep -qiE 'prune|system df' "$FAKE/docker-clean.log"; then
  fail "cleanup touched unrelated Docker resources"
fi

# 2f. a second run is idempotent and never deletes a non-Relativity file at the
# install path.
printf 'keep me\n' >"$FAKE/home/.local/bin/relativity"
: >"$FAKE/docker-clean2.log"
DOCKER_LOG="$FAKE/docker-clean2.log" HOME="$FAKE/home" PATH="$FAKE/cleanstub:$PATH" \
  bash "$ROOT/cleanup.sh" >/dev/null 2>&1 || fail "second cleanup run failed"
[ "$(cat "$FAKE/home/.local/bin/relativity")" = "keep me" ] ||
  fail "cleanup removed an unrelated file"
rm -f "$FAKE/home/.local/bin/relativity"

# 2g. Windows cleanup: shim, Windows User PATH entry and rc PATH line are removed.
mkdir -p "$FAKE/cleanwinstub"
printf '#!/bin/sh\necho MINGW64_NT-10.0\n' >"$FAKE/cleanwinstub/uname"
printf '#!/bin/sh\necho "C:\\Users\\tester\\.local\\bin"\n' >"$FAKE/cleanwinstub/cygpath"
printf '#!/bin/sh\necho "$@" >"$POWERSHELL_LOG"\nexit 0\n' >"$FAKE/cleanwinstub/powershell.exe"
cp "$FAKE/cleanstub/docker" "$FAKE/cleanwinstub/docker"
chmod +x "$FAKE/cleanwinstub/"*
: >"$FAKE/ps-clean.log"
: >"$FAKE/docker-cleanwin.log"
POWERSHELL_LOG="$FAKE/ps-clean.log" DOCKER_LOG="$FAKE/docker-cleanwin.log" \
  HOME="$FAKE/winhome" PATH="$FAKE/cleanwinstub:$PATH" \
  bash "$ROOT/cleanup.sh" >"$FAKE/winclean.log" 2>&1 || { cat "$FAKE/winclean.log" >&2; fail "Windows cleanup failed"; }
[ ! -e "$FAKE/winhome/.local/bin/relativity.cmd" ] ||
  fail "Windows cleanup left the .cmd shim behind"
grep -q 'SetEnvironmentVariable' "$FAKE/ps-clean.log" ||
  fail "Windows cleanup did not update the User PATH"

# Restore the launcher used by the E2E steps below.
HOME="$FAKE/home" bash "$ROOT/install.sh" >/dev/null
[ -x "$FAKE/home/.local/bin/relativity" ] || fail "re-install after cleanup failed"

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
