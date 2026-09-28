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
import { askJson, groqFirst, groqKeySource, hasProvider, missingProviderMessage, onlyProvider, providerList, providerName, providerSummary, warmOllama } from "./src/provider.mjs";
import { ENV_FILE } from "./src/env-init.mjs";
import { readEnvFile } from "./src/loadenv.mjs";
import { log } from "./src/log.mjs";
import { lowerOllamaPriority } from "./src/os-priority.mjs";
import { closeBrowser } from "./src/browser.mjs";

const port = Number(process.env.ULTRON_PORT || 7420);
const ws = new Workspace(process.argv[2] || process.env.ULTRON_WORKSPACE);

if (!hasProvider()) {
  log.warn(missingProviderMessage());
  log.warn("ULTRON will pair and run REAL tools, but its reasoning/coding loop needs a provider.");
} else {
  log.info(`Brain ready: ${providerName()}`);
  // ULTRON's default is this PC's Ollama — say where a different choice comes from
  if (!providerList().includes("ollama") && !providerList().includes("auto")) {
    const file = readEnvFile(ENV_FILE);
    const where = file.ULTRON_AI_PROVIDER ? "ULTRON_AI_PROVIDER in edith/.env" : file.EDITH_AI_PROVIDER ? "EDITH_AI_PROVIDER in edith/.env" : "ULTRON_AI_PROVIDER in your environment";
    log.warn(`Not using Ollama because ${where} says "${onlyProvider()}". Delete that setting to run ULTRON on this PC's Ollama.`);
  }
  // Check the Groq key once now (a tiny request), so a bad key shows up here —
  // with the file it's in — instead of in the middle of your first task.
  if (groqFirst() && !process.env.ULTRON_SKIP_KEY_CHECK) {
    askJson("Reply with the JSON object {\"ok\": true}.", "ping")
      .then(() => log.info(`Groq key works (from ${groqKeySource()}).`))
      .catch((err) => log.warn(`Groq check failed: ${err.message.replace(/^All AI providers failed\. /, "")}`));
  }
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

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
  log.info("Shutting down…");
  const bye = () => process.exit(0);
  closeBrowser().then(bye, bye);
  setTimeout(bye, 3000).unref();
});
