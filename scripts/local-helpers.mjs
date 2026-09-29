/**
 * Small pieces of `npm run local` that are worth testing on their own.
 */
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
