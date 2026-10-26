import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import type { AgentEvent } from "@/lib/ai/agent";
import { agentInstruction, agentsNamed } from "@/lib/agents/instruction";
import { displayState, planGroups, planOutcome, planSummary } from "@/components/agent-dock/state";

describe("commands addressed to agents", () => {
  it("finds the agents a sentence names, in order (Friday the day and 'mic' aren't agents unless addressed)", () => {
    expect(agentsNamed("JARVIS, ask Darwin to find 50 gyms in Bangalore without websites, then ask Ruben to prepare outreach scripts and tell Evie to create an Instagram promotional campaign"))
      .toEqual(["darwin", "robin", "ev"]);
    expect(agentsNamed("Make Darwin and Ruben work together on today's leads")).toEqual(["darwin", "robin"]);
    expect(agentsNamed("turn the mic on")).toEqual([]);
    expect(agentInstruction("Schedule the post for Friday", "friday")).toBeNull();
  });
  it("pulls out the instruction for one agent", () => {
    expect(agentInstruction("Activate Darwin and find 30 salons without websites", "darwin")).toBe("Find 30 salons without websites");
    expect(agentInstruction("Ask Evie to create three promotional concepts.", "ev")).toBe("Create three promotional concepts");
    expect(agentInstruction("Tell Aston to build a demo website for this prospect", "aston")).toBe("Build a demo website for this prospect");
    expect(agentInstruction("Get Ruben to prepare a follow-up message", "robin")).toBe("Prepare a follow-up message");
    expect(agentInstruction("hey jarvis, Darwin: verify the gyms from today", "darwin")).toBe("Verify the gyms from today");
    expect(agentInstruction("open Darwin", "darwin")).toBeNull();
    expect(agentInstruction("activate Darwin and take over", "darwin")).toBeNull();
    expect(agentInstruction("Stop the task running in Evie's window", "ev")).toBeNull();
  });
});

describe("agent window states and plans", () => {
  const t = (id: string, status: string, createdAt: string, dependsOn: string[] = []) => ({ id, status, createdAt, dependsOn, agentName: id.toUpperCase(), title: `task ${id}`, result: status === "completed" ? "Found 12 gyms. STATUS" : null, error: status === "failed" ? "Geoapify quota exhausted" : null });
  it("shows 'waiting for dependency' only while a needed task hasn't completed", () => {
    const st: Record<string, string> = { a: "running" };
    expect(displayState({ status: "assigned", dependsOn: ["a"] }, (id) => st[id])).toBe("waiting_dependency");
    st.a = "completed";
    expect(displayState({ status: "assigned", dependsOn: ["a"] }, (id) => st[id])).toBe("queued");
    expect(displayState({ status: "waiting_approval", dependsOn: [] }, () => undefined)).toBe("waiting_approval");
  });
  it("groups one request's tasks (dependencies or dispatched together) and reports the plan honestly", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 26, 10, 0, s)).toISOString();
    const groups = planGroups([t("d", "completed", at(0)), t("r", "failed", at(5), ["d"]), t("e", "completed", at(6)), t("later", "completed", new Date(Date.UTC(2026, 9, 26, 12)).toISOString())]);
    expect(groups).toEqual([["d", "r", "e"]]);
    expect(planOutcome(["completed", "running"])).toBeNull();
    expect(planOutcome(["completed", "failed"])).toBe("partial");
    expect(planOutcome(["completed", "completed"])).toBe("completed");
    expect(planOutcome(["failed", "cancelled"])).toBe("failed");
    const s = planSummary([t("d", "completed", at(0)), t("r", "failed", at(5), ["d"])])!;
    expect(s).toMatch(/^The plan is partially complete: 1 of 2 tasks finished\./);
    expect(s).toContain("- R · task r: failed — Geoapify quota exhausted");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("tasks from agent windows (integration)", () => {
  let userId = "";
  let E: typeof import("@/lib/jobs/engine");
  let D: typeof import("@/lib/jobs/dispatch");
  const db = () => getDb();
  beforeAll(async () => {
    E = await import("@/lib/jobs/engine"); D = await import("@/lib/jobs/dispatch");
    userId = (await db().user.create({ data: { email: `dock-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await db().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("an instruction typed into a window becomes a real tracked task with dependencies", async () => {
    const a = await D.dispatchTask(userId, { agent: "darwin", title: "Find gyms", request: "Find 5 gyms", brief: D.quickBrief("Find 5 gyms") });
    const b = await D.dispatchTask(userId, { agent: "robin", title: "Outreach scripts", request: "Prepare outreach scripts", brief: D.quickBrief("Prepare outreach scripts"), dependsOn: [a.job.id] });
    expect(a.job.status).toBe("assigned");
    expect(b.job.dependsOn).toEqual([a.job.id]);
    // RUBIN can't start before DARWIN completes
    expect(await E.runnableJobs(userId)).toEqual([a.job.id]);
    await expect(D.dispatchTask(userId, { agent: "ev", title: "x", request: "x", brief: D.quickBrief("x y z"), dependsOn: ["nope"] })).rejects.toThrow(/doesn't exist/);
  });

  it("a website for ASTON goes to the studio and still waits for its dependency", async () => {
    const dep = await D.dispatchTask(userId, { agent: "darwin", title: "Lead", request: "Find a café", brief: D.quickBrief("Find a café") });
    const w = await D.dispatchTask(userId, { agent: "aston", title: "Site", request: "Build a website for the café DARWIN finds", brief: D.quickBrief("Build a website"), dependsOn: [dep.job.id] });
    expect(w.studio).toMatch(/^\/dashboard\/aston\/studio\?project=/);
    expect((w.job.payload as { mode?: string }).mode).toBe("studio");
    expect(w.job.dependsOn).toEqual([dep.job.id]);
  });

  it("shows what the agent is writing while it runs, and retries a recoverable failure a bounded number of times", async () => {
    const j = await D.dispatchTask(userId, { agent: "mike", title: "Scan", request: "Scan NIFTY", brief: D.quickBrief("Scan NIFTY") });
    let seenLive: string | null = null;
    const writing = async function* () {
      yield { type: "text", delta: "Looking at the daily chart…" } as AgentEvent;
      await new Promise((r) => setTimeout(r, 2700));
      yield { type: "text", delta: " still going" } as AgentEvent;
      seenLive = (await db().agentJob.findUnique({ where: { id: j.job.id } }))!.liveText;
      yield { type: "error", message: "fetch failed (ECONNRESET)" } as AgentEvent;
    };
    let r = await E.runJob(j.job.id, { runner: writing as never });
    expect(seenLive).toContain("Looking at the daily chart");
    expect(r!.status).toBe("assigned"); // recoverable → queued again
    expect(r!.liveText).toBeNull();
    expect(JSON.stringify(r!.progress)).toContain("trying again, attempt 2 of 3");
    const failing = async function* () { yield { type: "error", message: "fetch failed (ECONNRESET)" } as AgentEvent; };
    r = await E.runJob(j.job.id, { runner: failing as never });
    expect(r!.status).toBe("assigned");
    r = await E.runJob(j.job.id, { runner: failing as never });
    expect(r!.status).toBe("failed"); // third attempt: reported, not retried forever
    expect(r!.attempts).toBe(3);

    // a real problem isn't retried
    const k = await D.dispatchTask(userId, { agent: "mike", title: "Scan 2", request: "Scan BANKNIFTY", brief: D.quickBrief("Scan BANKNIFTY") });
    const blocked = async function* () { yield { type: "done", text: "No data.\nSTATUS: BLOCKED — the market data key isn't set" } as AgentEvent; };
    r = await E.runJob(k.job.id, { runner: blocked as never });
    expect(r!.status).toBe("failed");
    expect(r!.attempts).toBe(1);
  });
});
