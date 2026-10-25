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
import path from "node:path";
import { tuneDatabaseUrl, isConnectError, dbHost } from "./db-url";
import { loadMigrations, repairSchema, type RepairResult } from "./schema/repair-core.mjs";

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

/** Prisma's "table/column … does not exist" — the database missed an update. */
export const isSchemaError = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022" || /does not exist in the current database/i.test(String((e as Error)?.message ?? ""));
};

let repairing: Promise<RepairResult | null> | null = null;
/**
 * Add what this version's database changes need and the database lacks
 * (repeat-safe, additive only — see schema/repair-core.mjs). Once per process;
 * a failed attempt can be retried a minute later.
 */
function repairOnce(client: PrismaClient): Promise<RepairResult | null> {
  repairing ??= (async () => {
    const migrations = await loadMigrations(path.join(process.cwd(), "prisma", "migrations"));
    if (!migrations.length) return null;
    const r = await repairSchema(client, migrations);
    if (r.repaired.length) console.log(`[db] The database was missing ${r.repaired.join(", ")} — added it.`);
    if (r.failed.length) console.error("[db] Couldn't add a missing database change:", r.failed);
    return r;
  })().catch((e) => {
    console.error("[db] Database check failed:", (e as Error)?.message ?? e);
    setTimeout(() => { repairing = null; }, 60_000);
    return null;
  });
  return repairing;
}
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
        let repaired = false;
        for (let attempt = 0; ; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            // "column … does not exist": add the missing change, then run the query again (once)
            if (!repaired && isSchemaError(e)) {
              repaired = true;
              const r = await repairOnce(base);
              if (r?.repaired.length) continue;
              throw e;
            }
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
