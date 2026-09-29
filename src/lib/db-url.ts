/**
 * Connection settings that let JARVIS ride out a sleeping database. Neon (and
 * other serverless Postgres) suspends the database when idle; waking it can
 * take longer than Prisma's 5-second default, which shows up as "Can't reach
 * database server". Settings already in DATABASE_URL are kept as they are.
 */
export function tuneDatabaseUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return raw; }
  if (!/^postgres(ql)?:$/i.test(url.protocol)) return raw;
  const set = (k: string, v: string) => { if (!url.searchParams.has(k)) url.searchParams.set(k, v); };
  set("connect_timeout", "30"); // seconds to open a connection (a cold start)
  set("pool_timeout", "30");    // seconds a query may wait for a free connection
  return url.toString();
}

/** Prisma errors that mean "couldn't connect" — the query never ran, so it's safe to try again. */
export function isConnectError(e: unknown): boolean {
  const code = (e as { code?: string; errorCode?: string } | null)?.code ?? (e as { errorCode?: string } | null)?.errorCode;
  if (code && ["P1001", "P1002", "P2024"].includes(code)) return true;
  const m = String((e as Error | null)?.message ?? "");
  return /Can't reach database server|Timed out fetching a new connection|timed out while connecting|Server has closed the connection before/i.test(m) && !/Invalid .* invocation:[\s\S]*(Unique constraint|Foreign key)/.test(m);
}

/** Where the database is, for messages (host only — never the password). */
export function dbHost(raw: string): string {
  try { const u = new URL(raw); return `${u.hostname}:${u.port || 5432}`; } catch { return "the database"; }
}
