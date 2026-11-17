@echo off
rem relativity - Windows shim for the POSIX launcher. Git Bash is a prerequisite.
rem %~dp0relativity is the symlink install.sh puts next to this file, pointing
rem at the repo's bin/relativity - so `git pull` updates the launcher too.
setlocal
set "SCRIPT=%~dp0relativity"

set "BASH_EXE="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not defined BASH_EXE for %%F in (bash.exe) do set "BASH_EXE=%%~$PATH:F"

if not defined BASH_EXE (
  echo Git Bash is required. Install: https://git-scm.com/download/win 1>&2
  exit /b 1
)

"%BASH_EXE%" "%SCRIPT%" %*
exit /b %ERRORLEVEL%
