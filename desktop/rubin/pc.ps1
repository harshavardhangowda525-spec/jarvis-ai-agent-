# RUBEN - window control on Windows (run by pc.cjs with the action as JSON in $env:RUBIN_PC_ARGS).
# Lists windows, brings one to the front, minimises / maximises / restores / closes it, or types
# keys into it. Closing and typing only ever run after you clicked "Yes, do it" in RUBEN.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$a = $env:RUBIN_PC_ARGS | ConvertFrom-Json
if ($a.op -eq 'list') {
  $w = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle } })
  ConvertTo-Json -InputObject $w -Compress; exit
}
if ($a.op -eq 'desktop') { (New-Object -ComObject Shell.Application).MinimizeAll(); '{"ok":true}'; exit }
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class RubinW {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
}
"@
$p = Get-Process -Id ([int]$a.id) -ErrorAction SilentlyContinue
if (-not $p -or $p.MainWindowHandle -eq 0) { '{"ok":false,"error":"That window is no longer open."}'; exit }
$h = $p.MainWindowHandle
function Front {
  if ([RubinW]::IsIconic($h)) { [RubinW]::ShowWindow($h, 9) | Out-Null }
  [RubinW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [RubinW]::SetForegroundWindow($h) | Out-Null; [RubinW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  # Windows sometimes refuses a background program; the shell's own "activate" usually gets through
  if ([RubinW]::GetForegroundWindow() -ne $h) { try { (New-Object -ComObject WScript.Shell).AppActivate([int]$a.id) | Out-Null; Start-Sleep -Milliseconds 250 } catch {} }
}
switch ($a.op) {
  'focus'    { Front }
  'minimize' { [RubinW]::ShowWindow($h, 6) | Out-Null }
  'maximize' { [RubinW]::ShowWindow($h, 3) | Out-Null; Front }
  'restore'  { [RubinW]::ShowWindow($h, 9) | Out-Null; Front }
  'close'    { $p.CloseMainWindow() | Out-Null }
  'keys'     {
    Front; Start-Sleep -Milliseconds 400
    # only type if that window really is in front - never into whatever else has focus
    if ([RubinW]::GetForegroundWindow() -ne $h) { '{"ok":false,"error":"Windows wouldn''t bring that app to the front, so nothing was typed."}'; exit }
    Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([string]$a.keys)
  }
}
'{"ok":true}'
