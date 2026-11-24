@echo off
rem relativity - Windows entry point. Delegates to relativity-run.ps1 next to
rem this file (a checkout's bin\, or %LOCALAPPDATA%\relativity\bin). No Git
rem Bash required.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0relativity-run.ps1" %*
exit /b %ERRORLEVEL%
