#!/usr/bin/env node
/**
 * EDITH — entrypoint. Loads a local .env (reusing JARVIS's AI keys), resolves
 * the workspace, prints the real capability check, and starts the control server.
 *
 *   node run.mjs
 *   EDITH_WORKSPACE=/path/to/project node run.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Workspace } from "./src/workspace.mjs";
import { startServer } from "./src/server.mjs";
import { hasProvider, providerName } from "./src/provider.mjs";
import { log } from "./src/log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, ".env"));

const port = Number(process.env.EDITH_PORT || 7420);
const ws = new Workspace(process.argv[2] || process.env.EDITH_WORKSPACE);

if (!hasProvider()) {
  log.warn("No AI provider key found — set GROQ_API_KEY (or GEMINI/CEREBRAS/OPENROUTER/OPENAI) in edith/.env.");
  log.warn("EDITH will pair and run REAL tools, but its reasoning/coding loop needs a provider.");
} else {
  log.info(`Brain ready: ${providerName()}`);
}

startServer({ port, ws });

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { log.info("Shutting down…"); process.exit(0); });

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("="); if (eq === -1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
