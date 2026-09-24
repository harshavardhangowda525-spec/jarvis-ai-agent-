#!/usr/bin/env node
/**
 * `npm run check` — tests every AI key in edith/.env with a tiny request and
 * says which ones work and why the others don't. Never prints the keys.
 */
import { ENV_FILE, envLoaded } from "./src/env-init.mjs"; // must stay first
import { checkProviders } from "./src/provider.mjs";

if (!envLoaded) {
  console.log(`No .env found at ${ENV_FILE}.`);
  console.log("Create it: copy .env.example .env   (Windows)   or   cp .env.example .env");
  process.exit(1);
}

console.log("Checking ULTRON's AI keys…\n");
const results = await checkProviders((msg) => console.log(msg));
if (!results.length) {
  console.log("No AI keys found in edith/.env. Add at least one (see .env.example).");
  process.exit(1);
}
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.provider.padEnd(10)} ${r.model.padEnd(40)} ${r.reason}`);
const working = results.filter((r) => r.ok).length;
console.log(`\n${working} of ${results.length} working.${working ? " ULTRON is ready." : " Add a working key, then run this again."}`);
process.exit(working ? 0 : 1);
