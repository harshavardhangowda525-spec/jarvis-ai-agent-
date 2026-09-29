#!/usr/bin/env node
/**
 * `npm run local` — run ALL of JARVIS on this PC: the web app with every agent
 * (JARVIS, EV, DARWIN, ULTRON's dashboard) and the ULTRON runtime.
 *
 * Brains: JARVIS, EV and DARWIN answer with Groq (Gemini as the backup);
 * ULTRON runs on this PC's Ollama, reached directly on 127.0.0.1. (Set
 * JARVIS_PROVIDER=ollama to put JARVIS back on the PC brain — then the brain
 * gateway starts too.)
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
import { retireOldUltronProvider, stopPort } from "./local-helpers.mjs";

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
// Same precedence as Next.js: .env.local wins over .env.
const envFile = [".env.local", ".env"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
const appEnv = { ...readEnv(path.join(ROOT, ".env")), ...readEnv(path.join(ROOT, ".env.local")) };
// ULTRON runs on Ollama now — a leftover old-default line in edith/.env would keep it on Groq.
for (const line of retireOldUltronProvider(path.join(EDITH, ".env"))) {
  say(`  edith/.env had ${line} (the old default) — turned that line off so ULTRON runs on this PC's Ollama.`);
}
const edithEnv = readEnv(path.join(EDITH, ".env"));
const isPlaceholder = (v) => !v || !v.trim() || /^\[sensitive\]$/i.test(v.trim());
// AUTH_SECRET only signs logins made on THIS PC (separate from Vercel's), so if
// Vercel withheld it, create a private one here and keep it in .env.local.
if (appEnv.DATABASE_URL && isPlaceholder(appEnv.AUTH_SECRET)) {
  const secret = crypto.randomBytes(48).toString("base64url");
  const file = path.join(ROOT, ".env.local");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = /^AUTH_SECRET=.*$/m.test(text) ? text.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET="${secret}"`) : `${text.replace(/\s*$/, "\n")}AUTH_SECRET="${secret}"\n`;
  fs.writeFileSync(file, next);
  appEnv.AUTH_SECRET = secret;
  say("  Created a private sign-in secret for this PC (AUTH_SECRET in .env.local).");
}
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
// Vercel won't hand out values marked "Sensitive" — `vercel env pull` writes a
// blank/placeholder instead, which only fails later at login. Catch it here.
const dbUrl = appEnv.DATABASE_URL.trim();
if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
  const shown = dbUrl ? `"${dbUrl.slice(0, 12)}…"` : "empty";
  die(
    `DATABASE_URL in .env.local isn't a database address (it starts with ${shown}).\n` +
    "  Vercel doesn't copy values marked \"Sensitive\" to your PC. Paste the real one by hand:\n" +
    "    1. Open console.neon.tech → your project → Dashboard → Connect (or Connection string).\n" +
    "    2. Copy the connection string that starts with postgresql://  (the pooled one is fine).\n" +
    "       Copy ONLY the address — not the  psql '…'  wrapper around it.\n" +
    "    3. In .env.local, set the line to:   DATABASE_URL=\"postgresql://…\"\n" +
    "  (Or on Vercel → Settings → Environment Variables → DATABASE_URL → the eye icon, if it's shown.)\n" +
    "  Then run  npm run local  again.",
  );
}
say(`  Settings: ${path.basename(envFile)} (same database as your Vercel app)`);
// Other keys that came through blank (Sensitive on Vercel) — worth copying by hand.
const IMPORTANT = ["GROQ_API_KEY", "GEMINI_API_KEY", "ELEVENLABS_API_KEY", "GEOAPIFY_API_KEY", "GOOGLE_CLIENT_SECRET", "INSTAGRAM_ACCESS_TOKEN", "MAGIC_HOUR_API_KEY", "OLLAMA_API_KEY"];
const blank = IMPORTANT.filter((k) => k in appEnv && isPlaceholder(appEnv[k]));
if (blank.length) say(`  Note: these came through empty (marked Sensitive on Vercel): ${blank.join(", ")}.\n        Copy their values into .env.local if you want those features on this PC.`);

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

// ---- 4. Ollama: ULTRON's brain (and JARVIS's only when JARVIS_PROVIDER says so) ---------------
const pickOf = (v, d) => (v || d).toLowerCase().split(/[\s,>]+/).filter(Boolean);
const jarvisPick = pickOf(appEnv.JARVIS_PROVIDER, "groq,gemini");
// what ULTRON itself will read: your environment, then edith/.env (old name EDITH_AI_PROVIDER too)
const ultronSetting = process.env.ULTRON_AI_PROVIDER || edithEnv.ULTRON_AI_PROVIDER || edithEnv.EDITH_AI_PROVIDER || "";
const ultronPick = pickOf(ultronSetting, "ollama");
const usesOllama = (pick) => pick.includes("ollama") || pick.includes("auto");
const keyFile = path.join(EDITH, ".brain-key");
const brainKey = appEnv.OLLAMA_API_KEY || edithEnv.OLLAMA_API_KEY ||
  (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "") ||
  `brain_${crypto.randomBytes(24).toString("base64url")}`;
const model = process.env.OLLAMA_MODEL || edithEnv.OLLAMA_MODEL || appEnv.OLLAMA_MODEL || "qwen2.5:3b";
const ultronModel = process.env.ULTRON_OLLAMA_MODEL || edithEnv.ULTRON_OLLAMA_MODEL || appEnv.ULTRON_OLLAMA_MODEL || model;
let ollamaUp = await up(`${OLLAMA}/api/tags`);
if (!ollamaUp && (usesOllama(ultronPick) || usesOllama(jarvisPick))) {
  // The Ollama app normally runs in the background; if it's installed but not running, start it.
  const found = spawnSync(win ? "where ollama" : "command -v ollama", { shell: true, encoding: "utf8" }).status === 0;
  if (found) {
    say("  Starting Ollama…");
    try {
      const o = spawn("ollama", ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
      o.on("error", () => {});
      o.unref();
    } catch { /* not startable */ }
    ollamaUp = await waitFor(`${OLLAMA}/api/tags`, 20);
  }
}
if (usesOllama(ultronPick)) {
  if (!ollamaUp) {
    say("  ! Ollama isn't running — ULTRON runs on it. Install it from ollama.com (or open the Ollama app), then restart this.");
  } else {
    const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => null);
    const have = (tags?.models ?? []).map((m) => String(m.name));
    const has = (m) => have.some((n) => n === m || n === `${m}:latest`);
    if (!has(ultronModel)) {
      say(`  ! ULTRON's model ${ultronModel} isn't downloaded yet — run:  ollama pull ${ultronModel}`);
      if (have.length) say(`    (or set ULTRON_OLLAMA_MODEL in edith/.env to one you have: ${have.slice(0, 5).join(", ")})`);
    }
  }
}
let brainUrl = "";
if (usesOllama(jarvisPick)) {
  if (ollamaUp) {
    if (await up(`http://127.0.0.1:${BRAIN_PORT}/health`)) {
      say("  Ollama gateway already running on this PC — using it.");
    } else {
      start("brain", ["brain.mjs"], { cwd: EDITH, env: { BRAIN_LOCAL_ONLY: "1", OLLAMA_API_KEY: brainKey, OLLAMA_MODEL: model, BRAIN_PORT: String(BRAIN_PORT) } });
      if (!(await waitFor(`http://127.0.0.1:${BRAIN_PORT}/health`, 180))) say("  (the brain is still loading the model — JARVIS answers once it's ready)");
    }
    brainUrl = `http://127.0.0.1:${BRAIN_PORT}`;
  } else {
    say("  Ollama isn't running — JARVIS_PROVIDER puts JARVIS on your PC brain, so open the Ollama app and restart this.");
  }
}

// ---- 5. ULTRON runtime ------------------------------------------------------------------------------
// ULTRON runs on this PC's Ollama. Cloud keys are lent too, for anyone who adds
// a backup with ULTRON_AI_PROVIDER (e.g. "ollama,groq").
const groqKey = [edithEnv.GROQ_API_KEY, appEnv.GROQ_API_KEY].find((v) => v && !isPlaceholder(v)) || "";
const startUltron = () => start("ultron", ["run.mjs"], { cwd: EDITH, env: { ...(groqKey ? { GROQ_API_KEY: groqKey } : {}), ULTRON_OLLAMA_MODEL: ultronModel, OLLAMA_BASE_URL: OLLAMA, ULTRON_ALLOWED_ORIGINS: [edithEnv.ULTRON_ALLOWED_ORIGINS || edithEnv.EDITH_ALLOWED_ORIGINS, `http://localhost:${PORT}`].filter(Boolean).join(",") } });
const running = await fetch("http://127.0.0.1:7420/health", { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).catch(() => null);
if (!running) startUltron();
else if (ultronPick[0] === "ollama" && !/^ollama\b/i.test(String(running.brain ?? ""))) {
  // an ULTRON from before (another window, or left behind) — it would keep answering on its old brain
  say(`  An older ULTRON is still running on ${running.brain || "another brain"} — stopping it so ULTRON starts on Ollama…`);
  stopPort(7420);
  for (let i = 0; i < 20 && (await up("http://127.0.0.1:7420/health", 800)); i++) await new Promise((r) => setTimeout(r, 500));
  if (await up("http://127.0.0.1:7420/health", 800)) say("  ! Couldn't stop it — close the old ULTRON window (or restart the PC), then run this again.");
  else startUltron();
} else say(`  ULTRON already running on ${running.brain || "its brain"} — using it.`);

// ---- 6. the web app (every agent) ------------------------------------------------------------------
// The NIOS watcher's scheduled check needs a secret; use yours or a one-off one for this run.
const cronSecret = appEnv.CRON_SECRET && !isPlaceholder(appEnv.CRON_SECRET) ? appEnv.CRON_SECRET : crypto.randomBytes(24).toString("hex");
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
start("jarvis", [nextBin, "start", "-p", String(PORT)], {
  cwd: ROOT,
  env: {
    ...(brainUrl ? {
      OLLAMA_BASE_URL: brainUrl,                               // straight to the PC brain
      OLLAMA_API_KEY: brainKey,
      OLLAMA_MODEL: model,
      BRAIN_PRIORITY: appEnv.BRAIN_PRIORITY || "first",        // only matters with JARVIS_PROVIDER=auto
    } : {}),
    // EV's images must stay publicly reachable for Instagram — keep the Vercel address.
    APP_URL: appEnv.APP_URL || edithEnv.JARVIS_URL || "",
    DATABASE_URL: dbUrl,
    AUTH_SECRET: appEnv.AUTH_SECRET,
    CRON_SECRET: cronSecret,
  },
});
const local = `http://localhost:${PORT}`;
if (await waitFor(`${local}/login`, 120)) {
  say(`\n  ✓ JARVIS is running on this PC: ${local}`);
  const only = (pick) => (pick.includes("auto") ? "all providers" : pick.map((p) => (p === "ollama" ? "Ollama" : p[0].toUpperCase() + p.slice(1))).join(" → "));
  const withModel = (pick, m) => only(pick).replace(/^Ollama\b/, `Ollama (${m})`);
  say(`    Brains: JARVIS ${withModel(jarvisPick, model)} · EV ${only(pickOf(appEnv.EV_PROVIDER, "groq,gemini"))} · DARWIN ${only(pickOf(appEnv.DARWIN_PROVIDER, "groq,gemini"))} · ULTRON ${withModel(ultronPick, ultronModel)}`);
  const geminiKey = [edithEnv.GEMINI_API_KEY, appEnv.GEMINI_API_KEY].find((v) => v && !isPlaceholder(v));
  if (!groqKey && !geminiKey) say("    ! GROQ_API_KEY and GEMINI_API_KEY are both empty in .env.local — JARVIS, EV and DARWIN need at least one.");
  else if (!groqKey) say("    ! GROQ_API_KEY is empty — JARVIS, EV and DARWIN will use Gemini only.");
  else if (!geminiKey) say("    (No GEMINI_API_KEY — JARVIS, EV and DARWIN have no backup when Groq is busy. Free at aistudio.google.com/apikey.)");
  if (appEnv.JARVIS_PROVIDER && usesOllama(jarvisPick)) say(`    Note: .env.local sets JARVIS_PROVIDER=${appEnv.JARVIS_PROVIDER}, so JARVIS stays on your PC brain — delete that line to use Groq/Gemini.`);
  if (ultronSetting && !usesOllama(ultronPick)) say(`    Note: ULTRON_AI_PROVIDER=${ultronSetting} keeps ULTRON off Ollama — delete that line in edith/.env to use Ollama.`);
  say("    NIOS watch: checking the official NIOS pages every 15 minutes while this runs (new notices are emailed if Gmail is connected).");
  say("    EV daily content: from 4:00 AM EV prepares today's post + Reel for your approval (it never publishes without you).");
  say("    Log in with your usual account. Keep this window open — Ctrl+C stops everything.\n");
  // NIOS board watcher — scheduled check while the PC is on (the console also checks while it's open).
  const niosCheck = async () => {
    try {
      const r = await fetch(`${local}/api/cron/nios`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(90_000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.data?.newNotices) say(`  [nios] ${j.data.newNotices} new NIOS notice${j.data.newNotices === 1 ? "" : "s"}${j.data.emailed ? " — emailed to you" : ""}. Open JARVIS to see ${j.data.newNotices === 1 ? "it" : "them"}.`);
    } catch { /* offline — next round */ }
  };
  setTimeout(niosCheck, 60_000);
  setInterval(niosCheck, 15 * 60_000);
  // Daily summaries: store yesterday's structured summary (idempotent — safe to repeat).
  const dailySummary = () => fetch(`${local}/api/cron/daily-summary`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(90_000) }).catch(() => {});
  setTimeout(dailySummary, 90_000);
  setInterval(dailySummary, 60 * 60_000);
  // EV daily content: from 4:00 AM (EV_DAILY_TZ) EV prepares today's post + Reel; this tick
  // starts it and keeps it moving (slow renders, Instagram processing) while the PC is on.
  let evTicking = false;
  const evDaily = async () => {
    if (evTicking) return;
    evTicking = true;
    try {
      const r = await fetch(`${local}/api/cron/ev-daily`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(320_000) });
      const j = await r.json().catch(() => ({}));
      for (const x of j?.data?.results ?? []) if (x.status === "ready" && !evAnnounced.has(j.data.today)) { evAnnounced.add(j.data.today); say("  [ev] Today's Instagram content is ready for your approval — open EV in JARVIS."); }
    } catch { /* offline — next round */ } finally { evTicking = false; }
  };
  const evAnnounced = new Set();
  // DARWIN's daily search: starts at 6:00 AM (DARWIN_DAILY_TZ) and keeps going
  // back-to-back until today's leads are all found — no need to open DARWIN.
  let dwTicking = false;
  const dwAnnounced = new Set();
  let dwTimer = null;
  const darwinDaily = async () => {
    if (dwTicking) return;
    dwTicking = true;
    let more = false;
    try {
      const r = await fetch(`${local}/api/cron/darwin-daily?chain=off`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(320_000) });
      const j = await r.json().catch(() => ({}));
      more = !!j?.data?.more;
      for (const x of j?.data?.results ?? []) if ((x.status === "completed" || x.status === "partial") && !dwAnnounced.has(j.data.date)) { dwAnnounced.add(j.data.date); say(`  [darwin] Daily lead search finished — ${x.verified} verified no-website leads saved. Open JARVIS for the report.`); }
    } catch { /* offline — next round */ } finally { dwTicking = false; }
    // still searching → carry straight on; otherwise look again in 5 minutes
    clearTimeout(dwTimer);
    dwTimer = setTimeout(darwinDaily, more ? 5_000 : 5 * 60_000);
  };
  dwTimer = setTimeout(darwinDaily, 60_000);
  setTimeout(evDaily, 120_000);
  setInterval(evDaily, 5 * 60_000);
  if (!process.argv.includes("--no-open")) {
    if (win) spawn(`start "" "${local}"`, { shell: true, stdio: "ignore", detached: true });
    else if (process.platform === "darwin") spawn("open", [local], { stdio: "ignore", detached: true });
    else spawn("xdg-open", [local], { stdio: "ignore", detached: true }).on("error", () => {});
  }
} else {
  say(`\n  JARVIS didn't start on ${local} — see the [jarvis] lines above.`);
}
