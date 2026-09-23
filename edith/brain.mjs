#!/usr/bin/env node
/**
 * `npm run brain` — makes the Ollama model on THIS PC the brain for JARVIS, EV
 * and DARWIN (which run on Vercel and can't reach localhost).
 *
 *   1. Checks Ollama is running and your model is pulled, and keeps it loaded.
 *   2. Starts a small gateway on 127.0.0.1 that REQUIRES a secret key on every
 *      request (Ollama itself has no auth) and only exposes the chat API.
 *   3. Opens a free Cloudflare tunnel to that gateway (no account needed).
 *   4. Tells JARVIS the tunnel's current URL every 2 minutes, so the address can
 *      change on every restart without you touching Vercel again.
 *
 * Stop it with Ctrl+C — JARVIS is told the brain went offline and falls back to
 * your cloud keys immediately.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./src/loadenv.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, ".env"));
const read = (n) => (process.env[n] ?? "").trim();

const OLLAMA = (read("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/\/v1$/, "");
const MODEL = read("OLLAMA_MODEL") || "qwen2.5-coder:7b";
const PORT = Number(read("BRAIN_PORT") || 11500);
const JARVIS = read("JARVIS_URL").replace(/\/+$/, "");
const FIXED_URL = read("BRAIN_PUBLIC_URL").replace(/\/+$/, ""); // e.g. an ngrok static domain
const KEY_FILE = path.resolve(__dirname, ".brain-key");
const HEARTBEAT_MS = 120_000;

const say = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

// ---- shared secret --------------------------------------------------------
function loadKey() {
  const fromEnv = read("OLLAMA_API_KEY");
  if (fromEnv) return { key: fromEnv, fresh: false };
  try { const k = fs.readFileSync(KEY_FILE, "utf8").trim(); if (k) return { key: k, fresh: false }; } catch { /* first run */ }
  const k = `brain_${crypto.randomBytes(24).toString("base64url")}`;
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  return { key: k, fresh: true };
}
const { key: KEY, fresh: FRESH_KEY } = loadKey();
const keyMatches = (header) => {
  const got = Buffer.from(String(header || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(KEY);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

// ---- Ollama checks ----------------------------------------------------------
async function checkOllama() {
  let tags;
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    tags = await r.json();
  } catch {
    die(`Ollama isn't running at ${OLLAMA}. Open the Ollama app (llama icon in the tray) or run "ollama serve", then try again.`);
  }
  const names = (tags?.models ?? []).map((m) => m.name);
  const has = names.some((n) => n === MODEL || n === `${MODEL}:latest` || (!MODEL.includes(":") && n.startsWith(`${MODEL}:`)));
  if (!has) {
    die(`Model "${MODEL}" isn't downloaded yet. Run:  ollama pull ${MODEL}` +
      (names.length ? `\n  (or set OLLAMA_MODEL to one you have: ${names.join(", ")})` : ""));
  }
}
async function warmUp() {
  // An empty prompt loads the model; keep_alive keeps it in memory so replies
  // don't pay a 10–30s load time each time.
  await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: "24h" }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {});
}

// ---- gateway ----------------------------------------------------------------
const ALLOWED = /^\/v1\/(chat\/completions|completions|embeddings|models)(\/[^/]+)?$/;
const upstream = new URL(OLLAMA);
const client = upstream.protocol === "https:" ? https : http;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://gateway");
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/health") return json(200, { ok: true, model: MODEL });
  if (!ALLOWED.test(url.pathname)) return json(404, { error: { message: "Not found" } });
  if (!keyMatches(req.headers.authorization)) return json(401, { error: { message: "Invalid brain key" } });

  // Live log so you can SEE JARVIS reaching this PC and how long answers take.
  const t0 = Date.now();
  const stamp = () => new Date().toLocaleTimeString();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  let firstByte = 0;
  say(`  ${stamp()}  ← request from JARVIS (${url.pathname.replace("/v1/", "")})`);
  res.on("finish", () => say(`  ${stamp()}  ✓ answered in ${secs()}s${firstByte ? ` (thinking ${firstByte.toFixed(1)}s before the first word)` : ""}`));
  res.on("close", () => {
    if (!res.writableFinished) say(`  ${stamp()}  ✗ JARVIS stopped waiting after ${secs()}s — the model is too slow for its time limit (see OLLAMA_TIMEOUT_MS or use a smaller model).`);
  });
  const up = client.request(
    { hostname: upstream.hostname, port: upstream.port, path: url.pathname + url.search, method: req.method,
      headers: { "content-type": req.headers["content-type"] ?? "application/json", accept: req.headers.accept ?? "*/*" } },
    (upRes) => {
      const headers = { ...upRes.headers }; delete headers.connection;
      res.writeHead(upRes.statusCode ?? 502, headers);
      upRes.once("data", () => { firstByte = (Date.now() - t0) / 1000; });
      upRes.pipe(res); // streams tokens straight through
    },
  );
  up.on("error", () => { if (!res.headersSent) json(502, { error: { message: "Ollama isn't reachable on the PC." } }); else res.end(); });
  req.pipe(up);
});

// ---- tunnel -----------------------------------------------------------------
function startTunnel() {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${PORT}`;
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
async function waitReachable(publicUrl) {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(5000) }); if (r.ok) return true; } catch { /* DNS still propagating */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

// ---- registration with JARVIS -----------------------------------------------
let lastRegOk = null;
async function register(publicUrl) {
  if (!JARVIS) return "no-jarvis";
  try {
    const r = await fetch(`${JARVIS}/api/brain/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ url: publicUrl, model: MODEL }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return "ok";
    if (r.status === 503) return "key-missing";
    if (r.status === 401) return "key-mismatch";
    if (r.status === 404) return "old-deploy";
    return `http-${r.status}`;
  } catch {
    return "unreachable";
  }
}
function explainReg(res) {
  const setKey = `Add this on Vercel → Settings → Environment Variables, then Redeploy:\n    OLLAMA_API_KEY=${KEY}`;
  return {
    "ok": "✓ JARVIS, EV and DARWIN are now using this PC's brain.",
    "no-jarvis": `✗ JARVIS_URL isn't set. Add to edith/.env:  JARVIS_URL=https://your-app.vercel.app`,
    "key-missing": `✗ JARVIS doesn't have the brain key yet. ${setKey}`,
    "key-mismatch": `✗ The brain key on Vercel doesn't match this PC. ${setKey}`,
    "old-deploy": "✗ Your Vercel app is on an older version without the brain endpoint — redeploy the latest code.",
    "unreachable": `✗ Couldn't reach ${JARVIS} — check JARVIS_URL and your internet.`,
  }[res] ?? `✗ JARVIS answered ${res}.`;
}

// ---- main ---------------------------------------------------------------------
say(`\nJARVIS brain gateway — model ${MODEL}`);
await checkOllama();
say("  Loading the model into memory…");
await warmUp();
setInterval(warmUp, 20 * 60_000).unref(); // keep it resident

await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); })
  .catch((e) => die(e.code === "EADDRINUSE" ? `Port ${PORT} is busy — is another "npm run brain" already running?` : e.message));

let publicUrl = FIXED_URL;
let tunnel = null;
if (!publicUrl) {
  say("  Opening a secure tunnel…");
  const t = await startTunnel();
  if (!t.url) die("Couldn't open a Cloudflare tunnel. Install it with:  winget install --id Cloudflare.cloudflared   then run npm run brain again.");
  publicUrl = t.url; tunnel = t.child;
  if (!(await waitReachable(publicUrl))) say("  (tunnel is slow to come up — continuing; JARVIS will retry)");
}

const res = await register(publicUrl);
lastRegOk = res === "ok";
say(`\n  Brain URL: ${publicUrl}`);
say(`  ${explainReg(res)}`);
if (FRESH_KEY && res !== "ok") say(`  (Your brain key is saved in edith/.brain-key — keep it private.)`);
say("\n  Keep this window open. Ctrl+C to stop.\n");

setInterval(async () => {
  const r = await register(publicUrl);
  if ((r === "ok") !== lastRegOk) say(`  ${new Date().toLocaleTimeString()}  ${explainReg(r)}`);
  lastRegOk = r === "ok";
}, HEARTBEAT_MS);

async function shutdown() {
  say("\n  Stopping — telling JARVIS the brain is offline…");
  if (JARVIS) {
    await fetch(`${JARVIS}/api/brain/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ url: null }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
  if (tunnel?.pid) {
    // On Windows the tunnel runs under a cmd.exe shell — kill the whole tree so
    // cloudflared doesn't linger in the background.
    if (process.platform === "win32") spawnSync(`taskkill /pid ${tunnel.pid} /T /F`, { shell: true, stdio: "ignore" });
    else tunnel.kill();
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
