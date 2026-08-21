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

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
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
