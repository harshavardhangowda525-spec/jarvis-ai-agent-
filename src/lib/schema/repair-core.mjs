/**
 * Database self-repair (shared by `npm run local` and the app itself).
 *
 * Prisma's updater (`migrate deploy`) stops completely when an earlier change
 * failed part-way, when the change history table is missing, or when the
 * database already has some of a change's tables — and then later features
 * fail with "column … does not exist". This compares the REAL database with
 * every migration and applies the purely additive ones (new tables, columns,
 * indexes, constraints, enums) whose objects are missing, each statement
 * written so it's safe to repeat. Anything that changes or removes data is
 * never touched here — that stays with Prisma's updater.
 */
import { createHash, randomUUID } from "node:crypto";

const strip = (sql) => sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n");

/** Statements of a migration (Prisma writes one per `;` at a line end). */
export function statements(sql) {
  return strip(sql).split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
}

const ID = String.raw`"([^"]+)"`;

/** What a statement creates, and its repeat-safe form — or null if it isn't purely additive. */
export function classify(stmt) {
  const s = stmt.replace(/\s+/g, " ").trim();
  let m;
  if ((m = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${ID}`, "i").exec(s))) {
    return { objects: [{ kind: "table", name: m[1] }], sql: stmt.replace(/^(\s*CREATE TABLE)\s+(?:IF NOT EXISTS\s+)?/i, "$1 IF NOT EXISTS ") };
  }
  if ((m = new RegExp(`^CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?${ID}`, "i").exec(s))) {
    return { objects: [{ kind: "index", name: m[2] }], sql: stmt.replace(/^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX)\s+(?:IF NOT EXISTS\s+)?/i, "$1 IF NOT EXISTS ") };
  }
  if ((m = new RegExp(`^CREATE TYPE ${ID} AS ENUM`, "i").exec(s))) {
    return { objects: [{ kind: "type", name: m[1] }], sql: `DO $$ BEGIN ${stmt}; EXCEPTION WHEN duplicate_object THEN NULL; END $$` };
  }
  if ((m = new RegExp(`^ALTER TABLE ${ID} (.*)$`, "i").exec(s))) {
    const table = m[1], rest = m[2];
    // ADD COLUMN "a" …, ADD COLUMN "b" …
    const parts = rest.split(/,\s*(?=ADD\s)/i);
    if (parts.every((p) => /^ADD COLUMN /i.test(p))) {
      const cols = parts.map((p) => new RegExp(`^ADD COLUMN (?:IF NOT EXISTS )?${ID}`, "i").exec(p)?.[1]);
      if (cols.some((c) => !c)) return null;
      return { objects: cols.map((c) => ({ kind: "column", name: `${table}.${c}` })), sql: stmt.replace(/ADD\s+COLUMN\s+(?:IF NOT EXISTS\s+)?/gi, "ADD COLUMN IF NOT EXISTS ") };
    }
    if (parts.length === 1 && (m = new RegExp(`^ADD CONSTRAINT ${ID}`, "i").exec(rest))) {
      return { objects: [{ kind: "constraint", name: m[1] }], sql: `DO $$ BEGIN ${stmt}; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$` };
    }
  }
  return null;
}

const has = (schema, o) =>
  o.kind === "table" ? schema.tables.has(o.name)
    : o.kind === "column" ? schema.columns.has(o.name)
      : o.kind === "index" ? schema.indexes.has(o.name)
        : o.kind === "constraint" ? schema.constraints.has(o.name)
          : schema.types.has(o.name);

/**
 * Which migrations the database is really missing (pure — tested).
 * Returns, per migration: what's missing, whether it can be repaired here,
 * and the repeat-safe statements to run.
 */
export function planRepair(migrations, schema) {
  const out = [];
  for (const mg of migrations) {
    const parsed = statements(mg.sql).map(classify);
    const additive = parsed.every(Boolean);
    const objects = parsed.filter(Boolean).flatMap((p) => p.objects);
    const missing = objects.filter((o) => !has(schema, o));
    out.push({ name: mg.name, additive, missing, complete: additive ? missing.length === 0 : null, sql: additive ? parsed.map((p) => p.sql) : [], checksum: createHash("sha256").update(mg.sql).digest("hex") });
  }
  return out;
}

export async function readSchema(client) {
  const q = (sql) => client.$queryRawUnsafe(sql);
  const [t, c, i, k, e] = await Promise.all([
    q(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = current_schema()`),
    q(`SELECT table_name || '.' || column_name AS n FROM information_schema.columns WHERE table_schema = current_schema()`),
    q(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = current_schema()`),
    q(`SELECT c.conname AS n FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace WHERE s.nspname = current_schema()`),
    q(`SELECT t.typname AS n FROM pg_type t JOIN pg_namespace s ON s.oid = t.typnamespace WHERE s.nspname = current_schema()`),
  ]);
  const set = (rows) => new Set(rows.map((r) => r.n));
  return { tables: set(t), columns: set(c), indexes: set(i), constraints: set(k), types: set(e) };
}

/**
 * Bring the database in line with this version (safe to run every start).
 * `migrations`: [{ name, sql }] in order. Returns what it did and what's still missing.
 */
export async function repairSchema(client, migrations) {
  const schema = await readSchema(client);
  const plan = planRepair(migrations, schema);
  const repaired = [], failed = [], blocked = [];
  for (const p of plan) {
    if (p.complete !== false) continue;
    if (!p.additive) { if (p.missing.length) blocked.push(p.name); continue; }
    try {
      for (const s of p.sql) await client.$executeRawUnsafe(s);
      repaired.push(p.name);
    } catch (e) {
      failed.push({ name: p.name, error: String(e?.message ?? e).split("\n").filter(Boolean).pop()?.slice(0, 300) ?? "failed" });
    }
  }
  // Prisma's change history: mark what is really in the database as done, so its updater works again
  let recorded = 0;
  if (schema.tables.has("_prisma_migrations")) {
    const after = planRepair(migrations, await readSchema(client));
    const rows = await client.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const stuck = new Set(rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    for (const p of after) {
      if (p.complete !== true || done.has(p.name)) continue;
      if (stuck.has(p.name)) {
        await client.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1, logs = NULL WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`, p.name);
      } else {
        await client.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`, randomUUID(), p.checksum, p.name);
      }
      recorded++;
    }
  }
  const final = planRepair(migrations, await readSchema(client));
  const stillMissing = final.filter((p) => p.missing.length).map((p) => ({ name: p.name, missing: p.missing.map((o) => o.name) }));
  return { repaired, failed, blocked, recorded, stillMissing };
}

/** The migrations folder, in order. */
export async function loadMigrations(dir) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "migration.sql"))).map((d) => d.name).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8") }));
}
