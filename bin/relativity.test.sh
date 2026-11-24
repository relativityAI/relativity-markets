#!/bin/sh
# E2E test for install.sh + bin/relativity: checkout install, piped/download
# install, uninstall (data kept), package-manager guards, and the detached
# start / already-running / stop cycle. Needs Docker and a FREE port 8501
# (stop a running app first); the first run downloads images (a few minutes).
#   sh bin/relativity.test.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=http://127.0.0.1:8501
FAKE=$(mktemp -d)

cleanup() {
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

# 2. checkout install links the command (real repo, fake HOME — real HOME untouched)
HOME="$FAKE/home" bash "$ROOT/install.sh" >/dev/null
[ -x "$FAKE/home/.local/bin/relativity" ] || fail "install.sh did not link the command"
[ "$(readlink "$FAKE/home/.local/bin/relativity")" = "$ROOT/bin/relativity" ] ||
  fail "symlink does not point at the real repo"

# 2a. re-running is idempotent: same link, one PATH line, no duplicate edits
out=$(HOME="$FAKE/home" bash "$ROOT/install.sh")
echo "$out" | grep -q "already installed" || fail "install.sh did not report an existing install"
path_lines=$(grep -hF 'export PATH="$HOME/.local/bin:$PATH"' \
  "$FAKE/home/.profile" "$FAKE/home/.bashrc" "$FAKE/home/.zshrc" 2>/dev/null | wc -l)
[ "$path_lines" -le 1 ] || fail "re-run duplicated the PATH line"

# 2b. Linux: when Docker/Compose/curl are already present, no package manager
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

# 2c. Linux: a missing Compose plugin is installed via apt (stubbed here), then
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

# 3. piped/download install: no checkout — files come from RELATIVITY_RAW_BASE
#    (file:// here, so no network). Simulates `curl … | sh` by piping the script.
mkdir -p "$FAKE/dl"
(cd "$FAKE/dl" && HOME="$FAKE/dlhome" RELATIVITY_RAW_BASE="file://$ROOT" \
  sh <"$ROOT/install.sh" >"$FAKE/dl.log" 2>&1) || { cat "$FAKE/dl.log" >&2; fail "download install failed"; }
grep -q "Downloading Relativity" "$FAKE/dl.log" || fail "download mode: did not download"
[ -f "$FAKE/dlhome/.local/share/relativity/docker-compose.yml" ] ||
  fail "download mode: compose file missing"
[ -x "$FAKE/dlhome/.local/share/relativity/bin/relativity" ] ||
  fail "download mode: launcher missing"
[ "$(readlink "$FAKE/dlhome/.local/bin/relativity")" = "$FAKE/dlhome/.local/share/relativity/bin/relativity" ] ||
  fail "download mode: symlink does not point at the downloaded launcher"
cmp -s "$ROOT/docker-compose.yml" "$FAKE/dlhome/.local/share/relativity/docker-compose.yml" ||
  fail "download mode: downloaded compose file differs from the checkout"

# 4. uninstall (download mode): stops the stack, removes command + PATH,
#    keeps data. Stub docker so no real containers/images are touched.
mkdir -p "$FAKE/dlhome/.local/share/relativity/services/data"
: >"$FAKE/dlhome/.local/share/relativity/services/data/relativity.db"
mkdir -p "$FAKE/cleanstub"
cat >"$FAKE/cleanstub/docker" <<'STUB'
#!/bin/sh
echo "$@" >>"$DOCKER_LOG"
exit 0
STUB
chmod +x "$FAKE/cleanstub/docker"
: >"$FAKE/docker-clean.log"
DOCKER_LOG="$FAKE/docker-clean.log" HOME="$FAKE/dlhome" PATH="$FAKE/cleanstub:$PATH" \
  "$FAKE/dlhome/.local/bin/relativity" uninstall >"$FAKE/un.log" 2>&1 ||
  { cat "$FAKE/un.log" >&2; fail "uninstall failed"; }
[ ! -e "$FAKE/dlhome/.local/bin/relativity" ] || fail "uninstall left the command behind"
[ ! -e "$FAKE/dlhome/.local/share/relativity/docker-compose.yml" ] ||
  fail "uninstall left the compose file behind"
[ -f "$FAKE/dlhome/.local/share/relativity/services/data/relativity.db" ] ||
  fail "uninstall deleted local data"
path_lines=$(grep -hF 'export PATH="$HOME/.local/bin:$PATH"' \
  "$FAKE/dlhome/.profile" "$FAKE/dlhome/.bashrc" "$FAKE/dlhome/.zshrc" 2>/dev/null | wc -l)
[ "$path_lines" -eq 0 ] || fail "uninstall left a PATH entry behind"
grep -q 'docker-compose.yml down' "$FAKE/docker-clean.log" ||
  fail "uninstall did not stop the stack"

# 5. uninstall from a checkout must NOT delete the repo's files.
: >"$FAKE/docker-clean2.log"
DOCKER_LOG="$FAKE/docker-clean2.log" HOME="$FAKE/home" PATH="$FAKE/cleanstub:$PATH" \
  "$FAKE/home/.local/bin/relativity" uninstall >"$FAKE/un2.log" 2>&1 ||
  { cat "$FAKE/un2.log" >&2; fail "checkout uninstall failed"; }
[ ! -e "$FAKE/home/.local/bin/relativity" ] || fail "checkout uninstall left the command behind"
[ -f "$ROOT/bin/relativity" ] || fail "uninstall deleted the checkout launcher"
[ -f "$ROOT/docker-compose.yml" ] || fail "uninstall deleted the checkout compose file"
[ -f "$ROOT/services/searxng/settings.yml" ] || fail "uninstall deleted checkout files"

# Restore the install for the E2E steps below.
HOME="$FAKE/home" bash "$ROOT/install.sh" >/dev/null
[ -x "$FAKE/home/.local/bin/relativity" ] || fail "re-install after uninstall failed"

# 6. port must be free (an app typed by a human beats the test)
command -v docker >/dev/null 2>&1 || fail "docker missing"
if curl -fsS -o /dev/null --max-time 2 "$URL/health" 2>/dev/null; then
  echo "SKIP: app already running on $URL — run \`relativity stop\` (or docker compose down), then re-run this test."
  exit 0
fi

# 7. start via the symlink; the launcher is detached and exits once healthy.
"$FAKE/home/.local/bin/relativity" >"$FAKE/launch.log" 2>&1 ||
  { tail -30 "$FAKE/launch.log" >&2; fail "launcher failed"; }
wait_healthy || { tail -30 "$FAKE/launch.log" >&2; fail "app not healthy after start"; }
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

# 8. second invocation, from another directory: still refreshes, then detects
#    the running app (the README promises it works from any folder)
out=$(cd /tmp && "$FAKE/home/.local/bin/relativity")
echo "$out" | grep -q "Checking for updates..." || fail "second run skipped the update check"
echo "$out" | grep -q "already running" || fail "second run did not detect running app"

# 8b. a run against an already-running app on an older image must recreate it.
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

# 9. stop path: `relativity stop` takes the stack down and frees the port.
"$FAKE/home/.local/bin/relativity" stop >/dev/null ||
  fail "relativity stop failed"
wait_port_free || fail "port 8501 still serving after stop"

echo "relativity install/run: all checks passed"
