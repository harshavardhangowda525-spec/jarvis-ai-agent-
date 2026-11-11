# JARVIS 2.0 - window control on Windows (run by executor.cjs with the action as JSON in $env:JARVIS_ORB_ARGS).
# Fixed code; the action and its arguments arrive as data, never as script text.
# Lists windows (and which one is in front), brings one to the front, minimises / maximises /
# restores / closes it, puts two side by side, or sends keys to it. Closing and typing only ever
# run after you clicked "Yes" in JARVIS's own confirmation dialog.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$a = $env:JARVIS_ORB_ARGS | ConvertFrom-Json
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class JarvisW {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
}
"@
function ForegroundPid { $fp = 0; [JarvisW]::GetWindowThreadProcessId([JarvisW]::GetForegroundWindow(), [ref]$fp) | Out-Null; [int]$fp }
if ($a.op -eq 'list') {
  $front = ForegroundPid
  $w = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle; active = ($_.Id -eq $front) } })
  ConvertTo-Json -InputObject $w -Compress; exit
}
if ($a.op -eq 'desktop') { (New-Object -ComObject Shell.Application).MinimizeAll(); '{"ok":true}'; exit }
function Win([int]$id) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if (-not $p -or $p.MainWindowHandle -eq 0) { return $null }; $p }
function Front($p) {
  $h = $p.MainWindowHandle
  if ([JarvisW]::IsIconic($h)) { [JarvisW]::ShowWindow($h, 9) | Out-Null }
  [JarvisW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [JarvisW]::SetForegroundWindow($h) | Out-Null; [JarvisW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  if ([JarvisW]::GetForegroundWindow() -ne $h) { try { (New-Object -ComObject WScript.Shell).AppActivate([int]$p.Id) | Out-Null; Start-Sleep -Milliseconds 250 } catch {} }
  return ([JarvisW]::GetForegroundWindow() -eq $h)
}
if ($a.op -eq 'arrange') {
  $l = Win $a.left; $r = Win $a.right
  if (-not $l -or -not $r) { '{"ok":false,"error":"One of those windows is no longer open."}'; exit }
  Add-Type -AssemblyName System.Windows.Forms
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $half = [int]($wa.Width / 2)
  foreach ($p in @($l, $r)) { [JarvisW]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
  [JarvisW]::MoveWindow($l.MainWindowHandle, $wa.X, $wa.Y, $half, $wa.Height, $true) | Out-Null
  [JarvisW]::MoveWindow($r.MainWindowHandle, $wa.X + $half, $wa.Y, $wa.Width - $half, $wa.Height, $true) | Out-Null
  '{"ok":true}'; exit
}
# ---- Phone Link (prospect calls from your own number). The number arrives as data and is checked here too. ----
if ($a.op -like 'phone-*') {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $AE = [System.Windows.Automation.AutomationElement]; $TS = [System.Windows.Automation.TreeScope]
  function PLWindows {
    $ids = @(Get-Process -Name PhoneExperienceHost, YourPhone -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    if (-not $ids.Count) { return @() }
    $all = $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
    return @($all | Where-Object { $ids -contains $_.Current.ProcessId })
  }
  function Buttons($ws) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $out = @(); foreach ($w in $ws) { try { $out += @($w.FindAll($TS::Descendants, $c)) } catch {} }; return $out
  }
  function Press($ws, [string]$re) {
    foreach ($b in (Buttons $ws)) {
      if ($b.Current.Name -match $re -and $b.Current.IsEnabled) {
        try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $true } catch {}
      }
    }
    return $false
  }
  $endRe = '^(End call|Hang up|End|Call end)$'
  function InCall { return [bool](@(Buttons (PLWindows) | Where-Object { $_.Current.Name -match $endRe }).Count) }
  switch ($a.op) {
    'phone-check' {
      $installed = [bool](Get-AppxPackage -Name Microsoft.YourPhone -ErrorAction SilentlyContinue)
      $running = [bool](Get-Process -Name PhoneExperienceHost, YourPhone -ErrorAction SilentlyContinue)
      $cable = [bool](Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'VB-Audio|CABLE' })
      ConvertTo-Json -Compress -InputObject @{ ok = $true; installed = $installed; running = $running; cable = $cable }; exit
    }
    'phone-dial' {
      $to = [string]$a.to
      if ($to -notmatch '^\+?\d{8,15}$') { '{"ok":false,"error":"That number is not dialable."}'; exit }
      if (InCall) { '{"ok":false,"error":"Phone Link is already on a call."}'; exit }
      Start-Process "tel:$to"
      $pressed = $false
      for ($i = 0; $i -lt 16; $i++) {
        Start-Sleep -Milliseconds 500
        if (InCall) { ConvertTo-Json -Compress -InputObject @{ ok = $true; pressed = $pressed }; exit }
        if (-not $pressed) { $pressed = Press (PLWindows) '^(Call|Start call|Dial)$' }
      }
      if (-not @(PLWindows).Count) { '{"ok":false,"error":"Phone Link did not open. Open Phone Link, make sure your phone is connected and Calls are set up, then try again."}'; exit }
      ConvertTo-Json -Compress -InputObject @{ ok = $false; error = "Phone Link opened but the call didn't start. Check that Calls is set up in Phone Link (Bluetooth paired)." }; exit
    }
    'phone-state' {
      $names = @(Buttons (PLWindows) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 30)
      ConvertTo-Json -Compress -InputObject @{ ok = $true; inCall = [bool](@($names | Where-Object { $_ -match $endRe }).Count); buttons = $names }; exit
    }
    'phone-hangup' {
      $ok = Press (PLWindows) $endRe
      ConvertTo-Json -Compress -InputObject @{ ok = $true; pressed = $ok }; exit
    }
  }
  '{"ok":false,"error":"Unknown phone action."}'; exit
}
$p = Win $a.id
if (-not $p) { '{"ok":false,"error":"That window is no longer open."}'; exit }
$h = $p.MainWindowHandle
switch ($a.op) {
  'focus'    { $ok = Front $p; if (-not $ok) { '{"ok":false,"error":"Windows would not bring it to the front."}'; exit } }
  'minimize' { [JarvisW]::ShowWindow($h, 6) | Out-Null }
  'maximize' { [JarvisW]::ShowWindow($h, 3) | Out-Null; Front $p | Out-Null }
  'restore'  { [JarvisW]::ShowWindow($h, 9) | Out-Null; Front $p | Out-Null }
  'close'    { $p.CloseMainWindow() | Out-Null }
  'keys'     {
    $ok = Front $p; Start-Sleep -Milliseconds 300
    # only type if that window really is in front - never into whatever else has focus
    if (-not $ok -or [JarvisW]::GetForegroundWindow() -ne $h) { '{"ok":false,"error":"Windows would not bring that app to the front, so nothing was typed."}'; exit }
    Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([string]$a.keys)
  }
}
'{"ok":true}'
