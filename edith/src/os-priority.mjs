import { spawn } from "node:child_process";

/**
 * Windows: run Ollama at "below normal" priority. A model running on the CPU
 * uses every core at 100%, which starves Chrome and Windows itself ("Not
 * Responding"). At below-normal priority Ollama still gets the whole CPU when
 * nothing else needs it, but your browser and desktop always come first.
 *
 * Model runners Ollama starts later inherit the lower priority from its main
 * process; calling this again periodically catches any that didn't.
 * Opt out with BRAIN_LOW_PRIORITY=0.
 */
export function lowerOllamaPriority() {
  if (process.platform !== "win32" || process.env.BRAIN_LOW_PRIORITY === "0") return;
  const ps =
    "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'ollama*' } | " +
    "ForEach-Object { try { if ($_.PriorityClass -ne 'BelowNormal' -and $_.PriorityClass -ne 'Idle') { $_.PriorityClass = 'BelowNormal' } } catch {} }";
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch { /* PowerShell unavailable — nothing to do */ }
}
