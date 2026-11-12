@echo off
rem Double-click to free disk space JARVIS has piled up (caches and leftovers only).
rem Close JARVIS and the orb first, so their caches aren't in use.
setlocal
cd /d "%~dp0"
title JARVIS clean-up
call "%~dp0scripts\windows\ensure-node.cmd" || goto :end
node scripts\clean.mjs
:end
pause
