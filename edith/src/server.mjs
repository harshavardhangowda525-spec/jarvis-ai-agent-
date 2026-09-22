/**
 * EDITH local control server. Same safety posture as the Operator:
 *  - binds to 127.0.0.1 ONLY,
 *  - requires a pairing TOKEN (no web page can drive EDITH without it),
 *  - reports a REAL first-run capability check (provider, git, node, python,
 *    deploy providers) — nothing is marked available unless it actually is.
 */
import { WebSocketServer } from "ws";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.mjs";
import { providerName, providerSummary, hasProvider } from "./provider.mjs";
import { EdithAgent } from "./agent.mjs";
import { Audit } from "./audit.mjs";
import { killAll } from "./tools/terminal.mjs";
import { capabilityCheck } from "./capabilities.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.resolve(__dirname, "../.edith-token");

export function getToken() {
  if (process.env.EDITH_TOKEN) return process.env.EDITH_TOKEN.trim();
  try { const t = fs.readFileSync(TOKEN_FILE, "utf8").trim(); if (t) return t; } catch { /* create below */ }
  const token = crypto.randomBytes(16).toString("hex");
  try { fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 }); } catch { /* ignore */ }
  return token;
}

export { capabilityCheck };

/**
 * Origins allowed to auto-read the pairing token over HTTP (`GET /pair`).
 * Localhost is trusted by default; add your deployed app (e.g. your Vercel URL)
 * via EDITH_ALLOWED_ORIGINS="https://your-app.vercel.app" (comma-separated).
 * A page from any OTHER origin gets 403 — it can't silently grab the token.
 */
const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

/** Find a servable entry page (index.html) at/under a root, shallow-first. */
function findEntryHtml(root) {
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
  const queue = [{ dir: root, rel: "" }];
  for (let depth = 0; depth < 4 && queue.length; depth++) {
    const next = [];
    for (const { dir, rel } of queue) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      // Prefer an index.html directly in this directory.
      if (entries.some((e) => e.isFile() && e.name.toLowerCase() === "index.html")) {
        return rel ? `${rel}/index.html` : "index.html";
      }
      for (const e of entries) {
        if (e.isDirectory() && !skip.has(e.name) && !e.name.startsWith(".")) {
          next.push({ dir: path.join(dir, e.name), rel: rel ? `${rel}/${e.name}` : e.name });
        }
      }
    }
    queue.length = 0;
    queue.push(...next);
  }
  return null;
}

function allowedOrigins() {
  const defaults = [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:5173", "http://127.0.0.1:5173",
  ];
  const extra = (process.env.EDITH_ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([...defaults, ...extra]);
}

export function startServer({ port, ws }) {
  const token = getToken();
  const origins = allowedOrigins();
  const clients = new Set();
  const audit = new Audit(ws);
  let agent = null;
  let pendingConfirm = null;
  let mode = "confirmation";

  const broadcast = (event) => {
    const msg = JSON.stringify(event);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(msg);
  };
  const emit = (event) => broadcast(event);
  const confirm = ({ title, detail, level }) =>
    new Promise((resolve) => { pendingConfirm = resolve; emit({ kind: "confirm", title, detail, level }); });

  /** If the workspace holds a servable site, tell the UI where to preview it. */
  function emitPreview({ announce = false } = {}) {
    const entry = findEntryHtml(ws.root);
    if (!entry) {
      if (announce) emit({ kind: "activity", label: "No index.html to preview yet." });
      return false;
    }
    emit({ kind: "preview", url: `http://127.0.0.1:${port}/preview/${entry}`, path: entry });
    return true;
  }

  async function runGoal(text) {
    if (agent) { emit({ kind: "activity", label: "EDITH is already working. Say stop first." }); return; }
    emit({ kind: "goal", goal: text });
    agent = new EdithAgent({ ws, audit, emit, confirm, mode });
    try {
      const res = await agent.run(text);
      emit({ kind: "result", ok: !!res.ok, message: res.report || res.message || (res.ok ? "Done." : "Stopped."), needUser: !!res.needUser });
      // Surface a live preview whenever the build produced a servable page.
      if (res.ok) emitPreview();
    } catch (err) {
      emit({ kind: "error", message: String(err.message) });
    } finally {
      agent = null;
    }
  }

  // HTTP layer on the SAME port: /pair (origin-locked token hand-off) + /health.
  const httpServer = http.createServer((req, res) => {
    const origin = req.headers.origin || "";
    const allow = origins.has(origin);
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    // CORS preflight — Private Network Access needs an explicit opt-in header so
    // an HTTPS page (e.g. the Vercel app) may reach this localhost service.
    if (req.method === "OPTIONS") {
      if (allow) {
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      res.writeHead(allow ? 204 : 403);
      res.end();
      return;
    }
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "GET" && u.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "edith", brain: providerName() }));
      return;
    }
    if (req.method === "GET" && u.pathname === "/pair") {
      if (!allow) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "origin_not_allowed",
          hint: "Add this origin to EDITH_ALLOWED_ORIGINS in edith/.env, then restart EDITH.",
        }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token, url: `ws://127.0.0.1:${port}`, brain: providerName() }));
      return;
    }
    // Live preview of the site EDITH built — serves files from the workspace,
    // read-only and path-escape-safe, so the dashboard can iframe it.
    if (req.method === "GET" && (u.pathname === "/preview" || u.pathname.startsWith("/preview/"))) {
      let rel = decodeURIComponent(u.pathname.replace(/^\/preview\/?/, ""));
      if (!rel || rel.endsWith("/")) rel += "index.html";
      const abs = path.resolve(ws.root, rel);
      // Reject any path that escapes the workspace root.
      if (abs !== ws.root && !abs.startsWith(ws.root + path.sep)) {
        res.writeHead(403); res.end("Forbidden"); return;
      }
      fs.readFile(abs, (err, data) => {
        if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
        const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(data);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.searchParams.get("token") !== token) { socket.close(4001, "unauthorized"); return; }
    clients.add(socket);
    log.info(`JARVIS UI paired (${clients.size})`);
    socket.send(JSON.stringify({ kind: "hello", provider: providerName(), mode, capabilities: capabilityCheck(ws), workspace: ws.root }));

    socket.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      switch (m.op) {
        case "goal": if (m.text) runGoal(String(m.text)); break;
        case "stop": killAll(); agent?.stop(); emit({ kind: "stopped", message: "Stopped. Running processes terminated." }); break;
        case "confirm": if (pendingConfirm) { pendingConfirm(!!m.approved); pendingConfirm = null; } break;
        case "mode": if (["autonomous", "confirmation", "manual"].includes(m.mode)) { mode = m.mode; emit({ kind: "mode", mode }); } break;
        case "capabilities": socket.send(JSON.stringify({ kind: "capabilities", capabilities: capabilityCheck(ws) })); break;
        case "preview": emitPreview({ announce: true }); break;
        case "ping": socket.send(JSON.stringify({ kind: "pong" })); break;
        default: break;
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  httpServer.listen(port, "127.0.0.1", () => {
    const caps = capabilityCheck(ws);
    log.info("");
    log.info(`  EDITH is listening on ws://127.0.0.1:${port}`);
    log.info(`  Workspace: ${ws.root}`);
    log.info(`  Brain: ${providerName()}`);
    log.info(`  Providers (in order): ${providerSummary()}`);
    log.info(`  node ${caps.node.ok ? "✓" : "✗"}  git ${caps.git.ok ? "✓" : "✗"}  python ${caps.python.ok ? "✓" : "✗"}`);
    log.info("");
    log.info("  Pair JARVIS (Dashboard → EDITH):");
    log.info("     • Local dashboard auto-pairs — just open Dashboard → EDITH.");
    log.info(`     • Or paste manually →  URL: ws://127.0.0.1:${port}   TOKEN: ${token}`);
    if ((process.env.EDITH_ALLOWED_ORIGINS || "").trim()) {
      log.info(`     • Auto-pair enabled for: ${process.env.EDITH_ALLOWED_ORIGINS}`);
    } else {
      log.info("     • To auto-pair from your deployed app, set EDITH_ALLOWED_ORIGINS to its URL.");
    }
    log.info("");
  });

  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log.error(`Port ${port} is already in use — another EDITH may be running. Stop it (or set EDITH_PORT) and retry.`);
      process.exit(1);
    }
    log.error(`Server error: ${err.message}`);
  });

  return { wss, httpServer, token };
}
