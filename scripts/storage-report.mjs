/**
 * npm run storage — how much disk JARVIS and its agents really use on this PC,
 * by agent and category, measured (not estimated). It also lists the database
 * tables by agent (the database lives online, on Neon — not on this disk).
 *
 *   npm run storage            measure only (changes nothing)
 *   npm run storage -- --clean also clear what is safe to clear: the Next.js
 *                              build cache (rebuilt automatically). Nothing
 *                              else is ever deleted by this script.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirSize } from "./local-helpers.mjs";
import { parseEnvFiles } from "./rubin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MB = (b) => `${(b / 1024 / 1024).toFixed(b >= 100 * 1024 * 1024 ? 0 : 1)} MB`.padStart(9);
const appData = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));

/** [agent, category, label, path, note] */
const ITEMS = [
  ["Shared", "dependencies", "node_modules (Next.js, Prisma, ffmpeg …)", path.join(ROOT, "node_modules"), "required to run — reinstalled by npm install"],
  ["Shared", "build output", "JARVIS build (.next, without cache)", path.join(ROOT, ".next"), "required — rebuilt after each update"],
  ["Shared", "cache", "Next.js build cache (.next/cache)", path.join(ROOT, ".next", "cache"), "safe to clear (npm run storage -- --clean); capped at 400 MB by npm run local"],
  ["JARVIS", "models", "Face / hand / gesture models (public/models, public/vision)", [path.join(ROOT, "public", "models"), path.join(ROOT, "public", "vision")], "required for Face ID and gestures"],
  ["RUBEN", "dependencies", "Electron (desktop/rubin/node_modules)", path.join(ROOT, "desktop", "rubin", "node_modules"), "required for the RUBEN desktop app"],
  ["RUBEN", "build output", "RUBEN bundles (desktop/rubin/dist)", path.join(ROOT, "desktop", "rubin", "dist"), "rebuilt on every start"],
  ["RUBEN", "logs", "RUBEN log + app data", path.join(appData, "RUBEN"), "log capped at 512 KB + one old file"],
  ["ULTRON", "dependencies", "ULTRON runtime (edith/node_modules)", path.join(ROOT, "edith", "node_modules"), "required for ULTRON"],
  ["ULTRON", "workspaces", "ULTRON project workspaces (edith/workspaces)", path.join(ROOT, "edith", "workspaces"), "your generated projects — kept; audit log capped at 2 MB"],
  ["PC brain", "models", "Ollama models (~/.ollama/models)", path.join(os.homedir(), ".ollama", "models"), "only if you use the PC brain — each model is GBs; remove unused ones with `ollama rm <name>`"],
  ["Source", "code", "Git history (.git)", path.join(ROOT, ".git"), "kept"],
];

const sizeOf = (p) => (Array.isArray(p) ? p.reduce((s, x) => s + dirSize(x), 0) : dirSize(p));

async function dbTables() {
  const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { return ""; } };
  const env = parseEnvFiles([read(".env"), read(".env.local")]);
  const url = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!url) return null;
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await db.$queryRawUnsafe(`SELECT relname AS name, pg_total_relation_size(relid)::bigint AS bytes, n_live_tup::bigint AS rows FROM pg_stat_user_tables ORDER BY 2 DESC`);
    return rows.map((r) => ({ name: String(r.name), bytes: Number(r.bytes), rows: Number(r.rows) }));
  } catch (e) {
    return { error: String(e?.message || e).split("\n").pop() };
  } finally { await db.$disconnect().catch(() => {}); }
}

const agentOf = (t) => /^Darwin/.test(t) ? "DARWIN" : /^Robin/.test(t) ? "RUBIN" : /^Ev/.test(t) ? "EV" : /^Mike/.test(t) ? "MIKE" : /^(Gate|Face)/.test(t) ? "Gate / Face ID" : /^(Conversation|Message|Memory|Task|Note|ToolLog|ActivityEvent|DailySummary)$/.test(t) ? "JARVIS" : "Other";

async function main() {
  const clean = process.argv.includes("--clean");
  console.log("Storage on this PC (measured)\n=============================");
  const rows = ITEMS.map(([agent, cat, label, p, note]) => ({ agent, cat, label, note, bytes: sizeOf(p) }));
  // the build without its cache
  const next = rows.find((r) => r.label.startsWith("JARVIS build")), cache = rows.find((r) => r.cat === "cache");
  next.bytes = Math.max(0, next.bytes - cache.bytes);
  let total = 0;
  for (const r of rows) {
    total += r.bytes;
    console.log(`${MB(r.bytes)}  ${r.agent.padEnd(8)} ${r.cat.padEnd(13)} ${r.label}${r.bytes ? "" : " (not present)"}`);
    if (r.bytes) console.log(`${"".padStart(9)}  ${"".padEnd(8)} ${"".padEnd(13)} ↳ ${r.note}`);
  }
  console.log(`${MB(total)}  TOTAL\n`);

  if (clean) {
    const dir = path.join(ROOT, ".next", "cache");
    const before = dirSize(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Cleared the Next.js build cache: ${MB(before).trim()} freed (measured before → ${MB(dirSize(dir)).trim()} after).\n`);
  }

  const t = await dbTables();
  if (!t) console.log("Database: DATABASE_URL isn't set — skipped.");
  else if ("error" in t) console.log(`Database: couldn't read table sizes (${t.error}).`);
  else {
    const by = new Map();
    for (const r of t) { const a = agentOf(r.name); const v = by.get(a) ?? { bytes: 0, rows: 0, tables: 0 }; v.bytes += r.bytes; v.rows += r.rows; v.tables++; by.set(a, v); }
    console.log("Database (online — not on this disk), by agent:");
    for (const [a, v] of [...by.entries()].sort((x, y) => y[1].bytes - x[1].bytes)) console.log(`${MB(v.bytes)}  ${a.padEnd(15)} ${v.rows} rows in ${v.tables} tables`);
    console.log("Largest tables:");
    for (const r of t.slice(0, 6)) console.log(`${MB(r.bytes)}  ${r.name} (${r.rows} rows)`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
