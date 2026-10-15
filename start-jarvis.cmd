@echo off
rem Double-click to start JARVIS. Fixes "npm is not recognized" by itself
rem (finds or installs Node.js), installs packages if needed, then runs npm run local.
setlocal
cd /d "%~dp0"
title JARVIS
call "%~dp0scripts\windows\ensure-node.cmd" || goto :fail
if not exist "node_modules\next\package.json" (
  echo Installing JARVIS packages (first time, a few minutes^)...
  call npm install --no-audit --no-fund || goto :fail
)
call npm run local
goto :end
:fail
echo.
echo JARVIS couldn't start - see the message above.
:end
echo.
pause
