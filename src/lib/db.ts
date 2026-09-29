/**
 * Prisma client singleton with graceful degradation.
 *
 * If DATABASE_URL is unset the app must not crash at import time. We expose
 * `getDb()` which throws a typed error only when actually used, and
 * `isDbConfigured` for callers that want to check first.
 */
import "server-only";
import { PrismaClient } from "@prisma/client";
import { env } from "./env";
import { tuneDatabaseUrl, isConnectError, dbHost } from "./db-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const isDbConfigured = env.databaseUrl.length > 0;

export class DbNotConfiguredError extends Error {
  constructor() {
    super("Database is not configured. Set DATABASE_URL.");
    this.name = "DbNotConfiguredError";
  }
}

const RETRY_MS = [1_500, 3_000, 6_000];
let lastConnectWarn = 0;

/**
 * The client, with two things for a database that sleeps when idle (Neon):
 * a longer connection timeout, and a few retries when it couldn't connect at
 * all (the query never ran, so trying again is safe). Connection trouble is
 * logged as one short line instead of a wall of prisma:error.
 */
function createClient(): PrismaClient {
  const base = new PrismaClient({
    datasources: { db: { url: tuneDatabaseUrl(env.databaseUrl) } },
    log: [{ emit: "event", level: "error" }, ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : [])],
  });
  base.$on("error", (e) => {
    if (isConnectError(e)) return; // reported once by the retry below
    console.error("prisma:error", e.message);
  });
  const extended = base.$extends({
    query: {
      async $allOperations({ args, query }) {
        for (let attempt = 0; ; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (!isConnectError(e) || attempt >= RETRY_MS.length) throw e;
            if (Date.now() - lastConnectWarn > 30_000) {
              lastConnectWarn = Date.now();
              console.warn(`[db] Can't reach the database at ${dbHost(env.databaseUrl)} — it may be waking up; retrying…`);
            }
            await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
          }
        }
      },
    },
  });
  return extended as unknown as PrismaClient;
}

/**
 * Returns the shared Prisma client, or throws DbNotConfiguredError when the
 * database is not configured. Route handlers catch this and return a clean
 * 503 rather than a stack trace.
 */
export function getDb(): PrismaClient {
  if (!isDbConfigured) throw new DbNotConfiguredError();
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/** Lightweight connectivity probe for the health/status endpoints. */
export async function pingDb(): Promise<boolean> {
  if (!isDbConfigured) return false;
  try {
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
