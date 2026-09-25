import { describe, expect, it } from "vitest";
import { brandDna, compact, formatFromText, formatOfKind, liveStage, stageOfItem, studioPipeline } from "@/lib/ev/studio";

describe("EV studio pipeline", () => {
  it("places stored content on the pipeline by its real status", () => {
    expect(stageOfItem({ kind: "idea", status: "draft", hasMedia: false })).toBe("IDEA");
    expect(stageOfItem({ kind: "reel", status: "draft", hasMedia: false })).toBe("SCRIPT");
    expect(stageOfItem({ kind: "post", status: "draft", hasMedia: true })).toBe("CREATIVE");
    expect(stageOfItem({ kind: "post", status: "ready", hasMedia: true })).toBe("REVIEW");
    expect(stageOfItem({ kind: "post", status: "scheduled", hasMedia: true })).toBe("APPROVED");
    expect(stageOfItem({ kind: "post", status: "published", hasMedia: true })).toBe("PUBLISHED");
    expect(stageOfItem({ kind: "post", status: "rejected", hasMedia: false })).toBeNull();
  });

  it("counts every stage, leaving rejected / failed pieces out", () => {
    const c = studioPipeline([
      { kind: "idea", status: "draft", hasMedia: false },
      { kind: "post", status: "published", hasMedia: true },
      { kind: "post", status: "published", hasMedia: true },
      { kind: "ad", status: "failed", hasMedia: false },
    ]);
    expect(c).toEqual({ IDEA: 1, SCRIPT: 0, CREATIVE: 0, REVIEW: 0, APPROVED: 0, PUBLISHED: 2 });
  });

  it("derives the on-screen creative's stage from EV's live state", () => {
    expect(liveStage("IDLE", { hasMedia: false, publish: "idle" })).toBeNull();
    expect(liveStage("THINKING", { hasMedia: false, publish: "idle" })).toBe("SCRIPT");
    expect(liveStage("GENERATING", { hasMedia: false, publish: "idle" })).toBe("CREATIVE");
    expect(liveStage("IDLE", { hasMedia: true, publish: "idle" })).toBe("REVIEW");
    expect(liveStage("IDLE", { hasMedia: true, publish: "publishing" })).toBe("APPROVED");
    expect(liveStage("SUCCESS", { hasMedia: true, publish: "done" })).toBe("PUBLISHED");
  });
});

describe("EV studio formats", () => {
  it("reads the canvas format from a command", () => {
    expect(formatFromText("Create a reel concept for gyms")).toBe("reel");
    expect(formatFromText("Generate a promo video")).toBe("reel");
    expect(formatFromText("Plan a cafe weekend campaign")).toBe("campaign");
    expect(formatFromText("Make a gym promo post image")).toBe("post");
    expect(formatFromText("run a promo for salons")).toBe("ad");
    expect(formatFromText("instagram story for clinics")).toBe("story");
    expect(formatFromText("how are we doing?")).toBeNull();
  });

  it("maps stored kinds to a canvas shape", () => {
    expect(formatOfKind("reel")).toBe("reel");
    expect(formatOfKind("website")).toBe("product");
    expect(formatOfKind("hook")).toBe("typography");
    expect(formatOfKind("educational")).toBe("post");
  });
});

describe("EV brand DNA", () => {
  it("summarises only what EV has stored, with configured brand facts", () => {
    const dna = brandDna([
      { kind: "reel", status: "published", niche: "gyms", theme: "transformations" },
      { kind: "reel", status: "draft", niche: "gyms", theme: null },
      { kind: "campaign", status: "approved", niche: "cafes", theme: "weekend footfall" },
    ]);
    const v = Object.fromEntries(dna.map((n) => [n.key, n.value]));
    expect(v.style).toBe("Reels · Campaigns");
    expect(v.audience).toBe("gyms · cafes");
    expect(v.themes).toContain("transformations");
    expect(v.campaigns).toBe("1 published · 1 campaign");
    expect(v.tone).toMatch(/Confident/);
  });

  it("says so when there's nothing yet instead of inventing", () => {
    const v = Object.fromEntries(brandDna([]).map((n) => [n.key, n.value]));
    expect(v.style).toBe("—");
    expect(v.themes).toBe("—");
    expect(v.audience).toMatch(/^Targets: /);
    expect(v.campaigns).toBe("0 published · 0 campaigns");
  });

  it("compacts real numbers and marks missing ones", () => {
    expect(compact(950)).toBe("950");
    expect(compact(1234)).toBe("1.2K");
    expect(compact(25_000)).toBe("25K");
    expect(compact(null)).toBe("—");
  });
});
