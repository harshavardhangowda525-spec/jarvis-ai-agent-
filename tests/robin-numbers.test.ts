import { describe, expect, it } from "vitest";
import { followUpBreakdown, leadNumberOf, leadLabel, spokenLead, wordsToNumber } from "@/lib/robin/numbers";
import { parseRobinCommand as p, splitNote } from "@/lib/robin/command";

describe("ROBIN lead numbers", () => {
  it("hears a lead named by its number — digits or words", () => {
    for (const [t, n] of [["7", 7], ["#7", 7], ["lead 7", 7], ["Lead #12", 12], ["number 3", 3], ["no. 4", 4], ["client 9", 9], ["lead number 15", 15], ["lead seven", 7], ["number twenty one", 21], ["lead twenty-five", 25], ["Number Eight.", 8]] as const) expect(leadNumberOf(t), t).toBe(n);
    for (const t of ["ABC Café", "Cafe 7 Seas", "seven", "0", "lead", "Iron Gym 2"]) expect(leadNumberOf(t), t).toBeNull();
    expect(wordsToNumber("one hundred and five")).toBe(105);
    expect(leadLabel({ number: 7, businessName: "ABC Café" })).toBe("#7 ABC Café");
    expect(spokenLead({ number: 7, businessName: "ABC Café" })).toBe("lead 7, ABC Café");
  });

  it("commands work with numbers", () => {
    expect(p("follow up with 7 tomorrow at 4")).toEqual({ kind: "followup", name: "7", when: "tomorrow at 4" });
    expect(p("move lead 12 to interested")).toEqual({ kind: "move", name: "lead 12", stage: "interested" });
    expect(p("open number 3")).toEqual({ kind: "open", name: "number 3" });
    expect(p("open lead 7")).toEqual({ kind: "open", name: "lead 7" });
    expect(p("show me lead #12")).toEqual({ kind: "open", name: "lead #12" });
    expect(p("open 7")).toEqual({ kind: "open", name: "7" });
    expect(p("open lead seven")).toEqual({ kind: "open", name: "lead seven" });
    expect(p("show me the leads").kind).not.toBe("open");
    expect(p("make 5 a client")).toEqual({ kind: "convert", name: "5" });
  });
});

describe("ROBIN takes down follow-up notes", () => {
  it("a note can ride along with the follow-up", () => {
    expect(p("Schedule a follow-up with 7 tomorrow at 4, note: he wants an online menu")).toEqual({ kind: "followup", name: "7", when: "tomorrow at 4", note: "he wants an online menu" });
    expect(p("follow up with ABC Café on Friday at 11am about the website pricing")).toEqual({ kind: "followup", name: "ABC Café", when: "on friday at 11am", note: "the website pricing" });
    expect(p("follow up with lead 12 about the menu photos tomorrow at 5 pm")).toEqual({ kind: "followup", name: "lead 12", when: "tomorrow at 5 pm", note: "the menu photos" });
    expect(p("follow up with 3 tomorrow at about 4")).toEqual({ kind: "followup", name: "3", when: "tomorrow at about 4" }); // "about 4" is a time, not a note
    expect(splitNote("tomorrow at 4 and note that the owner is travelling")).toEqual(["tomorrow at 4", "the owner is travelling"]);
  });

  it("notes when a follow-up is done, and notes on their own", () => {
    expect(p("done with 7, he wants a quote next week")).toEqual({ kind: "complete_followup", name: "7", note: "he wants a quote next week" });
    expect(p("I followed up with ABC Café — call back on Monday")).toEqual({ kind: "complete_followup", name: "ABC Café", note: "call back on Monday" });
    expect(p("mark the follow-up with 4 as done")).toEqual({ kind: "complete_followup", name: "4" });
    expect(p("follow up with 9 is done: not interested this month")).toEqual({ kind: "complete_followup", name: "9", note: "not interested this month" });
    expect(p("note for 7: owner prefers WhatsApp")).toEqual({ kind: "note", name: "7", text: "owner prefers WhatsApp" });
    expect(p("take down a note for lead 3 that they close on Mondays")).toEqual({ kind: "note", name: "lead 3", text: "they close on Mondays" });
    expect(p("add a note to ABC Café, send the menu design first")).toEqual({ kind: "note", name: "ABC Café", text: "send the menu design first" });
    expect(p("note for 12 wants it before Diwali")).toEqual({ kind: "note", name: "12", text: "wants it before Diwali" });
    expect(p("note: call after 6 pm")).toEqual({ kind: "note", name: null, text: "call after 6 pm" });
  });

  it("'how many follow-ups do we have?' → the breakdown", () => {
    for (const t of ["how many follow ups do we have", "How many follow-ups do I have?", "what follow-ups do we have", "give me the follow-up breakdown", "read my follow ups", "list all follow-ups"]) expect(p(t), t).toEqual({ kind: "followups", which: "all" });
    expect(p("what follow-ups are overdue")).toEqual({ kind: "followups", which: "overdue" });
    expect(p("how many follow-ups today")).toEqual({ kind: "followups", which: "today" });
    expect(p("schedule a follow-up with 7 tomorrow at 4").kind).toBe("followup");
  });

  it("the breakdown names every follow-up with its number, time and the note you gave", () => {
    const now = new Date("2026-10-02T06:30:00Z"); // 12:00 IST
    const q = {
      tz: "Asia/Kolkata",
      overdue: [{ dueAt: "2026-10-01T10:30:00Z", action: "call", notes: "wants an online menu", lead: { number: 7, businessName: "ABC Café" } }],
      today: [
        { dueAt: "2026-10-02T11:30:00Z", action: "whatsapp", notes: "send the price list\nDone: asked for photos", lead: { number: 3, businessName: "Iron Gym" } },
        { dueAt: "2026-10-02T12:30:00Z", action: "call", notes: null, lead: { number: 12, businessName: "Spice Route" } },
      ],
      upcoming: [{ dueAt: "2026-10-03T05:30:00Z", action: "meeting", notes: "demo at their place", lead: { number: 21, businessName: "Brew House" } }],
    };
    const text = followUpBreakdown(q, { now });
    expect(text).toMatch(/^You have 4 follow-ups — 1 overdue, 2 today, 1 coming up\./);
    expect(text).toContain("Overdue: lead 7, ABC Café — call, was due yesterday at 4:00 PM. Note: wants an online menu.");
    expect(text).toContain("Today: lead 3, Iron Gym — WhatsApp, at 5:00 PM. Note: send the price list; Done: asked for photos. lead 12, Spice Route — call, at 6:00 PM. No note.");
    expect(text).toContain("Coming up: lead 21, Brew House — meeting, tomorrow at 11:00 AM. Note: demo at their place.");
    expect(followUpBreakdown(q, { now, which: "today" })).toMatch(/^2 follow-ups today\.\nlead 3, Iron Gym/);
    expect(followUpBreakdown({ tz: "Asia/Kolkata", overdue: [], today: [], upcoming: [] }, { now })).toBe("You don't have any follow-ups scheduled right now.");
    expect(followUpBreakdown(q, { now, max: 2 })).toMatch(/And 2 more — they're all on screen\.$/);
  });
});
