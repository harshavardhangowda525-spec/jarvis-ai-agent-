/**
 * Import this FIRST: ES modules run their imports before the importing file's
 * own code, so settings that other modules read while loading (e.g.
 * ULTRON_MAX_TOKENS, OLLAMA_TIMEOUT_MS) must be in process.env by then.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./loadenv.mjs";

export const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
export const envLoaded = loadEnv(ENV_FILE);
