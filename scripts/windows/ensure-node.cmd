@echo off
rem Makes sure Node.js (node + npm) can be found; installs it if it's missing.
rem Called by start-jarvis.cmd and start-rubin.cmd. Changes only YOUR user PATH (no admin needed),
rem and only adds the Node.js folder to it.

where node >nul 2>nul && where npm >nul 2>nul && goto :ok

rem --- 1. Node.js installed but Windows lost track of it: look in the usual places ---
set "NODEDIR="
for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs" "%NVM_SYMLINK%" "%LOCALAPPDATA%\Volta\bin") do (
  if not defined NODEDIR if exist "%%~D\node.exe" set "NODEDIR=%%~D"
)
if defined NODEDIR goto :addpath

rem --- 2. Not installed: install the LTS version with winget (built into Windows 10/11) ---
echo Node.js isn't installed on this PC - installing it now (a minute or two)...
where winget >nul 2>nul || goto :nowinget
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
if exist "%ProgramFiles%\nodejs\node.exe" (set "NODEDIR=%ProgramFiles%\nodejs" & goto :addpath)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (set "NODEDIR=%LOCALAPPDATA%\Programs\nodejs" & goto :addpath)
echo.
echo The Node.js install didn't finish. Install it from https://nodejs.org (the LTS button), then run this again.
start "" "https://nodejs.org/en/download"
exit /b 1

:nowinget
echo.
echo This PC can't install Node.js by itself (winget isn't available).
echo Opening https://nodejs.org - download the LTS version, install it, then run this file again.
start "" "https://nodejs.org/en/download"
exit /b 1

:addpath
rem for this window...
set "PATH=%NODEDIR%;%APPDATA%\npm;%PATH%"
rem ...and for good (your user PATH), unless it's already there
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = $env:NODEDIR; $p = [Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p = '' }; if (($p -split ';') -notcontains $d) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $d).TrimStart(';')), 'User'); Write-Host ('Added ' + $d + ' to your PATH.') }"
where node >nul 2>nul || (echo Node.js still can't be found. Restart the PC and run this again. & exit /b 1)

:ok
for /f "delims=" %%V in ('node -v') do echo Node.js %%V found.
exit /b 0
