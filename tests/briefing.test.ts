import { describe, it, expect } from "vitest";
import { redact, redactMeta } from "@/lib/activity/redact";
import { localDate, startOfDay, yesterdayIn, parseHistoryRange, addDays } from "@/lib/activity/dates";
import { buildBriefing, type Ev, type BriefingInput } from "@/lib/briefing/build";
import { briefingRequest } from "@/lib/briefing/intent";
import { describeToolEvent, isTrivialCommand } from "@/lib/activity/tool-events";

const TZ = "Asia/Kolkata";
// "now" = 28 Sep 2026, 09:30 IST → yesterday = 27 Sep
const NOW = Date.UTC(2026, 8, 28, 4, 0);
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 27, h, m) - 5.5 * 3600_000).toISOString(); // IST wall time on 27 Sep

describe("secrets never reach the history", () => {
  it("redacts keys, tokens, passwords, private keys, card numbers and URL credentials", () => {
    const t = redact("my groq key is gsk_abcdefghijklmnopqrstuvwxyz123456 and password: hunter22, token=abc123xyz, " +
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U " +
      "db postgres://jarvis:s3cr3t@host/db card 4111 1111 1111 1111 sk-proj-ABCDEFGHIJKLMNOPQRSTUV");
    for (const leak of ["gsk_abc", "hunter22", "abc123xyz", "eyJhbGci", "s3cr3t", "4111 1111", "sk-proj-ABC"]) expect(t).not.toContain(leak);
    expect(redact("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----")).toBe("[redacted]");
  });
  it("keeps normal work text, including business phone numbers", () => {
    expect(redact("Called Iron Temple Gym on +91 98450 12345 about a website")).toBe("Called Iron Temple Gym on +91 98450 12345 about a website");
    expect(redactMeta({ apiKey: "x", note: "ok", nested: { accessToken: "y", count: 3 } })).toEqual({ note: "ok", nested: { count: 3 } });
  });
});

describe("the user's own calendar days", () => {
  it("yesterday is computed in the user's timezone", () => {
    expect(yesterdayIn(TZ, NOW)).toBe("2026-09-27");
    expect(yesterdayIn("America/Los_Angeles", NOW)).toBe("2026-09-26"); // still the 27th there at 04:00 UTC
    expect(localDate(new Date(at(23, 30)), TZ)).toBe("2026-09-27");
    expect(startOfDay("2026-09-27", TZ).toISOString()).toBe("2026-09-26T18:30:00.000Z");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it.each([
    ["What did I do yesterday?", "2026-09-27", "2026-09-27"],
    ["Give me yesterday's summary", "2026-09-27", "2026-09-27"],
    ["What happened yesterday?", "2026-09-27", "2026-09-27"],
    ["Yesterday's briefing", "2026-09-27", "2026-09-27"],
    ["What did I do on September 25?", "2026-09-25", "2026-09-25"],
    ["what did I work on 25th September", "2026-09-25", "2026-09-25"],
    ["What did I work on last week?", "2026-09-21", "2026-09-27"],
    ["Show me my activity from the last 7 days", "2026-09-22", "2026-09-28"],
  ])("%s", (text, from, to) => {
    const r = parseHistoryRange(text, TZ, NOW)!;
    expect([r.from, r.to]).toEqual([from, to]);
  });
  it("specific questions go to JARVIS; plain 'brief me' asks open the briefing", () => {
    expect(briefingRequest("What did I do yesterday?", TZ, NOW)?.from).toBe("2026-09-27");
    expect(briefingRequest("What problems did I encounter yesterday?", TZ, NOW)).toBeNull();
    expect(briefingRequest("What did DARWIN do yesterday?", TZ, NOW)).toBeNull();
    expect(briefingRequest("What did I work on in the evening?", TZ, NOW)).toBeNull();
    expect(briefingRequest("open youtube", TZ, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------- the engine

let n = 0;
const e = (h: number, p: Partial<Ev>): Ev => ({ id: `e${++n}`, timestamp: at(h, n % 60), category: "command", agent: "JARVIS", action: "x", result: null, status: "info", importance: 2, project: null, ...p });
const base = (events: Ev[], tasks?: Partial<BriefingInput["tasks"]>): BriefingInput => ({
  from: "2026-09-27", to: "2026-09-27", label: "Yesterday", kind: "day", tz: TZ, now: NOW, events,
  tasks: { completed: [], remaining: [], used: false, ...tasks }, recordedSince: "2026-09-20", userName: "Harsha Gowda",
});

const DAY: Ev[] = [
  e(9, { category: "agent", agent: "DARWIN", action: "Opened DARWIN", importance: 1 }),
  e(9, { category: "business", agent: "DARWIN", action: "Discovered 18 new gym leads near Bengaluru via Geoapify.", status: "success", importance: 3, project: "DARWIN", metadata: { type: "discovered", count: 18 } }),
  e(10, { category: "business", agent: "DARWIN", action: "Discovered 7 new cafe leads near Pune via Geoapify.", status: "success", importance: 3, project: "DARWIN", metadata: { type: "discovered", count: 7 } }),
  e(10, { category: "business", agent: "DARWIN", action: "Iron Temple: New → Contacted.", status: "success", importance: 3, project: "DARWIN", metadata: { type: "stage_changed" } }),
  e(11, { category: "business", agent: "DARWIN", action: "Follow-up for Iron Temple on 30/9.", status: "success", importance: 2, project: "DARWIN", metadata: { type: "followup_scheduled" } }),
  e(15, { category: "marketing", agent: "EV", action: "Content created: reel — Gym booking surge", status: "success", importance: 3, project: "EV" }),
  e(15, { category: "error", agent: "EV", action: "Instagram publish failed", result: "Token expired", status: "failed", importance: 4, project: "EV", metadata: { tool: "ev_instagram" } }),
  e(16, { category: "marketing", agent: "EV", action: "Published a post to Instagram", status: "success", importance: 4, project: "EV", metadata: { tool: "ev_instagram" } }),
  e(19, { category: "development", agent: "ULTRON", action: "ULTRON started: build a landing page for Chai Point", importance: 2, project: "ULTRON" }),
  e(20, { category: "error", agent: "ULTRON", action: "ULTRON couldn't complete: add a contact form", result: "npm install failed", status: "failed", importance: 3, project: "ULTRON" }),
  e(20, { category: "development", agent: "ULTRON", action: "ULTRON completed: build a landing page for Chai Point", status: "success", importance: 3, project: "ULTRON" }),
  e(21, { category: "command", agent: "JARVIS", action: "remind me to send the Chai Point quotation", status: "success", importance: 3 }),
  e(21, { category: "command", agent: "JARVIS", action: "remind me to send the Chai Point quotation", status: "success", importance: 3 }), // duplicate
];

describe("buildBriefing — only what was recorded", () => {
  const b = buildBriefing(base(DAY, { used: true, completed: [{ title: "Fix DARWIN map", priority: "normal" }], remaining: [{ title: "Send Chai Point quotation", priority: "high" }, { title: "EV content approval", priority: "normal" }] }));

  it("counts real metrics and nothing else", () => {
    const m = Object.fromEntries(b.metrics.map((x) => [x.key, x.value]));
    expect(m.leads).toBe(25);
    expect(m.tasksCompleted).toBe(1);
    expect(m.tasksRemaining).toBe(2);
    expect(m.projects).toBe(3);
    expect(m.problems).toBe(2);
    expect(m.resolved).toBe(1); // the EV publish failure was followed by a successful publish; ULTRON's contact form wasn't
    expect(m.commands).toBe(1); // the duplicate command counts once
    expect(m.followUps).toBe(1);
    expect(b.completion).toEqual({ done: 1, remaining: 2, pct: 33 });
    expect(b.eventCount).toBe(11); // the "opened" event (importance 1) and the duplicate are left out
  });

  it("agent activity comes from recorded events", () => {
    const s = Object.fromEntries(b.agents.map((a) => [a.name, a.status]));
    expect(s).toMatchObject({ DARWIN: "active", EV: "active", ULTRON: "active", JARVIS: "active", HUMANOID: "inactive" });
  });

  it("timeline flows through the real parts of the day", () => {
    expect(b.timeline.map((t) => t.part)).toEqual(["Morning", "Afternoon", "Evening"]);
    expect(b.timeline[0].lead).toBe("Business");
    expect(b.points).toHaveLength(11);
  });

  it("briefs like JARVIS — with real numbers only", () => {
    const text = b.spoken;
    expect(b.paragraphs[0]).toBe("Good morning, Harsha. Here's your briefing from yesterday.");
    expect(text).toContain("DARWIN found 25 new leads across 2 searches");
    expect(text).toContain("moved 1 lead through the pipeline");
    expect(text).toContain("EV created 1 piece of content and published 1 post to Instagram");
    expect(text).toContain('ULTRON completed "build a landing page for Chai Point"');
    expect(text).toContain("2 problems came up, and 1 was resolved");
    expect(text).toContain("Your main unfinished item is Send Chai Point quotation");
    expect(text).toMatch(/That's everything important from yesterday\.$/);
    expect(b.unfinished).toEqual(["Send Chai Point quotation", "EV content approval", "add a contact form"]);
  });

  it("insights are backed by the data", () => {
    expect(b.insights.length).toBeGreaterThan(0);
    // DARWIN had 4 of 10 agent events — not a majority, so no "most of the work" claim
    expect(b.insights.some((i) => /handled most/.test(i))).toBe(false);
    expect(b.insights[0]).toBe("Business made up the largest share of the work yesterday (4 of 10 events).");
    const darwinDay = buildBriefing(base(DAY.filter((x) => x.agent !== "EV")));
    expect(darwinDay.insights[0]).toBe("DARWIN handled most of the agent work yesterday — 4 of 7 agent events.");
  });

  it("stores the day in the requested structure", () => {
    expect(Object.keys(b.daily)).toEqual(["date", "accomplishments", "projects", "business_progress", "development_progress", "problems", "solutions", "unfinished_tasks", "important_decisions", "next_actions"]);
    expect(b.daily.solutions).toContain("Resolved: Instagram publish failed");
    expect(b.daily.next_actions[0]).toBe("Finish: Send Chai Point quotation");
  });

  it("with nothing recorded it says so instead of inventing", () => {
    const empty = buildBriefing(base([]));
    expect(empty.hasData).toBe(false);
    expect(empty.metrics).toEqual([]);
    expect(empty.completion).toBeNull();
    expect(empty.insights).toEqual([]);
    expect(empty.paragraphs[1]).toBe("I don't have any recorded activity yesterday.");
    const fresh = buildBriefing({ ...base([]), recordedSince: null });
    expect(fresh.spoken).toContain("tomorrow's briefing will cover today");
  });
});

describe("tool events", () => {
  it("records meaningful actions and every failure; skips lookups", () => {
    expect(describeToolEvent("tasks", { action: "create", title: "Call Sharma" }, "JARVIS", true, "Task created.", null)).toMatchObject({ category: "task", action: "Task created: Call Sharma" });
    expect(describeToolEvent("gmail", { action: "send", to: "a@b.com", subject: "Quote" }, "JARVIS", true, "Sent", null)?.action).toBe("Email sent to a@b.com: Quote");
    expect(describeToolEvent("gmail", { action: "list" }, "JARVIS", true, null, null)).toBeNull();
    expect(describeToolEvent("weather", {}, "JARVIS", true, null, null)).toBeNull();
    expect(describeToolEvent("darwin_search", {}, "DARWIN", false, null, "Geoapify rate limit")).toMatchObject({ category: "error", status: "failed", result: "Geoapify rate limit" });
    expect(isTrivialCommand("hey jarvis")).toBe(true);
    expect(isTrivialCommand("find 20 gyms in Bangalore")).toBe(false);
  });
});
