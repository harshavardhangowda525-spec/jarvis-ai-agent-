import "server-only";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";
import type { PlaybookDump } from "./playbook-types";

/**
 * Reads your trading playbook's own records — never a copy JARVIS keeps, never
 * written back. The playbook app stores every record as a JSON document in
 * Supabase (`documents`: user_id, collection, doc_id, data, deleted) when cloud
 * sync is on. Without that, a backup you exported from the playbook
 * (Settings → Export) can stand in. With neither, the answer is "no data
 * source" — the weekly review never invents records.
 */

export type SourceKind = "supabase" | "backup";

export interface PlaybookSnapshot {
  kind: SourceKind;
  dump: PlaybookDump;
  fetchedAt: string;
  /** when the newest record was last changed (supabase) or the backup was uploaded */
  asOf: string | null;
  counts: Record<string, number>;
  note?: string;
}

export class NoPlaybookSource extends Error {
  constructor(public readonly detail: string) { super(detail); }
}

export function supabaseMode(): "password" | "service" | null {
  if (!env.playbookSupabaseUrl) return null;
  if (env.playbookServiceKey && env.playbookUserId) return "service";
  if (env.playbookAnonKey && env.playbookEmail && env.playbookPassword) return "password";
  return null;
}

export const SETUP_HINT =
  "Connect your trading playbook: set PLAYBOOK_SUPABASE_URL plus either PLAYBOOK_SUPABASE_ANON_KEY, PLAYBOOK_EMAIL and PLAYBOOK_PASSWORD (your playbook login — reads only your own records), " +
  "or PLAYBOOK_SUPABASE_SERVICE_KEY and PLAYBOOK_USER_ID. If the playbook runs in LOCAL MODE (no Supabase), upload its backup from Settings → Export on the Trading Intelligence page instead.";

let token: { value: string; until: number } | null = null;

async function accessToken(f: typeof fetch): Promise<{ key: string; bearer: string; userId: string | null }> {
  if (supabaseMode() === "service") return { key: env.playbookServiceKey, bearer: env.playbookServiceKey, userId: env.playbookUserId };
  if (token && token.until > Date.now() + 60_000) return { key: env.playbookAnonKey, bearer: token.value, userId: null };
  const r = await f(`${env.playbookSupabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.playbookAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.playbookEmail, password: env.playbookPassword }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; msg?: string };
  if (!r.ok || !j.access_token) throw new Error(`The playbook's Supabase sign-in failed (${j.error_description ?? j.msg ?? `HTTP ${r.status}`}).`);
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return { key: env.playbookAnonKey, bearer: token.value, userId: null };
}

type Row = { collection: string; doc_id: string; data: unknown; deleted: boolean; updated_at: string };

export async function fetchSupabase(f: typeof fetch = fetch): Promise<PlaybookSnapshot> {
  const auth = await accessToken(f);
  const dump: PlaybookDump = {};
  let newest: string | null = null;
  const page = 1000;
  for (let from = 0; ; from += page) {
    const q = new URLSearchParams({ select: "collection,doc_id,data,deleted,updated_at", order: "updated_at.asc" });
    if (auth.userId) q.set("user_id", `eq.${auth.userId}`);
    const r = await f(`${env.playbookSupabaseUrl}/rest/v1/documents?${q}`, {
      headers: { apikey: auth.key, Authorization: `Bearer ${auth.bearer}`, Range: `${from}-${from + page - 1}`, "Range-Unit": "items" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`The playbook's Supabase answered HTTP ${r.status} when reading documents.`);
    const rows = (await r.json()) as Row[];
    for (const row of rows) {
      if (!newest || row.updated_at > newest) newest = row.updated_at;
      if (row.deleted) continue;
      (dump[row.collection] ??= {})[row.doc_id] = row.data;
    }
    if (rows.length < page) break;
  }
  return snapshot("supabase", dump, newest);
}

function snapshot(kind: SourceKind, dump: PlaybookDump, asOf: string | null, note?: string): PlaybookSnapshot {
  const counts = Object.fromEntries(Object.entries(dump).map(([c, d]) => [c, Object.keys(d).length]));
  return { kind, dump, fetchedAt: new Date().toISOString(), asOf, counts, note };
}

/** A playbook backup (`{ collection: { id: data } }`), checked before it's kept. */
export function parseBackup(raw: unknown): PlaybookDump {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("That file isn't a playbook backup (expected the JSON from the playbook's Settings → Export).");
  const known = ["settings", "journey", "journal", "jentries", "etfRuns", "paperSessions", "backtests", "trades", "sims", "etfWorkflow", "daylog", "playbook", "strategies"];
  const out: PlaybookDump = {};
  for (const [c, docs] of Object.entries(raw as Record<string, unknown>)) {
    if (!docs || typeof docs !== "object" || Array.isArray(docs)) continue;
    out[c] = docs as Record<string, unknown>;
  }
  if (!Object.keys(out).some((c) => known.includes(c))) throw new Error("That file has none of the playbook's collections — export it again from the playbook's Settings → Export.");
  return out;
}

const cache = new Map<string, { at: number; snap: PlaybookSnapshot }>();

/** The freshest available view of your playbook. Supabase first; the uploaded backup when cloud sync isn't configured. */
export async function loadPlaybook(userId: string, o: { fresh?: boolean; fetch?: typeof fetch } = {}): Promise<PlaybookSnapshot> {
  const hit = cache.get(userId);
  if (!o.fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.snap;
  let snap: PlaybookSnapshot;
  if (supabaseMode() && (await ownsPlaybook(userId))) {
    snap = await fetchSupabase(o.fetch);
  } else {
    const st = await getDb().tradingSettings.findUnique({ where: { userId } });
    if (!st?.backup) throw new NoPlaybookSource(SETUP_HINT);
    snap = snapshot("backup", st.backup as PlaybookDump, st.backupAt?.toISOString() ?? null,
      `From the playbook backup uploaded ${st.backupAt?.toISOString().slice(0, 10) ?? ""} — anything you did in the playbook after that isn't included.`);
  }
  cache.set(userId, { at: Date.now(), snap });
  return snap;
}

async function ownsPlaybook(userId: string): Promise<boolean> {
  if (!env.playbookOwnerEmail) return true;
  const u = await getDb().user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email?.toLowerCase() === env.playbookOwnerEmail;
}

export function forgetPlaybookCache(userId: string) {
  cache.delete(userId);
}

export function sourceStatus() {
  const mode = supabaseMode();
  return {
    supabase: mode,
    configured: !!mode,
    url: env.playbookSupabaseUrl ? new URL(env.playbookSupabaseUrl).host : null,
    hint: mode ? null : SETUP_HINT,
  };
}
