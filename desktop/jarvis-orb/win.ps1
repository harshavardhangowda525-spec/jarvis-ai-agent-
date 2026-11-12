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
# ---- JARVIS working on the screen: mouse / keyboard input, and what's clickable in the front window ----
if ($a.op -eq 'input' -or $a.op -eq 'uia') {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public static class JarvisIn {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; [FieldOffset(32)] public ulong pad; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  static void Send(ushort vk, ushort scan, uint flags) { var i = new INPUT[1]; i[0].type = 1; i[0].ki.wVk = vk; i[0].ki.wScan = scan; i[0].ki.dwFlags = flags; SendInput(1, i, Marshal.SizeOf(typeof(INPUT))); }
  public static void Key(ushort vk, bool up) { Send(vk, 0, up ? 2u : 0u); }
  public static void Text(string s) { foreach (char c in s) { Send(0, c, 4); Send(0, c, 4 | 2); System.Threading.Thread.Sleep(8); } }
}
"@
  [JarvisIn]::SetProcessDPIAware() | Out-Null
  if ($a.op -eq 'input') {
    $vk = @{ ctrl = 0x11; control = 0x11; alt = 0x12; shift = 0x10; win = 0x5B; windows = 0x5B; enter = 0x0D; return = 0x0D; tab = 0x09; esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E; up = 0x26; down = 0x28; left = 0x25; right = 0x27; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22 }
    function VkOf([string]$k) {
      if ($vk.ContainsKey($k)) { return [uint16]$vk[$k] }
      if ($k -match '^f([1-9]|1[0-2])$') { return [uint16](0x6F + [int]$Matches[1]) }
      if ($k.Length -eq 1) { $c = [char]::ToUpper($k[0]); if (($c -ge 'A' -and $c -le 'Z') -or ($c -ge '0' -and $c -le '9')) { return [uint16][int]$c } }
      return $null
    }
    switch ($a.kind) {
      { $_ -in 'click', 'double', 'right' } {
        [JarvisIn]::SetCursorPos([int]$a.x, [int]$a.y) | Out-Null; Start-Sleep -Milliseconds 60
        $down = 0x02; $up = 0x04; if ($a.kind -eq 'right') { $down = 0x08; $up = 0x10 }
        $times = 1; if ($a.kind -eq 'double') { $times = 2 }
        for ($i = 0; $i -lt $times; $i++) { [JarvisIn]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [JarvisIn]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 70 }
      }
      'type' { [JarvisIn]::Text([string]$a.text); if ($a.enter) { Start-Sleep -Milliseconds 80; [JarvisIn]::Key(0x0D, $false); [JarvisIn]::Key(0x0D, $true) } }
      'key' {
        $codes = @(); foreach ($k in ([string]$a.keys).ToLower().Split('+')) { $c = VkOf $k.Trim(); if ($null -eq $c) { ConvertTo-Json -Compress -InputObject @{ ok = $false; error = "unknown key $k" }; exit }; $codes += $c }
        foreach ($c in $codes) { [JarvisIn]::Key($c, $false) }
        [array]::Reverse($codes); foreach ($c in $codes) { [JarvisIn]::Key($c, $true) }
      }
      'scroll' { $d = 120; if ($a.direction -eq 'down') { $d = -120 }; for ($i = 0; $i -lt [int]$a.amount; $i++) { [JarvisIn]::mouse_event(0x0800, 0, 0, $d, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 } }
    }
    '{"ok":true}'; exit
  }
  # uia: the clickable things in the window in front (names, kinds, where they are)
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $AE = [System.Windows.Automation.AutomationElement]; $CT = [System.Windows.Automation.ControlType]
  $out = @()
  try {
    $f = $AE::FocusedElement; $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker; $top = $f
    while ($top -and ($p2 = $walker.GetParent($top)) -and -not $p2.Equals($AE::RootElement)) { $top = $p2 }
    $types = @($CT::Button, $CT::Edit, $CT::Hyperlink, $CT::MenuItem, $CT::ListItem, $CT::TabItem, $CT::CheckBox, $CT::RadioButton, $CT::ComboBox, $CT::TreeItem, $CT::SplitButton, $CT::Document)
    $conds = $types | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $_) }
    $or = New-Object System.Windows.Automation.OrCondition([System.Windows.Automation.Condition[]]$conds)
    $all = $top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $or)
    foreach ($e in $all) {
      if ($out.Count -ge 150) { break }
      try {
        $c = $e.Current
        if ($c.IsOffscreen) { continue }
        $r = $c.BoundingRectangle
        if ($r.IsEmpty -or $r.Width -lt 3 -or $r.Height -lt 3) { continue }
        $name = [string]$c.Name; if (-not $name) { $name = [string]$c.HelpText }
        if (-not $name -and $c.ControlType -ne $CT::Edit) { continue }
        $out += [pscustomobject]@{ name = $name.Substring(0, [Math]::Min(120, $name.Length)); role = $c.ControlType.ProgrammaticName.Replace('ControlType.', ''); x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; password = [bool]$c.IsPassword }
      } catch { }
    }
  } catch { }
  ConvertTo-Json -Compress -InputObject @($out); exit
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
