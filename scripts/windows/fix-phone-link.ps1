# JARVIS - fixes Phone Link calls pairing from the terminal ("We couldn't add your device").
#  1. lists the phones / devices paired over Bluetooth and removes the ones you pick (keeps the rest)
#  2. restarts the Bluetooth service
#  3. resets the Phone Link app (it forgets its broken pairing; you link the phone again)
#  4. gets the latest Intel Bluetooth driver (Intel Driver & Support Assistant)
#  5. opens Phone Link so you can press Calls -> Set up
# Nothing is deleted except the pairings you choose. Usage (from the JARVIS folder):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\fix-phone-link.ps1
$ErrorActionPreference = 'Continue'
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

# --- run as administrator (restarting Bluetooth and removing pairings needs it) ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Say 'Asking Windows for administrator rights (click Yes)...' Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
  exit
}

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class JvBt {
  [DllImport("bthprops.cpl", SetLastError = true)] public static extern int BluetoothRemoveDevice(ref ulong address);
}
"@

# --- 1. paired devices ---
Say ''
Say '== Step 1: devices paired with this laptop ==' Cyan
$seen = @{}
$devs = @()
foreach ($d in Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue) {
  if ($d.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_([0-9A-F]{12})\\') {
    $addr = $Matches[2]
    if ($seen.ContainsKey($addr)) { continue }
    $seen[$addr] = $true
    $devs += [pscustomobject]@{ N = $devs.Count + 1; Name = $d.FriendlyName; Address = $addr }
  }
}
if (-not $devs.Count) { Say 'No paired devices found.' Yellow }
else {
  $devs | ForEach-Object { Say ("  {0,2}. {1}  ({2})" -f $_.N, $_.Name, $_.Address) }
  Say ''
  Say 'Type the numbers to REMOVE, separated by commas - remove every PHONE (including the POCO, it gets paired again fresh).' Yellow
  Say 'Leave headphones, speakers and the TV. Just press Enter to skip.' Yellow
  $pick = Read-Host 'Remove'
  foreach ($n in ($pick -split '[,\s]+' | Where-Object { $_ -match '^\d+$' })) {
    $d = $devs | Where-Object { $_.N -eq [int]$n }
    if (-not $d) { continue }
    $a = [Convert]::ToUInt64($d.Address, 16)
    $r = [JvBt]::BluetoothRemoveDevice([ref]$a)
    if ($r -eq 0) { Say "  Removed $($d.Name)." Green } else { Say "  Couldn't remove $($d.Name) (code $r) - remove it in Settings > Bluetooth & devices." Red }
  }
}

# --- 2. restart Bluetooth ---
Say ''
Say '== Step 2: restarting Bluetooth ==' Cyan
try { Restart-Service -Name bthserv -Force -ErrorAction Stop; Say '  Bluetooth service restarted.' Green }
catch { Say "  Couldn't restart it: $($_.Exception.Message)" Red }
Say '  (If the phone can''t find the laptop: Settings > Devices > More Bluetooth options > tick "Allow Bluetooth devices to find this PC".)'

# --- 3. reset Phone Link ---
Say ''
Say '== Step 3: resetting Phone Link ==' Cyan
Get-Process -Name PhoneExperienceHost, YourPhone -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$pl = Get-AppxPackage -Name Microsoft.YourPhone -ErrorAction SilentlyContinue
if (-not $pl) { Say '  Phone Link isn''t installed - get it from the Microsoft Store ("Phone Link").' Red }
else {
  try { $pl | Reset-AppxPackage -ErrorAction Stop; Say '  Phone Link reset (you''ll link the phone again).' Green }
  catch { Say '  Couldn''t reset it automatically - Settings > Apps > Phone Link > Advanced options > Reset.' Yellow }
}

# --- 4. latest Intel Bluetooth driver ---
Say ''
Say '== Step 4: Intel Bluetooth driver ==' Cyan
$bt = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object { $_.DeviceName -match 'Intel.*Bluetooth' } | Select-Object -First 1
if ($bt) { $when = ''; try { $when = ' from ' + ([datetime]$bt.DriverDate).ToString('yyyy-MM-dd') } catch { }; Say "  Now: $($bt.DeviceName), driver $($bt.DriverVersion)$when" }
$ans = Read-Host '  Install / open Intel Driver & Support Assistant to update it? (Y/N)'
if ($ans -match '^[Yy]') {
  $wg = Get-Command winget -ErrorAction SilentlyContinue
  if ($wg) {
    winget install --id Intel.IntelDriverAndSupportAssistant -e --accept-package-agreements --accept-source-agreements
    Say '  When it opens in your browser, install the Intel Wireless Bluetooth update, then RESTART the laptop.' Yellow
    Start-Process 'https://www.intel.com/content/www/us/en/support/intel-driver-support-assistant.html'
  } else {
    Say '  Opening Intel''s page - download "Intel Driver & Support Assistant", run it, install the Bluetooth update, then restart.' Yellow
    Start-Process 'https://www.intel.com/content/www/us/en/support/intel-driver-support-assistant.html'
  }
}

# --- 5. Phone Link ---
Say ''
Say '== Step 5: set up calls ==' Cyan
Say '  On the POCO: open Link to Windows and link it again (scan the QR code Phone Link shows).'
Say '  Then in Phone Link: Calls > Set up > Begin pairing, and accept the code on BOTH screens (Windows + N shows hidden laptop prompts).'
Start-Process 'explorer.exe' 'shell:AppsFolder\Microsoft.YourPhone_8wekyb3d8bbwe!App'
Say ''
Say 'Done. If the driver was updated, restart the laptop first, then do step 5.' Green
