# relativity — Windows launcher (no Git Bash). Invoked by relativity.cmd.
#   relativity            start: refresh the app image, start the stack and
#                         open http://127.0.0.1:8501 once it is healthy
#   relativity stop       stop the stack
#   relativity uninstall  stop + remove the command (your data is kept)
param([string]$Command = 'up')

$Url = 'http://127.0.0.1:8501'
$Image = 'ghcr.io/relativityai/relativity-markets:latest'
# Script lives in <root>\bin — root holds docker-compose.yml (checkout or
# %LOCALAPPDATA%\relativity), mirroring bin/relativity on Unix.
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root 'docker-compose.yml'

function Test-Healthy {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$Url/health" | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Open-Browser { Start-Process $Url }

function Wait-And-Open {
  for ($i = 0; $i -lt 300; $i++) {
    if (Test-Healthy) { Open-Browser; return }
    Start-Sleep -Seconds 1
  }
  Write-Warning "App did not become healthy at $Url"
}

function Require-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required. Install: https://docs.docker.com/get-docker/ — then re-run the installer.'
  }
  docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose plugin missing — update Docker Desktop.' }
  if (-not (Test-Path $ComposeFile)) { throw "Missing $ComposeFile — re-run the installer." }
}

switch ($Command) {
  'up' {
    Require-Docker
    # Refresh the app image BEFORE anything else, so every invocation picks up
    # the newest published build.
    docker image inspect $Image *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host '(first run downloads the Docker images — a few minutes)' }
    Write-Host 'Checking for updates...'
    docker compose -f $ComposeFile pull app
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not check for updates — starting with the local image.' }

    $latest = docker image inspect $Image -f '{{.Id}}' 2>$null
    $running = docker compose -f $ComposeFile ps -q app 2>$null

    if ($running -and (Test-Healthy)) {
      $current = docker inspect -f '{{.Image}}' $running 2>$null
      if ($latest -and $current -and ($current -ne $latest)) {
        Write-Host 'Update available — restarting the app with the latest image...'
        docker compose -f $ComposeFile up -d --no-deps --force-recreate app
        Wait-And-Open
      } else {
        Write-Host "Relativity is already running: $Url"
        Open-Browser
      }
      exit 0
    }

    Write-Host "Starting Relativity: $Url"
    # Pre-create the data dir as this user — Docker would create it root-owned
    # and the container (uid 1000) could not write its database.
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'services\data') | Out-Null
    docker compose -f $ComposeFile up -d
    Wait-And-Open
    Write-Host 'Stop it with:  relativity stop'
  }

  'stop' {
    Require-Docker
    Write-Host 'Stopping Relativity...'
    docker compose -f $ComposeFile down
    Write-Host 'Stopped.'
  }

  'uninstall' {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
      docker compose -f $ComposeFile down 2>$null
    }
    $Bin = $PSScriptRoot
    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($UserPath) {
      $kept = ($UserPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $Bin }) -join ';'
      [Environment]::SetEnvironmentVariable('Path', $kept, 'User')
      Write-Host 'Removed the PATH entry the installer added.'
    }
    if (Test-Path (Join-Path $Root '.git')) {
      Write-Host "Left $Root untouched (checkout — your files and data stay)."
    } else {
      Remove-Item -Recurse -Force $Bin -ErrorAction SilentlyContinue
      Remove-Item -Force $ComposeFile -ErrorAction SilentlyContinue
      if (Test-Path (Join-Path $Root 'services\data')) {
        Write-Host "Kept your data: $(Join-Path $Root 'services\data')"
      } else {
        Remove-Item -Recurse -Force (Join-Path $Root 'services') -ErrorAction SilentlyContinue
      }
      # Non-recursive: succeeds only when nothing (e.g. your data) is left.
      Remove-Item -Force $Root -ErrorAction SilentlyContinue
    }
    Write-Host 'Relativity uninstalled.'
  }

  default {
    Write-Error 'usage: relativity [up|stop|uninstall]'
    exit 1
  }
}
