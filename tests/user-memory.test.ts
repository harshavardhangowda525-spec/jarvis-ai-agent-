import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { explicitMemory, isKnown, saveMemory, loadMemories } from "@/lib/ai/user-memory";
import { parseFacts, batchMessages, learnFromChats } from "@/lib/ai/learn";
import { getDb, isDbConfigured } from "@/lib/db";

describe("explicitMemory", () => {
  it.each([
    ["Remember that I take my coffee black", "I take my coffee black."],
    ["jarvis, remember my company is Infinity Web & Apps.", "My company is Infinity Web & Apps."],
    ["please keep in mind that I work from Bangalore", "I work from Bangalore."],
    ["From now on, keep your answers short", "From now on: Keep your answers short."],
  ])("%s", (text, fact) => expect(explicitMemory(text)).toBe(fact));

  it.each([
    "remember to call mom at 5",            // a reminder, not a fact
    "do you remember what I said?",          // a question
    "remember what my favourite colour is?", // a question
    "what's the weather in Bangalore",
  ])("ignores %s", (text) => expect(explicitMemory(text)).toBeNull());
});

describe("isKnown", () => {
  it("matches ignoring case/punctuation and inside longer facts", () => {
    expect(isKnown("Prefers short answers", ["prefers short answers."])).toBe(true);
    expect(isKnown("Lives in Bangalore", ["Lives in Bangalore with his family"])).toBe(true);
    expect(isKnown("Likes tea", ["Likes coffee"])).toBe(false);
  });
});

describe("parseFacts", () => {
  it("reads JSON inside code fences and drops secrets/short junk", () => {
    const facts = parseFacts('Sure!\n```json\n{"facts":[{"key":"company","content":"Runs Infinity Web & Apps."},{"key":"x","content":"ok"},{"key":"login","content":"His password is hunter2."}]}\n```');
    expect(facts).toEqual([{ key: "company", content: "Runs Infinity Web & Apps." }]);
  });
  it("returns [] for non-JSON", () => expect(parseFacts("no facts here")).toEqual([]));
});

describe("batchMessages", () => {
  it("keeps batches under the size limit and prefers the most recent", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => `message number ${i} `.repeat(10));
    const b = batchMessages(msgs, 1000, 3);
    expect(b).toHaveLength(3);
    expect(b.every((x) => x.length <= 1000)).toBe(true);
    expect(b.at(-1)).toContain("message number 49");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("memory storage + learning from chats (integration)", () => {
  let userId = "";
  beforeAll(async () => {
    const db = getDb();
    const u = await db.user.create({ data: { email: `mem-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id;
    const convo = await db.conversation.create({ data: { userId, title: "t" } });
    const texts = [
      "I run a web design agency called Infinity Web & Apps in Bangalore",
      "open darwin",
      "please keep replies short, I mostly use voice",
      "my api key is sk-123456 remember it",
      "what's the weather",
    ];
    for (const content of texts) await db.message.create({ data: { conversationId: convo.id, userId, role: "user", content } });
  });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });

  it("saveMemory refuses secrets and duplicates", async () => {
    expect(await saveMemory(userId, "My API key is abc")).toEqual({ saved: false, reason: "secret" });
    expect((await saveMemory(userId, "Prefers short answers.")).saved).toBe(true);
    expect(await saveMemory(userId, "prefers short answers")).toEqual({ saved: false, reason: "duplicate" });
  });

  it("learns lasting facts from past chats, skipping known ones; secrets never reach the model", async () => {
    const prompts: string[] = [];
    const fakeModel = async (_system: string, user: string) => {
      prompts.push(user);
      return JSON.stringify({ facts: [
        { key: "business", content: "Runs a web design agency called Infinity Web & Apps in Bangalore." },
        { key: "style", content: "Prefers short answers." },           // already remembered
        { key: "voice", content: "Mostly uses JARVIS by voice." },
      ] });
    };
    const r = await learnFromChats(userId, fakeModel);
    expect(r.scanned).toBe(3); // "open darwin" too short, secret-looking message dropped
    expect(prompts.join("\n")).not.toContain("sk-123456");
    expect(r.added).toEqual(["Runs a web design agency called Infinity Web & Apps in Bangalore.", "Mostly uses JARVIS by voice."]);
    expect(r.alreadyKnown).toBe(1);
    const mems = await loadMemories(userId);
    expect(mems.map((m) => m.content)).toContain("Mostly uses JARVIS by voice.");

    // Running it again adds nothing new.
    const again = await learnFromChats(userId, fakeModel);
    expect(again.added).toEqual([]);
  });
});
