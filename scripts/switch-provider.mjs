#!/usr/bin/env node
/**
 * Switch the JARVIS "brain" between providers by editing local .env.
 *
 *   npm run use:ollama     -> local, unlimited, private (needs Ollama running)
 *   npm run use:groq       -> cloud, fast, always-on (needs GROQ_API_KEY)
 *   node scripts/switch-provider.mjs gemini|openai|anthropic
 *
 * Only touches AI_PROVIDER (and fills AI_MODEL / OLLAMA_BASE_URL when blank).
 * For the deployed app on Vercel, change AI_PROVIDER in the Vercel dashboard
 * instead and redeploy — this script only edits your local .env.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = join(ROOT, ".env");
const EXAMPLE = join(ROOT, ".env.example");

const DEFAULT_MODEL = {
  ollama: "llama3.1",
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-3.6-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
};

const provider = (process.argv[2] || "").toLowerCase();
if (!DEFAULT_MODEL[provider]) {
  console.error(`Usage: node scripts/switch-provider.mjs <${Object.keys(DEFAULT_MODEL).join("|")}>`);
  process.exit(1);
}

if (!existsSync(ENV)) {
  if (existsSync(EXAMPLE)) { copyFileSync(EXAMPLE, ENV); console.log("Created .env from .env.example"); }
  else writeFileSync(ENV, "");
}

let text = readFileSync(ENV, "utf8");

/** Set KEY="value": replace the line if present, else append. */
function setVar(key, value) {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
}
/** Current value of KEY (unquoted), or "" if unset/blank. */
function getVar(key) {
  const m = text.match(new RegExp(`^${key}="?([^"\\n]*)"?$`, "m"));
  return m ? m[1].trim() : "";
}

setVar("AI_PROVIDER", provider);
// Update AI_MODEL to the new provider's default UNLESS the user set a custom
// model (one that isn't any provider's known default).
const KNOWN_DEFAULTS = new Set(Object.values(DEFAULT_MODEL));
const currentModel = getVar("AI_MODEL");
if (!currentModel || KNOWN_DEFAULTS.has(currentModel)) {
  setVar("AI_MODEL", DEFAULT_MODEL[provider]);
}
if (provider === "ollama" && !getVar("OLLAMA_BASE_URL")) {
  setVar("OLLAMA_BASE_URL", "http://localhost:11434/v1");
}

writeFileSync(ENV, text);

const model = getVar("AI_MODEL") || DEFAULT_MODEL[provider];
console.log(`\n✓ JARVIS brain set to: ${provider}  (model: ${model})`);
if (provider === "ollama") {
  console.log("  • Make sure Ollama is running:  ollama serve");
  console.log(`  • And the model is pulled:      ollama pull ${model}`);
} else if (provider === "groq") {
  console.log("  • Make sure GROQ_API_KEY is set in .env");
}
console.log("  • Restart the dev server for it to take effect:  npm run dev\n");
