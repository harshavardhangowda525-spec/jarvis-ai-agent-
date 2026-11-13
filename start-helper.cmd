@echo off
rem Double-click when JARVIS runs on Vercel: starts ONLY the JARVIS helper on this laptop
rem (calls through WhatsApp / Phone Link, Chrome + screen control, Google Maps lead finder, background jobs).
rem It connects to the JARVIS_URL in operator\.env. For JARVIS fully on this laptop use start-jarvis.cmd instead.
setlocal
cd /d "%~dp0operator"
title JARVIS helper
call "%~dp0scripts\windows\ensure-node.cmd" || goto :end
findstr /b /c:"JARVIS_URL=" .env >nul 2>&1 || (
  echo operator\.env has no JARVIS_URL yet.
  echo In JARVIS on Vercel: CRM ^> "Connect this laptop", copy the two lines it shows into operator\.env, then run this again.
  goto :end
)
if not exist "node_modules\playwright\package.json" (
  echo Installing the helper (first time^)...
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  call npm install --no-audit --no-fund || goto :end
)
node run.mjs
:end
echo.
pause
