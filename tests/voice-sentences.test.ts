import { describe, it, expect } from "vitest";
import { takeSentences, cleanForSpeech } from "@/lib/voice/sentences";

describe("takeSentences", () => {
  it("releases the first full sentence early and keeps the unfinished tail", () => {
    const r = takeSentences("It's 24 degrees in Bangalore. Light rain is exp", true);
    expect(r.pieces).toEqual(["It's 24 degrees in Bangalore."]);
    expect(r.rest).toBe("Light rain is exp");
  });

  it("waits while there's no sentence boundary yet", () => {
    expect(takeSentences("The answer is 3.5 so", true)).toEqual({ pieces: [], rest: "The answer is 3.5 so" });
  });

  it("merges short later sentences so speech flows", () => {
    const r = takeSentences("Sure. Done. I saved the note to your list. ", false);
    expect(r.pieces).toEqual(["Sure. Done. I saved the note to your list."]);
  });

  it("flush returns everything left, cleaned", () => {
    const r = takeSentences("See **this** [link](https://x.com) now", false, true);
    expect(r.pieces).toEqual(["See this link now"]);
    expect(r.rest).toBe("");
  });

  it("streaming chunk by chunk speaks every word exactly once", () => {
    const text = "Good morning, Harsha. You have three tasks today. The first one is the client call at ten. Want me to set a reminder?";
    let buf = "", spoken: string[] = [], first = true;
    for (const ch of text.match(/.{1,7}/g)!) {
      buf += ch;
      const r = takeSentences(buf, first);
      if (r.pieces.length) first = false;
      spoken.push(...r.pieces); buf = r.rest;
    }
    spoken.push(...takeSentences(buf, first, true).pieces);
    expect(spoken.join(" ")).toBe(text);
    expect(spoken[0]).toBe("Good morning, Harsha.");
  });
});

describe("cleanForSpeech", () => {
  it("drops code blocks, bullets and urls", () => {
    expect(cleanForSpeech("- one\n- two ```x=1``` see https://a.b/c")).toBe("one two see");
  });
});
