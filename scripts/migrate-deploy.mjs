#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` over a DIRECT database connection.
 *
 * Neon's pooled endpoint (host contains "-pooler") uses PgBouncer transaction
 * mode, which can't grant the session-level advisory lock Prisma migrations
 * need — so `migrate deploy` times out (P1002). This derives the direct host
 * (strips "-pooler") from DATABASE_URL / DIRECT_URL and runs migrations there,
 * while the app keeps using the pooled URL at runtime.
 *
 * It never fails the build: if migrations can't run (e.g. DB briefly asleep),
 * it logs a warning and continues — the schema is already applied, and the
 * next deploy will retry.
 */
import { execSync } from "node:child_process";

const raw = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
if (!raw) {
  console.warn("[migrate] No DATABASE_URL set — skipping migrate deploy.");
  process.exit(0);
}

// Turn a pooled Neon host into its direct equivalent: "-pooler." -> "."
const directUrl = raw.replace("-pooler.", ".");

try {
  console.log("[migrate] Running prisma migrate deploy over a direct connection…");
  execSync("prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: directUrl },
  });
  console.log("[migrate] Migrations applied.");
} catch (err) {
  console.warn(
    "[migrate] migrate deploy did not complete (continuing build). " +
      "If this is a schema change, re-deploy once the database is awake.",
  );
  console.warn(String(err?.message || err));
  // Do not fail the build — the app can still boot on the existing schema.
  process.exit(0);
}
