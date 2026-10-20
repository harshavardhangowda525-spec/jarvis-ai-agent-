import { spawn, spawnSync } from "node:child_process";

/**
 * A free Cloudflare quick tunnel to a gateway on this PC (no account needed),
 * shared by the Ollama brain (`npm run brain`) and the Claude bridge
 * (`npm run claude`). Resolves { url, child } — url is null if it never came up.
 */
export function startTunnel(port, say = console.log) {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${port}`;
    // Fixed command strings (no user input). On Windows npx/cloudflared are
    // .cmd/.exe shims that need a shell; passing ONE string avoids Node's
    // DEP0190 "args with shell" warning.
    const win = process.platform === "win32";
    const run = (line, opts = {}) => (win ? spawn(line, { shell: true, ...opts }) : spawn(line.split(" ")[0], line.split(" ").slice(1), opts));
    const hasCf = (win ? spawnSync("cloudflared --version", { shell: true, stdio: "ignore" }) : spawnSync("cloudflared", ["--version"], { stdio: "ignore" })).status === 0;
    const line = hasCf
      ? `cloudflared tunnel --url ${target} --no-autoupdate`
      : `npx --yes cloudflared tunnel --url ${target} --no-autoupdate`;
    if (!hasCf) say("  (cloudflared not installed — fetching it via npx; this can take 1–2 minutes the first time.\n   Faster next time: winget install --id Cloudflare.cloudflared)");
    const child = run(line);
    let done = false;
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !done) { done = true; resolve({ url: m[0], child }); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => { if (!done) { done = true; resolve({ url: null, child: null, code }); } });
    setTimeout(() => { if (!done) { done = true; resolve({ url: null, child }); } }, 180_000);
  });
}

export async function waitReachable(publicUrl) {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(5000) }); if (r.ok) return true; } catch { /* DNS still propagating */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** Kill the tunnel (on Windows it runs under cmd.exe — kill the whole tree). */
export function stopTunnel(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
  else child.kill();
}
