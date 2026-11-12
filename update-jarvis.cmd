@echo off
rem Double-click to get the latest JARVIS (then double-click start-jarvis.cmd).
setlocal
cd /d "%~dp0"
title JARVIS update
git pull origin claude/jarvis-ai-agent-1h0a1c || goto :fail
echo.
echo JARVIS is up to date. Now double-click start-jarvis.cmd (calls run inside JARVIS - no orb needed).
goto :end
:fail
echo.
echo The update didn't work - see the message above.
:end
echo.
pause
