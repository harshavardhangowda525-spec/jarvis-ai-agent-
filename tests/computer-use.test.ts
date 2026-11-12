import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDb, isDbConfigured } from "@/lib/db";
import { parseStep, stepPrompt, type UiElement } from "@/lib/desktop/act";

import { createComputer } from "../operator/src/desktop/computer.mjs";

const screen = { w: 1366, h: 768 };
const els: UiElement[] = [
  { id: 1, name: "Search", role: "Edit", x: 100, y: 50, w: 200, h: 30 },
  { id: 2, name: "Send", role: "Button", x: 900, y: 700, w: 80, h: 30 },
  { id: 3, name: "Password", role: "Edit", x: 100, y: 200, w: 200, h: 30, password: true },
];

describe("computer use: the safe-step rules", () => {
  it("clicks an element by its centre and clamps raw coordinates to the screen", () => {
    const s = parseStep('{"action":"click","element":1,"say":"Opening search"}', els, screen);
    expect(s.action).toEqual({ type: "click", x: 200, y: 65, target: "Search" });
    expect(s.confirm).toBeNull();
    expect(s.blocked).toBeNull();
    const far = parseStep('Sure! {"action":"click","x":5000,"y":-20,"target":"corner"}', els, screen);
    expect(far.action).toMatchObject({ x: 1365, y: 0, target: "corner" });
  });
  it("asks first before sending / paying / deleting", () => {
    expect(parseStep('{"action":"click","element":2,"say":"Sending the email"}', els, screen).confirm).toBe("Sending the email");
    expect(parseStep('{"action":"click","x":5,"y":5,"target":"thing","risky":true,"confirm":"Post this?"}', els, screen).confirm).toBe("Post this?");
  });
  it("never types passwords, OTPs or card numbers, and never into a password box", () => {
    expect(parseStep('{"action":"type","element":3,"text":"hunter2"}', els, screen).blocked).toMatch(/never type/);
    expect(parseStep('{"action":"type","element":1,"text":"4111 1111 1111 1111"}', els, screen).blocked).toMatch(/never type/);
    expect(parseStep('{"action":"type","element":1,"text":"my otp is 482913"}', els, screen).blocked).toMatch(/never type/);
    expect(parseStep('{"action":"type","element":1,"text":"bakeries in Bangalore","enter":true}', els, screen).blocked).toBeNull();
  });
  it("refuses lock / wipe keys and junk keys; bad JSON becomes a clean fail", () => {
    expect(parseStep('{"action":"key","keys":"win+l"}', els, screen).blocked).toMatch(/don't press/);
    expect(parseStep('{"action":"key","keys":"shift+delete"}', els, screen).blocked).toMatch(/don't press/);
    expect(parseStep('{"action":"key","keys":"ctrl+<script>"}', els, screen).blocked).toMatch(/isn't valid/);
    expect(parseStep("no idea", els, screen).action.type).toBe("fail");
    expect(parseStep('{"action":"scroll","direction":"sideways","amount":99}', els, screen).action).toEqual({ type: "scroll", direction: "down", amount: 15 });
  });
  it("tells the model the goal, history and the elements (marking password fields)", () => {
    const p = stepPrompt("Open Notepad", els, ["Opened Start"], screen);
    expect(p).toContain("Task: Open Notepad");
    expect(p).toContain("1. Opened Start");
    expect(p).toContain('3: Edit "Password"');
    expect(p).toContain("[password field]");
  });
});

function fakes(steps: unknown[], o: { confirm?: boolean; stopAfter?: number } = {}) {
  const log: { input: unknown[]; labels: (string | null)[]; reports: unknown[]; ripples: number[][]; apps: string[] } = { input: [], labels: [], reports: [], ripples: [], apps: [] };
  let i = 0;
  const deps = {
    capture: async () => ({ ok: true, dataUrl: "data:image/jpeg;base64,AA==", w: 1366, h: 768, factor: 1.5 }),
    elements: async () => [],
    act: async () => steps[Math.min(i++, steps.length - 1)],
    input: async (a: unknown) => { log.input.push(a); return { ok: true }; },
    openApp: async (n: string) => { log.apps.push(n); return { ok: true }; },
    confirm: async () => o.confirm ?? true,
    label: (t: string | null) => log.labels.push(t),
    ripple: (x: number, y: number) => log.ripples.push([x, y]),
    report: async (_id: string, r: unknown) => { log.reports.push(r); return { stop: o.stopAfter != null && log.reports.length >= o.stopAfter }; },
    sleep: async () => {},
  };
  return { deps, log };
}
const step = (action: object, extra: object = {}) => ({ action, say: "doing it", confirm: null, blocked: null, ...extra });

describe("computer use: the orb's loop", () => {
  it("does each step (scaling the screenshot to real pixels) until done", async () => {
    const { deps, log } = fakes([step({ type: "open_app", app: "Notepad" }), step({ type: "click", x: 100, y: 200, target: "x" }), step({ type: "type", text: "hi", enter: true }), step({ type: "done", summary: "Wrote hi." })]);
    const r = await createComputer(deps).run({ id: "t1", goal: "write hi" });
    expect(r).toEqual({ ok: true, status: "done", say: "Wrote hi." });
    expect(log.apps).toEqual(["Notepad"]);
    expect(log.input[0]).toEqual({ kind: "click", x: 150, y: 300 });
    expect(log.ripples).toEqual([[150, 300]]);
    expect(log.input[1]).toEqual({ kind: "type", text: "hi", enter: true });
    expect(log.labels.at(0)).toBe("write hi");
    expect(log.labels.at(-1)).toBeNull(); // the "JARVIS is working" label goes away
    expect(log.reports.at(-1)).toEqual({ status: "done", result: "Wrote hi." });
  });
  it("stops on a blocked step without touching anything", async () => {
    const { deps, log } = fakes([step({ type: "type", text: "pw" }, { blocked: "I never type passwords" })]);
    const r = await createComputer(deps).run({ id: "t2", goal: "log in" });
    expect(r.status).toBe("failed");
    expect(log.input).toEqual([]);
  });
  it("asks you first, and stops when you say no", async () => {
    const { deps, log } = fakes([step({ type: "click", x: 1, y: 1, target: "Send" }, { confirm: "Send it?" })], { confirm: false });
    const r = await createComputer(deps).run({ id: "t3", goal: "send" });
    expect(r.status).toBe("stopped");
    expect(log.input).toEqual([]);
  });
  it("stops when you press Stop on the dashboard, and caps the number of steps", async () => {
    const a = fakes([step({ type: "key", keys: "tab" })], { stopAfter: 2 });
    expect((await createComputer(a.deps).run({ id: "t4", goal: "tab around" })).status).toBe("stopped");
    expect(a.log.input.length).toBe(2);
    const b = fakes([step({ type: "key", keys: "tab" })]);
    const r = await createComputer(b.deps).run({ id: "t5", goal: "tab forever", maxSteps: 4 });
    expect(r.status).toBe("failed");
    expect(b.log.input.length).toBe(4);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("computer use: jobs on the server (integration)", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `desktop-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("queues, hands one job to the orb, picks steps, and stops", async () => {
    const S = await import("@/lib/desktop/service");
    await expect(S.queueTask(userId, "  ")).rejects.toThrow(/Say what/);
    const a = await S.queueTask(userId, "Open Notepad and type hello");
    const b = await S.queueTask(userId, "Open Calculator");
    const t = await S.nextTask(userId);
    expect(t).toMatchObject({ id: a.id, goal: "Open Notepad and type hello" });
    expect(await S.nextTask(userId)).toBeNull(); // one at a time

    const ask = vi.fn(async () => '{"action":"open_app","app":"Notepad","say":"Opening Notepad"}');
    const s = await S.nextStep(userId, a.id, { image: "data:image/jpeg;base64,AA==", elements: [], history: [], screen }, ask);
    expect(s.action).toEqual({ type: "open_app", app: "Notepad" });
    expect(ask).toHaveBeenCalledOnce();
    expect(await S.reportTask(userId, a.id, { step: { say: "Opening Notepad", action: "open Notepad" } })).toEqual({ stop: false });

    await S.stopTask(userId, a.id);
    expect(await S.reportTask(userId, a.id, { step: { say: "x", action: "y" } })).toEqual({ stop: true });
    expect((await S.nextStep(userId, a.id, { image: "data:image/jpeg;base64,AA==", elements: [], history: [], screen }, ask)).action.type).toBe("fail");

    expect((await S.nextTask(userId))?.id).toBe(b.id);
    await S.reportTask(userId, b.id, { status: "done", result: "Opened it." });
    const recent = await S.recentTasks(userId);
    expect(recent.find((r) => r.id === b.id)).toMatchObject({ status: "done", result: "Opened it." });
    expect((recent.find((r) => r.id === a.id)?.steps as unknown[]).length).toBe(2);
  });
});
