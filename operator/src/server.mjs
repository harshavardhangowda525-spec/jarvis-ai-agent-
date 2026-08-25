import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.mjs";
import { providerName } from "./provider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.resolve(__dirname, "../.operator-token");

/**
 * Local control server. Security model:
 *   - Binds to 127.0.0.1 ONLY — never reachable from the network.
 *   - Requires a pairing TOKEN (query ?token=). Random pages in the browser
 *     cannot connect without it, so no website can drive JARVIS.
 *   - The token is stable across restarts (stored in .operator-token) so you
 *     pair the JARVIS UI once.
 */
export function getToken() {
  if (process.env.OPERATOR_TOKEN) return process.env.OPERATOR_TOKEN.trim();
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (t) return t;
  } catch { /* not created yet */ }
  const token = crypto.randomBytes(16).toString("hex");
  try { fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 }); } catch { /* ignore */ }
  return token;
}

export function startServer({ port, session, mgr }) {
  const token = getToken();
  const clients = new Set();

  const wss = new WebSocketServer({ host: "127.0.0.1", port });

  // Session broadcasts every event to all paired clients.
  session.send = (event) => {
    const msg = JSON.stringify(event);
    for (const ws of clients) { if (ws.readyState === ws.OPEN) ws.send(msg); }
  };

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.searchParams.get("token") !== token) {
      ws.close(4001, "unauthorized");
      log.warn("rejected a connection with a bad/missing token");
      return;
    }
    clients.add(ws);
    log.info(`JARVIS UI paired (${clients.size} client${clients.size === 1 ? "" : "s"})`);
    ws.send(JSON.stringify({ kind: "hello", provider: providerName(), mode: session.mode }));

    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      switch (m.op) {
        case "command": if (m.text) session.enqueue(String(m.text)); break;
        case "mode": session.setMode(String(m.mode)); break;
        case "stop": session.stop(); break;
        case "pause": session.pause(); break;
        case "resume": session.resume(); break;
        case "confirm": session.confirmDecision(!!m.approved); break;
        case "ping": ws.send(JSON.stringify({ kind: "pong" })); break;
        default: break;
      }
    });

    ws.on("close", () => { clients.delete(ws); });
    ws.on("error", () => { clients.delete(ws); });
  });

  wss.on("listening", () => {
    log.info("");
    log.info(`  JARVIS Operator is listening on ws://127.0.0.1:${port}`);
    log.info(`  Brain: ${providerName()}`);
    log.info("");
    log.info("  Pair the JARVIS web app (Dashboard → Operator) with:");
    log.info(`     URL   : ws://127.0.0.1:${port}`);
    log.info(`     TOKEN : ${token}`);
    log.info("");
  });

  return { wss, token };
}
