import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { inCallingWindow, cantCall, dialable, openerText, shortName, isMachine, saysDoNotCall, asksIfAi, parseTurn, crmPatchFor, manualCallSection, detectLang, normLang, splitSentences } from "@/lib/calls/rules";
import { runOneCall, type CallerIO } from "@/lib/calls/loop";
import { INFINITY_TEMPLATE } from "@/lib/ai/operator";

const persona = { callerName: "Jarvis", company: "Infinity Web & Apps", ownerName: "Harshavardhan", city: "Bengaluru", recordingNotice: true };

describe("prospect calls: rules (pure)", () => {
  it("calling hours: 10:00–19:00 IST, Mon–Sat", () => {
    const r = { hoursFrom: "10:00", hoursTo: "19:00", days: [1, 2, 3, 4, 5, 6] };
    expect(inCallingWindow(r, new Date("2026-11-11T04:31:00Z"), "Asia/Kolkata")).toBe(true); // Wed 10:01
    expect(inCallingWindow(r, new Date("2026-11-11T04:29:00Z"), "Asia/Kolkata")).toBe(false); // 09:59
    expect(inCallingWindow(r, new Date("2026-11-11T13:30:00Z"), "Asia/Kolkata")).toBe(false); // 19:00
    expect(inCallingWindow(r, new Date("2026-11-15T06:00:00Z"), "Asia/Kolkata")).toBe(false); // Sunday
  });
  it("who may be called", () => {
    const ok = { phone: "+919845011111", doNotContact: false, status: "new", attempts: 0, calledToday: false };
    expect(cantCall(ok)).toBeNull();
    expect(cantCall({ ...ok, doNotContact: true })).toMatch(/do-not-contact/);
    expect(cantCall({ ...ok, attempts: 3 })).toMatch(/3 times/);
    expect(cantCall({ ...ok, calledToday: true })).toMatch(/today/);
    expect(cantCall({ ...ok, status: "lost" })).toMatch(/lost/);
    expect(cantCall({ ...ok, phone: null })).toMatch(/no phone/);
  });
  it("numbers Phone Link can dial", () => {
    expect(dialable("09353054858")).toBe("+919353054858");
    expect(dialable("+91 98450 11111")).toBe("+919845011111");
    expect(dialable("919845011111")).toBe("+919845011111");
    expect(dialable("080 6900 7989")).toBe("+918069007989");
    expect(dialable("call me")).toBeNull();
  });
  it("the opener always says it's an AI assistant", () => {
    const t = openerText(persona, "Posh & Pixie | Premium Unisex Salon in HSR Layout");
    expect(t).toBe("Hi, is this Posh & Pixie? Hi! This is Jarvis, an AI assistant calling from Infinity Web & Apps here in Bengaluru, on behalf of Harshavardhan. This call may be recorded for quality. Is this a good time for two minutes?");
    expect(openerText({ ...persona, recordingNotice: false }, "Gym", "Ravi")).not.toMatch(/recorded/);
    expect(shortName("SAM Fine Suits – Bespoke Tailoring for Men")).toBe("SAM Fine Suits");
  });
  it("hears machines, 'don't call me', and 'are you a bot?'", () => {
    expect(isMachine("The number you have dialled is currently switched off")).toBe(true);
    expect(isMachine("Please leave a message after the tone")).toBe(true);
    expect(isMachine("Hello, who is this?")).toBe(false);
    expect(saysDoNotCall("Please don't call me again")).toBe(true);
    expect(saysDoNotCall("remove my number from your list")).toBe(true);
    expect(saysDoNotCall("call me later")).toBe(false);
    expect(asksIfAi("wait, are you a robot?")).toBe(true);
  });
  it("English, Hindi and Kannada: detection, 'don't call', 'are you a robot?', sentences", () => {
    expect(detectLang("Hello there")).toBe("en");
    expect(detectLang("हाँ बोलिए")).toBe("hi");
    expect(detectLang("ಹೌದು ಹೇಳಿ")).toBe("kn");
    expect(normLang("hindi")).toBe("hi"); expect(normLang("Kannada")).toBe("kn"); expect(normLang("en")).toBe("en"); expect(normLang("tamil")).toBeNull();
    expect(saysDoNotCall("मुझे दोबारा फोन मत करना")).toBe(true);
    expect(saysDoNotCall("please call mat karo")).toBe(true);
    expect(saysDoNotCall("ದಯವಿಟ್ಟು ಕಾಲ್ ಮಾಡಬೇಡಿ")).toBe(true);
    expect(asksIfAi("क्या आप रोबोट हैं?")).toBe(true);
    expect(asksIfAi("kya aap robot ho")).toBe(true);
    expect(parseTurn(`{"say":"हम डेमो बना सकते हैं।","lang":"hi"}`, "क्या आप रोबोट हैं?").say).toMatch(/^जी हाँ, मैं एक AI असिस्टेंट हूँ।/);
    expect(parseTurn(`{"say":"मैं इंसान हूँ, भरोसा कीजिए।"}`, "x").say).toMatch(/AI असिस्टेंट/);
    expect(parseTurn(`{"say":"ok","lang":"kn"}`, "y").lang).toBe("kn");
    expect(splitSentences("Hi! We build websites. Want a free demo? Great.")).toEqual(["Hi! We build websites.", "Want a free demo? Great."]); // short bits ride along with the one before
    expect(splitSentences("नमस्ते। हम वेबसाइट बनाते हैं।")).toEqual(["नमस्ते। हम वेबसाइट बनाते हैं।"]);
  });
  it("the brain's reply is made safe", () => {
    expect(parseTurn(`{"say":"Sure! When would suit you?","end":false,"outcome":null}`, "maybe")).toMatchObject({ say: "Sure! When would suit you?", end: false });
    expect(parseTurn(`{"say":"No no, I'm a real human calling you.","end":false}`, "hello").say).toMatch(/AI assistant/);
    expect(parseTurn(`{"say":"Haha, good question! Anyway, about your website…"}`, "are you a bot?").say).toMatch(/^Yes, I'm an AI assistant\./);
    expect(parseTurn(`{"say":"Great, just share your card number and CVV to confirm."}`, "ok").say).toMatch(/nothing to pay/);
    expect(parseTurn(`{"say":"Lovely, Thursday 4 PM it is.","end":true,"outcome":"demo_booked","callbackAt":"2026-11-12T16:00:00+05:30"}`, "thursday 4")).toMatchObject({ end: true, outcome: "demo_booked", callbackAt: "2026-11-12T10:30:00.000Z" });
    expect(parseTurn("garbage {", "x").say).toBeTruthy();
    expect(parseTurn(`{"say":"x","outcome":"sold"}`, "y").outcome).toBeNull();
  });
  it("outcomes move the lead (manual 6.5)", () => {
    expect(crmPatchFor("do_not_call")).toEqual({ status: "lost", lostReason: "not_interested", doNotContact: true });
    expect(crmPatchFor("has_vendor")).toEqual({ status: "lost", lostReason: "has_vendor" });
    const at = new Date("2026-11-12T10:30:00Z");
    expect(crmPatchFor("callback", { callbackAt: at })).toMatchObject({ status: "callback", nextActionAt: at });
    expect(crmPatchFor("not_reachable").status).toBe("not_reachable");
  });
  it("the call brain gets the user's own Part 6 + catalogue", () => {
    const s = manualCallSection(INFINITY_TEMPLATE);
    expect(s).toMatch(/MODULE 3: CALLING/);
    expect(s).toMatch(/Objection handling/i);
    expect(s).toMatch(/3\.2 Full service catalogue/);
    expect(s).not.toMatch(/MODULE 4: JARVIS CALENDAR/);
  });
});

/** A phone + audio + server double for the call loop. */
function fakeIO(script: { dial?: { ok: boolean; error?: string }; heard: (string | null)[]; inCall?: boolean[]; server?: (b: Record<string, unknown>) => Record<string, unknown>; slowBrain?: boolean; cutOn?: string }) {
  const said: string[] = []; const langs: string[] = []; const api: Record<string, unknown>[] = []; const labels: (string | null)[] = [];
  let t = 0; let hung = 0; let i = 0; let j = 0;
  const io: CallerIO = {
    api: async (b) => { api.push(b); if (script.slowBrain && b.action === "turn" && !b.opener) await new Promise((r) => setTimeout(r, 30)); return script.server?.(b) ?? {}; },
    dial: async () => script.dial ?? { ok: true },
    hangup: async () => { hung++; },
    inCall: async () => (script.inCall ? script.inCall[Math.min(j++, script.inCall.length - 1)] : true),
    speak: async (x, l) => { said.push(x); langs.push(l); t += 3000; return { interrupted: !!script.cutOn && x.includes(script.cutOn) }; },
    listen: async (ms) => { const h = i < script.heard.length ? script.heard[i++] : null; t += h === null ? ms : 2000; return h; },
    label: (x) => labels.push(x), log: () => {}, sleep: async (ms) => { t += ms; await new Promise((r) => setTimeout(r, 1)); }, now: () => t, stopped: () => false,
  };
  return { io, said, langs, api, labels, hung: () => hung };
}
const job = { id: "c1", to: "+919845011111", name: "Iron Den Gym", maxMs: 240_000, maxTurns: 16 };

describe("prospect calls: the caller's loop (fakes)", () => {
  it("nobody answers → no_answer, hung up, label off", async () => {
    const f = fakeIO({ heard: ["", null] });
    expect(await runOneCall(f.io, job)).toBe("no_answer");
    expect(f.api.at(-1)).toMatchObject({ action: "finish", reason: "no_answer" });
    expect(f.hung()).toBe(1); expect(f.labels.at(-1)).toBeNull();
  });
  it("a call to YOU: you pick up and stay quiet → JARVIS speaks up by itself, then talks with you", async () => {
    const own = { ...job, id: "own_t1", name: "you (updates)" };
    const server = (b: Record<string, unknown>) => b.opener ? { say: "Hi, it's JARVIS with an update. This is a test call, and I'm live." } : b.action === "turn" ? { say: "All good here.", end: String(b.heard).includes("bye") } : {};
    const f = fakeIO({ heard: [null, "Nice, how are things?", "ok bye"], server });
    expect(await runOneCall(f.io, own)).toBe("ended");
    expect(f.said[0]).toMatch(/test call, and I'm live/);
    expect(f.api.filter((b) => b.opener)).toHaveLength(1); // the opener once, not again after you talk
    expect(f.api.find((b) => b.action === "turn" && !b.opener)).toMatchObject({ heard: "Nice, how are things?" });
    expect(f.api.some((b) => b.state === "answered")).toBe(true);
    // a prospect's call still waits for their hello
    const g = fakeIO({ heard: [null] });
    expect(await runOneCall(g.io, job)).toBe("no_answer");
    expect(g.said).toEqual([]);
  });
  it("hello → opener → conversation → JARVIS ends it → reported", async () => {
    const f = fakeIO({ heard: ["Hello?", "", "Yes tell me", "Ok, Thursday 4 pm works"], server: (b) => b.opener ? { say: "Hi, is this Iron Den? …an AI assistant…" } : b.action === "turn" ? (String(b.heard).includes("Thursday") ? { say: "Lovely, see you then!", end: true } : { say: "We'd love to make you a free demo website." }) : {} });
    expect(await runOneCall(f.io, job)).toBe("ended");
    expect(f.said).toEqual(["Hi, is this Iron Den? …an AI assistant…", "We'd love to make you a free demo website.", "Lovely, see you then!"]);
    expect(f.api.map((a) => a.action)).toEqual(["turn", "event", "turn", "turn", "finish"]);
    expect(f.api[1]).toMatchObject({ state: "answered" });
  });
  it("an operator message → the server ends it at the opener", async () => {
    const f = fakeIO({ heard: ["The number you have dialled is switched off"], server: (b) => (b.opener ? { say: "", end: true } : {}) });
    expect(await runOneCall(f.io, job)).toBe("ended");
    expect(f.said).toEqual([]);
  });
  it("silence twice → asks 'can you hear me?' once, then hangs up", async () => {
    const f = fakeIO({ heard: ["Hello", null, null], server: (b) => (b.opener ? { say: "Hi!" } : {}) });
    expect(await runOneCall(f.io, job)).toBe("hung_up");
    expect(f.said).toEqual(["Hi!", "Hello? Can you hear me?"]);
  });
  it("a slow answer gets a short filler first; they can talk over JARVIS; it follows their language", async () => {
    const f = fakeIO({ slowBrain: true, cutOn: "AI assistant", heard: ["Hello?", "हाँ बोलिए, क्या बात है?", "नहीं, अभी नहीं"],
      server: (b) => b.opener ? { say: "Hi! This is Jarvis, an AI assistant calling…" } : b.action === "turn" ? (String(b.heard).includes("नहीं") ? { say: "कोई बात नहीं, धन्यवाद!", end: true, lang: "hi" } : { say: "हम आपके लिए एक फ़्री डेमो वेबसाइट बनाना चाहते हैं।", lang: "hi" }) : {} });
    expect(await runOneCall(f.io, job)).toBe("ended");
    const turns = f.api.filter((a) => a.action === "turn" && !a.opener);
    expect(turns[0]).toMatchObject({ lang: "hi", interrupted: true }); // the opener was cut off
    expect(turns[1]).toMatchObject({ lang: "hi", interrupted: false });
    expect(f.said[1]).toBe("हाँ जी,"); // filler, in Hindi
    expect(f.langs.slice(1)).toEqual(["hi", "hi", "hi"]);
    expect(f.said).toContain("कोई बात नहीं, धन्यवाद!");
  });
  it("a quick answer needs no filler", async () => {
    const f = fakeIO({ heard: ["Hello", "Yes?"], server: (b) => (b.opener ? { say: "Hi!" } : b.action === "turn" ? { say: "Thanks, bye!", end: true } : {}) });
    await runOneCall(f.io, job);
    expect(f.said).toEqual(["Hi!", "Thanks, bye!"]);
  });

  it("Phone Link can't dial → failed with its reason", async () => {
    const f = fakeIO({ dial: { ok: false, error: "Phone Link did not open." }, heard: [] });
    expect(await runOneCall(f.io, job)).toBe("failed");
    expect(f.api[0]).toMatchObject({ action: "finish", reason: "failed", error: "Phone Link did not open." });
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("prospect calls: plan → your approval → call → CRM (integration)", () => {
  let userId = "";
  let C: typeof import("@/lib/calls/service");
  let P: typeof import("@/lib/prospects/service");
  const ask = (reply: object) => async () => JSON.stringify(reply);
  beforeAll(async () => {
    C = await import("@/lib/calls/service"); P = await import("@/lib/prospects/service");
    userId = (await getDb().user.create({ data: { email: `calls-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await getDb().profile.create({ data: { userId, timezone: "Asia/Kolkata" } }).catch(() => {});
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("nothing is dialled without your approval, outside hours, or with calling off", async () => {
    const a = await P.createProspect(userId, { businessName: "Iron Den Gym", phone: "098450 11111", category: "Gym" }, "jarvis");
    await P.createProspect(userId, { businessName: "No Phone Cafe" }, "jarvis");
    const plan = await C.planCalls(userId);
    expect(plan.calls.map((c) => c.name)).toEqual(["Iron Den Gym"]);
    expect(plan.calls[0].toNumber).toBe("+919845011111");
    expect(plan.skipped).toContainEqual({ name: "No Phone Cafe", reason: "no phone number" });
    expect((await C.planCalls(userId)).skipped).toContainEqual({ name: "Iron Den Gym", reason: "already planned" });

    await C.saveSettings(userId, { enabled: true, hoursFrom: "00:00", hoursTo: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
    expect((await C.callerNext(userId)).call).toBeNull(); // proposed ≠ approved
    await C.saveSettings(userId, { enabled: false });
    await C.approveBatch(userId, plan.batchId!);
    expect((await C.callerNext(userId)).wait).toMatch(/switched off/);
    await C.saveSettings(userId, { enabled: true, hoursFrom: "00:00", hoursTo: "00:01" });
    const outside = await C.callerNext(userId, new Date("2026-11-11T06:30:00Z"));
    expect(outside.wait).toMatch(/Outside calling hours/);
    await C.saveSettings(userId, { hoursFrom: "00:00", hoursTo: "23:59" });
    await expect(C.saveSettings(userId, { hoursFrom: "12:00", hoursTo: "11:00" })).rejects.toThrow(/end after/);
    await C.saveSettings(userId, { hoursFrom: "00:00", hoursTo: "23:59" });
    expect(a.id).toBeTruthy();
  });

  it("a real conversation: opener → turns → finish updates the CRM with summary, services and the demo", async () => {
    const n = await C.callerNext(userId);
    if (!n.call) throw new Error(n.wait);
    expect(n.call.opener).toMatch(/an AI assistant calling from Infinity Web & Apps/);
    expect((await C.callerNext(userId)).wait).toMatch(/already in progress/);
    const id = n.call.id;
    const o = await C.callerTurn(userId, id, "Hello?", { opener: true });
    expect(o.say).toBe(n.call.opener);
    await C.callerEvent(userId, id, "answered");
    const t1 = await C.callerTurn(userId, id, "Yes, tell me", { ask: ask({ say: "I saw Iron Den on Google — great reviews! You don't have a website yet. Could we make you a free demo?", end: false }) });
    expect(t1.say).toMatch(/free demo/);
    const t2 = await C.callerTurn(userId, id, "Okay, Thursday at 4 is fine. I'm Ravi, the owner.", { ask: ask({ say: "Lovely, Thursday 4 PM then — Harshavardhan will confirm on WhatsApp. Thanks Ravi!", end: true, outcome: "demo_booked", callbackAt: "2026-11-12T16:00:00+05:30" }) });
    expect(t2).toMatchObject({ end: true, outcome: "demo_booked" });
    const f = await C.callerFinish(userId, id, { reason: "ended" }, { ask: ask({ summary: "Ravi (owner) liked the free demo idea. Demo booked Thursday 4 PM.", outcome: "interested", interestedServices: ["Business Website"], decisionMaker: "Ravi (owner)", contactPerson: "Ravi" }) });
    expect(f).toMatchObject({ status: "completed", outcome: "demo_booked" });
    const p = await getDb().prospect.findFirstOrThrow({ where: { userId, businessName: "Iron Den Gym" } });
    expect(p).toMatchObject({ status: "demo_booked", nextAction: "Confirm the demo time on WhatsApp", contactPerson: "Ravi", decisionMaker: "Ravi (owner)", interestedServices: ["Business Website"] });
    expect(p.nextActionAt!.toISOString()).toBe("2026-11-12T10:30:00.000Z");
    const call = await getDb().prospectCall.findUniqueOrThrow({ where: { id } });
    expect((call.transcript as { who: string }[]).map((l) => l.who)).toEqual(["them", "jarvis", "them", "jarvis", "them", "jarvis"]);
    const ev = await getDb().prospectEvent.findMany({ where: { prospectId: p.id, kind: "note" } });
    expect(ev.some((e) => /Call \(spoke\): Ravi \(owner\)/.test(e.text))).toBe(true);
    // one call a day
    expect((await C.planCalls(userId, { prospectIds: [p.id] })).skipped[0]?.reason).toBeTruthy();
  });

  it("'don't call me again' ends the call at once and marks Do not contact forever", async () => {
    const x = await P.createProspect(userId, { businessName: "Sunrise Salon", phone: "+91 90000 22222", category: "Salon" }, "jarvis");
    const plan = await C.planCalls(userId, { prospectIds: [x.id] });
    await C.approveBatch(userId, plan.batchId!);
    const n = await C.callerNext(userId);
    const id = n.call!.id;
    await C.callerTurn(userId, id, "Hello", { opener: true }); await C.callerEvent(userId, id, "answered");
    const t = await C.callerTurn(userId, id, "Please don't call me again", { ask: async () => { throw new Error("the brain must not be needed"); } });
    expect(t).toMatchObject({ end: true, outcome: "do_not_call" });
    await C.callerFinish(userId, id, { reason: "ended" }, { ask: ask({ summary: "Asked not to be called.", outcome: "not_interested" }) });
    const p = await getDb().prospect.findUniqueOrThrow({ where: { id: x.id } });
    expect(p).toMatchObject({ doNotContact: true, status: "lost", lostReason: "not_interested" });
    expect((await C.planCalls(userId, { prospectIds: [x.id] })).skipped[0]).toMatchObject({ reason: "marked do-not-contact" });
  });

  it("Hindi on the call: 'फोन मत करना' gets a Hindi goodbye; an interrupted line is marked for the brain", async () => {
    const x = await P.createProspect(userId, { businessName: "Sharma Sweets", phone: "+91 90000 66666" }, "jarvis");
    await C.approveBatch(userId, (await C.planCalls(userId, { prospectIds: [x.id] })).batchId!);
    const n = await C.callerNext(userId);
    const id = n.call!.id;
    await C.callerTurn(userId, id, "हैलो?", { opener: true, lang: "hi" });
    await C.callerEvent(userId, id, "answered");
    let seen = "";
    await C.callerTurn(userId, id, "हाँ, बोलिए", { lang: "hi", interrupted: true, ask: async (sys, user) => { seen = `${sys}\n${user}`; return JSON.stringify({ say: "हम आपके लिए फ़्री डेमो बनाना चाहते हैं।", lang: "hi" }); } });
    expect(seen).toMatch(/\[interrupted\]/);
    expect(seen).toMatch(/looks like Hindi/);
    const t = await C.callerTurn(userId, id, "दोबारा फोन मत करना", { lang: "hi" });
    expect(t).toMatchObject({ end: true, outcome: "do_not_call", lang: "hi" });
    expect(t.say).toMatch(/दोबारा कॉल नहीं/);
    await C.callerFinish(userId, id, { reason: "ended" }, { ask: async () => JSON.stringify({ summary: "Asked not to be called.", outcome: "not_interested" }) });
    expect((await getDb().prospect.findUniqueOrThrow({ where: { id: x.id } })).doNotContact).toBe(true);
  });

  it("no answer → Not reachable; a failed dial is recorded; daily cap; a silent caller's call is closed", async () => {
    const y = await P.createProspect(userId, { businessName: "Corner Tailor", phone: "+91 90000 33333" }, "jarvis");
    const plan = await C.planCalls(userId, { prospectIds: [y.id] });
    await C.approveBatch(userId, plan.batchId!);
    const n = await C.callerNext(userId);
    const r = await C.callerFinish(userId, n.call!.id, { reason: "no_answer" });
    expect(r).toMatchObject({ status: "no_answer", outcome: "not_reachable" });
    expect((await getDb().prospect.findUniqueOrThrow({ where: { id: y.id } })).status).toBe("not_reachable");

    await C.saveSettings(userId, { dailyCap: 3 });
    const z = await P.createProspect(userId, { businessName: "Late Bakery", phone: "+91 90000 44444" }, "jarvis");
    await C.approveBatch(userId, (await C.planCalls(userId, { prospectIds: [z.id] })).batchId!);
    expect((await C.callerNext(userId)).wait).toMatch(/Today's 3 calls are done/);
    await C.saveSettings(userId, { dailyCap: 25 });
    const n2 = await C.callerNext(userId);
    await C.callerFinish(userId, n2.call!.id, { reason: "failed", error: "Phone Link did not open." });
    expect(await getDb().prospectCall.findUniqueOrThrow({ where: { id: n2.call!.id } })).toMatchObject({ status: "failed", error: "Phone Link did not open." });

    const w = await P.createProspect(userId, { businessName: "Quiet Gym", phone: "+91 90000 55555" }, "jarvis");
    await C.approveBatch(userId, (await C.planCalls(userId, { prospectIds: [w.id] })).batchId!);
    const n3 = await C.callerNext(userId);
    await getDb().prospectCall.update({ where: { id: n3.call!.id }, data: { heartbeatAt: new Date(Date.now() - C.STALE_MS - 1000) } });
    expect(await C.callsTick()).toBeGreaterThanOrEqual(1);
    expect((await getDb().prospectCall.findUniqueOrThrow({ where: { id: n3.call!.id } })).status).toBe("failed");
  });
});
