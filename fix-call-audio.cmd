@echo off
rem JARVIS - set every sound setting for WhatsApp calls in one go (fixes "I hear my own voice" echo):
rem   - WhatsApp's microphone = CABLE Output (only JARVIS's voice goes into the call)
rem   - WhatsApp's sound      = your speakers (never the cable)
rem   - Windows' default speaker = Speakers, default microphone = Microphone (never Stereo Mix / the cable)
rem   - "Listen to this device" OFF on the cable, Stereo Mix and the microphone (those loop sound back)
rem Then restarts WhatsApp so it picks the settings up.
setlocal
set SVV=%~dp0tools\calls-audio\SoundVolumeView.exe
if not exist "%SVV%" (
  echo The sound tool isn't installed yet. Run this once as administrator first:
  echo   powershell -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-calls-audio.ps1"
  pause & exit /b 1
)
echo Setting up call audio...
"%SVV%" /SetDefault "Speakers" all
"%SVV%" /SetDefault "Microphone" all
for %%D in ("CABLE Output" "Stereo Mix" "Microphone") do "%SVV%" /SetListenToThisDevice %%D 0
for %%P in (msedgewebview2.exe WhatsApp.exe WhatsApp.Root.exe) do (
  "%SVV%" /SetAppDefault "VB-Audio Virtual Cable\Device\CABLE Output\Capture" all %%P
  "%SVV%" /SetAppDefault "Speakers" all %%P
)
echo Restarting WhatsApp...
taskkill /F /IM WhatsApp.Root.exe >nul 2>&1
taskkill /F /IM WhatsApp.exe >nul 2>&1
timeout /t 2 >nul
start "" "whatsapp:"
echo.
echo Done. Check:  Windows+R  ^>  mmsys.cpl
echo   Playback tab:  "Speakers"   has the green tick (CABLE Input does NOT)
echo   Recording tab: "Microphone" has the green tick (NOT Stereo Mix, NOT CABLE Output)
echo Then ask JARVIS for a test call.
pause
