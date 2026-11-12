@echo off
rem Double-click: finds and fixes the call echo, makes JARVIS's voice clear, tells JARVIS, then JARVIS calls you.
rem Only Windows sound settings change (nothing is deleted).
setlocal
cd /d "%~dp0"
title JARVIS - fix call echo
call "%~dp0scripts\windows\ensure-node.cmd" || goto :end
node "%~dp0scripts\windows\fix-echo.mjs"
:end
echo.
pause
