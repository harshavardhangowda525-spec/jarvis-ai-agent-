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
import { toNativeChat, NativeToOpenAI, describeTimings, ndjson } from "./src/ollama-native.mjs";
import { lowerOllamaPriority } from "./src/os-priority.mjs";

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
// Speed settings (see src/ollama-native.mjs for why these matter).
const NATIVE = read("BRAIN_NATIVE") !== "0"; // talk to Ollama's native API
const NUM_CTX = Math.max(2048, Number(read("BRAIN_CTX")) || 8192);
const KEEP_ALIVE = read("BRAIN_KEEP_ALIVE") || "24h";
let NO_THINK = false; // set when the model supports "thinking" (turned off for speed)

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
  // don't pay a 10–30s load time each time. The context size must match what
  // chat requests use, or Ollama would reload the model on the first question.
  await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: KEEP_ALIVE, ...(NATIVE ? { options: { num_ctx: NUM_CTX } } : {}) }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {});
}

/** Does this model "think" before answering (qwen3, deepseek-r1, …)? */
async function detectThinking() {
  try {
    const r = await fetch(`${OLLAMA}/api/show`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, name: MODEL }), signal: AbortSignal.timeout(10_000),
    });
    const d = await r.json();
    return Array.isArray(d?.capabilities) && d.capabilities.includes("thinking");
  } catch { return false; }
}

/** Measure real speed once at startup and say what would make it faster. */
async function speedCheck() {
  let gpuShare = null;
  try {
    const ps = await (await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(5000) })).json();
    const m = (ps?.models ?? []).find((x) => [x.name, x.model].some((n) => n === MODEL || n === `${MODEL}:latest`));
    if (m?.size) gpuShare = (m.size_vram ?? 0) / m.size;
  } catch { /* older Ollama */ }
  let tps = null;
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL, stream: false, keep_alive: KEEP_ALIVE, ...(NO_THINK ? { think: false } : {}),
        messages: [{ role: "user", content: "Say hello in five words." }],
        options: { num_ctx: NUM_CTX, num_predict: 24 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const d = await r.json();
    if (d?.eval_count && d?.eval_duration) tps = d.eval_count / (d.eval_duration / 1e9);
  } catch { /* reported below as unknown */ }

  const where = gpuShare == null ? "" : gpuShare >= 0.99 ? "fully on the GPU" : gpuShare <= 0.01 ? "on the CPU only (no GPU)" : `${Math.round(gpuShare * 100)}% on the GPU, the rest on the CPU`;
  say(`  Speed: ${tps ? `${tps.toFixed(1)} tokens/sec` : "unknown"}${where ? ` · running ${where}` : ""}`);
  if (process.platform === "win32" && process.env.BRAIN_LOW_PRIORITY !== "0") say("  Ollama runs at below-normal priority, so Chrome and Windows stay responsive while it thinks.");
  if (tps != null && tps < 12) {
    say("  Tip: that's slow for voice. A smaller model answers 2–3× faster:");
    say("         ollama pull qwen2.5:3b     then set OLLAMA_MODEL=qwen2.5:3b in edith/.env");
    if (gpuShare != null && gpuShare < 0.99 && gpuShare > 0.01) say(`       The model doesn't fit in GPU memory — a smaller model or BRAIN_CTX=4096 lets it run fully on the GPU.`);
  }
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * /v1/chat/completions through Ollama's native API (keep_alive, num_ctx and
 * think=false can only be set there), answered in OpenAI format. Returns
 * Ollama's final timing line for the log.
 */
async function nativeChat(req, res, onFirstToken) {
  const json = (code, body) => { if (!res.headersSent) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); } else res.end(); };
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { json(400, { error: { message: "Invalid JSON body" } }); return null; }
  const nreq = toNativeChat(body, { model: MODEL, numCtx: NUM_CTX, keepAlive: KEEP_ALIVE, noThink: NO_THINK });

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ac.abort(); }); // JARVIS gave up → stop generating

  // Streaming: answer with headers RIGHT AWAY and send a keep-alive comment every
  // few seconds while the model reads the prompt. On a CPU that reading can take
  // longer than a proxy/SDK will wait for silent headers; JARVIS enforces its own
  // "first word" limit instead (and falls back to the cloud if it's exceeded).
  let ping = null;
  const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const sseError = (message) => { sse({ error: { message } }); res.end(); };
  if (nreq.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    res.write(": reading the prompt\n\n");
    ping = setInterval(() => res.write(": still reading\n\n"), 5000);
  }
  const stopPing = () => { if (ping) { clearInterval(ping); ping = null; } };

  let up;
  try {
    up = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nreq), signal: ac.signal });
  } catch {
    stopPing();
    if (nreq.stream) sseError("Ollama isn't reachable on the PC."); else json(502, { error: { message: "Ollama isn't reachable on the PC." } });
    return null;
  }
  if (!up.ok) {
    stopPing();
    const text = await up.text().catch(() => "");
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* plain text */ }
    message = message || `Ollama HTTP ${up.status}`;
    if (nreq.stream) sseError(message); else json(up.status, { error: { message } });
    return null;
  }

  const conv = new NativeToOpenAI(nreq.model);
  try {
    if (nreq.stream) {
      let first = true;
      for await (const obj of ndjson(up.body)) {
        if (obj.error) { stopPing(); sse({ error: { message: String(obj.error) } }); break; }
        for (const c of conv.push(obj)) {
          if (first) { first = false; stopPing(); onFirstToken(); }
          sse(c);
        }
      }
      stopPing();
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      let err = null;
      for await (const obj of ndjson(up.body)) { if (obj.error) { err = String(obj.error); break; } conv.push(obj); }
      if (err) json(500, { error: { message: err } }); else json(200, conv.completion());
    }
  } catch {
    stopPing();
    if (!res.writableEnded) res.end(); // client went away mid-answer
  }
  return conv.final;
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
  let timings = "";
  say(`  ${stamp()}  ← request from JARVIS (${url.pathname.replace("/v1/", "")})`);
  res.on("finish", () => say(`  ${stamp()}  ✓ answered in ${secs()}s${firstByte ? ` (first word after ${firstByte.toFixed(1)}s)` : ""}${timings ? ` — ${timings}` : ""}`));
  res.on("close", () => {
    if (!res.writableFinished) say(`  ${stamp()}  ✗ JARVIS stopped waiting after ${secs()}s${firstByte ? "" : " before the first word"} and used a cloud model instead. A smaller model (see the Speed tip above) answers sooner.`);
  });
  if (NATIVE && req.method === "POST" && url.pathname === "/v1/chat/completions") {
    nativeChat(req, res, () => { firstByte = (Date.now() - t0) / 1000; })
      .then((final) => { timings = describeTimings(final); })
      .catch(() => { if (!res.headersSent) json(500, { error: { message: "Gateway error" } }); else res.end(); });
    return;
  }
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
let lastRegDetail = "";
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
    lastRegDetail = ((await r.json().catch(() => ({})))?.error ?? "").toString().slice(0, 200);
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
    "ok": "✓ Connected. JARVIS and DARWIN use this PC's brain as their unlimited backup when the cloud is rate-limited\n    (or first, if you chose \"Your PC (Ollama) first\" in Settings → AI). EV uses Groq only.",
    "no-jarvis": `✗ JARVIS_URL isn't set. Add to edith/.env:  JARVIS_URL=https://your-app.vercel.app`,
    "key-missing": `✗ JARVIS doesn't have the brain key yet. ${setKey}`,
    "key-mismatch": `✗ The brain key on Vercel doesn't match this PC. ${setKey}`,
    "old-deploy": "✗ Your Vercel app is on an older version without the brain endpoint — redeploy the latest code.",
    "unreachable": `✗ Couldn't reach ${JARVIS} — check JARVIS_URL and your internet.`,
  }[res] ?? `✗ JARVIS answered ${res}.`;
}

/** Ask the live deployment what it sees, so a setup problem is never a guess. */
async function diagnose() {
  if (!JARVIS) return;
  try {
    const r = await fetch(`${JARVIS}/api/brain/status`, { signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) { say(`  • ${JARVIS} doesn't have the latest code yet (no /api/brain/status). Redeploy the newest commit.`); return; }
    const d = (await r.json().catch(() => ({})))?.data;
    if (!d) return;
    say(`  • Live app: build ${d.build} (${d.environment}) — OLLAMA_API_KEY ${d.keyConfigured ? "IS set" : "is NOT set"} there.`);
    if (!d.keyConfigured) {
      say("    Checklist: exact name OLLAMA_API_KEY · value = the brain_… text only · Production ticked ·");
      say(`    the project that serves ${JARVIS.replace(/^https?:\/\//, "")} · Redeploy AFTER saving, wait for Ready.`);
    }
  } catch { /* offline */ }
  if (lastRegDetail) say(`  • JARVIS said: "${lastRegDetail}"`);
  say("  (Keep this window open — it retries every 2 minutes and prints ✓ as soon as JARVIS accepts the key.)");
}

/** How long the live app waits for this PC's first word (OLLAMA_TIMEOUT_MS on Vercel). */
async function showWaitLimit() {
  try {
    const r = await fetch(`${JARVIS}/api/brain/status`, { signal: AbortSignal.timeout(10_000) });
    const sec = (await r.json().catch(() => ({})))?.data?.firstWordTimeoutSec;
    if (!sec) return; // older deployment
    say(`  JARVIS waits up to ${sec}s for this PC's first word, then uses a cloud model.`);
    if (sec < 90) say("  (That's short for a CPU. Delete OLLAMA_TIMEOUT_MS on Vercel — or set it to 180000 — and redeploy.)");
  } catch { /* offline */ }
}

// ---- main ---------------------------------------------------------------------
say(`\nJARVIS brain gateway — model ${MODEL}`);
await checkOllama();
// Keep the PC responsive: Ollama yields the CPU to Chrome/Windows (Windows only).
lowerOllamaPriority();
if (NATIVE) NO_THINK = await detectThinking();
say(`  Loading the model into memory…${NATIVE ? ` (context ${NUM_CTX} tokens, kept loaded ${KEEP_ALIVE}${NO_THINK ? ", thinking off for speed" : ""})` : ""}`);
await warmUp();
lowerOllamaPriority(); // the model runner exists now
if (NATIVE) await speedCheck();
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
if (res !== "ok") await diagnose();
else await showWaitLimit();
if (FRESH_KEY && res !== "ok") say(`  (Your brain key is saved in edith/.brain-key — keep it private.)`);
say("\n  Keep this window open. Ctrl+C to stop.\n");

setInterval(async () => {
  lowerOllamaPriority(); // catches a runner restarted since the last check
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
