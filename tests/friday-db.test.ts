import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, isDbConfigured } from "@/lib/db";

const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: who.id }) }));

/**
 * FRIDAY with real Blender: set FRIDAY_BLENDER to a Blender binary to run these
 * (they're skipped otherwise — nothing here is mocked).
 */
const blender = process.env.FRIDAY_BLENDER && fs.existsSync(process.env.FRIDAY_BLENDER);
const d = isDbConfigured && blender ? describe : describe.skip;
const glasses = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/friday-glasses.json"), "utf8"));

d("FRIDAY models, renders and versions with Blender (integration)", () => {
  let userId = "";
  let P: typeof import("@/lib/friday/projects");
  let plan: typeof import("@/lib/friday/plan");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "friday-"));
  const settings = { engine: "cycles" as const, width: 320, height: 240, samples: 8, gpu: false };
  beforeAll(async () => {
    process.env.FRIDAY_PROJECTS_DIR = root;
    P = await import("@/lib/friday/projects");
    plan = await import("@/lib/friday/plan");
    userId = (await getDb().user.create({ data: { email: `friday-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  let projectId = "";
  it("builds v001: .blend, GLB and ten verified renders, with manifest and metadata", async () => {
    const p = plan.planSchema.parse(glasses);
    const project = await P.findOrCreateProject(userId, "Edith Smart Glasses");
    projectId = project.id;
    const v = await P.newVersion(project, p, { change: "First concept" });
    const stages = new Set<string>();
    const { result } = await P.buildVersion(project, v, { settings, onProgress: (x) => stages.add(x.stage) });
    expect(stages.has("geometry") && stages.has("render")).toBe(true);
    const dir = path.join(root, "edith-smart-glasses", "versions", "v001");
    for (const f of ["model.blend", "model.glb", "plan.json", "manifest.json"]) expect(fs.existsSync(path.join(dir, f))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "model.glb")).subarray(0, 4).toString()).toBe("glTF");
    expect(result.renders.map((r) => r.view)).toEqual(plan.VIEW_IDS);
    for (const r of result.renders) expect(fs.statSync(path.join(dir, r.file)).size).toBeGreaterThan(1000);
    expect(result.exploded).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(root, "edith-smart-glasses", "project_metadata.json"), "utf8"));
    expect(meta.activeVersion).toBe(1);
    expect(meta.versions[0].folder).toBe("versions/v001");
  }, 600_000);

  it("v002 changes only a material colour — v001 is untouched, renders re-made where they changed", async () => {
    const project = (await getDb().fridayProject.findUnique({ where: { id: projectId } }))!;
    const v1 = (await getDb().fridayVersion.findUnique({ where: { projectId_n: { projectId, n: 1 } } }))!;
    const before = fs.readFileSync(path.join(root, "edith-smart-glasses", "versions", "v001", "renders", "front.png"));
    const p2 = plan.planSchema.parse({ ...glasses, materials: glasses.materials.map((m: { id: string }) => m.id === "frame" ? { ...m, color: "#8a1c1c" } : m) });
    const v2 = await P.newVersion(project, p2, { change: "Red frame", parentN: 1 });
    const { result } = await P.buildVersion(project, v2, { settings, reuseFrom: v1 });
    expect(result.renders).toHaveLength(10);
    expect(result.renders.every((r) => r.reused === null)).toBe(true); // the frame is in every view
    expect(fs.readFileSync(path.join(root, "edith-smart-glasses", "versions", "v001", "renders", "front.png")).equals(before)).toBe(true);
    const view = await P.projectView(userId, projectId);
    expect(view!.activeVersion).toBe(2);
    expect(view!.versions.map((v) => v.n)).toEqual([2, 1]);
  }, 600_000);

  it("v003 with the same model reuses every render instead of rendering again", async () => {
    const project = (await getDb().fridayProject.findUnique({ where: { id: projectId } }))!;
    const v2 = (await getDb().fridayVersion.findUnique({ where: { projectId_n: { projectId, n: 2 } } }))!;
    const p3 = plan.planSchema.parse({ ...(v2.plan as object), summary: "Same model, new note" });
    const v3 = await P.newVersion(project, p3, { change: "Saved as a named version", parentN: 2, label: "Review" });
    const { result } = await P.buildVersion(project, v3, { settings, reuseFrom: v2 });
    expect(result.renders.every((r) => r.reused === 2)).toBe(true);
  }, 600_000);

  it("serves files only to the owner, only inside the version folder", async () => {
    const F = await import("@/app/api/friday/files/[...path]/route");
    const project = (await getDb().fridayProject.findUnique({ where: { id: projectId } }))!;
    expect(P.safeProjectFile(project, 1, "../../../project_metadata.json")).toBeNull();
    const get = (parts: string[], q = "") => F.GET(new Request(`http://x/api/friday/files${q}`), { params: { path: parts } });
    who.id = userId;
    const ok = await get([projectId, "1", "model.glb"]);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("model/gltf-binary");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).toString()).toBe("glTF");
    const dl = await get([projectId, "1", "model.blend"], "?download=1");
    expect(dl.headers.get("content-disposition")).toMatch(/edith-smart-glasses-v001-model\.blend/);
    expect((await get([projectId, "1", "..", "..", "project_metadata.json"])).status).toBe(404);
    expect((await get([projectId, "1", "job.json"])).status).toBe(200); // inside the folder, a known type
    who.id = "someone-else";
    expect((await get([projectId, "1", "model.glb"])).status).toBe(404);
  });
});
