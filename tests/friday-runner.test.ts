import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, isDbConfigured } from "@/lib/db";
import type { AgentEvent } from "@/lib/ai/agent";
import type { FridayAsk } from "@/lib/friday/runner";

/** Friday's whole task with real Blender: brain plan → repair → build → verified version → edit → cancel. */
const blender = process.env.FRIDAY_BLENDER && fs.existsSync(process.env.FRIDAY_BLENDER);
const d = isDbConfigured && blender ? describe : describe.skip;
const glasses = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/friday-glasses.json"), "utf8"));
const settings = { engine: "cycles" as const, width: 320, height: 240, samples: 6, gpu: false };

d("FRIDAY's task runner (integration)", () => {
  let userId = "";
  let S: typeof import("@/lib/friday/service");
  let R: typeof import("@/lib/friday/runner");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "friday-run-"));
  beforeAll(async () => {
    process.env.FRIDAY_PROJECTS_DIR = root;
    S = await import("@/lib/friday/service");
    R = await import("@/lib/friday/runner");
    userId = (await getDb().user.create({ data: { email: `friday-run-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await getDb().note.create({ data: { userId, title: "EDITH smart glasses", content: "EDITH glasses spec: overall frame width 140 mm, matte black acetate frame, camera on the left hinge." } });
    await getDb().memory.create({ data: { userId, content: "EDITH was the old name of ULTRON, the PC control agent on my desktop." } });
  });
  afterAll(async () => {
    await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = async (job: Parameters<typeof R.fridayRunner>[0], ask: FridayAsk | undefined) => {
    const evs: AgentEvent[] = [];
    for await (const e of R.fridayRunner(job, { ask, settings })({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: null, history: [], message: "" })) evs.push(e);
    return evs;
  };

  it("finds the glasses note (not the ULTRON memory) and keeps the real spec separate", async () => {
    const s = await R.gatherSpecs(userId, "Model the EDITH smart glasses");
    expect(s.sources).toEqual(["note: EDITH smart glasses"]);
    expect(s.lines[0]).toMatch(/140 mm/);
  });

  let projectId = "";
  it("create: a bad first plan is repaired, Blender builds it, version 1 is verified", async () => {
    const job = await S.requestFriday(userId, { action: "create", request: "Model the EDITH smart glasses from my notes", name: "EDITH Smart Glasses" });
    expect(job.agent).toBe("friday");
    const prompts: string[] = [];
    const replies = [JSON.stringify({ ...glasses, materials: [] }), JSON.stringify(glasses)];
    // a brain that streams its answer, as Claude does
    const evs = await run(job, async (_s: string, u: string, onDelta?: (t: string) => void) => { prompts.push(u); const r = replies.shift()!; for (let i = 0; i < r.length; i += 40) onDelta?.(r.slice(i, i + 40)); return r; });
    // the live view saw the whole preparation
    const L = await import("@/lib/friday/live");
    const { snapshot: live, close } = L.subscribeFriday(job.id, () => {});
    close();
    expect(live.stages).toEqual(expect.arrayContaining(["specs", "plan", "materials", "geometry", "modifiers", "validate", "lighting", "cameras", "save", "export", "render", "verify", "done"]));
    expect(live.stage?.stage).toBe("done");
    expect(JSON.parse(live.plan).components).toHaveLength(glasses.components.length); // the corrected plan, streamed (the rejected one was reset)
    expect(live.materials.map((m) => m.id)).toEqual(glasses.materials.map((m: { id: string }) => m.id));
    expect(live.parts).toHaveLength(glasses.components.length);
    expect(live.parts.every((p) => p.status === "built" && typeof p.faces === "number")).toBe(true);
    expect(live.parts.find((p) => p.id === "rim_cut")?.cutter).toBe(true);
    expect(live.model).toMatch(/\/api\/friday\/files\/.+\/1\/model\.glb/);
    expect(live.renders.map((r) => r.view).sort()).toEqual([...(await import("@/lib/friday/plan")).VIEW_IDS].sort());
    expect(live.renders.every((r) => /renders\/.+\.png/.test(r.url) && r.seconds != null)).toBe(true);
    expect(live.log.some((l) => /didn't check out/.test(l.text))).toBe(true);
    expect(live.log.some((l) => /^Built Lens rim/.test(l.text))).toBe(true);
    expect(live.result?.ok).toBe(true);
    expect(prompts[0]).toMatch(/overall frame width 140 mm/);
    expect(prompts[0]).not.toMatch(/ULTRON/);
    expect(prompts[1]).toMatch(/couldn't be used: materials/);
    const done = evs.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }>;
    expect(done?.text).toMatch(/EDITH Smart Glasses — version 1/);
    expect(done.text).toMatch(/STATUS: DONE/);
    expect(done.text).toMatch(/not an engineering-ready/);
    const tools = evs.filter((e) => e.type === "tool").map((e) => (e as { summary: string }).summary);
    expect(tools.filter((t) => /^Rendered view/.test(t))).toHaveLength(10);
    expect(tools.some((t) => /Found specs in your note: EDITH smart glasses/.test(t))).toBe(true);
    const art = evs.find((e) => e.type === "artifact") as Extract<AgentEvent, { type: "artifact"; kind: "friday" }>;
    projectId = art.projectId;
    const v = await getDb().fridayVersion.findUnique({ where: { projectId_n: { projectId, n: 1 } } });
    expect(v?.status).toBe("ready");
  }, 600_000);

  it("edit: a material change becomes version 2 from version 1's plan", async () => {
    const job = await S.requestFriday(userId, { action: "edit", change: "Make the lenses amber" });
    let seen = "";
    const evs = await run(job, async (_s: string, u: string) => { seen = u; return JSON.stringify({ ...glasses, materials: glasses.materials.map((m: { id: string }) => m.id === "lens" ? { ...m, color: "#c47a12" } : m) }); });
    expect(seen).toMatch(/CURRENT PLAN/);
    expect(seen).toMatch(/Make the lenses amber/);
    expect((evs.find((e) => e.type === "done") as { text: string }).text).toMatch(/version 2/);
    const p = (await getDb().fridayProject.findUnique({ where: { id: projectId } }))!;
    expect(p.activeVersion).toBe(2);
    expect(p.name).toBe("EDITH Smart Glasses");
  }, 600_000);

  it("render: re-renders just the top view of version 2", async () => {
    const job = await S.requestFriday(userId, { action: "render", views: ["top"] });
    const evs = await run(job, undefined);
    expect((evs.find((e) => e.type === "done") as { text: string }).text).toMatch(/Re-rendered Top/);
    expect(evs.filter((e) => e.type === "tool" && /^Rendered view/.test((e as { summary: string }).summary))).toHaveLength(1);
  }, 600_000);

  it("cancel: a cancelled task stops Blender and the version is marked failed", async () => {
    const job = await S.requestFriday(userId, { action: "edit", change: "Thicker temples" });
    await getDb().agentJob.update({ where: { id: job.id }, data: { cancelRequested: true } });
    const evs = await run(job, async () => { await new Promise((r) => setTimeout(r, 2500)); return JSON.stringify(glasses); });
    const text = evs.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toMatch(/Cancelled/);
    const v3 = await getDb().fridayVersion.findUnique({ where: { projectId_n: { projectId, n: 3 } } });
    expect(v3?.status).toBe("failed");
    expect((await getDb().fridayProject.findUnique({ where: { id: projectId } }))!.activeVersion).toBe(2);
  }, 120_000);
});
