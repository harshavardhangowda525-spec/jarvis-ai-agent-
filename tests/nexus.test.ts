import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";
import { diffJobs, type JobRow } from "@/lib/nexus/events";

describe("Nexus signals come only from real record changes", () => {
  const row = (status: string, steps: number, id = "j1"): JobRow => ({ id, agent: "darwin", title: "Find gyms", status, dependsOn: [], progress: Array.from({ length: steps }, (_, i) => ({ text: `step ${i + 1}` })), updatedAt: new Date().toISOString() });
  it("a baseline produces nothing visible; transitions and new steps do", () => {
    const prev = new Map();
    diffJobs(prev, [row("assigned", 1)]); // the baseline (stream start) — the caller discards these
    expect(diffJobs(prev, [row("assigned", 1)])).toEqual([]); // no change → no signal
    expect(diffJobs(prev, [row("running", 2)]).map((s) => s.kind)).toEqual(["dispatch"]);
    expect(diffJobs(prev, [row("running", 3)]).map((s) => [s.kind, s.text])).toEqual([["step", "step 3"]]);
    expect(diffJobs(prev, [row("waiting_approval", 4)])[0].kind).toBe("approval");
    expect(diffJobs(prev, [row("completed", 5)])[0].kind).toBe("return");
    expect(diffJobs(prev, [row("failed", 6, "j2")])[0].kind).toBe("fail");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("Nexus states and the Approval Center (integration)", () => {
  let userId = "";
  let S: typeof import("@/lib/nexus/status");
  let C: typeof import("@/lib/approvals/center");
  const saved = { g: env.groqApiKey, j: env.jarvisProvider, d: env.darwinProvider };
  const brief = { objective: "Find gyms without websites", expectedOutcome: "A list", context: [], requirements: [], constraints: [], acceptance: ["real leads"], approvals: [] };
  beforeAll(async () => {
    S = await import("@/lib/nexus/status"); C = await import("@/lib/approvals/center");
    userId = (await getDb().user.create({ data: { email: `nexus-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { Object.assign(env, { groqApiKey: saved.g, jarvisProvider: saved.j, darwinProvider: saved.d }); await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("an agent without a brain is offline; RUBEN is 'not reported', never invented", async () => {
    Object.assign(env, { groqApiKey: "", geminiApiKey: "" });
    const s = await S.agentStatuses(userId);
    expect(s.agents.find((a) => a.id === "darwin")!.state).toBe("offline");
    expect(s.agents.find((a) => a.id === "ruben")!.state).toBe("unknown");
  });

  it("derives states from real tasks: queued ≠ working, running with a live lease = working, approval, error", async () => {
    Object.assign(env, { groqApiKey: "gsk_test", darwinProvider: "groq", jarvisProvider: "groq" });
    const db = getDb();
    await db.agentJob.create({ data: { userId, agent: "darwin", title: "Find gyms", request: "r", brief, status: "assigned" } });
    let darwin = (await S.agentStatuses(userId)).agents.find((a) => a.id === "darwin")!;
    expect(darwin.state).toBe("ready");
    expect(darwin.reason).toBe("1 task queued");
    expect(darwin.capabilities.length).toBeGreaterThan(3);
    expect(darwin.capabilities.some((c) => c.tool === "darwin_message" && c.needsApproval)).toBe(true);
    await db.agentJob.updateMany({ where: { userId, agent: "darwin" }, data: { status: "running", leaseUntil: new Date(Date.now() + 60_000), startedAt: new Date() } });
    darwin = (await S.agentStatuses(userId)).agents.find((a) => a.id === "darwin")!;
    expect(darwin.state).toBe("working");
    expect(darwin.reason).toBe("Working on: Find gyms");
    await db.agentJob.updateMany({ where: { userId, agent: "darwin" }, data: { status: "waiting_approval", leaseUntil: null, progress: [{ at: new Date().toISOString(), text: "Waiting for your approval: send 3 emails", kind: "approval" }] } });
    darwin = (await S.agentStatuses(userId)).agents.find((a) => a.id === "darwin")!;
    expect(darwin.state).toBe("waiting_approval");
    await db.agentJob.create({ data: { userId, agent: "aston", title: "Demo site", request: "r", brief, status: "failed", error: "Claude bridge offline", finishedAt: new Date() } });
    const aston = (await S.agentStatuses(userId)).agents.find((a) => a.id === "aston")!;
    expect(aston.state).toBe("error");
    expect(aston.errors[0].error).toBe("Claude bridge offline");
  });

  it("the Approval Center lists what waits for you, and every decision is carried out and recorded", async () => {
    const db = getDb();
    let c = await C.listCenter(userId);
    const job = c.approvals.find((i) => i.kind === "job")!;
    expect(job.proposes).toBe("Waiting for your approval: send 3 emails");
    expect(c.attention.map((a) => a.title)).toEqual(["Demo site"]);
    // approve with changes → the task resumes with the note
    let r = await C.decide(userId, { kind: "job", id: job.id, decision: "revise", note: "only the first two" });
    expect(r.ok).toBe(true);
    const resumed = await db.agentJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(resumed.status).toBe("assigned");
    expect(JSON.stringify(resumed.brief)).toMatch(/only the first two/);
    // a second approve of the same item fails (it's no longer waiting) and that is recorded too
    r = await C.decide(userId, { kind: "job", id: job.id, decision: "approve" });
    expect(r.ok).toBe(false);
    // DARWIN draft: revise text, then reject — nothing sent
    const lead = await db.darwinLead.create({ data: { userId, businessName: "Iron Temple Gym", fingerprint: `f${Date.now()}`, email: "owner@example.com" } as never });
    const msg = await db.darwinMessage.create({ data: { userId, leadId: lead.id, channel: "email", subject: "Hi", body: "Hello there", status: "approval_required" } });
    c = await C.listCenter(userId);
    const draft = c.approvals.find((i) => i.kind === "darwin_message")!;
    expect(draft.actions).not.toContain("approve"); // Gmail isn't connected in tests — approve isn't offered
    expect(draft.effect).toMatch(/Gmail isn't connected/);
    expect((await C.decide(userId, { kind: "darwin_message", id: msg.id, decision: "revise", note: "Hello, a quick idea for your gym" })).ok).toBe(true);
    expect((await db.darwinMessage.findUniqueOrThrow({ where: { id: msg.id } })).body).toBe("Hello, a quick idea for your gym");
    expect((await C.decide(userId, { kind: "darwin_message", id: msg.id, decision: "reject" })).ok).toBe(true);
    expect((await db.darwinMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("rejected");
    // EVIE proposal from an intel item → approve creates a real task for the chosen agent
    const item = await db.intelItem.create({ data: { userId, urlHash: `h${Date.now()}`, url: "https://techcrunch.com/x", title: "Clinics adopt online booking", publisher: "TechCrunch", via: "rss", analysis: { recommendedAction: "Offer a booking site package to clinics.", opportunity: "Clinic booking sites" } } });
    const p = await C.propose(userId, { refKind: "intel_item", refId: item.id, agent: "darwin" });
    expect(await C.propose(userId, { refKind: "intel_item", refId: item.id, agent: "darwin" })).toMatchObject({ id: p.id }); // no duplicates
    expect((await C.listCenter(userId)).approvals.some((i) => i.kind === "proposal" && i.id === p.id)).toBe(true);
    r = await C.decide(userId, { kind: "proposal", id: p.id, decision: "approve" });
    expect(r.ok).toBe(true);
    const pr = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    const created = await db.agentJob.findUniqueOrThrow({ where: { id: pr.jobId! } });
    expect(created).toMatchObject({ agent: "darwin", status: "assigned", title: "Act on: Clinics adopt online booking" });
    expect(JSON.stringify(created.brief)).toMatch(/techcrunch\.com\/x/);
    const log = await db.approvalDecision.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(log.map((x) => [x.kind, x.decision, x.outcome])).toEqual([
      ["job", "revise", "ok"], ["job", "approve", "failed"], ["darwin_message", "revise", "ok"], ["darwin_message", "reject", "ok"], ["proposal", "approve", "ok"],
    ]);
  });
});
