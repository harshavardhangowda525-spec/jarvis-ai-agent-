import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";
import { istInstant } from "@/lib/trading/week";
import { playbookDump } from "./fixtures/playbook";

const d = isDbConfigured ? describe : describe.skip;
d("MIKE's weekly trading review (integration)", () => {
  let userId = "";
  let R: typeof import("@/lib/trading/reports");
  let S: typeof import("@/lib/trading/source");
  let X: typeof import("@/lib/trading/export");
  const W = { start: "2026-10-19", end: "2026-10-25" };
  const snap = () => ({ kind: "backup" as const, dump: playbookDump() as never, fetchedAt: new Date().toISOString(), asOf: null, counts: {} });
  const goodAsk = async () => ({ provider: "test", text: JSON.stringify({
    executiveSummary: "You saved 2 backtest runs (23 historical simulated trades) and 1 paper session with 4 historical paper trades.",
    strategies: [{ id: "trend", note: "Insufficient data: 20 trades." }], risk: "Risk per trade went above 0.5% once.", learning: "17 of 84 lessons.", discipline: "", comparison: "",
    nextWeek: [{ action: "Run 3 more trend backtests", why: "Only 20 trend trades so far" }],
  }) });

  beforeAll(async () => {
    R = await import("@/lib/trading/reports");
    S = await import("@/lib/trading/source");
    X = await import("@/lib/trading/export");
    userId = (await getDb().user.create({ data: { email: `trading-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("says the playbook isn't connected instead of inventing a report", async () => {
    const r = await R.generateWeekly(userId, W, { trigger: "scheduled", ask: null });
    expect(r.status).toBe("unavailable");
    expect(r.error).toMatch(/PLAYBOOK_SUPABASE_URL/);
    expect(r.metrics).toBeNull();
  });

  it("generates once, keeps the AI text only when its numbers are real, and keeps revisions", async () => {
    const r1 = await R.generateWeekly(userId, W, { trigger: "manual", ask: goodAsk, snapshot: snap(), force: true });
    expect(r1.status).toBe("ready");
    expect(r1.revision).toBe(1);
    expect((r1.narrative as { by: string }).by).toBe("ai");
    // a second scheduled call is a no-op
    const again = await R.generateWeekly(userId, W, { trigger: "scheduled", ask: goodAsk, snapshot: snap() });
    expect(again.revision).toBe(1);
    // regenerate with an AI that makes numbers up → discarded, rule-based text used, revision 2 kept alongside 1
    const liar = async () => ({ provider: "test", text: JSON.stringify({ executiveSummary: "Brilliant week: 92% win rate and ₹18,400 profit on your trades.", nextWeek: [{ action: "Size up", why: "You are winning" }] }) });
    const r2 = await R.generateWeekly(userId, W, { trigger: "manual", ask: liar, snapshot: snap(), force: true });
    expect(r2.revision).toBe(2);
    const n2 = r2.narrative as { by: string; rejected: string; executiveSummary: string };
    expect(n2.by).toBe("rules");
    expect(n2.rejected).toMatch(/numbers that aren't in your records \(92, 18400\)/);
    expect(n2.executiveSummary).not.toMatch(/92%/);
    const view = await R.getReport(userId, W.start);
    expect(view!.revisions.map((v) => v.revision)).toEqual([2, 1]);
    const old = await R.getReport(userId, W.start, 1);
    expect(old!.viewingOld).toBe(true);
    expect(old!.narrative!.by).toBe("ai");
  });

  it("the scheduler is due at Sunday 18:00 IST and catches up missed weeks from the uploaded backup", async () => {
    await getDb().tradingSettings.upsert({ where: { userId }, create: { userId, backup: playbookDump() as never, backupAt: new Date() }, update: { backup: playbookDump() as never, backupAt: new Date() } });
    S.forgetPlaybookCache(userId);
    // before 18:00 on Sunday 1 Nov the due week is still 19–25 Oct (already ready) → nothing new
    let out = await R.runDueWeekly({ now: new Date(istInstant("2026-11-01", 17, 30)), ask: null, userIds: [userId], notify: false });
    expect(out).toEqual([{ userId, week: "2026-10-19", status: "ready", trigger: "manual" }]);
    // JARVIS was off for two Sundays → both missed weeks are made on the next run
    out = await R.runDueWeekly({ now: new Date(istInstant("2026-11-10", 9)), ask: null, userIds: [userId], notify: false });
    expect(out.map((o) => [o.week, o.status, o.trigger])).toEqual([["2026-10-26", "ready", "catch_up"], ["2026-11-02", "ready", "catch_up"]]);
    const rows = await getDb().tradingReport.findMany({ where: { userId }, orderBy: { weekStart: "asc" } });
    expect(rows.map((r) => r.weekStart)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
    expect((rows[1].source as { kind: string }).kind).toBe("backup");
    // idempotent: running again changes nothing
    out = await R.runDueWeekly({ now: new Date(istInstant("2026-11-10", 10)), ask: null, userIds: [userId], notify: false });
    expect(out.every((o) => !o.fresh)).toBe(true);
    // switched off → nothing runs
    await getDb().tradingSettings.update({ where: { userId }, data: { weeklyEnabled: false } });
    out = await R.runDueWeekly({ now: new Date(istInstant("2026-11-15", 19)), ask: null, userIds: [userId], notify: false });
    expect(out[0].status).toBe("disabled");
  });

  it("notifies once, logging each channel's real outcome", async () => {
    const r = await getDb().tradingReport.findFirstOrThrow({ where: { userId, weekStart: W.start } });
    await getDb().tradingSettings.update({ where: { userId }, data: { notifyEmail: true } });
    await R.notifyReport(r);
    const after = await getDb().tradingReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.notifiedAt).not.toBeNull();
    const log = after.notifyLog as { channel: string; status: string }[];
    expect(log).toEqual(expect.arrayContaining([expect.objectContaining({ channel: "whatsapp", status: "off" }), expect.objectContaining({ channel: "email", status: "not_configured" })]));
    await R.notifyReport(after); // second call does nothing
    expect((await getDb().tradingReport.findUniqueOrThrow({ where: { id: r.id } })).notifiedAt!.getTime()).toBe(after.notifiedAt!.getTime());
  });

  it("exports the stored figures as CSV and PDF", async () => {
    const view = (await R.getReport(userId, W.start))!;
    const csv = X.reportCsv(view);
    expect(csv).toMatch(/A Trend-Following,Insufficient data,20/);
    expect(csv).toMatch(/Range-Bound,No data,0,no data/);
    expect(csv).toMatch(/Risk per trade above 0\.5%,high/);
    const pdf = await X.reportPdf(view);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(5000);
  });

  it("reads the playbook's Supabase documents read-only, signed in as you", async () => {
    const saved = { ...env };
    Object.assign(env, { playbookSupabaseUrl: "https://pb.example.supabase.co", playbookAnonKey: "anon", playbookEmail: "me@example.com", playbookPassword: "pw", playbookServiceKey: "", playbookUserId: "" });
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string> });
      if (url.includes("/auth/v1/token")) return new Response(JSON.stringify({ access_token: "jwt-1", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify([
        { collection: "etfRuns", doc_id: "r1", data: { id: "r1" }, deleted: false, updated_at: "2026-10-24T10:00:00Z" },
        { collection: "jentries", doc_id: "gone", data: {}, deleted: true, updated_at: "2026-10-25T10:00:00Z" },
      ]), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const s = await S.fetchSupabase(fake);
      expect(s.kind).toBe("supabase");
      expect(Object.keys(s.dump)).toEqual(["etfRuns"]);
      expect(s.asOf).toBe("2026-10-25T10:00:00Z");
      expect(calls[0].method).toBe("POST");
      expect(calls[1].method).toBe("GET");
      expect(calls[1].url).toMatch(/\/rest\/v1\/documents\?select=collection%2Cdoc_id%2Cdata%2Cdeleted%2Cupdated_at/);
      expect(calls[1].headers.Authorization).toBe("Bearer jwt-1");
      expect(calls.slice(1).every((c) => c.method === "GET")).toBe(true);
    } finally {
      Object.assign(env, saved);
    }
  });
});
