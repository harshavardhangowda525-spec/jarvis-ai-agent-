#!/usr/bin/env node
/**
 * Switch JARVIS's main brain (all agents) in .env.local — only the brain settings change; keys are never
 * read out, printed or touched.   node scripts/set-brain.mjs groq      (Groq first, Gemini as the backup)
 *                                  node scripts/set-brain.mjs claude    (back to Claude on this PC first)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, ".env.local");
const AGENTS = ["JARVIS_PROVIDER", "DARWIN_PROVIDER", "RUBIN_PROVIDER", "ROBIN_PROVIDER", "EV_PROVIDER", "MIKE_PROVIDER", "ASTON_PROVIDER", "FRIDAY_PROVIDER"];

/** The new .env.local text. Pure (tested). */
export function switchBrain(text, to) {
  const lines = text.replace(/(\r?\n)+$/, "").split(/\r?\n/);
  const want = to === "claude"
    ? { AI_PROVIDER: null, CLAUDE_FOR_ALL_AGENTS: "1" }
    : { AI_PROVIDER: to, CLAUDE_FOR_ALL_AGENTS: "0" };
  const order = to === "claude" ? null : [to, ...["groq", "gemini", "cerebras", "openrouter"].filter((p) => p !== to)];
  const seen = new Set();
  const out = lines.map((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (!m) return l;
    const [, k, v] = m;
    if (k in want) { seen.add(k); return want[k] === null ? l : `${k}=${want[k]}`; }
    if (AGENTS.includes(k) && order) {
      // keep the agent's other brains as backups, but Claude out and the new brain first
      const own = v.replace(/["']/g, "").split(/[\s,>]+/).filter((p) => p && p !== "claude" && p !== "auto");
      const list = [...new Set([order[0], ...own, ...order.slice(1, 2)])];
      return `${k}=${list.join(",")}`;
    }
    return l;
  });
  for (const [k, v] of Object.entries(want)) if (!seen.has(k) && v !== null) out.push(`${k}=${v}`);
  return out.join("\n").replace(/\n*$/, "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const to = (process.argv[2] || "groq").toLowerCase();
  if (!["groq", "gemini", "cerebras", "claude"].includes(to)) { console.error("Use: groq, gemini, cerebras or claude"); process.exit(1); }
  if (!fs.existsSync(FILE)) { console.error(".env.local wasn't found in the JARVIS folder."); process.exit(1); }
  const before = fs.readFileSync(FILE, "utf8");
  fs.writeFileSync(`${FILE}.before-brain-switch`, before);
  fs.writeFileSync(FILE, switchBrain(before, to));
  console.log(`JARVIS's main brain is now ${to === "claude" ? "Claude on this PC" : `${to} (Gemini as backup), Claude off`}. Restart JARVIS (start-jarvis.cmd).`);
  console.log("(Your previous settings are saved in .env.local.before-brain-switch.)");
}
