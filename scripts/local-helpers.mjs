/**
 * Small pieces of `npm run local` that are worth testing on their own.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
export { retireOldUltronProvider } from "../edith/src/stale-provider.mjs";

/** Process ids listening on a TCP port (Windows: netstat; elsewhere: lsof, then fuser). */
export function listeningPids(port, platform = process.platform) {
  if (platform === "win32") {
    const r = spawnSync("netstat -ano -p tcp", { shell: true, encoding: "utf8", windowsHide: true });
    return parseNetstat(r.stdout || "", port);
  }
  const l = spawnSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { shell: true, encoding: "utf8" });
  let pids = (l.stdout || "").split(/\s+/).filter((p) => /^\d+$/.test(p));
  if (!pids.length) {
    const f = spawnSync(`fuser ${port}/tcp`, { shell: true, encoding: "utf8" });
    pids = `${f.stdout || ""} `.split(/\s+/).filter((p) => /^\d+$/.test(p));
  }
  return [...new Set(pids.map(Number))].filter((p) => p !== process.pid);
}

/** `netstat -ano` output → pids LISTENING on the port (pure — tested). */
export function parseNetstat(out, port) {
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP$/i.test(cols[0]) || !/LISTEN/i.test(cols[3])) continue;
    if (!new RegExp(`[:.]${port}$`).test(cols[1])) continue;
    const pid = Number(cols[4]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Stop whatever is listening on the port. Returns how many processes were stopped. */
export function stopPort(port, platform = process.platform) {
  const pids = listeningPids(port, platform);
  for (const pid of pids) {
    if (platform === "win32") spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: "ignore", windowsHide: true });
    else { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
  }
  return pids.length;
}

/**
 * What a database connection error means, in plain words (pure — tested).
 * Returns null when there's nothing to explain.
 */
export function describeDbError(message = "") {
  const m = String(message);
  if (!m) return null;
  if (/exceeded the compute time quota|compute time quota|exceeded .*quota/i.test(m)) {
    return "Neon says the project has used up its compute quota for this month. Open console.neon.tech → your project → Billing/Usage (upgrade the plan or wait for the monthly reset). Until then the database refuses every connection.";
  }
  if (/password authentication failed|authentication failed/i.test(m)) {
    return "The database rejected the password in DATABASE_URL. Copy a fresh connection string from console.neon.tech → Connect into .env.local.";
  }
  if (/does not exist/i.test(m) && /database|role/i.test(m)) {
    return "The database or user named in DATABASE_URL doesn't exist on the server. Copy the connection string again from console.neon.tech → Connect.";
  }
  if (/ENOTFOUND|getaddrinfo|could not translate host/i.test(m)) {
    return "This PC couldn't look up the database's address (DNS). Check the internet connection, or that the host in DATABASE_URL is spelled right.";
  }
  if (/Can't reach database server|ETIMEDOUT|ECONNREFUSED|timed out|ECONNRESET/i.test(m)) {
    return "This PC couldn't open a connection to the database. Usually one of: (1) the internet dropped or is slow, (2) a firewall, antivirus, office/college Wi-Fi or VPN blocks port 5432 — try another network or a phone hotspot, (3) the Neon project is suspended or deleted — check console.neon.tech. JARVIS keeps retrying while it wakes up.";
  }
  return null;
}

/**
 * Try the database once (up to `timeoutMs`), the way JARVIS will. Resolves to
 * { ok, ms, error } — never throws. Uses JARVIS's own Prisma client.
 */
export async function probeDatabase(root, url, timeoutMs = 40_000) {
  const { createRequire } = await import("node:module");
  const started = Date.now();
  let client;
  try {
    const require = createRequire(`${root.replace(/\\/g, "/")}/package.json`);
    const { PrismaClient } = require("@prisma/client");
    const { tuneDatabaseUrl } = await import("./db-url.mjs");
    client = new PrismaClient({ datasources: { db: { url: tuneDatabaseUrl(url) } }, log: [] });
    await Promise.race([
      client.$queryRawUnsafe("SELECT 1"),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Can't reach database server (no answer in ${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)),
    ]);
    return { ok: true, ms: Date.now() - started, error: null };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: String(e?.message ?? e) };
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

/**
 * Which of this version's database changes (prisma/migrations) the database
 * hasn't applied yet — and any that started but failed. Read straight from
 * Prisma's own _prisma_migrations table, so it can't be fooled by a stamp file.
 * Returns null if the database can't be asked.
 */
export async function pendingMigrations(root, url, timeoutMs = 40_000) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(root, "prisma", "migrations");
  const local = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  const { createRequire } = await import("node:module");
  let client;
  try {
    const require = createRequire(`${root.replace(/\\/g, "/")}/package.json`);
    const { PrismaClient } = require("@prisma/client");
    const { tuneDatabaseUrl } = await import("./db-url.mjs");
    client = new PrismaClient({ datasources: { db: { url: tuneDatabaseUrl(url) } }, log: [] });
    const rows = await Promise.race([
      client.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"').catch((e) => (/does not exist/i.test(String(e?.message)) ? [] : Promise.reject(e))),
      new Promise((_, rej) => setTimeout(() => rej(new Error("no answer")), timeoutMs)),
    ]);
    const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    return { missing: local.filter((m) => !done.has(m)), failed };
  } catch {
    return null;
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

/**
 * Compare the real database with this version and add anything additive it
 * missed (tables, columns, indexes) — repeat-safe — then mark those changes done
 * in Prisma's history so its updater can carry on. Null if it couldn't connect.
 */
export async function repairDatabase(root, url, timeoutMs = 90_000) {
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { createRequire } = await import("node:module");
  let client;
  try {
    const require = createRequire(`${root.replace(/\\/g, "/")}/package.json`);
    const { PrismaClient } = require("@prisma/client");
    const { tuneDatabaseUrl } = await import("./db-url.mjs");
    const core = await import(pathToFileURL(path.join(root, "src", "lib", "schema", "repair-core.mjs")).href);
    // a pooled Neon address can't change tables reliably — use the direct one
    client = new PrismaClient({ datasources: { db: { url: tuneDatabaseUrl(url.replace("-pooler.", ".")) } }, log: [] });
    const migrations = await core.loadMigrations(path.join(root, "prisma", "migrations"));
    return await Promise.race([core.repairSchema(client, migrations), new Promise((_, rej) => setTimeout(() => rej(new Error("no answer")), timeoutMs))]);
  } catch (e) {
    return { error: String(e?.message ?? e).split("\n").filter(Boolean).pop() };
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

/** AI keys/models JARVIS, EV and DARWIN can use (the same names the app reads). */
const CLOUD_AI_VARS = ["GROQ_API_KEY", "GEMINI_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "AI_API_KEY", "GROQ_MODEL", "GEMINI_MODEL"];
const realValue = (v) => typeof v === "string" && v.trim() !== "" && !/^\[sensitive\]$/i.test(v.trim());

/**
 * The cloud AI keys to give the JARVIS app (pure — tested): .env.local's own
 * value when it has a real one, otherwise the one in ULTRON's edith/.env (where
 * they lived when ULTRON ran on Groq). `borrowed` lists the ones taken from
 * edith/.env, so the runner can say so.
 */
export function cloudAiKeys(appEnv, edithEnv) {
  const values = {};
  const borrowed = [];
  for (const k of CLOUD_AI_VARS) {
    if (realValue(appEnv[k])) values[k] = appEnv[k].trim();
    else if (realValue(edithEnv[k])) { values[k] = edithEnv[k].trim(); borrowed.push(k); }
  }
  return { values, borrowed };
}

/**
 * Is the generated Prisma client already built from this schema? (pure — tested)
 * Prisma reformats its copy, so whitespace is ignored.
 */
export function prismaClientMatches(schema, generated) {
  if (!schema || !generated) return false;
  const norm = (t) => String(t).replace(/\s+/g, " ").trim();
  return norm(schema) === norm(generated);
}

/**
 * Where each API key really is (pure — tested). Settings files are checked in
 * order (e.g. .env.local, .env, .env.txt), and the first NON-EMPTY value wins.
 * Vercel leaves "Sensitive" keys empty when pulled, and that empty line in
 * .env.local must not hide the real key you put in .env. A near-miss name
 * (GEOPIFY_API_KEY, GEOAPIFY_KEY …) is used too, and reported so you can
 * rename it.
 * @param {{ name: string, env: Record<string, string> }[]} sources
 * @param {Record<string, RegExp>} keys  wanted name → pattern for near-miss names
 */
export function resolveKeys(sources, keys) {
  const empty = (v) => !v || !String(v).trim() || /^\[sensitive\]$/i.test(String(v).trim());
  /** @type {Record<string, string>} */ const values = {};
  /** @type {Record<string, string>} */ const from = {};
  /** @type {{ key: string, wrong: string, file: string }[]} */ const misnamed = [];
  /** @type {{ key: string, file: string, real: string }[]} */ const hidden = [];
  for (const [key, near] of Object.entries(keys)) {
    let blankIn = null;
    for (const src of sources) {
      if (key in src.env && empty(src.env[key]) && !blankIn) blankIn = src.name;
      if (!empty(src.env[key])) { values[key] = String(src.env[key]).trim(); from[key] = src.name; break; }
    }
    if (values[key] && blankIn && blankIn !== from[key]) hidden.push({ key, file: blankIn, real: from[key] });
    if (values[key]) continue;
    for (const src of sources) {
      const wrong = Object.keys(src.env).find((k) => k !== key && near.test(k) && !empty(src.env[k]));
      if (wrong) { values[key] = String(src.env[wrong]).trim(); from[key] = src.name; misnamed.push({ key, wrong, file: src.name }); break; }
    }
  }
  return { values, from, misnamed, hidden };
}

/**
 * Bytes used by a file or folder (symlinks not followed). Missing → 0.
 * @param {string} p
 * @returns {number}
 */
export function dirSize(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(p); } catch { return 0; }
  for (const e of entries) total += dirSize(path.join(p, e));
  return total;
}

/**
 * Next.js keeps every build's webpack cache in .next/cache/webpack and never
 * trims it — it grows past 1 GB. It's only a speed-up (rebuilt on demand), so
 * past `maxBytes` it's cleared. Returns the bytes freed (0 = under the limit).
 * @param {string} root
 * @param {number} [maxBytes]
 */
export function pruneBuildCache(root, maxBytes = 400 * 1024 * 1024) {
  const dir = path.join(root, ".next", "cache", "webpack");
  const size = dirSize(dir);
  if (size <= maxBytes) return 0;
  try { fs.rmSync(dir, { recursive: true, force: true }); return size; } catch { return 0; }
}
