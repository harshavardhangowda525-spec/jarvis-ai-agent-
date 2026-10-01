import { describe, it, expect } from "vitest";
import { parseRobinCommand, parseWhen, stageFromWords } from "@/lib/robin/command";
import { isRobinActivation, isRobinDeactivation, robinCommand, stripRobinWake } from "@/lib/robin/wake";
import { qualify, explain, attention } from "@/lib/robin/qualify";
import { money, nodeOf } from "@/lib/robin/types";

describe("ROBIN wake words", () => {
  it("activates on Robin / Activate / Open / Start Robin", () => {
    for (const t of ["Robin", "Activate Robin", "Open Robin", "Start Robin", "Jarvis, open Robin", "robbin", "Robin online", "switch to Robin"]) expect(isRobinActivation(t), t).toBe(true);
    for (const t of ["ask Robin how many qualified leads I have", "Robin, show today's follow-ups", "rob the bank", "open mike"]) expect(isRobinActivation(t), t).toBe(false);
  });
  it("commands addressed to Robin and closing", () => {
    expect(robinCommand("Robin, show me today's follow-ups")).toBe("show me today's follow-ups");
    expect(robinCommand("Activate Robin")).toBeNull();
    expect(stripRobinWake("Robin, mark ABC Café as interested")).toBe("mark ABC Café as interested");
    for (const t of ["Close Robin", "Deactivate Robin", "Get me back to JARVIS", "back to Jarvis", "Robin, stand down"]) expect(isRobinDeactivation(t), t).toBe(true);
    expect(isRobinDeactivation("close the deal with ABC")).toBe(false);
  });
});

describe("ROBIN voice commands", () => {
  const p = parseRobinCommand;
  it("views and filters", () => {
    expect(p("Robin, show me today's follow-ups.")).toEqual({ kind: "view", view: "followups" });
    expect(p("Show leads waiting for follow-up")).toEqual({ kind: "view", view: "followups" });
    expect(p("Robin, show me my highest-priority leads.")).toEqual({ kind: "leads", filter: "hottest" });
    expect(p("show me the hottest leads")).toEqual({ kind: "leads", filter: "hottest" });
    expect(p("Robin, show me all qualified leads.")).toEqual({ kind: "leads", filter: "qualified" });
    expect(p("Robin, show me leads that haven't been contacted.")).toEqual({ kind: "leads", filter: "uncontacted" });
    expect(p("Robin, show me all quotations.")).toEqual({ kind: "view", view: "quotations" });
    expect(p("Robin, show my CRM.")).toEqual({ kind: "view", view: "pipeline" });
    expect(p("Show me the sales pipeline.")).toEqual({ kind: "view", view: "pipeline" });
    expect(p("Show my potential revenue.")).toEqual({ kind: "view", view: "revenue" });
    expect(p("Show pipeline value")).toEqual({ kind: "view", view: "revenue" });
    expect(p("Show won clients.")).toEqual({ kind: "view", view: "clients" });
    expect(p("show the funnel")).toEqual({ kind: "view", view: "funnel" });
  });
  it("numbers and the briefing", () => {
    expect(p("Robin, how many clients did I win this month?")).toEqual({ kind: "stat", stat: "won_month" });
    expect(p("Robin, show me my conversion rate.")).toEqual({ kind: "stat", stat: "conversion" });
    expect(p("how many qualified leads do I have")).toEqual({ kind: "stat", stat: "count", filter: "qualified" });
    expect(p("Robin, what's my day?")).toEqual({ kind: "briefing" });
  });
  it("actions on a lead (names keep their spelling)", () => {
    expect(p("Robin, mark ABC Café as interested.")).toEqual({ kind: "move", name: "ABC Café", stage: "interested" });
    expect(p("Robin, move ABC Café to quotation sent.")).toEqual({ kind: "move", name: "ABC Café", stage: "quotation_sent" });
    expect(p("Move ABC Café to quotation.")).toEqual({ kind: "move", name: "ABC Café", stage: "quotation_sent" });
    expect(p("Robin, mark this lead as not interested.")).toEqual({ kind: "move", name: null, stage: "not_interested" });
    expect(p("mark Urban Salon as won")).toEqual({ kind: "move", name: "Urban Salon", stage: "won" });
    expect(p("Robin, schedule a follow-up with ABC Café tomorrow at 4 PM.")).toEqual({ kind: "followup", name: "ABC Café", when: "tomorrow at 4 pm." });
    expect(p("book a demo with Prime Clinic on Friday at 11am")).toEqual({ kind: "demo", name: "Prime Clinic", when: "on friday at 11am" });
    expect(p("Robin, open ABC Café.")).toEqual({ kind: "open", name: "ABC Café" });
    expect(p("yes")).toEqual({ kind: "confirm", yes: true });
    expect(p("no, cancel")).toEqual({ kind: "ask", text: "no, cancel" });
    expect(p("cancel")).toEqual({ kind: "confirm", yes: false });
    expect(p("Close Robin")).toEqual({ kind: "exit" });
    expect(p("undo")).toEqual({ kind: "undo" });
    for (const t of ["hi", "Hi.", "hey Robin", "Hello!", "Robin, hi", "good morning", "what's up"]) expect(p(t), t).toEqual({ kind: "chat", topic: "hello" });
    expect(p("how are you?")).toEqual({ kind: "chat", topic: "how_are_you" });
    expect(p("thank you")).toEqual({ kind: "chat", topic: "thanks" });
    expect(p("who are you")).toEqual({ kind: "chat", topic: "who" });
    expect(p("Robin, undo that.")).toEqual({ kind: "undo" });
    expect(p("take it back")).toEqual({ kind: "undo" });
    expect(p("Make ABC Café a client.")).toEqual({ kind: "convert", name: "ABC Café" });
    expect(p("convert this lead to a client")).toEqual({ kind: "convert", name: null });
    expect(p("show me my conversion rate").kind).toBe("stat");
    expect(p("What should I say to a gym owner who thinks websites are expensive?").kind).toBe("ask");
  });
  it("stage words", () => {
    expect(stageFromWords("the quotation stage")).toBe("quotation_sent");
    expect(stageFromWords("demo done")).toBe("demo_completed");
    expect(stageFromWords("do not contact")).toBe("do_not_contact");
    expect(stageFromWords("banana")).toBeNull();
  });
});

describe("natural times (Asia/Kolkata)", () => {
  const tz = "Asia/Kolkata";
  const now = new Date("2026-10-01T05:30:00Z"); // Thu 1 Oct, 11:00 IST
  const ist = (d: Date | null) => d && new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
  it("days and times", () => {
    expect(ist(parseWhen("tomorrow at 4 PM", tz, now))).toBe("2026-10-02 16:00");
    expect(ist(parseWhen("tomorrow at 4", tz, now))).toBe("2026-10-02 16:00");
    expect(ist(parseWhen("today 6:30pm", tz, now))).toBe("2026-10-01 18:30");
    expect(ist(parseWhen("on Friday at 11am", tz, now))).toBe("2026-10-02 11:00");
    expect(ist(parseWhen("Monday morning", tz, now))).toBe("2026-10-05 10:00");
    expect(ist(parseWhen("Thursday", tz, now))).toBe("2026-10-08 10:00"); // today is Thursday → next week
    expect(ist(parseWhen("on 5 Oct at 3:30 pm", tz, now))).toBe("2026-10-05 15:30");
    expect(ist(parseWhen("October 20", tz, now))).toBe("2026-10-20 10:00");
    expect(ist(parseWhen("at 9am", tz, now))).toBe("2026-10-02 09:00"); // already past today
    expect(ist(parseWhen("in 2 hours", tz, now))).toBe("2026-10-01 13:00");
    expect(parseWhen("whenever", tz, now)).toBeNull();
  });
});

describe("qualification is transparent", () => {
  it("ranks from facts and explains why", () => {
    const q = qualify({ businessName: "ABC Café", category: "Cafe", phone: "+91 98450 11111", instagram: "@abc", city: "Bengaluru", websiteStatus: "no_website" });
    expect(q.priority).toBe("high");
    expect(explain(q)).toBe("High Priority because:\n• No website\n• Mobile number available\n• Instagram profile listed\n• Local business\n• Website service appears relevant\n• Booking / ordering app could fit");
    expect(qualify({ businessName: "Mystery", websiteStatus: "no_website" }).priority).toBe("needs_review"); // no way to reach them
    expect(qualify({ businessName: "Big Co", phone: "080 4123 4567", websiteStatus: "has_website", category: "Hardware" }).priority).toBe("low");
    expect(attention({ priority: "low", score: 20, stage: "interested", nextFollowUpAt: new Date(Date.now() - 1000) })).toBeGreaterThan(attention({ priority: "high", score: 70, stage: "qualified" }));
  });
  it("money and nodes", () => {
    expect(money(110000)).toBe("₹1,10,000");
    expect(money(990000, "INR", true)).toBe("₹9.9L");
    expect(nodeOf("demo_completed")).toBe("demo");
    expect(nodeOf("not_interested")).toBe("lost");
  });
});
