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
