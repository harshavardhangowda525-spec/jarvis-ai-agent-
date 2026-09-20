/**
 * EDITH local control server. Same safety posture as the Operator:
 *  - binds to 127.0.0.1 ONLY,
 *  - requires a pairing TOKEN (no web page can drive EDITH without it),
 *  - reports a REAL first-run capability check (provider, git, node, python,
 *    deploy providers) — nothing is marked available unless it actually is.
 */
import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.mjs";
import { providerName, hasProvider } from "./provider.mjs";
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

export function startServer({ port, ws }) {
  const token = getToken();
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

  async function runGoal(text) {
    if (agent) { emit({ kind: "activity", label: "EDITH is already working. Say stop first." }); return; }
    emit({ kind: "goal", goal: text });
    agent = new EdithAgent({ ws, audit, emit, confirm, mode });
    try {
      const res = await agent.run(text);
      emit({ kind: "result", ok: !!res.ok, message: res.report || res.message || (res.ok ? "Done." : "Stopped."), needUser: !!res.needUser });
    } catch (err) {
      emit({ kind: "error", message: String(err.message) });
    } finally {
      agent = null;
    }
  }

  const wss = new WebSocketServer({ host: "127.0.0.1", port });

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
        case "ping": socket.send(JSON.stringify({ kind: "pong" })); break;
        default: break;
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  wss.on("listening", () => {
    const caps = capabilityCheck(ws);
    log.info("");
    log.info(`  EDITH is listening on ws://127.0.0.1:${port}`);
    log.info(`  Workspace: ${ws.root}`);
    log.info(`  Brain: ${providerName()}`);
    log.info(`  node ${caps.node.ok ? "✓" : "✗"}  git ${caps.git.ok ? "✓" : "✗"}  python ${caps.python.ok ? "✓" : "✗"}`);
    log.info("");
    log.info("  Pair JARVIS (Dashboard → EDITH) with:");
    log.info(`     URL   : ws://127.0.0.1:${port}`);
    log.info(`     TOKEN : ${token}`);
    log.info("");
  });

  return { wss, token };
}
