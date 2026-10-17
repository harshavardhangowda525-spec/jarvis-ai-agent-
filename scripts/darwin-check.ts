/**
 * npm run darwin:check — proves DARWIN's lead pipeline works with YOUR keys,
 * on YOUR database, end to end. Nothing is mocked:
 *
 *   1. Provider health — one small real request per configured provider
 *      (Ready / Authentication failed / Rate limited / Quota exhausted /
 *      Billing required / Provider error / Unreachable / Not configured).
 *   2. A real discovery run (DISCOVER → NORMALIZE → DEDUPLICATE → SAVE) for a
 *      small batch, with the run report: businesses discovered, new leads
 *      saved, duplicates skipped, filtered out, provider errors, runtime.
 *   3. A "restart": the database connection is closed, a brand-new client is
 *      opened, and every saved lead is read back and compared field by field.
 *   4. A duplicate check over all your leads (no business stored twice).
 *
 * It passes ONLY when real businesses were retrieved, saved and read back.
 * The leads it saves are real businesses and stay in your CRM like any other
 * DARWIN search. Key values are never printed — only their names.
 *
 *   npm run darwin:check -- --category gyms --location "Indiranagar, Bengaluru" --count 5
 *   options: --email you@example.com (which JARVIS account; default RUBIN_USER_EMAIL or the only user)
 *            --health-only (skip the discovery run)
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { parseEnvFiles } from "./rubin.mjs";

// "server-only" is a Next.js marker package; outside Next it resolves to the same empty stub the tests use
const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const resolve = M._resolveFilename;
M._resolveFilename = (req, ...rest) => (req === "server-only" ? path.join(process.cwd(), "tests", "stubs", "server-only.ts") : resolve(req, ...rest));

const ROOT = process.cwd(); // npm runs it from the project folder
const read = (f: string) => { try { return fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { return ""; } };
const fileEnv = parseEnvFiles([read(".env"), read(".env.local")]) as Record<string, string>;
for (const [k, v] of Object.entries(fileEnv)) if (v && !process.env[k]) process.env[k] = v;

const arg = (name: string, d = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const line = (s = "") => console.log(s);
const ICON: Record<string, string> = { ready: "✓", not_configured: "·", auth_failed: "✗", quota_exhausted: "✗", billing_required: "✗", provider_error: "!", rate_limited: "!", unreachable: "✗" };

async function main() {
  const category = arg("category", "gyms");
  const location = arg("location", "Indiranagar, Bengaluru");
  const count = Math.min(Math.max(Number(arg("count", "5")) || 5, 1), 20);
  let failed = false;

  line("DARWIN pipeline check");
  line("=====================");
  const present = ["DATABASE_URL", "GEOAPIFY_API_KEY", "GOOGLE_PLACES_API_KEY", "FOURSQUARE_API_KEY", "SEARXNG_URL", "BRAVE_SEARCH_API_KEY", "SEARCH_API_KEY", "SERPER_API_KEY"]
    .map((k) => `${k} ${process.env[k]?.trim() ? "set" : "not set"}`);
  line(`Settings (values hidden): ${present.join(" · ")}`);
  if (!process.env.DATABASE_URL?.trim()) { line("\n✗ DATABASE_URL isn't set in .env / .env.local — nothing can be saved. Stopping."); process.exit(1); }

  const { providerHealth, discoveryReady } = await import("../src/lib/darwin/providers/health");
  line("\n1) Provider health (one real test request each)");
  const health = await providerHealth({ fresh: true });
  for (const h of health) {
    line(`   ${ICON[h.state] ?? "?"} ${h.label.padEnd(18)} ${h.stateLabel.padEnd(22)} ${h.detail}${h.latencyMs != null ? ` (${h.latencyMs} ms)` : ""}`);
    if (h.fix && h.state !== "ready") line(`     → ${h.fix}`);
  }
  if (!discoveryReady(health)) {
    const g = health.find((h) => h.id === "geoapify");
    line(`\n✗ Discovery can't run: Geoapify is "${g?.stateLabel}". ${g?.fix ?? ""}`);
    line("  The pipeline test was NOT run — nothing has been proven yet.");
    process.exit(1);
  }
  if (flag("health-only")) { line("\nHealth check done (--health-only: discovery run skipped)."); return; }

  const { getDb } = await import("../src/lib/db");
  const db = getDb();
  const email = arg("email", process.env.RUBIN_USER_EMAIL ?? "");
  const user = email ? await db.user.findUnique({ where: { email } }) : (await db.user.findMany({ take: 2 })).length === 1 ? await db.user.findFirst() : null;
  if (!user) { line(`\n✗ Couldn't pick the JARVIS account${email ? ` "${email}"` : " (there's more than one — pass --email you@example.com)"}.`); process.exit(1); }

  line(`\n2) Real discovery: ${count} × "${category}" near "${location}" for ${user.email}`);
  const before = await db.darwinLead.count({ where: { userId: user.id } });
  const { findNewLeads } = await import("../src/lib/darwin/discovery");
  const r = await findNewLeads({ userId: user.id, category, location, limit: count, filter: "all" });
  line(`   Businesses discovered : ${r.discovered}`);
  line(`   New leads saved       : ${r.newCount}`);
  line(`   Duplicates skipped    : ${r.skippedDuplicates}`);
  line(`   Filtered out          : ${r.filteredOut} (no name/coordinates, or not this category)`);
  line(`   Provider errors       : ${r.providerErrors.length ? r.providerErrors.join(" | ") : "none"}`);
  line(`   Requests / runtime    : ${r.requests} requests · ${(r.runtimeMs / 1000).toFixed(1)} s · stopped: ${r.stoppedReason}`);
  const withPhone = r.leads.filter((l) => l.phone).length, withSite = r.leads.filter((l) => l.website).length;
  line(`   Contact data          : ${withPhone}/${r.leads.length} have a listed phone · ${withSite}/${r.leads.length} list a website (missing = unknown, not "none")`);
  for (const l of r.leads.slice(0, 5)) line(`     • ${l.businessName} — ${l.phone ?? "phone unknown"} — ${l.website ?? "website not listed"}`);
  const after = await db.darwinLead.count({ where: { userId: user.id } });
  line(`   CRM count             : ${before} → ${after}`);
  if (after - before !== r.newCount) { failed = true; line(`   ✗ The CRM grew by ${after - before}, but the run reported ${r.newCount} new — counts don't match.`); }

  line("\n3) Restart: closing the database connection and reading the leads back with a new one");
  await db.$disconnect();
  const { PrismaClient } = await import("@prisma/client");
  const fresh = new PrismaClient();
  const ids = r.leads.map((l) => l.id);
  const back = await fresh.darwinLead.findMany({ where: { id: { in: ids } } });
  const mismatch = r.leads.filter((l) => {
    const b = back.find((x) => x.id === l.id);
    return !b || b.businessName !== l.businessName || (b.phone ?? null) !== (l.phone ?? null) || (b.website ?? null) !== (l.website ?? null) || b.source !== l.source;
  });
  line(`   Read back ${back.length}/${ids.length} saved leads${mismatch.length ? ` — ${mismatch.length} differ` : " — all fields match"}.`);
  if (back.length !== ids.length || mismatch.length) failed = true;

  line("\n4) Duplicate check over all your DARWIN leads");
  const dupes = await fresh.darwinLead.groupBy({ by: ["fingerprint"], where: { userId: user.id }, _count: { _all: true }, having: { fingerprint: { _count: { gt: 1 } } } });
  line(dupes.length ? `   ✗ ${dupes.length} business(es) are stored more than once.` : "   ✓ No business is stored twice.");
  if (dupes.length) failed = true;
  await fresh.$disconnect();

  line("");
  if (r.newCount === 0 && !failed) {
    line(`! Inconclusive: the search returned no NEW businesses (${r.skippedDuplicates} already known). Run again with another --location or --category.`);
    process.exit(2);
  }
  line(failed ? "✗ FAILED — see above." : `✓ PASSED — ${r.newCount} real businesses were retrieved from Geoapify, saved to DARWIN's CRM, and read back after a reconnect.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(`\n✗ ${(e as Error).message}`); process.exit(1); });
