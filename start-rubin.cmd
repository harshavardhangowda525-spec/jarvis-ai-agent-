@echo off
rem Double-click to start RUBEN (it runs on its own; JARVIS doesn't need to be running).
setlocal
cd /d "%~dp0"
title RUBEN
call "%~dp0scripts\windows\ensure-node.cmd" || goto :fail
if not exist "node_modules\next\package.json" (
  echo Installing packages (first time, a few minutes^)...
  call npm install --no-audit --no-fund || goto :fail
)
call npm run rubin
goto :end
:fail
echo.
echo RUBEN couldn't start - see the message above.
:end
echo.
pause
