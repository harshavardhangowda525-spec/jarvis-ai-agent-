/**
 * Real terminal execution, confined to the workspace. Captures actual stdout,
 * stderr, exit code, and duration. No fabricated output. Long output is
 * truncated for the model but the real exit code is always reported.
 *
 * Running processes are tracked so EDITH can be interrupted (STOP).
 */
import { spawn } from "node:child_process";

const running = new Set();

/** Kill every tracked child process (used by STOP). */
export function killAll() {
  for (const child of running) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }
  running.clear();
}

const MASK = [/API_KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i, /_KEY\b/i];
function maskEnvLeaks(text) {
  // Best-effort: redact anything that looks like KEY=value with a long value.
  return text.replace(/([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*[=:]\s*([^\s"']{8,})/gi,
    (_, k) => `${k}=***redacted***`);
}

/**
 * Run a command. Options: cwdRel (workspace-relative), timeoutMs, env.
 * Returns { command, exitCode, ok, stdout, stderr, durationMs, timedOut }.
 */
export function runCommand(ws, command, { cwdRel = ".", timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    const cwd = ws.resolve(cwdRel);
    const started = Date.now();
    let stdout = "", stderr = "", timedOut = false, killed = false;

    // Use a shell so pipelines/&&/env work as a developer expects.
    const child = spawn(command, { cwd, shell: true, env: { ...process.env } });
    running.add(child);

    const timer = setTimeout(() => { timedOut = true; killed = true; child.kill("SIGKILL"); }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); if (stdout.length > 40_000) stdout = stdout.slice(-40_000); });
    child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 40_000) stderr = stderr.slice(-40_000); });

    child.on("error", (err) => {
      clearTimeout(timer); running.delete(child);
      resolve({ command, exitCode: null, ok: false, stdout: "", stderr: String(err.message), durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer); running.delete(child);
      resolve({
        command,
        exitCode: code,
        ok: code === 0 && !killed,
        stdout: maskEnvLeaks(stdout.trim()),
        stderr: maskEnvLeaks(stderr.trim()),
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}
