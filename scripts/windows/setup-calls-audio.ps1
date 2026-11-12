# JARVIS - sets up the audio for calls through Phone Link or WhatsApp Desktop (run once, as administrator).
#  1. installs VB-Audio Virtual Cable (free) if it isn't there
#  2. sets Phone Link's and WhatsApp Desktop's microphone to "CABLE Output" (only those two - nothing else changes)
# Phone Link's speaker output stays on your normal speakers, so JARVIS can hear the other person.
# Usage (from the JARVIS folder):  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-calls-audio.ps1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

# --- run as administrator (installing a sound driver needs it) ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Say 'Asking Windows for administrator rights (click Yes)...' Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
  exit
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tools = Join-Path $root 'tools\calls-audio'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

function HasCable { [bool](Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'VB-Audio Virtual Cable|CABLE' }) }

# --- 1. VB-Audio Virtual Cable ---
if (HasCable) { Say 'VB-Audio Virtual Cable is already installed.' Green }
else {
  Say 'Downloading VB-Audio Virtual Cable (free, from vb-audio.com)...'
  $zip = Join-Path $tools 'vbcable.zip'
  $ok = $false
  foreach ($u in @('https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip', 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip')) {
    try { Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing; $ok = $true; break } catch { }
  }
  if (-not $ok) {
    Say "Couldn't download it automatically. Opening the download page: install VBCABLE_Setup_x64.exe (Run as administrator > Install Driver), then run this script again." Red
    Start-Process 'https://vb-audio.com/Cable/'
    exit 1
  }
  $dir = Join-Path $tools 'vbcable'
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  $setup = Get-ChildItem -Path $dir -Recurse -Filter 'VBCABLE_Setup_x64.exe' | Select-Object -First 1
  if (-not $setup) { Say 'The download did not contain VBCABLE_Setup_x64.exe.' Red; exit 1 }
  Say 'Installing the driver (if Windows asks "Would you like to install this device software?", click Install)...'
  Start-Process -FilePath $setup.FullName -ArgumentList '-i', '-h' -Wait
  Start-Sleep -Seconds 4
  if (HasCable) { Say 'VB-Audio Virtual Cable installed.' Green }
  else {
    Say 'The silent install did not finish - opening the installer: click "Install Driver", then run this script again.' Yellow
    Start-Process -FilePath $setup.FullName -Verb RunAs -Wait
    if (-not (HasCable)) { Say 'Still not installed. Restart the laptop and run this script again.' Red; exit 1 }
  }
}

# --- 2. Phone Link's microphone = CABLE Output (via NirSoft SoundVolumeView, a free command-line tool) ---
$svv = Join-Path $tools 'SoundVolumeView.exe'
if (-not (Test-Path $svv)) {
  Say 'Downloading SoundVolumeView (free, from nirsoft.net) to set Phone Link''s microphone...'
  $z = Join-Path $tools 'svv.zip'
  Invoke-WebRequest -Uri 'https://www.nirsoft.net/utils/soundvolumeview-x64.zip' -OutFile $z -UseBasicParsing
  Expand-Archive -Path $z -DestinationPath $tools -Force
}
# Phone Link has to be running for Windows to remember its microphone
if (-not (Get-Process -Name PhoneExperienceHost -ErrorAction SilentlyContinue)) {
  Say 'Starting Phone Link...'
  Start-Process 'explorer.exe' 'shell:AppsFolder\Microsoft.YourPhone_8wekyb3d8bbwe!App'
  Start-Sleep -Seconds 8
}
$cableMic = 'VB-Audio Virtual Cable\Device\CABLE Output\Capture'
# WhatsApp Desktop too (JARVIS can call through it instead of Phone Link)
$waApp = Get-AppxPackage -Name '*WhatsAppDesktop*' -ErrorAction SilentlyContinue
if ($waApp -and -not (Get-Process -Name WhatsApp, WhatsApp.Root -ErrorAction SilentlyContinue)) {
  Say 'Starting WhatsApp Desktop...'
  Start-Process 'explorer.exe' "shell:AppsFolder\$($waApp.PackageFamilyName)!App"
  Start-Sleep -Seconds 8
}
# the new WhatsApp records sound through Microsoft Edge WebView2 (msedgewebview2.exe), so that gets the cable too
foreach ($p in @('PhoneExperienceHost.exe', 'YourPhone.exe', 'WhatsApp.exe', 'WhatsApp.Root.exe', 'msedgewebview2.exe')) {
  & $svv /SetAppDefault $cableMic all $p | Out-Null
}
Start-Sleep -Seconds 1
Say ''
Say 'Done:' Green
Say '  - Phone Link''s and WhatsApp Desktop''s microphone is now "CABLE Output" (JARVIS''s voice goes into calls).'
Say '  - Your normal microphone and speakers are unchanged; Phone Link still plays calls on your speakers.'
Say ''
Say 'Next:' Cyan
Say '  1. Restart the laptop once (new sound drivers like a restart).'
Say '  2. Start the orb (npm run orb) > tray icon > Prospect calls... > "JARVIS''s voice goes to" = CABLE Input > Run check > Start calling.'
Say '  3. On the dashboard: "JARVIS, give me a test call".'
Say ''
Say 'To check it yourself: Settings > System > Sound > Volume mixer > Phone Link > Input device should say CABLE Output.' DarkGray
