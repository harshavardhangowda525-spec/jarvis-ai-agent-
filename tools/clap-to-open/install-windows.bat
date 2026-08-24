@echo off
REM ============================================================================
REM  JARVIS clap launcher - one-click installer for Windows.
REM
REM  This installs the two Python dependencies and makes the clap listener
REM  start automatically (and invisibly) every time you log in, so JARVIS is
REM  always ready to open on a double clap - no terminal window to keep open.
REM
REM  Just double-click this file. Run it once.
REM ============================================================================
setlocal

echo.
echo  Installing JARVIS clap launcher...
echo.

REM 1) Make sure Python is available.
where python >nul 2>nul
if errorlevel 1 (
  echo  [!] Python was not found. Install Python 3 from https://www.python.org/downloads/
  echo      IMPORTANT: tick "Add python.exe to PATH" during install, then re-run this.
  echo.
  pause
  exit /b 1
)

REM 2) Install dependencies.
echo  Installing dependencies (sounddevice, numpy)...
python -m pip install --quiet --upgrade sounddevice numpy
if errorlevel 1 (
  echo  [!] Dependency install failed. Try:  python -m pip install sounddevice numpy
  pause
  exit /b 1
)

REM 3) Create a hidden-launch VBS in the Startup folder so it runs at login
REM    with no console window. pythonw.exe runs Python without a window.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\jarvis-clap.vbs"
set "SCRIPT=%~dp0jarvis_clap.py"

>"%VBS%" echo Set WShell = CreateObject("WScript.Shell")
>>"%VBS%" echo WShell.Run "pythonw """ ^& "%SCRIPT%" ^& """", 0, False

echo.
echo  Done. JARVIS clap launcher will start automatically at every login.
echo.
echo  Starting it now so you don't have to reboot...
start "" pythonw "%SCRIPT%"

echo.
echo  Clap twice anywhere to open JARVIS.
echo.
echo  To change the URL it opens, edit DEFAULT_URL near the top of jarvis_clap.py
echo  (or edit the .vbs in your Startup folder to add:  --url https://your-app ).
echo.
echo  To stop auto-start later: press Win+R, type  shell:startup  , and delete
echo  jarvis-clap.vbs from the folder that opens.
echo.
pause
