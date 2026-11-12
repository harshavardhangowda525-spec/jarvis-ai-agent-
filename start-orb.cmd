@echo off
rem Double-click to start the JARVIS desktop orb (it makes the calls). Start JARVIS first (start-jarvis.cmd).
setlocal
cd /d "%~dp0"
title JARVIS orb
call "%~dp0scripts\windows\ensure-node.cmd" || goto :fail
if not exist "node_modules\next\package.json" (
  echo Installing packages (first time, a few minutes^)...
  call npm install --no-audit --no-fund || goto :fail
)
call npm run orb
goto :end
:fail
echo.
echo The orb couldn't start - see the message above.
:end
echo.
pause
