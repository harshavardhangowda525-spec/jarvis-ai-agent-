import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { inWords, reminderEmail, type ReminderDeps } from "@/lib/robin/reminders";

describe("RUBIN reminder email (pure)", () => {
  it("says what's coming up, when, with the lead number and your notes", () => {
    const now = new Date("2026-10-02T09:30:00Z"); // 3:00 PM IST
    const one = reminderEmail([{ kind: "followup", id: "f1", leadId: "L7", dueAt: new Date("2026-10-02T10:30:00Z"), what: "Call", lead: { number: 7, businessName: "ABC Café", phone: "+91 98450 11111" }, notes: "wants an online menu\nprefers WhatsApp" }], "Asia/Kolkata", now, "https://jarvis.example.app");
    expect(one.subject).toBe("Reminder: Follow-up with lead 7, ABC Café — call in 1 hours (4:00 PM)".replace("1 hours", "1 hour"));
    expect(one.body).toContain("• Follow-up with lead 7, ABC Café\n  Call · today at 4:00 PM (in 1 hour)\n  Phone: +91 98450 11111\n  Your notes: wants an online menu; prefers WhatsApp\n  Open: https://jarvis.example.app/dashboard/rubin?lead=L7");
    expect(one.body).toMatch(/tell Rubin how it went \(e\.g\. "done with 7, …"\)/);
    expect(inWords(25 * 60_000)).toBe("in 25 min");
    expect(inWords(90 * 60_000)).toBe("in 1 hour 30 min");
    expect(inWords(-10 * 60_000)).toBe("10 min ago");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("RUBIN emails you before a follow-up or demo is due (integration, fake Gmail)", () => {
  let userId = "";
  let R: typeof import("@/lib/robin/reminders");
  let crm: typeof import("@/lib/robin/crm");
  let engage: typeof import("@/lib/robin/engage");
  const sent: { to: string; subject: string; body: string }[] = [];
  let ready = true, fail = false;
  const deps: ReminderDeps = {
    ready: async () => ready,
    myAddress: async () => "owner@example.com",
    send: async (_u, to, subject, body) => { if (fail) throw new Error("Gmail said no"); sent.push({ to, subject, body }); return "msg-1"; },
  };
  const T0 = new Date("2026-10-05T08:00:00Z"); // 1:30 PM IST
  const at = (min: number) => new Date(T0.getTime() + min * 60_000);
  let fuSoon = "", fuLater = "", fuOld = "", leadNo = 0;

  beforeAll(async () => {
    [R, crm, engage] = await Promise.all([import("@/lib/robin/reminders"), import("@/lib/robin/crm"), import("@/lib/robin/engage")]);
    userId = (await getDb().user.create({ data: { email: `rbrem-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await getDb().profile.create({ data: { userId, timezone: "Asia/Kolkata" } });
    const a = (await crm.createLead(userId, { businessName: "ABC Café", phone: "+91 98450 11111", city: "Bengaluru" }, "user")).lead;
    const b = (await crm.createLead(userId, { businessName: "Iron Gym", phone: "+91 98450 22222", city: "Bengaluru" }, "user")).lead;
    leadNo = a.number!;
    fuSoon = (await engage.scheduleFollowUp(userId, a.id, { dueAt: at(40), notes: "wants an online menu" }, "voice")).id;
    fuLater = (await engage.scheduleFollowUp(userId, b.id, { dueAt: at(180) }, "voice")).id;
    fuOld = (await engage.scheduleFollowUp(userId, b.id, { dueAt: at(-200), notes: "old" }, "voice")).id;
    await engage.scheduleDemo(userId, b.id, { at: at(50), demoType: "in_person", notes: "bring the laptop" }, "voice");
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }); });

  it("nothing goes out while Gmail isn't connected — and nothing is marked as reminded", async () => {
    ready = false;
    expect(await R.sendDueReminders(userId, { now: T0, deps })).toEqual({ sent: 0, skipped: "gmail" });
    expect((await getDb().robinFollowUp.findUnique({ where: { id: fuSoon } }))?.remindedAt).toBeNull();
    ready = true;
  });

  it("a failed send is tried again on the next check", async () => {
    fail = true;
    expect((await R.sendDueReminders(userId, { now: T0, deps })).skipped).toMatch(/^send failed: Gmail said no/);
    expect((await getDb().robinFollowUp.findUnique({ where: { id: fuSoon } }))?.remindedAt).toBeNull();
    fail = false;
  });

  it("an hour before: one email to you with everything coming up — once", async () => {
    const r = await R.sendDueReminders(userId, { now: T0, deps });
    expect(r).toEqual({ sent: 2, to: "owner@example.com" }); // the follow-up in 40 min + the demo in 50 min
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(`Reminder: 2 coming up — first in 40 min: lead ${leadNo}, ABC Café`);
    expect(sent[0].body).toContain(`• Follow-up with lead ${leadNo}, ABC Café\n  Call · today at 2:10 PM (in 40 min)`);
    expect(sent[0].body).toContain("Your notes: wants an online menu");
    expect(sent[0].body).toMatch(/• Demo with lead \d+, Iron Gym\n  In-person demo · today at 2:20 PM \(in 50 min\)/);
    expect(sent[0].body).toContain("Your notes: bring the laptop");
    expect(sent[0].body).not.toContain("old"); // long overdue — not reminded
    // the next check sends nothing new
    expect(await R.sendDueReminders(userId, { now: at(5), deps })).toEqual({ sent: 0 });
    expect(sent).toHaveLength(1);
    expect((await getDb().robinFollowUp.findUnique({ where: { id: fuSoon } }))?.remindedAt).not.toBeNull();
    expect((await getDb().robinFollowUp.findUnique({ where: { id: fuOld } }))?.remindedAt).toBeNull();
    expect(await getDb().robinActivity.count({ where: { userId, type: "reminder_emailed" } })).toBe(2);
  });

  it("the later one goes out when it's an hour away — to the address you chose", async () => {
    expect((await R.sendDueReminders(userId, { now: at(100), deps })).sent).toBe(0); // 80 min away
    await crm.saveSettings(userId, { reminderEmail: "me@infinitywebapps.in" });
    const r = await R.sendDueReminders(userId, { now: at(125), deps });
    expect(r).toEqual({ sent: 1, to: "me@infinitywebapps.in" });
    expect(sent.at(-1)!.subject).toMatch(/^Reminder: Follow-up with lead \d+, Iron Gym — call in 55 min \(4:30 PM\)$/);
    expect(sent.at(-1)!.body).toContain("Your notes: none");
    expect((await getDb().robinFollowUp.findUnique({ where: { id: fuLater } }))?.remindedAt).not.toBeNull();
  });

  it("your timing setting and the off switch are respected; the scheduled check covers every user", async () => {
    const l = (await crm.createLead(userId, { businessName: "Brew House", phone: "+91 98450 33333", city: "Bengaluru" }, "user")).lead;
    await engage.scheduleFollowUp(userId, l.id, { dueAt: at(300) }, "voice");
    await crm.saveSettings(userId, { reminderMinutes: 15 });
    expect((await R.sendDueReminders(userId, { now: at(270), deps })).sent).toBe(0); // 30 min away, reminder at 15
    await crm.saveSettings(userId, { emailReminders: false });
    expect(await R.sendDueReminders(userId, { now: at(290), deps })).toEqual({ sent: 0, skipped: "off" });
    await crm.saveSettings(userId, { emailReminders: true });
    const all = await R.sendAllDueReminders(at(290), deps);
    expect(all.sent).toBeGreaterThanOrEqual(1);
    expect(sent.at(-1)!.subject).toMatch(/Brew House — call in 10 min/);
  });
});
