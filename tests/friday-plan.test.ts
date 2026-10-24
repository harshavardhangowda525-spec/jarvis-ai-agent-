import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planSchema, hasExplodedParts, VIEW_IDS } from "@/lib/friday/plan";
import { runBlender, BlenderMissing, renderSettings } from "@/lib/friday/blender";
import { viewHash, slugify } from "@/lib/friday/projects";

const glasses = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/friday-glasses.json"), "utf8"));

describe("Friday's plan", () => {
  it("accepts the glasses concept and fills defaults", () => {
    const p = planSchema.parse(glasses);
    expect(p.components.length).toBe(11);
    expect(hasExplodedParts(p)).toBe(true);
    expect(VIEW_IDS).toHaveLength(10);
  });
  it("rejects unknown materials, non-cutter subtraction, duplicates and an unknown detail part", () => {
    const bad = structuredClone(glasses);
    bad.components[0].material = "nope";
    bad.components[1].cutter = false;
    bad.components.push({ ...bad.components[2] });
    bad.detail = "ghost";
    const r = planSchema.safeParse(bad);
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs.some((m) => /unknown material/.test(m))).toBe(true);
    expect(msgs.some((m) => /must have cutter: true/.test(m))).toBe(true);
    expect(msgs.some((m) => /duplicate component id/.test(m))).toBe(true);
    expect(msgs.some((m) => /unknown component "ghost"/.test(m))).toBe(true);
  });
  it("a render's cache key ignores the wording but not the model", () => {
    const p = planSchema.parse(glasses);
    const s = renderSettings({ width: 320, height: 240 });
    expect(viewHash({ ...p, summary: "other words" }, s, "front")).toBe(viewHash(p, s, "front"));
    expect(viewHash({ ...p, environment: "white" }, s, "front")).not.toBe(viewHash(p, s, "front"));
    expect(viewHash(p, s, "top")).not.toBe(viewHash(p, s, "front"));
  });
  it("slugs project names safely", () => {
    expect(slugify("EDITH Smart Glasses — v2!")).toBe("edith-smart-glasses-v2");
    expect(slugify("../../")).toBe("project");
  });
});

describe("without Blender", () => {
  const saved = { b: process.env.FRIDAY_BLENDER, p: process.env.PATH };
  afterEach(() => { process.env.FRIDAY_BLENDER = saved.b; process.env.PATH = saved.p; });
  it("says so honestly and how to install it", async () => {
    if (fs.existsSync("/usr/bin/blender") || fs.existsSync("/snap/bin/blender")) return;
    delete process.env.FRIDAY_BLENDER;
    process.env.PATH = "/nonexistent";
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "friday-none-"));
    await expect(runBlender({ plan: planSchema.parse(glasses), outDir: out, views: ["front"], render: renderSettings(), exports: ["glb"], saveBlend: true })).rejects.toBeInstanceOf(BlenderMissing);
    await expect(runBlender({ plan: planSchema.parse(glasses), outDir: out, views: ["front"], render: renderSettings(), exports: ["glb"], saveBlend: true })).rejects.toThrow(/Blender isn't installed/);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
