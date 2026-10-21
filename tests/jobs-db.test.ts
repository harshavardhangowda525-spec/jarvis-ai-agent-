import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import type { AgentEvent, AgentInput } from "@/lib/ai/agent";
import { judgeOutcome } from "@/lib/jobs/brief";

const brief = { objective: "Find 5 gyms in Indiranagar without a website", expectedOutcome: "5 verified leads saved to the CRM", acceptance: ["5 new leads are in the CRM"], context: [], requirements: [], constraints: [], approvals: [] };

/** A scripted agent: the AI model is the only thing replaced. */
function script(events: AgentEvent[], seen: string[] = [], during?: () => Promise<void>) {
  return async function* (input: AgentInput) {
    seen.push(input.message);
    for (const e of events) { yield e; if (during) await during(); }
  };
}

describe("judging a job's outcome", () => {
  it("needs the agent's STATUS: DONE and no failed step to call it completed", () => {
    expect(judgeOutcome("Saved 5 leads.\nSTATUS: DONE", [{ status: "ok", summary: "saved 5" }], null).status).toBe("completed");
    expect(judgeOutcome("Saved 5 leads.", [{ status: "ok", summary: "saved 5" }], null)).toMatchObject({ status: "failed", reason: expect.stringContaining("didn't confirm") });
    expect(judgeOutcome("Done.\nSTATUS: DONE", [{ status: "error", summary: "Geoapify: quota exhausted" }], null)).toMatchObject({ status: "failed", reason: expect.stringContaining("quota") });
    expect(judgeOutcome("Drafted 3 emails.\nSTATUS: NEEDS_APPROVAL — send the 3 emails", [], null)).toMatchObject({ status: "waiting_approval", reason: "send the 3 emails" });
    expect(judgeOutcome("No key.\nSTATUS: BLOCKED — GEOAPIFY_API_KEY isn't set", [], null)).toMatchObject({ status: "failed", reason: "GEOAPIFY_API_KEY isn't set" });
    expect(judgeOutcome("Saved.\nSTATUS: DONE", [], null).text).toBe("Saved.");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("JARVIS delegated tasks (integration)", () => {
  let userId = "";
  let E: typeof import("@/lib/jobs/engine");
  const db = () => getDb();
  const done = (t: string): AgentEvent[] => [{ type: "tool", name: "darwin_find", status: "ok", summary: "Saved 5 new gyms" }, { type: "done", text: `${t}\nSTATUS: DONE` }];

  beforeAll(async () => {
    E = await import("@/lib/jobs/engine");
    const u = await db().user.create({ data: { email: `jobs-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: "Asia/Kolkata" } } } });
    userId = u.id;
  });
  afterAll(async () => { await db().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("a long silent step (ASTON waiting for Claude) keeps its lease — it isn't restarted as dead", async () => {
    const j = await E.createJob(userId, { agent: "aston", title: "slow build", request: "x", brief });
    // the runner says nothing for 4× the lease; meanwhile the app keeps checking for dead runners
    const slow = async function* (): AsyncGenerator<AgentEvent> { await new Promise((r) => setTimeout(r, 2400)); yield* done("Built it."); };
    let stop = false;
    const watcher = (async () => { while (!stop) { await E.recoverStale(); await new Promise((r) => setTimeout(r, 150)); } })();
    const r = await E.runJob(j.id, { runner: slow as never, leaseMs: 600 });
    stop = true; await watcher;
    expect(r?.status).toBe("completed");
    expect(r?.attempts).toBe(1);
    expect((r?.progress as { text: string }[]).some((p) => /Interrupted/.test(p.text))).toBe(false);
  }, 15_000);

  it("runs a job through the agent and records progress, result, timestamps and a chat", async () => {
    const seen: string[] = [];
    const j = await E.createJob(userId, { agent: "darwin", title: "5 gyms without a website", request: "find 5 gyms in indiranagar with no website", brief });
    expect(j.status).toBe("assigned");
    const r = await E.runJob(j.id, { runner: script(done("Saved 5 gyms: A, B, C, D, E."), seen) });
    expect(r).toMatchObject({ status: "completed", result: "Saved 5 gyms: A, B, C, D, E.", attempts: 1, error: null });
    expect(r!.startedAt && r!.finishedAt).toBeTruthy();
    expect(seen[0]).toContain("Objective: Find 5 gyms");
    expect(seen[0]).toContain("never invent businesses");
    expect(await db().message.count({ where: { conversationId: r!.conversationId! } })).toBe(2);
    expect((r!.progress as { text: string }[]).map((p) => p.text).join(" | ")).toMatch(/started.*Saved 5 new gyms.*Completed/);
    // a second runner can't run it again
    expect(await E.runJob(j.id, { runner: script(done("again")) })).toBeNull();
  });

  it("only one of two simultaneous runners claims a job", async () => {
    const j = await E.createJob(userId, { agent: "darwin", title: "race", request: "x", brief });
    let runs = 0;
    const runner = async function* () { runs++; yield { type: "done", text: "ok\nSTATUS: DONE" } as AgentEvent; };
    await Promise.all([E.runJob(j.id, { runner }), E.runJob(j.id, { runner }), E.runJob(j.id, { runner })]);
    expect(runs).toBe(1);
  });

  it("waits for approval, and carries on after you approve", async () => {
    const j = await E.createJob(userId, { agent: "robin", title: "Outreach drafts", request: "prepare outreach", brief: { ...brief, approvals: ["sending any message"] } });
    const r = await E.runJob(j.id, { runner: script([{ type: "done", text: "Drafted 3 WhatsApp messages.\nSTATUS: NEEDS_APPROVAL — send the 3 messages" }]) });
    expect(r).toMatchObject({ status: "waiting_approval", finishedAt: null });
    const again = await E.resumeJob(userId, j.id, "send them");
    expect(again.status).toBe("assigned");
    const seen: string[] = [];
    const r2 = await E.runJob(j.id, { runner: script(done("Sent after approval."), seen) });
    expect(r2!.status).toBe("completed");
    expect(seen[0]).toContain("The user approved: send them");
  });

  it("cancels an assigned job at once, and a running job at its next step (keeping what it had)", async () => {
    const a = await E.createJob(userId, { agent: "ev", title: "cancel me", request: "x", brief });
    expect((await E.cancelJob(userId, a.id)).job.status).toBe("cancelled");
    expect(await E.runJob(a.id, { runner: script(done("x")) })).toBeNull();

    const b = await E.createJob(userId, { agent: "darwin", title: "long search", request: "x", brief });
    let n = 0;
    const r = await E.runJob(b.id, { runner: script([
      { type: "text", delta: "Searching Indiranagar… " },
      { type: "tool", name: "t", status: "ok", summary: "page 1" },
      { type: "tool", name: "t", status: "ok", summary: "page 2" },
      { type: "done", text: "finished\nSTATUS: DONE" },
    ], [], async () => { if (++n === 1) await E.cancelJob(userId, b.id); }) });
    expect(r).toMatchObject({ status: "cancelled" });
    expect(r!.result).toContain("Searching Indiranagar");
    expect(await E.retryJob(userId, b.id)).toMatchObject({ status: "assigned", attempts: 0 });
  });

  it("runs dependent tasks in order, handing over results — and fails them when a prerequisite fails", async () => {
    const a = await E.createJob(userId, { agent: "darwin", title: "Verify the cafe", request: "x", brief });
    const b = await E.createJob(userId, { agent: "robin", title: "Outreach for the cafe", request: "x", brief, dependsOn: [a.id] });
    expect(await E.runnableJobs(userId)).not.toContain(b.id);
    const seen: string[] = [];
    let call = 0;
    const runner = async function* (input: AgentInput) { seen.push(input.message); call++; yield { type: "done", text: (input.message.includes("Verify the cafe") ? "Brew Lab: phone +91 98450 11111, no website" : "Draft ready") + "\nSTATUS: DONE" } as AgentEvent; };
    const ran = await E.runPending(userId, 60_000, { runner });
    expect(ran.indexOf(a.id)).toBeGreaterThanOrEqual(0);
    expect(ran.indexOf(b.id)).toBeGreaterThan(ran.indexOf(a.id));
    const bPrompt = seen.find((m) => m.includes("Outreach for the cafe"))!;
    expect(bPrompt).toContain("Results from earlier tasks");
    expect(bPrompt).toContain("Brew Lab: phone +91 98450 11111");

    const c = await E.createJob(userId, { agent: "darwin", title: "will fail", request: "x", brief });
    const d2 = await E.createJob(userId, { agent: "robin", title: "after the failure", request: "x", brief, dependsOn: [c.id] });
    await E.runJob(c.id, { runner: script([{ type: "done", text: "No key\nSTATUS: BLOCKED — no Geoapify key" }]) });
    await E.runnableJobs(userId);
    expect(await db().agentJob.findUnique({ where: { id: d2.id } })).toMatchObject({ status: "failed", error: expect.stringContaining("will fail") });
  });

  it("recovers after a restart: an expired lease runs again, until it has been interrupted too often", async () => {
    const j = await E.createJob(userId, { agent: "darwin", title: "interrupted", request: "x", brief });
    await db().agentJob.update({ where: { id: j.id }, data: { status: "running", attempts: 1, leaseUntil: new Date(Date.now() - 1000) } });
    await E.recoverStale();
    expect(await db().agentJob.findUnique({ where: { id: j.id } })).toMatchObject({ status: "assigned" });
    await db().agentJob.update({ where: { id: j.id }, data: { status: "running", attempts: E.MAX_ATTEMPTS, leaseUntil: new Date(Date.now() - 1000) } });
    await E.recoverStale();
    expect(await db().agentJob.findUnique({ where: { id: j.id } })).toMatchObject({ status: "failed" });
  });

  it("lists jobs and announces each finished one once", async () => {
    const list = await E.listJobs(userId, { status: "all" });
    expect(list.length).toBeGreaterThanOrEqual(6);
    const first = await E.unannounced(userId);
    expect(first.length).toBeGreaterThan(0);
    await E.markAnnounced(userId, first.map((x) => x.id));
    expect((await E.unannounced(userId)).map((x) => x.id)).not.toEqual(expect.arrayContaining(first.map((x) => x.id)));
  });
});
