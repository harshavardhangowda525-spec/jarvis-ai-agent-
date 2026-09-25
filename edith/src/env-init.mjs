/**
 * Import this FIRST: ES modules run their imports before the importing file's
 * own code, so settings that other modules read while loading (e.g.
 * ULTRON_MAX_TOKENS, OLLAMA_TIMEOUT_MS) must be in process.env by then.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./loadenv.mjs";

const EDITH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE = path.join(EDITH_DIR, ".env");
export const envLoaded = loadEnv(ENV_FILE);

// AI keys you already gave JARVIS (the app's .env.local / .env, e.g. from
// "vercel env pull") work for ULTRON too — no need to copy GROQ_API_KEY into
// edith/.env. Only AI provider keys/models are taken; edith/.env still wins.
const AI_KEYS = /^(GROQ|OPENROUTER|MISTRAL|SAMBANOVA|GEMINI|CEREBRAS|OPENAI)_(API_KEY|MODEL)$|^GITHUB_MODELS_(TOKEN|MODEL)$/;
for (const f of [".env.local", ".env"]) loadEnv(path.join(EDITH_DIR, "..", f), { only: AI_KEYS });
