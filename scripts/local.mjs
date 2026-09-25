#!/usr/bin/env node
/**
 * `npm run local` — run ALL of JARVIS on this PC: the web app with every agent
 * (JARVIS, EV, DARWIN, ULTRON's dashboard), the Ollama brain gateway and the
 * ULTRON runtime. Ollama is reached directly on 127.0.0.1 — no Cloudflare
 * tunnel, no round trip through Vercel — so the PC brain answers with no
 * network overhead.
 *
 * Uses the SAME database as your Vercel deployment (DATABASE_URL), so your
 * account, memories, leads and chats are identical in both places.
 *
 * Settings come from .env.local (easiest: `npx vercel env pull .env.local
 * --environment=production`), plus edith/.env for the Ollama model.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITH = path.join(ROOT, "edith");
const win = process.platform === "win32";
const PORT = Number(process.env.JARVIS_LOCAL_PORT || 3000);
const BRAIN_PORT = 11500;
const OLLAMA = "http://127.0.0.1:11434";

const say = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

/** Minimal .env reader (quotes, BOM, inline "  # note"). Doesn't touch process.env. */
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("="); if (eq < 1) continue;
    const k = s.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "").trim();
    if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Run a command to completion in a visible way (npm install, build). */
function runStep(label, command, cwd) {
  say(`  ${label}…`);
  const r = spawnSync(command, { cwd, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) die(`${label} failed (see the output above).`);
}

const up = async (url, ms = 2500) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.status < 500; } catch { return false; }
};
async function waitFor(url, seconds) {
  for (let i = 0; i < seconds * 2; i++) { if (await up(url)) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}

// ---- children (one window, prefixed output, all stopped with Ctrl+C) ----------
const children = [];
function start(name, args, { cwd, env }) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `[${name}]`.padEnd(9);
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) if (l.trim()) out.write(`${tag} ${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => { if (!stopping) say(`${tag} stopped${code ? ` (exit ${code})` : ""}.`); });
  children.push(child);
  return child;
}
let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  say("\n  Stopping JARVIS…");
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue;
    if (win) spawnSync(`taskkill /pid ${c.pid} /T /F`, { shell: true, stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

// ---- 1. settings ----------------------------------------------------------------
say("\nJARVIS — running everything on this PC\n");
const envFile = [".env.local", ".env"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
const appEnv = envFile ? readEnv(envFile) : {};
const edithEnv = readEnv(path.join(EDITH, ".env"));
if (!appEnv.DATABASE_URL || !appEnv.AUTH_SECRET) {
  die(
    "JARVIS needs your app settings (database, keys) in a .env.local file here.\n" +
    "  Easiest — copy them from Vercel (one time):\n" +
    "    npx vercel login\n" +
    "    npx vercel link\n" +
    "    npx vercel env pull .env.local --environment=production\n" +
    "  Then run  npm run local  again.",
  );
}
say(`  Settings: ${path.basename(envFile)} (same database as your Vercel app)`);

// ---- 2. dependencies ------------------------------------------------------------------
// Install when ANY listed package is missing — an older node_modules (from before
// a package was added, e.g. sharp) must be topped up, not just a missing folder.
function missingPackages(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    return names.filter((n) => !fs.existsSync(path.join(dir, "node_modules", n, "package.json")));
  } catch { return ["?"]; }
}
for (const [dir, label] of [[ROOT, "JARVIS"], [EDITH, "ULTRON"]]) {
  const missing = missingPackages(dir);
  if (missing.length) runStep(`Installing ${label} packages (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""})`, "npm install", dir);
}

// ---- 3. build when the code changed -------------------------------------------------------
const head = (() => { try { return spawnSync("git rev-parse HEAD", { cwd: ROOT, shell: true, encoding: "utf8" }).stdout.trim(); } catch { return ""; } })();
const stampFile = path.join(ROOT, ".next", "LOCAL_BUILD_COMMIT");
const built = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8").trim() : "";
if (!built || (head && stamp !== head) || process.argv.includes("--rebuild")) {
  runStep("Building JARVIS (a few minutes the first time, and after each update)", "npm run build", ROOT);
  if (head) fs.writeFileSync(stampFile, head);
}

// ---- 4. Ollama brain (local only — no tunnel) -------------------------------------------------
const keyFile = path.join(EDITH, ".brain-key");
const brainKey = appEnv.OLLAMA_API_KEY || edithEnv.OLLAMA_API_KEY ||
  (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "") ||
  `brain_${crypto.randomBytes(24).toString("base64url")}`;
const model = process.env.OLLAMA_MODEL || edithEnv.OLLAMA_MODEL || appEnv.OLLAMA_MODEL || "qwen2.5:3b";
let brainUrl = "";
if (await up(`${OLLAMA}/api/tags`)) {
  if (await up(`http://127.0.0.1:${BRAIN_PORT}/health`)) {
    say("  Ollama gateway already running on this PC — using it.");
  } else {
    start("brain", ["brain.mjs"], { cwd: EDITH, env: { BRAIN_LOCAL_ONLY: "1", OLLAMA_API_KEY: brainKey, OLLAMA_MODEL: model, BRAIN_PORT: String(BRAIN_PORT) } });
    if (!(await waitFor(`http://127.0.0.1:${BRAIN_PORT}/health`, 180))) say("  (the brain is still loading the model — JARVIS will use the cloud until it's ready)");
  }
  brainUrl = `http://127.0.0.1:${BRAIN_PORT}`;
} else {
  say("  Ollama isn't running — JARVIS will use your cloud keys only. (Open the Ollama app and restart to use your PC brain.)");
}

// ---- 5. ULTRON runtime ------------------------------------------------------------------------------
if (await up("http://127.0.0.1:7420/health")) say("  ULTRON already running — using it.");
else start("ultron", ["run.mjs"], { cwd: EDITH, env: { ULTRON_ALLOWED_ORIGINS: [edithEnv.ULTRON_ALLOWED_ORIGINS || edithEnv.EDITH_ALLOWED_ORIGINS, `http://localhost:${PORT}`].filter(Boolean).join(",") } });

// ---- 6. the web app (every agent) ------------------------------------------------------------------
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
start("jarvis", [nextBin, "start", "-p", String(PORT)], {
  cwd: ROOT,
  env: {
    ...(brainUrl ? {
      OLLAMA_BASE_URL: brainUrl,                               // straight to the PC brain
      OLLAMA_API_KEY: brainKey,
      OLLAMA_MODEL: model,
      BRAIN_PRIORITY: appEnv.BRAIN_PRIORITY || "first",        // PC brain first, cloud as backup
    } : {}),
    // EV's images must stay publicly reachable for Instagram — keep the Vercel address.
    APP_URL: appEnv.APP_URL || edithEnv.JARVIS_URL || "",
  },
});
const local = `http://localhost:${PORT}`;
if (await waitFor(`${local}/login`, 120)) {
  say(`\n  ✓ JARVIS is running on this PC: ${local}`);
  say(`    Brain: ${brainUrl ? `your PC (Ollama ${model}) first, cloud as backup` : "cloud only"} · EV: ${appEnv.EV_PROVIDER || "groq"}`);
  say("    Log in with your usual account. Keep this window open — Ctrl+C stops everything.\n");
  if (!process.argv.includes("--no-open")) {
    if (win) spawn(`start "" "${local}"`, { shell: true, stdio: "ignore", detached: true });
    else if (process.platform === "darwin") spawn("open", [local], { stdio: "ignore", detached: true });
    else spawn("xdg-open", [local], { stdio: "ignore", detached: true }).on("error", () => {});
  }
} else {
  say(`\n  JARVIS didn't start on ${local} — see the [jarvis] lines above.`);
}
