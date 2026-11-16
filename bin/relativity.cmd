@echo off
rem relativity - Windows entry point (Docker mode, no Node needed).
cd /d "%~dp0.."
where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is required. Install: https://docs.docker.com/get-docker/
  exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 (
  echo Docker Compose is required. Install Docker from https://docs.docker.com/get-docker/
  exit /b 1
)

curl -fsS --max-time 2 http://127.0.0.1:8080/health >nul 2>&1
if not errorlevel 1 (
  echo Relativity is already running: http://127.0.0.1:8080
  start "" http://127.0.0.1:8080
  exit /b 0
)

echo Starting Relativity: http://127.0.0.1:8080 - Ctrl+C stops it
docker image inspect ghcr.io/relativityai/relativity-markets:latest >nul 2>&1
if errorlevel 1 echo ^(first run downloads the Docker images - a few minutes^)
rem start now on local images; refresh ghcr in the background for the next run
start "" /b cmd /c "docker compose pull >nul 2>&1"
start "" /b cmd /c "docker compose up -d >nul 2>&1"

set /a tries=0
:poll
curl -fsS --max-time 2 http://127.0.0.1:8080/health >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% geq 600 goto failed
timeout /t 1 /nobreak >nul
goto poll

:ready
start "" http://127.0.0.1:8080
echo Relativity is running: http://127.0.0.1:8080 - Ctrl+C stops it
docker compose up
exit /b 0

:failed
echo Relativity failed to start. Docker output:
docker compose logs --tail=20
exit /b 1
