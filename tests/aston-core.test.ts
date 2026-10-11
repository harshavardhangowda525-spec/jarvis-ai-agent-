import { describe, it, expect } from "vitest";
import { coreState, defaultLine, greeting, wakeIntent, clamp01 } from "@/lib/aston/core-state";
import { coreGeometry } from "@/components/aston/core/geometry";

describe("ASTON core state", () => {
  const base = { mode: "idle" as const, executing: false, fault: false, attention: false };

  it("is idle with nothing going on", () => {
    expect(coreState(base)).toBe("idle");
  });

  it("what you're doing now beats background status", () => {
    expect(coreState({ ...base, mode: "listening", fault: true, attention: true, executing: true })).toBe("listening");
    expect(coreState({ ...base, mode: "speaking", attention: true })).toBe("speaking");
    expect(coreState({ ...base, mode: "processing", executing: true })).toBe("processing");
  });

  it("a running task beats a fault; a fault beats open alerts", () => {
    expect(coreState({ ...base, executing: true, fault: true })).toBe("executing");
    expect(coreState({ ...base, fault: true, attention: true })).toBe("error");
    expect(coreState({ ...base, attention: true })).toBe("attention");
  });

  it("greets by the local time of day", () => {
    expect(greeting(8)).toBe("Good morning. How may I assist?");
    expect(greeting(14)).toBe("Good afternoon. How may I assist?");
    expect(greeting(21)).toBe("Good evening. How may I assist?");
    expect(greeting(2)).toBe("Good evening. How may I assist?");
  });

  it("shows a line per state", () => {
    expect(defaultLine("listening", 9)).toBe("Listening for your command…");
    expect(defaultLine("processing", 9)).toBe("Analyzing your request…");
    expect(defaultLine("executing", 9)).toBe("Executing workflow…");
    expect(defaultLine("idle", 15)).toBe("Good afternoon. How may I assist?");
  });

  it("clamps progress, keeping null for indeterminate tasks", () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(null)).toBeNull();
    expect(clamp01(Number.NaN)).toBeNull();
  });
});

describe("ASTON wake word", () => {
  it("ignores anything that doesn't start with ASTON", () => {
    expect(wakeIntent("build me a website")).toBeNull();
    expect(wakeIntent("I told Aston about it")).toBeNull();
    expect(wakeIntent("")).toBeNull();
  });

  it("a bare ASTON (or a hello) waits for the command", () => {
    expect(wakeIntent("ASTON")).toEqual({ kind: "wake" });
    expect(wakeIntent("Hey Aston")).toEqual({ kind: "wake" });
    expect(wakeIntent("aston, hello")).toEqual({ kind: "wake" });
  });

  it("ASTON + a phrase is a command, including common mis-hearings", () => {
    expect(wakeIntent("ASTON, build a website for a café")).toEqual({ kind: "command", text: "build a website for a café" });
    expect(wakeIntent("Austin what's the status")).toEqual({ kind: "command", text: "what's the status" });
    expect(wakeIntent("ok Ashton open the teleprompter")).toEqual({ kind: "command", text: "open the teleprompter" });
  });
});

describe("ASTON core geometry", () => {
  it("keeps the core and its rings on a phone screen", () => {
    const g = coreGeometry(412, 915);
    expect(g.cx).toBe(206);
    expect(g.u * 2).toBeLessThanOrEqual(412);
    expect(g.cy - g.u).toBeGreaterThan(80); // below the wordmark
    expect(g.cy + g.u * 1.06 + 90).toBeLessThan(915 - 80); // the status line clears the command bar
  });

  it("leaves room for the status line and command bar on a laptop", () => {
    const g = coreGeometry(1440, 900);
    expect(g.cy + g.u * 1.06 + 60).toBeLessThan(900 - 80);
    expect(g.cy - g.u).toBeGreaterThan(70);
  });

  it("fits short landscape phones", () => {
    const g = coreGeometry(844, 390);
    expect(g.cy + g.u).toBeLessThan(390 - 80);
    expect(g.u).toBeGreaterThanOrEqual(60);
  });
});
