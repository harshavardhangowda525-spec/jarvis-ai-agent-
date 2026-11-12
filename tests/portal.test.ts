import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { progressOf, pickProject, portalUrl } from "@/lib/portal/service";
import { describeEvent } from "@/lib/portal/watch";

describe("Client Portal (pure)", () => {
  it("progress is the weighted share of completed milestones (the portal's formula)", () => {
    expect(progressOf([{ status: "completed", weight: 2 }, { status: "in_progress", weight: 2 }])).toBe(50);
    expect(progressOf([{ status: "completed", weight: 1 }, { status: "not_started", weight: 3 }])).toBe(25);
    expect(progressOf([])).toBe(0);
  });
  it("finds a project by project, business or owner name, and asks when it's ambiguous", () => {
    const ps = [
      { name: "FitZone website", client: "FitZone Gym", owner: "Ravi" },
      { name: "Bloom app", client: "Bloom Coaching", owner: "Meera" },
      { name: "Bloom website", client: "Bloom Coaching", owner: "Meera" },
    ];
    expect(pickProject("fitzone", ps)).toMatchObject({ name: "FitZone website" });
    expect(pickProject("Ravi", ps)).toMatchObject({ client: "FitZone Gym" });
    expect(pickProject("bloom app", ps)).toMatchObject({ name: "Bloom app" });
    expect(Array.isArray(pickProject("bloom", ps))).toBe(true);
    expect(pickProject("nobody", ps)).toBeNull();
  });
  it("is only connected with a connection string, and describes what came in", () => {
    expect(portalUrl({} as NodeJS.ProcessEnv)).toBeNull();
    expect(portalUrl({ CLIENT_PORTAL_DATABASE_URL: " postgres://x " } as unknown as NodeJS.ProcessEnv)).toBe("postgres://x");
    expect(describeEvent({ ref: "comment:1", kind: "message", project: "FitZone website", client: "FitZone Gym", text: "Ravi: can we change the colour?", at: new Date() }))
      .toEqual({ action: "Client message — FitZone Gym · FitZone website", result: "Ravi: can we change the colour?" });
  });
});

describe("looking at the screen (pure)", () => {
  it("turns the vision AI's box (0–1000) into screenshot pixels, or takes plain x/y", async () => {
    const { parseLook } = await import("@/lib/desktop/look");
    expect(parseLook('{"found":true,"box":[40,940,90,980],"note":"phone icon"}', { w: 1366, h: 768 })).toEqual({ found: true, x: 1311, y: 50, answer: null, note: "phone icon" });
    expect(parseLook('sure {"found":true,"x":100,"y":5000}', { w: 1366, h: 768 })).toMatchObject({ found: true, x: 100, y: 767 });
    expect(parseLook('{"found":false,"answer":true}', { w: 1366, h: 768 })).toEqual({ found: false, x: null, y: null, answer: true, note: null });
    expect(parseLook("garbage", { w: 1366, h: 768 }).found).toBe(false);
  });
});

describe("seeing the screen when a Gemini model is overloaded", () => {
  it("has backup Gemini models, or yours from GEMINI_VISION_MODELS", async () => {
    const { geminiBackups } = await import("@/lib/desktop/service");
    expect(geminiBackups({} as NodeJS.ProcessEnv)[0]).toBe("gemini-flash-latest");
    expect(geminiBackups({ GEMINI_VISION_MODELS: "a, b" } as unknown as NodeJS.ProcessEnv)).toEqual(["a", "b"]);
  });
});
