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
import { spawnSync } from "node:child_process";
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
  const v = docker(["--version"]);
  if (v.status !== 0) {
    die("Docker isn't installed. Install Docker Desktop (docker.com/products/docker-desktop), start it, then run  npm run searxng  again.\n" +
      "No Docker? You can still give DARWIN a free web search: BRAVE_SEARCH_API_KEY (brave.com/search/api) or SERPER_API_KEY (serper.dev) in .env.local.");
  }
  if (docker(["info"], { stdio: "ignore" }).status !== 0) die("Docker is installed but not running — open Docker Desktop, wait until it says it's running, then run  npm run searxng  again.");
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
