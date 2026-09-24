import { describe, it, expect } from "vitest";
import { instantAnswer } from "@/lib/instant";

const now = new Date(2026, 8, 24, 16, 5);

describe("instantAnswer", () => {
  it.each(["what time is it?", "Jarvis, what's the time", "time now"])("time: %s", (q) => {
    expect(instantAnswer(q, now)).toMatch(/^It's 4:05\s?PM\.$/i);
  });
  it.each(["what's the date today", "what day is it", "today's date"])("date: %s", (q) => {
    expect(instantAnswer(q, now)).toMatch(/Thursday.*(24.*September|September.*24).*2026/);
  });
  it.each([
    ["what is 25 times 4", "That's 100."],
    ["calculate 18% of 2500", "That's 450."],
    ["12.5 + 7 / 2", "That's 16."],
    ["what's 2,500 plus 1,200", "That's 3,700."],
    ["how much is 10 divided by 4", "That's 2.5."],
    ["-3 * (2 + 1)", "That's -9."],
  ])("math: %s", (q, a) => expect(instantAnswer(q, now)).toBe(a));
  it.each([
    "what time does the store close",
    "what is the capital of france",
    "open darwin",
    "find 20 gyms in bangalore",
    "2026",
    "what is 5",
    "call 9845012345",
  ])("leaves %s to the AI", (q) => expect(instantAnswer(q, now)).toBeNull());
});
