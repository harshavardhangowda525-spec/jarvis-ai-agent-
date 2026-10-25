import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { classify, planRepair, loadMigrations, repairSchema, readSchema } from "@/lib/schema/repair-core.mjs";
import { isDbConfigured } from "@/lib/db";

describe("database self-repair: what's safe", () => {
  it("makes additive statements repeat-safe", () => {
    expect(classify(`ALTER TABLE "AgentJob" ADD COLUMN     "payload" JSONB`)?.sql).toBe(`ALTER TABLE "AgentJob" ADD COLUMN IF NOT EXISTS "payload" JSONB`);
    expect(classify(`CREATE TABLE "X" (\n "id" TEXT NOT NULL\n)`)?.sql).toMatch(/^CREATE TABLE IF NOT EXISTS "X"/);
    expect(classify(`CREATE UNIQUE INDEX "X_a_key" ON "X"("a")`)?.sql).toBe(`CREATE UNIQUE INDEX IF NOT EXISTS "X_a_key" ON "X"("a")`);
    expect(classify(`ALTER TABLE "X" ADD CONSTRAINT "X_fkey" FOREIGN KEY ("u") REFERENCES "User"("id")`)?.sql).toMatch(/^DO \$\$ BEGIN .* EXCEPTION WHEN duplicate_object/);
    expect(classify(`ALTER TABLE "X" ADD COLUMN "a" TEXT, ADD COLUMN "b" INTEGER`)?.objects.map((o) => o.name)).toEqual(["X.a", "X.b"]);
  });
  it("never touches changes that alter or remove data", () => {
    for (const s of [`ALTER TABLE "X" DROP COLUMN "a"`, `UPDATE "X" SET a = 1`, `DROP TABLE "X"`, `ALTER TABLE "X" RENAME COLUMN "a" TO "b"`, `ALTER TABLE "X" ALTER COLUMN "a" SET NOT NULL`]) expect(classify(s), s).toBeNull();
    const plan = planRepair([{ name: "m", sql: `ALTER TABLE "X" ADD COLUMN "a" TEXT;\nUPDATE "X" SET "a" = 'x';` }], { tables: new Set(["X"]), columns: new Set(), indexes: new Set(), constraints: new Set(), types: new Set() });
    expect(plan[0].additive).toBe(false);
    expect(plan[0].sql).toEqual([]);
  });
});

const d = isDbConfigured ? describe : describe.skip;

// These tests break a database on purpose — in their own schema, never the shared one.
const SCHEMA = "repair_test";
const isoUrl = () => { const u = new URL(process.env.DATABASE_URL!); u.searchParams.set("schema", SCHEMA); return u.toString(); };
let raw: PrismaClient;
const sharedUrl = process.env.DATABASE_URL;

d("database self-repair (integration)", () => {
  beforeAll(async () => {
    const admin = new PrismaClient();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.$disconnect();
    const r = spawnSync(process.execPath, [path.join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: isoUrl() }, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    raw = new PrismaClient({ datasources: { db: { url: isoUrl() } } });
  }, 180_000);
  afterAll(async () => {
    await raw?.$disconnect();
    process.env.DATABASE_URL = sharedUrl;
    const admin = new PrismaClient();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.$disconnect();
  });
  const breakIt = async (all = false) => {
    if (all) {
      await raw.$executeRawUnsafe(`DROP TABLE IF EXISTS "FridayVersion"`);
      await raw.$executeRawUnsafe(`DROP TABLE IF EXISTS "FridayProject"`);
      await raw.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '0025_friday'`);
    }
    await raw.$executeRawUnsafe(`ALTER TABLE "AgentJob" DROP COLUMN IF EXISTS "payload"`);
    await raw.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = NULL, logs = 'boom' WHERE migration_name = '0024_aston_plans'`);
  };

  it("adds the payload column and Friday's tables back, and un-sticks Prisma's history", async () => {
    const migrations = await loadMigrations(path.join(process.cwd(), "prisma", "migrations"));
    await breakIt(true);
    expect((await readSchema(raw)).columns.has("AgentJob.payload")).toBe(false);
    const r = await repairSchema(raw, migrations);
    expect(r.repaired).toEqual(expect.arrayContaining(["0024_aston_plans", "0025_friday"]));
    expect(r.failed).toEqual([]);
    expect(r.stillMissing).toEqual([]);
    const fixed = await readSchema(raw);
    expect(fixed.columns.has("AgentJob.payload")).toBe(true);
    expect(fixed.tables.has("FridayProject") && fixed.tables.has("FridayVersion")).toBe(true);
    expect(fixed.constraints.has("FridayVersion_projectId_fkey")).toBe(true);
    const rows = await raw.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name IN ('0024_aston_plans','0025_friday')`);
    expect(rows.map((x) => x.migration_name).sort()).toEqual(["0024_aston_plans", "0025_friday"]);
    expect(rows.every((x) => x.finished_at)).toBe(true);
    // Prisma's own updater is happy again
    const st = spawnSync(process.execPath, [path.join("node_modules", "prisma", "build", "index.js"), "migrate", "status"], { env: { ...process.env, DATABASE_URL: isoUrl() }, encoding: "utf8" });
    expect(st.stdout).toMatch(/Database schema is up to date/);
    // running it again changes nothing
    const again = await repairSchema(raw, migrations);
    expect(again.repaired).toEqual([]);
    expect(again.recorded).toBe(0);
  }, 120_000);

  it("npm run local's start-up check repairs it", async () => {
    await breakIt();
    const { repairDatabase } = await import("../scripts/local-helpers.mjs");
    const r = await repairDatabase(process.cwd(), isoUrl());
    expect(r.repaired).toEqual(["0024_aston_plans"]);
    expect(r.stillMissing).toEqual([]);
  }, 60_000);

  it("the app's prisma.agentJob.create() adds the missing column and succeeds (no restart, no command)", async () => {
    await breakIt();
    process.env.DATABASE_URL = isoUrl();
    vi.resetModules();
    const { getDb } = await import("@/lib/db");
    const { createJob } = await import("@/lib/jobs/engine");
    const user = await getDb().user.create({ data: { email: `repair-${Date.now()}@example.com`, passwordHash: "x" } });
    const job = await createJob(user.id, { agent: "friday", title: "3D model — EDITH glasses", request: "Model the EDITH glasses", brief: { objective: "Model the EDITH glasses", expectedOutcome: "a model", context: [], requirements: [], constraints: [], acceptance: ["done"], approvals: [] }, payload: { action: "create" } });
    expect(job.payload).toEqual({ action: "create" });
    await getDb().$disconnect();
  }, 60_000);
});
