@echo off
rem Fixes Phone Link calls pairing (asks for administrator rights).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\fix-phone-link.ps1"
