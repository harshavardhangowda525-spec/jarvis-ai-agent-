#!/usr/bin/env node
/**
 * ULTRON — entrypoint. Loads a local .env (reusing JARVIS's AI keys), resolves
 * the workspace, prints the real capability check, and starts the control server.
 *
 *   node run.mjs
 *   ULTRON_WORKSPACE=/path/to/project node run.mjs
 */
import "./src/env-init.mjs"; // must stay first — loads edith/.env before other modules read it
import { Workspace } from "./src/workspace.mjs";
import { startServer } from "./src/server.mjs";
import { hasProvider, providerName, providerSummary, warmOllama } from "./src/provider.mjs";
import { log } from "./src/log.mjs";
import { lowerOllamaPriority } from "./src/os-priority.mjs";

const port = Number(process.env.ULTRON_PORT || 7420);
const ws = new Workspace(process.argv[2] || process.env.ULTRON_WORKSPACE);

if (!hasProvider()) {
  log.warn("No AI provider key found — set GROQ_API_KEY (or MISTRAL/GITHUB_MODELS_TOKEN/SAMBANOVA/GEMINI/OPENROUTER/CEREBRAS/OPENAI, or OLLAMA_MODEL) in edith/.env.");
  log.warn("ULTRON will pair and run REAL tools, but its reasoning/coding loop needs a provider.");
} else {
  log.info(`Brain ready: ${providerName()}`);
  // Pre-load the local model only when it answers FIRST — as the backup it'd
  // just hold several GB of memory (and slow the PC down) until it's needed.
  if (providerName().startsWith("ollama")) {
    warmOllama().then((w) => {
      if (!w.configured) return;
      if (w.ok) log.info(`Ollama ${w.model} loaded (${w.seconds}s) — ready.`);
      else log.warn(`Ollama ${w.model}: ${w.error}`);
    });
  }
}

// If this PC's Ollama is in the chain, keep it from freezing Chrome/Windows.
if (providerSummary().includes("ollama(")) {
  lowerOllamaPriority();
  setInterval(lowerOllamaPriority, 120_000).unref();
}

startServer({ port, ws });

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { log.info("Shutting down…"); process.exit(0); });
