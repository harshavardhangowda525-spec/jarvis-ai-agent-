@echo off
rem Free disk space safely: temp files, caches, Windows Update downloads, Recycle Bin, JARVIS leftovers.
rem Never your documents, photos, videos, downloads or apps. Asks for administrator rights.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs" & exit /b)
cd /d "%~dp0"
node scripts\free-space.mjs %*
pause
