@echo off
rem Shows why Phone Link calls will not pair (read-only).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-phone-link.ps1"
pause
