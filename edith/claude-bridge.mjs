#!/usr/bin/env node
/**
 * `npm run claude` — makes the Claude app on THIS PC (Claude Code, signed in
 * with your Claude plan — no API key) the brain for JARVIS and its agents.
 *
 *   1. Checks the `claude` command is installed and signed in.
 *   2. Starts a gateway on 127.0.0.1 that speaks the same chat API JARVIS uses
 *      for every brain, and REQUIRES a secret key on every request.
 *   3. Each request runs `claude -p` once with Claude's own tools switched off:
 *      Claude thinks and decides which of JARVIS's tools to call; JARVIS runs
 *      them, exactly as with Groq/Gemini.
 *   4. Opens a free Cloudflare tunnel and tells your online JARVIS its address
 *      every 2 minutes (like `npm run brain`). With `npm run local` it serves
 *      127.0.0.1 only.
 *
 * Usage counts against your Claude plan's limits. When a limit is reached (or
 * the PC is off) JARVIS uses the next brain in its list (e.g. Groq, Gemini).
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./src/loadenv.mjs";
import { startTunnel, waitReachable, stopTunnel } from "./src/tunnel.mjs";
import { BridgeError, buildRequest, claudeArgs, parseResult, toChunks, toCompletion } from "./src/claude-protocol.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, ".env"));
const read = (n) => (process.env[n] ?? "").trim();

const MODEL = read("CLAUDE_MODEL") || "sonnet"; // sonnet | opus | haiku | a full model name
const PORT = Number(read("CLAUDE_BRIDGE_PORT") || 11510);
const JARVIS = read("JARVIS_URL").replace(/\/+$/, "");
const FIXED_URL = read("CLAUDE_BRIDGE_PUBLIC_URL").replace(/\/+$/, "");
const LOCAL_ONLY = read("CLAUDE_BRIDGE_LOCAL_ONLY") === "1";
const MAX_PARALLEL = Math.max(1, Number(read("CLAUDE_MAX_PARALLEL")) || 2);
const TIMEOUT_MS = Math.max(30_000, Number(read("CLAUDE_TIMEOUT_MS")) || 180_000);
const KEY_FILE = path.resolve(__dirname, ".claude-bridge-key");
// CLAUDE_BRIDGE_DEBUG_DIR=folder → save each request and Claude's raw answer there (troubleshooting only)
const DEBUG_DIR = read("CLAUDE_BRIDGE_DEBUG_DIR");
const HEARTBEAT_MS = 120_000;
// an empty folder: Claude never sees your files or a CLAUDE.md
const WORKDIR = path.join(os.tmpdir(), "jarvis-claude-bridge");

const say = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

// ---- shared secret --------------------------------------------------------
function loadKey() {
  const fromEnv = read("CLAUDE_BRIDGE_KEY");
  if (fromEnv) return { key: fromEnv, fresh: false };
  try { const k = fs.readFileSync(KEY_FILE, "utf8").trim(); if (k) return { key: k, fresh: false }; } catch { /* first run */ }
  const k = `claude_${crypto.randomBytes(24).toString("base64url")}`;
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  return { key: k, fresh: true };
}
const { key: KEY, fresh: FRESH_KEY } = loadKey();
const keyMatches = (header) => {
  const got = Buffer.from(String(header || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(KEY);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

// ---- finding the claude command -------------------------------------------
/**
 * How to start Claude without a shell (a shell would mangle the JSON schema):
 * the native claude(.exe); or, for an npm install on Windows (a .cmd shim), node
 * with the package's cli.js.
 */
export function resolveClaude() {
  const custom = read("CLAUDE_BIN");
  if (custom) return { cmd: custom, pre: [] };
  if (process.platform !== "win32") return { cmd: "claude", pre: [] };
  const found = spawnSync("where claude", { shell: true, encoding: "utf8" }).stdout?.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) ?? [];
  const exe = found.find((f) => /\.exe$/i.test(f));
  if (exe) return { cmd: exe, pre: [] };
  for (const shim of found.filter((f) => /\.cmd$/i.test(f))) {
    const cli = path.join(path.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (fs.existsSync(cli)) return { cmd: process.execPath, pre: [cli] };
  }
  return null;
}
const CLAUDE = resolveClaude();

function runClaude(args, input, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE.cmd, [...CLAUDE.pre, ...args], { cwd: WORKDIR, windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "jarvis-bridge" } });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new BridgeError(504, `Claude took longer than ${Math.round(TIMEOUT_MS / 1000)}s.`)); }, TIMEOUT_MS);
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); reject(new BridgeError(500, `Couldn't start Claude: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (out.trim()) resolve(out);
      else reject(new BridgeError(502, `Claude exited (${code})${err.trim() ? `: ${err.trim().slice(0, 300)}` : ""}`));
    });
    child.stdin.end(input);
  });
}

// ---- one request at a time per slot ----------------------------------------
let running = 0;
const queue = [];
const slot = () => new Promise((r) => { if (running < MAX_PARALLEL) { running++; r(); } else queue.push(r); });
const release = () => { const next = queue.shift(); if (next) next(); else running--; };

/** One JARVIS turn → one `claude -p` run → { text, toolCalls }. */
async function think(body, signal) {
  const { system, prompt, schema, toolNames } = buildRequest(body);
  const sysFile = path.join(WORKDIR, `system-${crypto.randomBytes(6).toString("hex")}.txt`);
  fs.writeFileSync(sysFile, system || "You are a helpful assistant.");
  await slot();
  try {
    const stdout = await runClaude(claudeArgs({ model: MODEL, systemFile: sysFile, schema }), prompt, signal);
    if (DEBUG_DIR) fs.writeFileSync(path.join(DEBUG_DIR, `${Date.now()}.json`), JSON.stringify({ system, prompt, schema, stdout }, null, 1));
    return parseResult(stdout, toolNames);
  } finally {
    release();
    fs.rm(sysFile, { force: true }, () => {});
  }
}

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

// ---- gateway ------------------------------------------------------------------
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://gateway");
  const json = (code, body) => { if (!res.headersSent) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); } else res.end(); };
  if (url.pathname === "/health") return json(200, { ok: true, kind: "claude", model: MODEL, busy: running, waiting: queue.length });
  if (url.pathname === "/v1/models") return keyMatches(req.headers.authorization) ? json(200, { object: "list", data: [{ id: MODEL, object: "model" }] }) : json(401, { error: { message: "Invalid bridge key" } });
  if (url.pathname !== "/v1/chat/completions" || req.method !== "POST") return json(404, { error: { message: "Not found" } });
  if (!keyMatches(req.headers.authorization)) return json(401, { error: { message: "Invalid bridge key" } });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(400, { error: { message: "Invalid JSON body" } }); }
  const t0 = Date.now();
  const stamp = () => new Date().toLocaleTimeString();
  say(`  ${stamp()}  ← request from JARVIS (${(body.tools ?? []).length} tools${queue.length || running >= MAX_PARALLEL ? `, waiting for a free slot` : ""})`);
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ac.abort(); });

  // stream: headers now, keep-alive comments while Claude thinks
  let ping = null;
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    res.write(": thinking\n\n");
    ping = setInterval(() => res.write(": still thinking\n\n"), 5000);
  }
  try {
    const r = await think(body, ac.signal);
    if (ping) clearInterval(ping);
    say(`  ${stamp()}  ✓ answered in ${((Date.now() - t0) / 1000).toFixed(1)}s${r.toolCalls.length ? ` — calls ${r.toolCalls.map((c) => c.name).join(", ")}` : ""}`);
    if (body.stream) {
      for (const c of toChunks(MODEL, r)) res.write(`data: ${JSON.stringify(c)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else json(200, toCompletion(MODEL, r));
  } catch (e) {
    if (ping) clearInterval(ping);
    const status = e instanceof BridgeError ? e.status : 500;
    const message = e instanceof BridgeError ? e.message : `Bridge error: ${e?.message ?? e}`;
    say(`  ${stamp()}  ✗ ${message}`);
    // a stream already said 200: report the error inside it (JARVIS falls back to the next brain)
    if (body.stream && res.headersSent) { res.write(`data: ${JSON.stringify({ error: { message, code: status } })}\n\n`); res.end(); }
    else json(status, { error: { message } });
  }
});

// ---- registration with JARVIS -------------------------------------------------
async function register(publicUrl) {
  if (!JARVIS) return "no-jarvis";
  try {
    const r = await fetch(`${JARVIS}/api/brain/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ kind: "claude", url: publicUrl, model: MODEL }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return "ok";
    if (r.status === 503) return "key-missing";
    if (r.status === 401) return "key-mismatch";
    if (r.status === 404 || r.status === 400) return "old-deploy";
    return `http-${r.status}`;
  } catch {
    return "unreachable";
  }
}
function explainReg(res) {
  const setKey = `Add this on Vercel → Settings → Environment Variables, then Redeploy:\n    CLAUDE_BRIDGE_KEY=${KEY}`;
  return {
    "ok": "✓ Connected. Agents whose brain list starts with \"claude\" (e.g. JARVIS_PROVIDER=claude,groq,gemini) now think with Claude on this PC.",
    "no-jarvis": "✗ JARVIS_URL isn't set. Add to edith/.env:  JARVIS_URL=https://your-app.vercel.app",
    "key-missing": `✗ JARVIS doesn't have the bridge key yet. ${setKey}`,
    "key-mismatch": `✗ The bridge key on Vercel doesn't match this PC. ${setKey}`,
    "old-deploy": "✗ Your Vercel app is on an older version without the Claude bridge — redeploy the latest code.",
    "unreachable": `✗ Couldn't reach ${JARVIS} — check JARVIS_URL and your internet.`,
  }[res] ?? `✗ JARVIS answered ${res}.`;
}

/** A tiny real request, so a sign-in problem shows up now — not in the middle of a conversation. */
async function selfCheck() {
  try {
    const r = await think({ messages: [{ role: "user", content: "Reply with exactly: ready" }] });
    return { ok: true, text: r.text.trim().slice(0, 40) };
  } catch (e) { return { ok: false, text: e.message }; }
}

// ---- main ---------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  say(`\nJARVIS Claude bridge — model ${MODEL}`);
  if (!CLAUDE) die("The `claude` command isn't installed. Install Claude Code (claude.com/claude-code), run `claude` once and sign in with your Claude account, then try again.");
  const ver = spawnSync(CLAUDE.cmd, [...CLAUDE.pre, "--version"], { encoding: "utf8", windowsHide: true });
  if (ver.status !== 0) die(`\`claude --version\` failed${ver.stderr ? `: ${ver.stderr.trim().slice(0, 200)}` : ""}. Reinstall Claude Code, then try again.`);
  say(`  Claude Code ${ver.stdout.trim()} · up to ${MAX_PARALLEL} at once · ${Math.round(TIMEOUT_MS / 1000)}s limit per answer`);
  fs.mkdirSync(WORKDIR, { recursive: true });
  say("  Checking you're signed in…");
  const chk = await selfCheck();
  if (!chk.ok) die(`${chk.text}\n  Open a terminal, run \`claude\`, sign in with your Claude account (/login), then try again.`);
  say(`  ✓ Claude answered: "${chk.text}"`);

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); })
    .catch((e) => die(e.code === "EADDRINUSE" ? `Port ${PORT} is busy — is another "npm run claude" already running?` : e.message));

  if (LOCAL_ONLY) {
    say(`\n  Claude bridge ready at http://127.0.0.1:${PORT} (no tunnel — JARVIS runs on this PC).`);
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
  } else {
    let publicUrl = FIXED_URL;
    let tunnel = null;
    if (!publicUrl) {
      say("  Opening a secure tunnel…");
      const t = await startTunnel(PORT, say);
      if (!t.url) die("Couldn't open a Cloudflare tunnel. Install it with:  winget install --id Cloudflare.cloudflared   then run npm run claude again.");
      publicUrl = t.url; tunnel = t.child;
      if (!(await waitReachable(publicUrl))) say("  (tunnel is slow to come up — continuing; JARVIS will retry)");
    }
    const first = await register(publicUrl);
    let lastOk = first === "ok";
    say(`\n  Bridge URL: ${publicUrl}`);
    say(`  ${explainReg(first)}`);
    if (FRESH_KEY && !lastOk) say("  (Your bridge key is saved in edith/.claude-bridge-key — keep it private.)");
    say("\n  Keep this window open. Ctrl+C to stop.\n");
    setInterval(async () => {
      const r = await register(publicUrl);
      if ((r === "ok") !== lastOk) say(`  ${new Date().toLocaleTimeString()}  ${explainReg(r)}`);
      lastOk = r === "ok";
    }, HEARTBEAT_MS);
    const shutdown = async () => {
      say("\n  Stopping — telling JARVIS the Claude bridge is offline…");
      if (JARVIS) {
        await fetch(`${JARVIS}/api/brain/register`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
          body: JSON.stringify({ kind: "claude", url: null }), signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
      stopTunnel(tunnel);
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}
