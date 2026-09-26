import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { parsePowerIntent, parseConfirmation, spokenDelay } from "@/lib/power-command";
// @ts-expect-error — plain ESM from the local runtime
import { powerPlan, clampDelay, powerEnabled, doPower } from "../edith/src/power.mjs";

describe("laptop power commands", () => {
  it.each([
    ["jarvis shutdown my laptop", 30],
    ["shut down my laptop", 30],
    ["Shut down the computer in 5 minutes", 300],
    ["turn off my PC", 30],
    ["power off the laptop after 45 seconds", 45],
    ["switch off this machine in 2 hours", 3600],
    ["my laptop shut down now", 30],
  ])("%s → shutdown", (text, delay) => {
    expect(parsePowerIntent(text)).toEqual({ kind: "shutdown", delaySec: delay });
  });

  it.each(["shut down EV", "power down", "go to sleep", "turn off the lights", "close ULTRON", "what's my laptop's battery"])(
    "%s → not a laptop shutdown", (text) => { expect(parsePowerIntent(text)).toBeNull(); },
  );

  it("cancel wording", () => {
    for (const t of ["cancel shutdown", "cancel the shutdown", "abort shutdown", "stop the shutdown", "don't shut down", "shutdown cancel"]) {
      expect(parsePowerIntent(t)).toEqual({ kind: "cancel" });
    }
  });

  it("reads a spoken yes / no", () => {
    expect(parseConfirmation("Yes")).toBe(true);
    expect(parseConfirmation("yeah, do it")).toBe(true);
    expect(parseConfirmation("Jarvis, go ahead.")).toBe(true);
    expect(parseConfirmation("no")).toBe(false);
    expect(parseConfirmation("never mind")).toBe(false);
    expect(parseConfirmation("what's the weather")).toBeNull();
    expect(spokenDelay(30)).toBe("30 seconds");
    expect(spokenDelay(300)).toBe("5 minutes");
    expect(spokenDelay(3600)).toBe("1 hour");
  });
});

describe("ULTRON power module", () => {
  it("uses the OS's own shutdown with a cancellable delay", () => {
    expect(powerPlan("shutdown", 30, "win32")).toMatchObject({ file: "shutdown", when: "now", delay: 30 });
    expect(powerPlan("shutdown", 30, "win32").args.slice(0, 3)).toEqual(["/s", "/t", "30"]);
    expect(powerPlan("cancel", 0, "win32")).toMatchObject({ file: "shutdown", args: ["/a"] });
    expect(powerPlan("shutdown", 30, "darwin")).toMatchObject({ file: "osascript", when: "after" });
    expect(powerPlan("shutdown", 30, "linux")).toMatchObject({ file: "systemctl", args: ["poweroff"], when: "after" });
  });
  it("never goes below 10 seconds (time to cancel) or above an hour", () => {
    expect(clampDelay(0)).toBe(10);
    expect(clampDelay(99999)).toBe(3600);
    expect(clampDelay("x")).toBe(30);
  });
  it("can be switched off on the computer", async () => {
    expect(powerEnabled({ ULTRON_POWER: "off" })).toBe(false);
    expect(powerEnabled({})).toBe(true);
  });
  it("schedules and cancels without running anything (non-Windows timer)", async () => {
    if (process.platform === "win32") return;
    expect(await doPower("cancel")).toMatchObject({ ok: false, message: "There's no shutdown pending." });
    const r = await doPower("shutdown", 3600);
    expect(r.ok).toBe(true);
    expect(await doPower("shutdown", 3600)).toMatchObject({ ok: false, message: "A shutdown is already scheduled." });
    expect(await doPower("cancel")).toEqual({ ok: true, message: "Shutdown cancelled." });
    expect(await doPower("reboot" as string)).toMatchObject({ ok: false });
  });
});

describe("ULTRON /power endpoint", () => {
  let server: any; let token = ""; const port = 7400 + Math.floor(Math.random() * 15);
  beforeAll(async () => {
    process.env.ULTRON_TOKEN = "power-test-token";
    process.env.ULTRON_POWER = "off"; // the endpoint must never power off the test machine
    // @ts-expect-error — plain ESM
    const { startServer } = await import("../edith/src/server.mjs");
    // @ts-expect-error — plain ESM
    const { Workspace } = await import("../edith/src/workspace.mjs");
    const ws = new Workspace(path.join(os.tmpdir(), `ultron-power-${Date.now()}`));
    server = startServer({ port, ws });
    token = server.token;
    await new Promise((r) => setTimeout(r, 300));
  });
  afterAll(() => { server?.httpServer?.close(); server?.wss?.close(); delete process.env.ULTRON_POWER; delete process.env.ULTRON_TOKEN; });

  const post = (headers: Record<string, string>, body = { action: "shutdown", delaySec: 30 }) =>
    fetch(`http://127.0.0.1:${port}/power`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("refuses without the pairing token", async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: "Bearer wrong" })).status).toBe(401);
  });
  it("refuses pages from other websites", async () => {
    expect((await post({ Authorization: `Bearer ${token}`, Origin: "https://evil.example.com" })).status).toBe(403);
  });
  it("paired requests reach the power module (turned off here)", async () => {
    const r = await post({ Authorization: `Bearer ${token}`, Origin: "http://localhost:3000" });
    expect(r.status).toBe(409);
    expect((await r.json()).message).toMatch(/turned off/);
  });
});
