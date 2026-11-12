@echo off
rem What is filling the disk? READ-ONLY - deletes nothing.
cd /d "%~dp0"
node scripts\find-space.mjs %*
pause
