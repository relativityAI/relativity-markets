# relativity installer for Windows (PowerShell) — no Git, no clone, no Git Bash.
#
#   irm https://raw.githubusercontent.com/relativityAI/relativity-markets/main/install.ps1 | iex
#
# From a checkout, run it directly (powershell -File install.ps1) to use the
# repo's own files instead of downloading. Re-running is safe.
$ErrorActionPreference = 'Stop'
$Base = if ($env:RELATIVITY_RAW_BASE) { $env:RELATIVITY_RAW_BASE } else { 'https://raw.githubusercontent.com/relativityAI/relativity-markets/main' }

# --- Docker (Desktop with the Compose plugin) ------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required to run Relativity. Install Docker Desktop: https://docs.docker.com/get-docker/'
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose is missing — update Docker Desktop, then re-run this installer.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running — start Docker Desktop, then re-run this installer.' }

# --- Files: checkout when present, otherwise download ----------------------
$Dir = Join-Path $env:LOCALAPPDATA 'relativity'
$Root = $PSScriptRoot
if ($Root -and (Test-Path (Join-Path $Root 'docker-compose.yml')) -and (Test-Path (Join-Path $Root 'bin\relativity-run.ps1'))) {
  # Checkout: use the repo files in place — `git pull` keeps them fresh.
  $Bin = Join-Path $Root 'bin'
  Write-Host "Using the checkout at $Root"
} else {
  $Bin = Join-Path $Dir 'bin'
  New-Item -ItemType Directory -Force -Path $Bin | Out-Null
  # Pre-create the data dir as this user — Docker would create it root-owned.
  New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'services\data') | Out-Null
  Write-Host "Downloading Relativity to $Dir ..."
  Invoke-WebRequest -UseBasicParsing "$Base/docker-compose.yml" -OutFile (Join-Path $Dir 'docker-compose.yml')
  Invoke-WebRequest -UseBasicParsing "$Base/bin/relativity.cmd" -OutFile (Join-Path $Bin 'relativity.cmd')
  Invoke-WebRequest -UseBasicParsing "$Base/bin/relativity-run.ps1" -OutFile (Join-Path $Bin 'relativity-run.ps1')
}

# --- Put `relativity` on the user PATH ------------------------------------
$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($UserPath -split ';') -notcontains $Bin) {
  [Environment]::SetEnvironmentVariable('Path', $(if ($UserPath) { $UserPath.TrimEnd(';') + ';' + $Bin } else { $Bin }), 'User')
  Write-Host "Added $Bin to your PATH."
} else {
  Write-Host 'relativity command is already installed.'
}

Write-Host ''
Write-Host 'Done. Open a NEW terminal and type:  relativity'
Write-Host '  * opens your browser (http://127.0.0.1:8501); relativity stop stops it'
Write-Host '  * first run downloads the Docker images — a few minutes'
