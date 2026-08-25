#!/usr/bin/env node
/**
 * JARVIS Operator — entrypoint.
 *
 * Starts the local control server and launches the visible browser lazily on
 * the first command. Loads environment from a local .env if present (so it can
 * reuse the same AI keys as your JARVIS deployment) without extra dependencies.
 *
 * Usage:
 *   node run.mjs
 *   OPERATOR_PORT=7317 node run.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserManager } from "./src/browser/manager.mjs";
import { Session } from "./src/session.mjs";
import { startServer } from "./src/server.mjs";
import { hasProvider, providerName } from "./src/provider.mjs";
import { log } from "./src/log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny .env loader (KEY=VALUE per line) — avoids a dotenv dependency.
loadEnv(path.resolve(__dirname, ".env"));

const port = Number(process.env.OPERATOR_PORT || 7317);

if (!hasProvider()) {
  log.warn("No AI provider key found. Set GROQ_API_KEY (or GEMINI/CEREBRAS/OPENROUTER/OPENAI)");
  log.warn("in operator/.env or your shell, or planning will fail. Continuing so you can pair.");
} else {
  log.info(`Brain ready: ${providerName()}`);
}

const mgr = new BrowserManager({
  profileDir: process.env.OPERATOR_PROFILE_DIR || undefined,
  executablePath: process.env.OPERATOR_CHROME_PATH || undefined,
});
const session = new Session({ mgr, send: () => {} });
startServer({ port, session, mgr });

// Graceful shutdown — keep the browser open on Ctrl+C? No: close cleanly.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    log.info("Shutting down…");
    await mgr.close();
    process.exit(0);
  });
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
