/**
 * Small pieces of `npm run local` that are worth testing on their own.
 */
import { spawnSync } from "node:child_process";
export { retireOldUltronProvider } from "../edith/src/stale-provider.mjs";

/** Process ids listening on a TCP port (Windows: netstat; elsewhere: lsof, then fuser). */
export function listeningPids(port, platform = process.platform) {
  if (platform === "win32") {
    const r = spawnSync("netstat -ano -p tcp", { shell: true, encoding: "utf8", windowsHide: true });
    return parseNetstat(r.stdout || "", port);
  }
  const l = spawnSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { shell: true, encoding: "utf8" });
  let pids = (l.stdout || "").split(/\s+/).filter((p) => /^\d+$/.test(p));
  if (!pids.length) {
    const f = spawnSync(`fuser ${port}/tcp`, { shell: true, encoding: "utf8" });
    pids = `${f.stdout || ""} `.split(/\s+/).filter((p) => /^\d+$/.test(p));
  }
  return [...new Set(pids.map(Number))].filter((p) => p !== process.pid);
}

/** `netstat -ano` output → pids LISTENING on the port (pure — tested). */
export function parseNetstat(out, port) {
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP$/i.test(cols[0]) || !/LISTEN/i.test(cols[3])) continue;
    if (!new RegExp(`[:.]${port}$`).test(cols[1])) continue;
    const pid = Number(cols[4]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Stop whatever is listening on the port. Returns how many processes were stopped. */
export function stopPort(port, platform = process.platform) {
  const pids = listeningPids(port, platform);
  for (const pid of pids) {
    if (platform === "win32") spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: "ignore", windowsHide: true });
    else { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
  }
  return pids.length;
}
