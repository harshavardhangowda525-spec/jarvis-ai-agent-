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
