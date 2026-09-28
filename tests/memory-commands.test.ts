import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseMemoryCommand, subjectKey, inSecondPerson } from "@/lib/memory/intent";
import { saveMemory, loadMemories, forgetMemories, explicitMemory } from "@/lib/ai/user-memory";
import { getDb, isDbConfigured } from "@/lib/db";

describe("what counts as 'remember this'", () => {
  it.each([
    ["Remember that my favourite colour is blue", "My favourite colour is blue."],
    ["Jarvis, remember: I'm allergic to peanuts.", "I'm allergic to peanuts."],
    ["can you remember that my sister's name is Priya?", "My sister's name is Priya."],
    ["Could you please remember my gym is Iron Temple", "My gym is Iron Temple."],
    ["don't forget that I have NIOS exams in October", "I have NIOS exams in October."],
    ["keep in mind that I prefer Tamil songs", "I prefer Tamil songs."],
    ["memorize this: my car is a white Swift", "My car is a white Swift."],
    ["note that the office wifi name is InfinityHQ", "The office wifi name is InfinityHQ."],
    ["save this to your memory: I wake up at 6", "I wake up at 6."],
    ["for future reference, my laptop is an HP Victus", "My laptop is an HP Victus."],
    ["From now on, call me boss", "From now on: Call me boss."],
    ["remember this - Harsha likes filter coffee", "Harsha likes filter coffee."],
  ])("%s", (t, fact) => { expect(parseMemoryCommand(t)).toEqual({ kind: "remember", fact }); });

  it.each([
    "remember to call mom at 5",            // a reminder (task), not a fact
    "do you remember what I said?",          // a question
    "remember what my favourite colour is?",
    "what's my favourite colour?",
    "remember",
    "open spotify",
  ])("not a memory instruction: %s", (t) => { expect(parseMemoryCommand(t)).toBeNull(); });

  it("forget + list", () => {
    expect(parseMemoryCommand("forget my favourite colour")).toEqual({ kind: "forget", query: "my favourite colour" });
    expect(parseMemoryCommand("Forget what I told you about the gym.")).toEqual({ kind: "forget", query: "the gym" });
    expect(parseMemoryCommand("delete my car from your memory")).toEqual({ kind: "forget", query: "my car" });
    expect(parseMemoryCommand("forget this event")).toBeNull(); // the briefing's command
    expect(parseMemoryCommand("forget it")).toBeNull();
    expect(parseMemoryCommand("What do you remember about me?")).toEqual({ kind: "list" });
    expect(parseMemoryCommand("show my memories")).toEqual({ kind: "list" });
  });

  it("the old API still works", () => {
    expect(explicitMemory("Remember that I take my coffee black")).toBe("I take my coffee black.");
    expect(explicitMemory("do you remember what I said?")).toBeNull();
  });

  it("knows what a fact is about, and says it back naturally", () => {
    expect(subjectKey("My favourite colour is blue.")).toBe("favourite colour");
    expect(subjectKey("My favorite color is green.")).toBe("favourite colour");
    expect(subjectKey("Call me Harsha.")).toBe("name");
    expect(subjectKey("I live in Bengaluru.")).toBe("where i live");
    expect(subjectKey("I'm allergic to peanuts.")).toBeNull();
    expect(inSecondPerson("My favourite colour is blue.")).toBe("your favourite colour is blue");
    expect(inSecondPerson("I'm allergic to peanuts.")).toBe("you're allergic to peanuts");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("memory that sticks (integration)", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `memcmd-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("a correction replaces the old fact instead of piling up", async () => {
    expect((await saveMemory(userId, "My favourite colour is blue.", { replace: true })).saved).toBe(true);
    const r = await saveMemory(userId, "My favorite color is green.", { replace: true });
    expect(r).toMatchObject({ saved: true, updated: true, previous: "My favourite colour is blue." });
    const all = await getDb().memory.findMany({ where: { userId } });
    expect(all.map((m) => m.content)).toEqual(["My favorite color is green."]);
    expect(await saveMemory(userId, "my favorite color is green", { replace: true })).toEqual({ saved: false, reason: "duplicate" });
  });

  it("refuses secrets", async () => {
    expect(await saveMemory(userId, "My bank PIN is 4321.", { replace: true })).toEqual({ saved: false, reason: "secret" });
  });

  it("what you asked to remember always reaches the prompt, even under lots of learned facts", async () => {
    await saveMemory(userId, "I'm allergic to peanuts.", { source: "user", replace: true });
    for (let i = 0; i < 80; i++) await getDb().memory.create({ data: { userId, content: `Learned fact number ${i} about projects.`, source: "learned" } });
    const mems = await loadMemories(userId, 60);
    const texts = mems.map((m) => m.content);
    expect(texts.slice(0, 2)).toEqual(expect.arrayContaining(["I'm allergic to peanuts.", "My favorite color is green."]));
    expect(texts.length).toBeLessThanOrEqual(62);
  });

  it("forgets by description, and never guesses when it's ambiguous", async () => {
    expect(await forgetMemories(userId, "my favourite colour")).toEqual({ removed: ["My favorite color is green."], ambiguous: [] });
    expect((await forgetMemories(userId, "learned fact about projects")).ambiguous.length).toBeGreaterThan(3);
    expect(await getDb().memory.count({ where: { userId, source: "learned" } })).toBe(80);
    expect((await forgetMemories(userId, "my boat")).removed).toEqual([]);
  });
});
