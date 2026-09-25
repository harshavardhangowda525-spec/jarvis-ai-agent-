/**
 * Import this FIRST: ES modules run their imports before the importing file's
 * own code, so settings that other modules read while loading (e.g.
 * ULTRON_MAX_TOKENS, OLLAMA_TIMEOUT_MS) must be in process.env by then.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, readEnvFile } from "./loadenv.mjs";

const EDITH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE = path.join(EDITH_DIR, ".env");

// Every Groq key ULTRON can find, and where it came from — so an old key left in
// edith/.env doesn't block the current one in the app's .env.local (ULTRON tries
// the next key when Groq rejects one, and says which file held the bad key).
{
  const sources = [
    ["your environment", process.env.GROQ_API_KEY],
    ["edith/.env", readEnvFile(ENV_FILE).GROQ_API_KEY],
    [".env.local", readEnvFile(path.join(EDITH_DIR, "..", ".env.local")).GROQ_API_KEY],
    [".env", readEnvFile(path.join(EDITH_DIR, "..", ".env")).GROQ_API_KEY],
  ];
  const seen = new Set();
  const keys = [];
  for (const [source, key] of sources) {
    const k = (key ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k); keys.push({ source, key: k });
  }
  globalThis.__ULTRON_GROQ_KEYS__ = keys;
}

export const envLoaded = loadEnv(ENV_FILE);

// AI keys you already gave JARVIS (the app's .env.local / .env, e.g. from
// "vercel env pull") work for ULTRON too — no need to copy GROQ_API_KEY into
// edith/.env. Only AI provider keys/models are taken; edith/.env still wins.
const AI_KEYS = /^(GROQ|OPENROUTER|MISTRAL|SAMBANOVA|GEMINI|CEREBRAS|OPENAI)_(API_KEY|MODEL)$|^GITHUB_MODELS_(TOKEN|MODEL)$/;
for (const f of [".env.local", ".env"]) loadEnv(path.join(EDITH_DIR, "..", f), { only: AI_KEYS });
