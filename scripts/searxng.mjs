#!/usr/bin/env node
/**
 * `npm run searxng` — connect JARVIS to its own SearXNG (free, unlimited web
 * search for DARWIN's lead verification and its "Instagram + No Website" task).
 *
 *   1. checks Docker is installed and running
 *   2. creates a private random secret in searxng/.env (git-ignored) the first time
 *   3. starts SearXNG (docker compose, bound to 127.0.0.1 only)
 *   4. waits until it answers a JSON search
 *   5. sets SEARXNG_URL in .env.local (nothing else in the file is touched)
 *
 * `npm run searxng -- stop` stops it. `npm run local` starts it again by itself.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "searxng");
const PORT = Number(process.env.SEARXNG_PORT || 8888);
const URL_ = `http://localhost:${PORT}`;
const say = (s) => console.log(s);
const die = (s) => { console.error(`\n${s}\n`); process.exit(1); };
const docker = (args, opts = {}) => spawnSync("docker", args, { cwd: DIR, encoding: "utf8", shell: process.platform === "win32", ...opts });

const win = process.platform === "win32";

/**
 * Docker Desktop installed but this terminal was opened before it (its PATH entry isn't
 * picked up yet) → use the docker.exe inside Docker Desktop directly.
 */
export function useDesktopCli(env = process.env, exists = fs.existsSync) {
  if (process.platform !== "win32" || spawnSync("docker", ["--version"], { stdio: "ignore", shell: true }).status === 0) return false;
  for (const base of [env.ProgramFiles, env.ProgramW6432, "C:\\Program Files"].filter(Boolean)) {
    const bin = path.win32.join(base, "Docker", "Docker", "resources", "bin");
    if (exists(path.win32.join(bin, "docker.exe"))) { env.PATH = `${bin};${env.PATH ?? ""}`; env.Path = env.PATH; return true; }
  }
  return false;
}

/** Is Docker's engine answering right now? */
export const dockerRunning = () => spawnSync("docker", ["info"], { stdio: "ignore", shell: win }).status === 0;

/** Where Docker Desktop is installed (Windows / macOS), or null. */
export function dockerDesktopPath(env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env.ProgramW6432, "C:\\Program Files"].filter(Boolean)) {
      const p = path.win32.join(base, "Docker", "Docker", "Docker Desktop.exe");
      if (exists(p)) return p;
    }
    return null;
  }
  if (platform === "darwin") return exists("/Applications/Docker.app") ? "/Applications/Docker.app" : null;
  return null;
}

/**
 * Docker installed but not running → open Docker Desktop and wait for its engine
 * (the first start after a reboot can take a minute or two).
 * "running" | "started" | "not_installed" | "timeout"
 */
export async function startDocker({ waitMs = 150_000, log = () => {} } = {}) {
  if (dockerRunning()) return "running";
  const app = dockerDesktopPath();
  if (!app) return "not_installed";
  log("  Docker isn't running — starting Docker Desktop (this can take a minute or two)…");
  try {
    const child = process.platform === "darwin" ? spawn("open", ["-a", "Docker"], { detached: true, stdio: "ignore" }) : spawn(app, [], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch { return "timeout"; }
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    if (dockerRunning()) return "started";
  }
  return "timeout";
}

const WINDOWS_HELP =
  "Docker Desktop didn't start. On Windows the usual causes are:\n" +
  "  1. WSL 2 isn't set up — open PowerShell as Administrator, run:  wsl --install  then restart the PC.\n" +
  "  2. Docker Desktop is waiting for you — open it from the Start menu and accept its terms / finish its first-run setup.\n" +
  "  3. Virtualization is off — Task Manager → Performance → CPU should say \"Virtualization: Enabled\"; if not, turn it on in the BIOS (Intel VT-x / AMD SVM).\n" +
  "When the Docker Desktop window says \"Engine running\", run  npm run searxng  again.";

export function ensureSecret(dir = DIR) {
  const f = path.join(dir, ".env");
  const text = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  if (/^SEARXNG_SECRET=\S+/m.test(text)) return false;
  fs.writeFileSync(f, `${text.replace(/\s*$/, text ? "\n" : "")}SEARXNG_SECRET=${crypto.randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  return true;
}

/** Set (or replace) one line in .env.local, keeping everything else as it is. */
export function setEnvLine(file, key, value) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const line = `${key}="${value}"`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const next = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, text ? "\n" : "")}${line}\n`;
  if (next !== text) fs.writeFileSync(file, next);
  return next !== text;
}

export async function searxngAnswers(base = URL_, timeoutMs = 4000) {
  try {
    const r = await fetch(`${base}/search?q=jarvis&format=json`, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 403) return "json_off";
    if (!r.ok) return "down";
    const j = await r.json().catch(() => null);
    return j && Array.isArray(j.results) ? "ok" : "down";
  } catch { return "down"; }
}

async function main() {
  const stop = process.argv.includes("stop");
  const noDocker = "Docker isn't installed. Install Docker Desktop (docker.com/products/docker-desktop), open it once, then run  npm run searxng  again.\n" +
    "No Docker? DARWIN can still search with a free key: BRAVE_SEARCH_API_KEY (brave.com/search/api) or SERPER_API_KEY (serper.dev) in .env.local.";
  useDesktopCli();
  if (docker(["--version"]).status !== 0 && !dockerDesktopPath()) die(noDocker);
  const docked = await startDocker({ log: say });
  if (docked === "not_installed") die(docker(["--version"]).status === 0 ? "Docker is installed but its engine isn't running — start it (Docker Desktop, or  sudo systemctl start docker  on Linux), then run  npm run searxng  again." : noDocker);
  if (docked === "timeout") die(process.platform === "win32" ? WINDOWS_HELP : "Docker didn't start — open Docker Desktop, wait for \"Engine running\", then run  npm run searxng  again.");
  if (docked === "started") say("  Docker is running ✓");
  if (stop) { docker(["compose", "down"], { stdio: "inherit" }); say("SearXNG stopped."); return; }

  if (ensureSecret()) say("  Created a private secret for SearXNG (searxng/.env, not committed).");
  say("  Starting SearXNG (the first time downloads it — a minute or two)…");
  const up = docker(["compose", "up", "-d"], { stdio: "inherit" });
  if (up.status !== 0) die("Couldn't start SearXNG with Docker (see the message above).");

  let state = "down";
  for (let i = 0; i < 60 && state !== "ok"; i++) {
    state = await searxngAnswers();
    if (state === "json_off") die(`SearXNG answers but refuses JSON — check searxng/settings.yml has "json" under search: formats:, then  npm run searxng  again.`);
    if (state !== "ok") await new Promise((r) => setTimeout(r, 2000));
  }
  if (state !== "ok") die(`SearXNG started but isn't answering at ${URL_} yet — run  docker logs jarvis-searxng  to see why.`);

  const changed = setEnvLine(path.join(ROOT, ".env.local"), "SEARXNG_URL", URL_);
  say(`\n✓ SearXNG is running at ${URL_} (only this computer can reach it).`);
  say(changed ? "✓ SEARXNG_URL added to .env.local — restart  npm run local  to use it." : "✓ SEARXNG_URL was already set in .env.local.");
  say("  DARWIN now has free, unlimited web search for verifying leads and Instagram accounts.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
