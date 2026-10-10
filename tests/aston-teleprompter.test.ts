import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
const H = vi.hoisted(() => {
  process.env.ASTON_OWNER_EMAIL = "aston-tp-owner@example.com";
  process.env.GROQ_API_KEY = "gsk_tp_test_key_0000000000000000000000";
  class UnauthorizedError extends Error {}
  return { user: null as null | { id: string; email: string }, UnauthorizedError };
});
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: H.UnauthorizedError,
  getCurrentUser: async () => H.user,
  requireUser: async () => { if (!H.user) throw new H.UnauthorizedError("Unauthorized"); return H.user; },
}));

import { getDb, isDbConfigured } from "@/lib/db";
import { parseCommand, speedPx } from "@/lib/aston/scripts/commands";
import {
  detectKind, fromEditText, isOpenOnly, normalizeSections, SCRIPT_INTENT, splitDirections, stripWake, toEditText, wordCount,
  type ScriptSection,
} from "@/lib/aston/scripts/format";
import { WEBSITE_INTENT } from "@/lib/aston/site/assemble";
import { memoryStore, type GroqDeps } from "@/lib/aston/groq";
import { speakableText, voiceLabel, markSelfSpeech, isSelfSpeaking } from "@/lib/aston/voice";

describe("teleprompter · understanding requests", () => {
  it("routes every script request to the teleprompter (before the website builder)", () => {
    const asks = [
      "ASTON, create a sales script.", "ASTON, prepare a pitch for this business.", "ASTON, generate a cold-calling script.",
      "ASTON, create a WhatsApp pitching script.", "ASTON, prepare a script for my website demo.", "ASTON, open teleprompter.",
      "ASTON, create a cold-calling sales script for a cafe that needs a website.",
    ];
    for (const a of asks) expect(SCRIPT_INTENT.test(stripWake(a).text)).toBe(true);
    // it mentions "website", but it's a script — the teleprompter check runs first
    expect(WEBSITE_INTENT.test("create a cold-calling sales script for a cafe that needs a website")).toBe(true);
    expect(isOpenOnly("ASTON, open teleprompter.")).toBe(true);
    expect(isOpenOnly("ASTON, open the teleprompter with a cold call script")).toBe(false);
    expect(SCRIPT_INTENT.test("what needs my attention today")).toBe(false);
  });

  it("detects the kind of script", () => {
    expect(detectKind("create a cold-calling sales script for a cafe that needs a website")).toBe("cold_call");
    expect(detectKind("generate a cold-calling script")).toBe("cold_call");
    expect(detectKind("create a WhatsApp pitching script")).toBe("whatsapp");
    expect(detectKind("prepare a script for my website demo")).toBe("zoom_demo");
    expect(detectKind("Instagram DM pitch for a salon")).toBe("instagram_dm");
    expect(detectKind("handle objections when they say it's too expensive")).toBe("objections");
    expect(detectKind("follow-up script after yesterday's demo")).toBe("follow_up");
    expect(detectKind("script for closing the sale")).toBe("closing");
    expect(detectKind("explain the benefits of an app")).toBe("benefits");
    expect(detectKind("prepare a pitch for this business")).toBe("general");
  });

  it("strips the wake word (including common mis-hearings)", () => {
    expect(stripWake("ASTON, create a script")).toEqual({ text: "create a script", woke: true });
    expect(stripWake("Hey Austin pause")).toEqual({ text: "pause", woke: true });
    expect(stripWake("Ashton: faster")).toEqual({ text: "faster", woke: true });
    expect(stripWake("create a script")).toEqual({ text: "create a script", woke: false });
  });
});

describe("teleprompter · voice commands", () => {
  it("understands every documented command", () => {
    const cases: [string, string][] = [
      ["ASTON, start teleprompter.", "start"], ["ASTON, pause.", "pause"], ["ASTON, resume.", "resume"],
      ["ASTON, scroll faster.", "faster"], ["ASTON, scroll slower.", "slower"],
      ["ASTON, increase text size.", "bigger"], ["ASTON, decrease text size.", "smaller"],
      ["ASTON, restart the script.", "restart"], ["ASTON, go to the next section.", "next"],
      ["ASTON, repeat the last section.", "repeat"], ["ASTON, edit the script.", "edit"],
      ["ASTON, close teleprompter.", "close"], ["ASTON stop", "stop"], ["Austin, slow down", "slower"],
      ["ASTON, start again", "restart"], ["ASTON full screen", "fullscreen"], ["ASTON, stop scrolling", "pause"],
    ];
    for (const [say, action] of cases) expect([say, parseCommand(say)]).toEqual([say, action]);
  });

  it("exact short phrases work without the name (whole sentence only)", () => {
    const cases: [string, string][] = [
      ["Start scrolling.", "start"], ["Pause.", "pause"], ["Resume.", "resume"], ["Scroll faster.", "faster"], ["Scroll slower", "slower"],
      ["Increase text size.", "bigger"], ["Go to the next section.", "next"], ["Repeat this section.", "repeat"],
      ["Restart the script.", "restart"], ["Close teleprompter.", "close"],
    ];
    for (const [say, action] of cases) expect([say, parseCommand(say)]).toEqual([say, action]);
  });

  it("never treats the pitch itself as a command", () => {
    // things you'd actually say to a client while reading
    for (const say of [
      "Can I pause you there for a second?", "Let's start with your menu", "We can make the text bigger on your website",
      "Shall we go to the next step and book a demo?", "stop", "faster",
    ]) expect(parseCommand(say)).toBeNull();
    // a long sentence that starts with the name isn't a command either
    expect(parseCommand("Aston Martin makes cars and our website could pause the scroll and start faster for you")).toBeNull();
    expect(parseCommand("ASTON")).toBeNull();
    expect(parseCommand("ASTON, what's the weather")).toBeNull();
  });

  it("speed scales with the text size", () => {
    expect(speedPx(4, 40, 1.5)).toBeCloseTo(18);
    expect(speedPx(8, 40, 1.5)).toBe(2 * speedPx(4, 40, 1.5));
  });
});

describe("teleprompter · read aloud", () => {
  it("speaks your words: directions dropped, fill-ins said plainly", () => {
    expect(speakableText("Hi, is this the owner of [Business name]? [Pause] Great. [Smile]")).toBe("Hi, is this the owner of Business name? Great.");
    expect(speakableText("[Wait for response]")).toBe("");
  });
  it("labels the voice honestly", () => {
    expect(voiceLabel({ lang: "en-GB", name: "Google UK English Male" } as SpeechSynthesisVoice)).toBe("British English");
    expect(voiceLabel({ lang: "en-IN", name: "x" } as SpeechSynthesisVoice)).toBe("Indian English");
    expect(voiceLabel(null)).toBe("No voice available");
  });
  it("its own voice is ignored by the microphone while speaking and just after", () => {
    markSelfSpeech(true);
    expect(isSelfSpeaking()).toBe(true);
    markSelfSpeech(false);
    expect(isSelfSpeaking()).toBe(true); // a short tail after speech ends
  });
});

describe("teleprompter · script format", () => {
  const sections: ScriptSection[] = [
    { heading: "Opening", lines: [{ who: "you", text: "Hi, is this [Owner's name]? [Pause] I'm calling from Infinity Web & Apps." }, { who: "note", text: "Wait for response" }] },
    { heading: "It's too expensive", lines: [{ who: "client", text: "That sounds expensive." }, { who: "you", text: "I understand. A website starts around ₹4,999." }] },
  ];
  it("round-trips through the edit format", () => {
    const text = toEditText(sections);
    expect(text).toContain("## Opening");
    expect(text).toContain("> Client: That sounds expensive.");
    expect(text).toContain("[Wait for response]");
    expect(fromEditText(text)).toEqual(sections);
    expect(fromEditText("Just one line")).toEqual([{ heading: "", lines: [{ who: "you", text: "Just one line" }] }]);
  });
  it("keeps directions and client lines out of what you read aloud", () => {
    expect(splitDirections("Hi there. [Pause] Great.")).toEqual([{ t: "Hi there. ", dir: false }, { t: "[Pause]", dir: true }, { t: " Great.", dir: false }]);
    // a fill-in is said (highlighted), a direction isn't
    expect(splitDirections("Hi [Owner's name], [smile] [Short pause]")).toEqual([
      { t: "Hi ", dir: false }, { t: "[Owner's name]", dir: false, slot: true }, { t: ", ", dir: false }, { t: "[smile]", dir: true }, { t: " ", dir: false }, { t: "[Short pause]", dir: true },
    ]);
    expect(wordCount(sections)).toBe(19); // "you" lines only; [Pause] removed, [Owner's name] kept
  });
  it("drops malformed or empty parts", () => {
    expect(normalizeSections([{ heading: "A", lines: [{ who: "you", text: "ok" }] }, { heading: "B", lines: [] }, "junk", { lines: [{ who: "boss", text: "x" }] }]))
      .toEqual([{ heading: "A", lines: [{ who: "you", text: "ok" }] }, { heading: "", lines: [{ who: "you", text: "x" }] }]);
    expect(normalizeSections(null)).toEqual([]);
  });
});

const d = isDbConfigured ? describe : describe.skip;
const OWNER = "aston-tp-owner@example.com";

function fakeGroq(reply: unknown | (() => never)): Partial<GroqDeps> & { bodies: { messages: { content: string }[] }[] } {
  const bodies: { messages: { content: string }[] }[] = [];
  return {
    bodies, store: memoryStore(), sleep: async () => {}, now: () => Date.now(),
    async create(body) {
      bodies.push(body as never);
      if (typeof reply === "function") (reply as () => never)();
      return { headers: {}, data: { choices: [{ message: { content: JSON.stringify(reply) } }] } as never };
    },
  };
}

const SCRIPT = {
  title: "Cold call — café website", kind: "cold_call", businessType: "Café",
  details: { industry: "Café", service: "Website development", price: "around ₹4,999" },
  sections: [
    { heading: "Opening", lines: [{ who: "you", text: "Hi, is this the owner of [Business name]? [Pause]" }, { who: "note", text: "Wait for response" }] },
    { heading: "Next step", lines: [{ who: "you", text: "Could I show you a quick demo this week?" }, { who: "client", text: "Sure, Thursday works." }] },
  ],
};

d("teleprompter · scripts in the database", () => {
  let userId = "", otherId = "";
  let S: typeof import("@/lib/aston/scripts/service");
  beforeAll(async () => {
    await getDb().user.deleteMany({ where: { email: { in: [OWNER, "aston-tp-other@example.com"] } } });
    userId = (await getDb().user.create({ data: { email: OWNER, passwordHash: "x" } })).id;
    otherId = (await getDb().user.create({ data: { email: "aston-tp-other@example.com", passwordHash: "x" } })).id;
    S = await import("@/lib/aston/scripts/service");
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: { in: [userId, otherId] } } }).catch(() => {}); });
  beforeEach(async () => { await getDb().astonScript.deleteMany({ where: { userId } }); H.user = { id: userId, email: OWNER }; });

  it("generates a script with the business defaults and stores it as a draft", async () => {
    const groq = fakeGroq(SCRIPT);
    const s = await S.generateScript(userId, { request: "create a cold-calling sales script for a cafe that needs a website" }, groq);
    expect(s).toMatchObject({ kind: "cold_call", kindLabel: "Cold call", businessType: "Café", saved: false });
    expect(s.sections).toHaveLength(2);
    const sys = groq.bodies[0].messages[0].content;
    expect(sys).toContain("Infinity Web & Apps");
    expect(sys).toContain("₹4,999");
    expect(sys).toContain("₹55,000");
    expect(sys).toMatch(/never invent client details.*discounts, guarantees/i);
    expect(sys).toContain("Cold call");
  });

  it("your details override, and a regenerate keeps the same script", async () => {
    const s = await S.generateScript(userId, { request: "pitch for a gym" }, fakeGroq(SCRIPT));
    const groq = fakeGroq(SCRIPT);
    const r = await S.generateScript(userId, { id: s.id, request: s.request, kind: "whatsapp", details: { businessName: "Peak Gym", price: "₹6,999" } }, groq);
    expect(r.id).toBe(s.id);
    expect(r.kind).toBe("whatsapp"); // the chosen kind wins over the model's
    expect(r.details).toMatchObject({ businessName: "Peak Gym", price: "₹6,999" });
    expect(groq.bodies[0].messages[1].content).toContain('"businessName":"Peak Gym"');
    expect(await getDb().astonScript.count({ where: { userId } })).toBe(1);
  });

  it("handles empty scripts and Groq failures without saving junk", async () => {
    await expect(S.generateScript(userId, { request: "cold call script" }, fakeGroq({ title: "x", sections: [] }))).rejects.toMatchObject({ status: 502 });
    const limited = fakeGroq(() => { throw Object.assign(new Error("Rate limit reached on requests per day (RPD)"), { status: 429, headers: {} }); });
    const err = await S.generateScript(userId, { request: "cold call script" }, limited).catch((e) => e);
    expect(err).toBeInstanceOf(S.ScriptError);
    expect(err.status).toBe(429);
    expect(err.message).not.toContain("gsk_");
    expect(await getDb().astonScript.count({ where: { userId } })).toBe(0);
  });

  it("edits, renames and saves persist (a reload sees them)", async () => {
    const s = await S.generateScript(userId, { request: "cold call script for a café" }, fakeGroq(SCRIPT));
    const edited = fromEditText(toEditText(s.sections) + "\n\n## Close\nThanks for your time, [Owner's name].");
    await S.updateScript(userId, s.id, { sections: edited, title: "Brew Lab call", saved: true });
    const again = await S.getScript(userId, s.id);
    expect(again).toMatchObject({ title: "Brew Lab call", saved: true });
    expect(again.sections.at(-1)).toEqual({ heading: "Close", lines: [{ who: "you", text: "Thanks for your time, [Owner's name]." }] });
    await expect(S.updateScript(userId, s.id, { sections: [] })).rejects.toThrow(/can't be empty/);
    await expect(S.updateScript(userId, s.id, { title: "   " })).rejects.toThrow(/needs a name/);
  });

  it("library: search, filter, scope, duplicate and delete", async () => {
    const a = await S.generateScript(userId, { request: "cold call for a café" }, fakeGroq(SCRIPT));
    const b = await S.generateScript(userId, { request: "whatsapp pitch for a gym" }, fakeGroq({ ...SCRIPT, title: "Gym WhatsApp", kind: "whatsapp", businessType: "Gym" }));
    await S.updateScript(userId, a.id, { saved: true });
    await S.updateScript(userId, b.id, { saved: true });
    await S.generateScript(userId, { request: "draft only" }, fakeGroq({ ...SCRIPT, title: "Draft" }));
    expect((await S.listScripts(userId)).scripts.map((x) => x.title).sort()).toEqual(["Cold call — café website", "Gym WhatsApp"]);
    expect((await S.listScripts(userId, { scope: "recent" })).scripts).toHaveLength(3);
    expect((await S.listScripts(userId, { q: "gym" })).scripts.map((x) => x.id)).toEqual([b.id]);
    expect((await S.listScripts(userId, { kind: "whatsapp" })).scripts.map((x) => x.id)).toEqual([b.id]);
    const byType = await S.listScripts(userId, { businessType: "café" });
    expect(byType.scripts.map((x) => x.id)).toEqual([a.id]);
    expect(byType.businessTypes).toEqual(["Café", "Gym"]);
    const copy = await S.duplicateScript(userId, a.id);
    expect(copy).toMatchObject({ title: "Cold call — café website (copy)", saved: true, sections: a.sections });
    await S.deleteScript(userId, a.id);
    await expect(S.getScript(userId, a.id)).rejects.toMatchObject({ status: 404 });
    // another user's script is invisible
    await expect(S.getScript(otherId, b.id)).rejects.toMatchObject({ status: 404 });
  });

  it("routes are owner-only", async () => {
    const s = await S.generateScript(userId, { request: "cold call for a café" }, fakeGroq(SCRIPT));
    const list = (await import("@/app/api/aston/scripts/route")).GET;
    const one = await import("@/app/api/aston/scripts/[id]/route");
    H.user = null;
    expect((await list(new Request("http://x/api/aston/scripts"))).status).toBe(401);
    H.user = { id: otherId, email: "aston-tp-other@example.com" };
    expect((await one.GET(new Request("http://x"), { params: { id: s.id } })).status).toBe(403);
    H.user = { id: userId, email: OWNER };
    expect((await one.GET(new Request("http://x"), { params: { id: s.id } })).status).toBe(200);
    const patched = await one.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ title: "Renamed", saved: true }) }), { params: { id: s.id } });
    expect((await patched.json()).data).toMatchObject({ title: "Renamed", saved: true });
    const gen = (await import("@/app/api/aston/scripts/route")).POST;
    expect((await gen(new Request("http://x", { method: "POST", body: JSON.stringify({ request: "x" }) }))).status).toBe(422);
    expect((await one.DELETE(new Request("http://x"), { params: { id: s.id } })).status).toBe(200);
  });
});
