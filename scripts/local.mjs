#!/usr/bin/env node
/**
 * `npm run local` — run ALL of JARVIS on this PC: the web app with every agent
 * (JARVIS, EV, DARWIN, ULTRON's dashboard) and the ULTRON runtime.
 *
 * Brains: JARVIS, EV and DARWIN answer with Groq (Gemini as the backup);
 * ULTRON runs on OpenRouter, with this PC's Ollama (127.0.0.1) as its backup. (Set
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
import { retireOldUltronProvider, stopPort, probeDatabase, pendingMigrations, repairDatabase, describeDbError, cloudAiKeys, prismaClientMatches, resolveKeys, pruneBuildCache } from "./local-helpers.mjs";
import { ensureSecret, searxngAnswers, startDocker } from "./searxng.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITH = path.join(ROOT, "edith");
const win = process.platform === "win32";
const PORT = Number(process.env.JARVIS_LOCAL_PORT || 3000);
const BRAIN_PORT = 11500;
const OLLAMA = "http://127.0.0.1:11434";

const say = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

/**
 * Minimal .env reader (quotes, BOM, inline "  # note"). Doesn't touch process.env.
 * A name listed twice keeps the first real value — but a blank / "[sensitive]"
 * line (what `vercel env pull` leaves) never hides a real value added further down.
 */
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
    const empty = (x) => !x || /^\[sensitive\]$/i.test(x);
    if (!(k in out) || (empty(out[k]) && !empty(v))) out[k] = v;
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
// ULTRON runs on OpenRouter, then Ollama — a leftover old-default line in edith/.env would keep it elsewhere.
for (const line of retireOldUltronProvider(path.join(EDITH, ".env"))) {
  say(`  edith/.env had ${line} (the old default) — turned that line off so ULTRON runs on OpenRouter, with this PC's Ollama as backup.`);
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
// Keys found where they really are: an empty line in .env.local (Vercel's "Sensitive" values come
// through empty) must not hide the real key in .env; a misspelt name or a .env.txt still counts.
const keyFiles = [[".env.local", path.join(ROOT, ".env.local")], [".env", path.join(ROOT, ".env")], [".env.local.txt", path.join(ROOT, ".env.local.txt")], [".env.txt", path.join(ROOT, ".env.txt")]]
  .filter(([, f]) => fs.existsSync(f)).map(([name, f]) => ({ name, env: readEnv(f) }));
const keys = resolveKeys(keyFiles, {
  GEOAPIFY_API_KEY: /^GEO_?A?P?I?FY(_API)?(_KEY)?$|^GEOAPIFY_?(API_?)?KEY$|^GEOAPIFY$|^GEOAPI(_KEY)?$|^GEOPIFY_API_KEY$/i,
  ELEVENLABS_API_KEY: /^ELEVEN_?LABS?(_API)?_KEY$/i,
  GROQ_API_KEY: /^GROQ_?(API_?)?KEY$/i,
  GEMINI_API_KEY: /^(GOOGLE_)?GEMINI_?(API_?)?KEY$/i,
});
for (const m of keys.misnamed) say(`  ! ${m.wrong} in ${m.file} looks like ${m.key} — using it for now; rename it to ${m.key}.`);
for (const h of keys.hidden) say(`  Note: ${h.key} is empty in ${h.file} — using the one in ${h.real}.`);
for (const [k, f] of Object.entries(keys.from)) if (/\.txt$/.test(f)) say(`  ! Using ${k} from ${f} — rename that file so Windows doesn't hide it.`);
say(keys.values.GEOAPIFY_API_KEY ? `  DARWIN lead discovery (Geoapify): key found in ${keys.from.GEOAPIFY_API_KEY} ✓` : "  ! DARWIN can't discover leads: no GEOAPIFY_API_KEY in .env.local or .env (free at myprojects.geoapify.com).");
// Other keys that came through blank (Sensitive on Vercel) — worth copying by hand.
const IMPORTANT = ["GROQ_API_KEY", "GEMINI_API_KEY", "ELEVENLABS_API_KEY", "GEOAPIFY_API_KEY", "GOOGLE_CLIENT_SECRET", "INSTAGRAM_ACCESS_TOKEN", "MAGIC_HOUR_API_KEY", "OLLAMA_API_KEY"];
const blank = IMPORTANT.filter((k) => k in appEnv && isPlaceholder(appEnv[k]) && !keys.values[k]);
if (blank.length) say(`  Note: these came through empty (marked Sensitive on Vercel): ${blank.join(", ")}.\n        Copy their values into .env.local if you want those features on this PC.`);
// Google (Gmail for DARWIN's emails, Calendar, Drive) needs both OAuth values on this PC too
const googleGone = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => isPlaceholder(appEnv[k]));
if (!googleGone.length) say("  Google (Gmail, Calendar, Drive): client ID and secret found in .env.local ✓");
else say(`  Note: ${googleGone.join(" and ")} ${googleGone.length > 1 ? "aren't" : "isn't"} in ${path.basename(envFile)} — Google (Gmail, Calendar, Drive) shows "Not configured" on this PC.\n        Copy the value${googleGone.length > 1 ? "s" : ""} from Google Cloud Console → APIs & Services → Credentials → your OAuth client, then restart.`);
// DARWIN's web searches (confirm "no website" — more searches, more leads a day)
const searches = [["SEARXNG_URL", "SearXNG"], ["BRAVE_SEARCH_API_KEY", "Brave"], ["SEARCH_API_KEY", "Tavily"], ["SERPER_API_KEY", "Serper"]].filter(([k]) => !isPlaceholder(appEnv[k])).map(([, n]) => n);
{
  // what RUBEN / the voice features will hear you with (the island needs one of these)
  const has = (k) => [appEnv[k], edithEnv[k]].some((v) => v && !isPlaceholder(v));
  say(has("ELEVENLABS_API_KEY") ? "  Voice input: ElevenLabs ✓"
    : has("GROQ_API_KEY") ? "  Voice input: Groq Whisper ✓ (no ELEVENLABS_API_KEY — replies use the Windows voice)"
    : "  ! Voice input is off — add GROQ_API_KEY (free at console.groq.com) or ELEVENLABS_API_KEY to .env.local to talk to RUBEN.");
}
say(searches.length ? `  DARWIN web search: ${searches.join(", ")} ✓` : "  Note: no web search for DARWIN — run  npm run searxng  (free, unlimited) or set SERPER_API_KEY / BRAVE_SEARCH_API_KEY in .env.local so it can confirm leads.");
// your own SearXNG (npm run searxng) on this PC: start it if it isn't running
const searxUrl = isPlaceholder(appEnv.SEARXNG_URL) ? "" : appEnv.SEARXNG_URL.trim().replace(/\/+$/, "");
if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(searxUrl) && fs.existsSync(path.join(ROOT, "searxng", "docker-compose.yml"))) {
  if ((await searxngAnswers(searxUrl, 2500)) !== "ok") {
    // Docker Desktop installed but closed → open it (waits up to ~90 s; JARVIS starts either way)
    const docked = await startDocker({ waitMs: 90_000, log: say });
    const dockerUp = docked === "running" || docked === "started";
    if (!dockerUp) say(`  ! SearXNG isn't running and Docker ${docked === "not_installed" ? "isn't installed" : "didn't start"} — run  npm run searxng  to see why. DARWIN uses its other web searches meanwhile.`);
    else {
      ensureSecret(path.join(ROOT, "searxng"));
      const up = spawnSync("docker", ["compose", "up", "-d"], { cwd: path.join(ROOT, "searxng"), stdio: "ignore", shell: win });
      let state = "down";
      for (let i = 0; up.status === 0 && i < 20 && state !== "ok"; i++) { state = await searxngAnswers(searxUrl, 2000); if (state !== "ok") await new Promise((r) => setTimeout(r, 1500)); }
      say(state === "ok" ? "  SearXNG started ✓" : "  ! Couldn't start SearXNG — run  npm run searxng  to see why. DARWIN uses its other web searches meanwhile.");
    }
  } else say("  SearXNG is running ✓");
}
// keys that are almost right (a typo, or SerpApi's name instead of Serper's) and a file Notepad saved as .txt
const SEARCH_KEYS = ["SEARXNG_URL", "BRAVE_SEARCH_API_KEY", "SEARCH_API_KEY", "SERPER_API_KEY"];
// monthly budgets — real settings that take a number, not a key
const SEARCH_BUDGETS = ["DARWIN_BRAVE_MONTHLY", "DARWIN_SERPER_MONTHLY", "DARWIN_SEARCH_MONTHLY_CREDITS"];
for (const k of SEARCH_BUDGETS.filter((k) => appEnv[k] && !isPlaceholder(appEnv[k]) && !/^\s*(\d+|0|off|none|unlimited)\s*$/i.test(appEnv[k]))) {
  say(`  ! ${k} in .env.local is the monthly search budget and takes a number (e.g. 2000) — if you pasted an API key there, move it to ${/BRAVE/.test(k) ? "BRAVE_SEARCH_API_KEY" : "SERPER_API_KEY"}.`);
}
for (const k of Object.keys(appEnv).filter((k) => /SERP|BRAVE|SEARX/i.test(k) && !SEARCH_KEYS.includes(k) && !SEARCH_BUDGETS.includes(k) && !isPlaceholder(appEnv[k]))) {
  say(`  ! ${k} in .env.local isn't a name DARWIN reads — ${/SERPAPI/i.test(k) ? "SerpApi (serpapi.com) is a different service; DARWIN uses Serper (serper.dev): " : ""}rename it to ${/BRAVE/i.test(k) ? "BRAVE_SEARCH_API_KEY" : /SEARX/i.test(k) ? "SEARXNG_URL" : "SERPER_API_KEY"}.`);
}
for (const f of [".env.local.txt", ".env.txt"]) {
  if (fs.existsSync(path.join(ROOT, f))) say(`  ! Found ${f} — Windows saved it with .txt on the end, so JARVIS can't read it. Rename it to ${f.replace(/\.txt$/, "")} (or copy its lines into .env.local).`);
}
if (blank.includes("INSTAGRAM_ACCESS_TOKEN")) say("        Instagram: open EV once in your Vercel JARVIS — it saves the connection to your database, and EV on this PC uses it.");

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
  // --no-save: install what's missing without rewriting package-lock.json, so the
  // next `git pull` never stops on "local changes to package-lock.json"
  if (missing.length) runStep(`Installing ${label} packages (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""})`, "npm install --no-save --no-audit --no-fund", dir);
}

/** prisma generate, tolerating a locked engine file when the client is already current. */
async function prismaGenerate() {
  const cmd = `"${process.execPath}" "${path.join(ROOT, "node_modules", "prisma", "build", "index.js")}" generate`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    say("  Preparing the database client…");
    const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", env: process.env });
    if (r.status === 0) return;
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const locked = /EPERM|EBUSY|operation not permitted|resource busy/i.test(out);
    const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
    if (locked && prismaClientMatches(read(path.join(ROOT, "prisma", "schema.prisma")), read(path.join(ROOT, "node_modules", ".prisma", "client", "schema.prisma")))) {
      say("  Database client is already up to date (its file is in use by another program — that's fine).");
      return;
    }
    if (locked && attempt === 1) { say("  The database client file is in use — waiting a moment and trying again…"); await new Promise((r) => setTimeout(r, 4000)); continue; }
    process.stdout.write(out);
    if (locked) die("Windows won't let JARVIS update node_modules\\.prisma\\client — another program has it open.\n  Close other JARVIS / \"npm run local\" / \"npm run dev\" windows and Prisma Studio (or open Task Manager and end the \"Node.js JavaScript Runtime\" tasks), then run npm run local again. Restarting the PC also clears it.");
    die("Preparing the database client failed (see the output above).");
  }
}

// ---- 3. build when the code changed -------------------------------------------------------
const head = (() => { try { return spawnSync("git rev-parse HEAD", { cwd: ROOT, shell: true, encoding: "utf8" }).stdout.trim(); } catch { return ""; } })();
const stampFile = path.join(ROOT, ".next", "LOCAL_BUILD_COMMIT");
const built = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8").trim() : "";
if (!built || (head && stamp !== head) || process.argv.includes("--rebuild")) {
  // A JARVIS left running from an earlier window keeps Prisma's engine file open,
  // and Windows then refuses to replace it (EPERM … query_engine-windows.dll.node).
  if (stopPort(PORT)) {
    say(`  Stopped the JARVIS that was still running on port ${PORT} from before.`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  await prismaGenerate();
  // the build cache only speeds builds up — keep it bounded instead of letting it reach gigabytes
  const freed = pruneBuildCache(ROOT);
  if (freed) say(`  Cleared the old build cache (${Math.round(freed / 1024 / 1024)} MB) — this build takes a little longer.`);
  runStep("Building JARVIS (a few minutes the first time, and after each update)", `node scripts/copy-vision-assets.mjs && "${process.execPath}" "${path.join(ROOT, "node_modules", "next", "dist", "bin", "next")}" build`, ROOT);
  if (head) fs.writeFileSync(stampFile, head);
}

// ---- 3b. can this PC reach the database? (Neon sleeps when idle — this also wakes it) -------
{
  const db = await probeDatabase(ROOT, dbUrl);
  if (db.ok) {
    say(`  Database: connected (${db.ms > 4000 ? `it was asleep — woke up in ${(db.ms / 1000).toFixed(1)} s` : `${db.ms} ms`})`);
    // this version's database changes (e.g. RUBIN's lead numbers) — applied once per update, safe to repeat
    // Ask the database itself which of this version's changes it still needs (never trust a
    // stamp alone — an update that failed once must not leave tables missing for good).
    // First: add anything this version needs that the database is missing (e.g. "column payload
    // does not exist" after an update that failed part-way) — additive, safe to repeat.
    const fix = await repairDatabase(ROOT, dbUrl);
    if (fix?.error) say(`  ! Couldn't check the database tables: ${fix.error}`);
    else if (fix) {
      if (fix.repaired.length) say(`  Database: added what it was missing (${fix.repaired.join(", ")}).`);
      for (const f of fix.failed) say(`  ! Database change ${f.name} couldn't be added: ${f.error}`);
    }
    const before = await pendingMigrations(ROOT, dbUrl);
    const needed = !before || before.missing.length > 0 || before.failed.length > 0 || process.argv.includes("--migrate");
    if (needed) {
      say(`  Updating the database for this version…${before?.missing.length ? ` (${before.missing.length} change${before.missing.length === 1 ? "" : "s"}: ${before.missing.join(", ")})` : ""}`);
      const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
        cwd: ROOT, stdio: "inherit", timeout: 180_000,
        // a pooled Neon address can't run migrations — use the direct one
        env: { ...process.env, DATABASE_URL: dbUrl.replace("-pooler.", ".") },
      });
      const after = await pendingMigrations(ROOT, dbUrl);
      if (r.status === 0 && after && !after.missing.length) say("  Database is up to date.");
      else {
        say("  ! The database couldn't be updated — some features will fail with \"column/table does not exist\" until it is.");
        if (after?.failed.length) say(`    A database change failed part-way: ${after.failed.join(", ")}. Send the error lines above to get it fixed.`);
        else if (after?.missing.length) say(`    Still missing: ${after.missing.join(", ")}. Send the error lines above, or run  npm run local -- --migrate  to try again.`);
      }
    }
  } else {
    say(`  ! Database: can't connect right now.\n    ${describeDbError(db.error) ?? db.error.split("\n").filter(Boolean).pop()}`);
    say("    JARVIS will still start and keeps retrying, but sign-in and saving need the database.");
  }
}

// ---- 4. Ollama: ULTRON's brain (and JARVIS's only when JARVIS_PROVIDER says so) ---------------
const pickOf = (v, d) => (v || d).toLowerCase().split(/[\s,>]+/).filter(Boolean);
const jarvisPick = pickOf(appEnv.JARVIS_PROVIDER, "groq,gemini");
// what ULTRON itself will read: your environment, then edith/.env (old name EDITH_AI_PROVIDER too)
const ultronSetting = process.env.ULTRON_AI_PROVIDER || edithEnv.ULTRON_AI_PROVIDER || edithEnv.EDITH_AI_PROVIDER || "";
const ultronPick = pickOf(ultronSetting, "openrouter,ollama");
// ULTRON's main brain: OpenRouter (its key may be in edith/.env or .env.local)
const openrouterKey = [edithEnv.OPENROUTER_API_KEY, appEnv.OPENROUTER_API_KEY].find((v) => v && !isPlaceholder(v)) || "";
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
    say(ultronPick[0] === "ollama" || !openrouterKey
      ? "  ! Ollama isn't running — ULTRON runs on it. Install it from ollama.com (or open the Ollama app), then restart this."
      : "  Ollama isn't running — ULTRON works on OpenRouter, but has no backup when OpenRouter is busy. Install/open Ollama (ollama.com) for one.");
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

// ---- 4b. Claude on this PC (your Claude plan) as the agents' brain ---------------------------------
// CLAUDE_FOR_ALL_AGENTS=1, or "claude" in any agent's *_PROVIDER list → start the Claude bridge
// (edith/claude-bridge.mjs) on 127.0.0.1; the agents fall back to their other brains if it can't answer.
const CLAUDE_PORT = 11510;
const agentPicks = ["JARVIS_PROVIDER", "DARWIN_PROVIDER", "RUBIN_PROVIDER", "ROBIN_PROVIDER", "EV_PROVIDER", "MIKE_PROVIDER", "ASTON_PROVIDER"].map((k) => pickOf(appEnv[k], ""));
const claudeWanted = ["1", "true", "yes", "on"].includes(String(appEnv.CLAUDE_FOR_ALL_AGENTS ?? "").toLowerCase()) || agentPicks.some((p) => p.includes("claude"));
const claudeKeyFile = path.join(EDITH, ".claude-bridge-key");
let claudeKey = appEnv.CLAUDE_BRIDGE_KEY || edithEnv.CLAUDE_BRIDGE_KEY || (fs.existsSync(claudeKeyFile) ? fs.readFileSync(claudeKeyFile, "utf8").trim() : "");
let claudeUrl = "";
if (claudeWanted) {
  if (!claudeKey) { claudeKey = `claude_${crypto.randomBytes(24).toString("base64url")}`; fs.writeFileSync(claudeKeyFile, claudeKey, { mode: 0o600 }); }
  if (await up(`http://127.0.0.1:${CLAUDE_PORT}/health`)) say("  Claude bridge already running on this PC — using it.");
  else {
    say("  Starting the Claude bridge (Claude on this PC, your Claude plan)…");
    start("claude", ["claude-bridge.mjs"], { cwd: EDITH, env: { CLAUDE_BRIDGE_LOCAL_ONLY: "1", CLAUDE_BRIDGE_KEY: claudeKey, CLAUDE_BRIDGE_PORT: String(CLAUDE_PORT), ...(appEnv.CLAUDE_MODEL ? { CLAUDE_MODEL: appEnv.CLAUDE_MODEL } : {}), ...(appEnv.CLAUDE_BIN ? { CLAUDE_BIN: appEnv.CLAUDE_BIN } : {}) } });
  }
  if (await waitFor(`http://127.0.0.1:${CLAUDE_PORT}/health`, 90)) claudeUrl = `http://127.0.0.1:${CLAUDE_PORT}`;
  else say("  ! The Claude bridge didn't start (see the [claude] lines above) — the agents use their other brains.");
}

// ---- 5. ULTRON runtime ------------------------------------------------------------------------------
// ULTRON runs on OpenRouter, then this PC's Ollama. Cloud keys are lent too, for
// anyone who picks other brains with ULTRON_AI_PROVIDER (e.g. "ollama,groq").
const groqKey = [edithEnv.GROQ_API_KEY, appEnv.GROQ_API_KEY].find((v) => v && !isPlaceholder(v)) || "";
const startUltron = () => start("ultron", ["run.mjs"], { cwd: EDITH, env: { ...(groqKey ? { GROQ_API_KEY: groqKey } : {}), ...(openrouterKey ? { OPENROUTER_API_KEY: openrouterKey } : {}), ULTRON_OLLAMA_MODEL: ultronModel, OLLAMA_BASE_URL: OLLAMA, ULTRON_ALLOWED_ORIGINS: [edithEnv.ULTRON_ALLOWED_ORIGINS || edithEnv.EDITH_ALLOWED_ORIGINS, `http://localhost:${PORT}`].filter(Boolean).join(",") } });
// the brain ULTRON will answer with first (OpenRouter needs its key; "auto" isn't checked)
const ultronFirst = ultronPick.includes("auto") ? "" : ultronPick.find((p) => (p === "openrouter" ? !!openrouterKey : true)) ?? "";
const running = await fetch("http://127.0.0.1:7420/health", { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).catch(() => null);
if (!running) startUltron();
else if (ultronFirst && !new RegExp(`^${ultronFirst}\\b`, "i").test(String(running.brain ?? ""))) {
  // an ULTRON from before (another window, or left behind) — it would keep answering on its old brain
  say(`  An older ULTRON is still running on ${running.brain || "another brain"} — stopping it so ULTRON starts on ${ultronFirst === "ollama" ? "Ollama" : ultronFirst === "openrouter" ? "OpenRouter" : ultronFirst}…`);
  stopPort(7420);
  for (let i = 0; i < 20 && (await up("http://127.0.0.1:7420/health", 800)); i++) await new Promise((r) => setTimeout(r, 500));
  if (await up("http://127.0.0.1:7420/health", 800)) say("  ! Couldn't stop it — close the old ULTRON window (or restart the PC), then run this again.");
  else startUltron();
} else say(`  ULTRON already running on ${running.brain || "its brain"} — using it.`);

// ---- 6. the web app (every agent) ------------------------------------------------------------------
// JARVIS, EV and DARWIN answer with Groq/Gemini. Their keys may be in .env.local
// or — from when ULTRON ran on Groq — only in edith/.env: hand over whichever exists.
const aiKeys = cloudAiKeys(appEnv, edithEnv);
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
    ...(claudeUrl ? { CLAUDE_BRIDGE_URL: claudeUrl, CLAUDE_BRIDGE_KEY: claudeKey, CLAUDE_MODEL: appEnv.CLAUDE_MODEL || "sonnet" } : {}),
    ...aiKeys.values,
    // the keys exactly where they were found (an empty line elsewhere can't hide them)
    ...keys.values,
    // EV's images must stay publicly reachable for Instagram — keep the Vercel address.
    APP_URL: appEnv.APP_URL || edithEnv.JARVIS_URL || "",
    DATABASE_URL: dbUrl,
    AUTH_SECRET: appEnv.AUTH_SECRET,
    CRON_SECRET: cronSecret,
    // Google (Gmail, Calendar, Drive): hand the values over directly, so a blank
    // duplicate line or an empty Windows variable can't hide them
    ...Object.fromEntries(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => !isPlaceholder(appEnv[k])).map((k) => [k, appEnv[k].trim()])),
  },
});
const local = `http://localhost:${PORT}`;
if (await waitFor(`${local}/login`, 120)) {
  say(`\n  ✓ JARVIS is running on this PC: ${local}`);
  const only = (pick) => (pick.includes("auto") ? "all providers" : pick.map((p) => (p === "ollama" ? "Ollama" : p === "claude" ? "Claude (this PC)" : p[0].toUpperCase() + p.slice(1))).join(" → "));
  if (claudeUrl) say(`    Claude on this PC answers first for ${["1", "true", "yes", "on"].includes(String(appEnv.CLAUDE_FOR_ALL_AGENTS ?? "").toLowerCase()) ? "every agent" : "the agents whose list starts with claude"} (your Claude plan's limits apply; their other brains take over when it can't).`);
  const withModel = (pick, m) => only(pick).replace(/^Ollama\b/, `Ollama (${m})`);
  // CLAUDE_FOR_ALL_AGENTS puts Claude in front of every agent's own list (when the bridge is up)
  const claudeAll = !!claudeUrl && ["1", "true", "yes", "on"].includes(String(appEnv.CLAUDE_FOR_ALL_AGENTS ?? "").toLowerCase());
  const eff = (pick) => (claudeAll && !pick.includes("claude") ? ["claude", ...pick] : pick);
  say(`    Brains: JARVIS ${withModel(eff(jarvisPick), model)} · EV ${only(eff(pickOf(appEnv.EV_PROVIDER, "groq,gemini")))} · DARWIN ${only(eff(pickOf(appEnv.DARWIN_PROVIDER, "groq,gemini")))} · ULTRON ${withModel(ultronPick, ultronModel)}`);
  if (claudeWanted && !claudeUrl) say("    ! You asked for Claude (CLAUDE_FOR_ALL_AGENTS / claude in a *_PROVIDER), but the Claude bridge isn't running — see the [claude] lines above. The agents are using their other brains.");
  const geminiKey = [edithEnv.GEMINI_API_KEY, appEnv.GEMINI_API_KEY].find((v) => v && !isPlaceholder(v));
  if (aiKeys.borrowed.length) say(`    Using ${aiKeys.borrowed.join(", ")} from edith/.env for JARVIS, EV and DARWIN (it isn't in .env.local).`);
  if (!Object.keys(aiKeys.values).some((k) => k.endsWith("_API_KEY"))) say("    ! No AI key found (GROQ_API_KEY / GEMINI_API_KEY) in .env.local or edith/.env — JARVIS, EV and DARWIN can't answer until you add one.\n      Free keys: console.groq.com/keys and aistudio.google.com/apikey — put them in .env.local, then run this again.");
  else if (!groqKey && !geminiKey) say("    ! GROQ_API_KEY and GEMINI_API_KEY are both empty — JARVIS, EV and DARWIN are set to use those two.");
  else if (!groqKey) say("    ! GROQ_API_KEY is empty — JARVIS, EV and DARWIN will use Gemini only.");
  else if (!geminiKey) say("    (No GEMINI_API_KEY — JARVIS, EV and DARWIN have no backup when Groq is busy. Free at aistudio.google.com/apikey.)");
  if (appEnv.JARVIS_PROVIDER && usesOllama(jarvisPick)) say(`    Note: .env.local sets JARVIS_PROVIDER=${appEnv.JARVIS_PROVIDER}, so JARVIS stays on your PC brain — delete that line to use Groq/Gemini.`);
  if (ultronSetting && ultronPick.join(",") !== "openrouter,ollama") say(`    Note: ULTRON_AI_PROVIDER=${ultronSetting} is set — delete that line in edith/.env for the default (OpenRouter, then Ollama).`);
  else if (!openrouterKey) say("    ! No OPENROUTER_API_KEY in .env.local or edith/.env — ULTRON runs on Ollama only. Get a key at openrouter.ai/keys to make OpenRouter its main brain.");
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
  // MIKE: check market alerts and finish open journal setups every 5 minutes (it never trades).
  let mkTicking = false;
  const mikeTick = async () => {
    if (mkTicking) return;
    mkTicking = true;
    try {
      const r = await fetch(`${local}/api/cron/mike`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(320_000) });
      const j = await r.json().catch(() => ({}));
      for (const x of j?.data?.results ?? []) for (const m of x.messages ?? []) say(`  [mike] ${m}`);
    } catch { /* offline — next round */ } finally { mkTicking = false; }
  };
  // RUBIN: email you a reminder before each follow-up / demo is due — checked every minute
  let rbTicking = false, rbWarned = false;
  const robinTick = async () => {
    if (rbTicking) return;
    rbTicking = true;
    try {
      const r = await fetch(`${local}/api/cron/robin`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(60_000) });
      const j = await r.json().catch(() => ({}));
      if (j?.data?.sent) say(`  [robin] Emailed you ${j.data.sent === 1 ? "a reminder" : `${j.data.sent} reminders`} for what's coming up.`);
      for (const x of j?.data?.results ?? []) if (x.skipped === "gmail" && !rbWarned) { rbWarned = true; say("  [robin] A follow-up is coming up, but Gmail isn't connected — connect Google in JARVIS Settings for reminder emails."); break; }
    } catch { /* offline — next round */ } finally { rbTicking = false; }
  };
  // JARVIS's delegated tasks: run what's waiting and pick up any a restart interrupted — every minute
  let jobTicking = false;
  const jobsTick = async () => {
    if (jobTicking) return;
    jobTicking = true;
    try {
      const r = await fetch(`${local}/api/cron/jobs`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(320_000) });
      const j = await r.json().catch(() => ({}));
      if (j?.data?.ran?.length) say(`  [tasks] Ran ${j.data.ran.length} delegated task${j.data.ran.length === 1 ? "" : "s"}.`);
    } catch { /* offline — next round */ } finally { jobTicking = false; }
  };
  // ASTON's daily marketing plan (also on the cloud schedule — this just covers a PC that's on)
  let planTicking = false;
  const plansTick = async () => {
    if (planTicking) return;
    planTicking = true;
    try {
      const r = await fetch(`${local}/api/cron/plans`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(320_000) });
      const j = await r.json().catch(() => ({}));
      for (const p of j?.data?.plans ?? []) if (p.status === "ready" && p.niche && !plansSaid.has(p.niche)) { plansSaid.add(p.niche); say(`  [plan] Today's marketing plan is ready — ${p.niche}.`); }
    } catch { /* offline — next round */ } finally { planTicking = false; }
  };
  const plansSaid = new Set();
  setTimeout(plansTick, 75_000);
  setInterval(plansTick, 5 * 60_000);
  setTimeout(jobsTick, 30_000);
  setInterval(jobsTick, 60_000);
  setTimeout(robinTick, 45_000);
  setInterval(robinTick, 60_000);
  setTimeout(mikeTick, 90_000);
  setInterval(mikeTick, 5 * 60_000);
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
