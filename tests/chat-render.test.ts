import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/chat/markdown";
import { speakable } from "@/components/chat/voice-mode";
import { CHAT_AGENTS, isChatAgent } from "@/lib/agents/catalog";

const html = (md: string) => renderToStaticMarkup(createElement(Markdown, { text: md }));

describe("chat Markdown", () => {
  it("renders headings, lists, tables, code and links", () => {
    const h = html("## Leads\n\n- one\n- two\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| x | y |\n\n```js\nconst a = 1;\n```\n\nSee [docs](https://example.com) and **bold** `code`.");
    expect(h).toContain("<h3");
    expect(h).toMatch(/<ul class="md-ul"><li>one<\/li><li>two<\/li><\/ul>/);
    expect(h).toMatch(/<ol class="md-ol"><li>first<\/li>/);
    expect(h).toContain("<th>A</th>");
    expect(h).toContain("const a = 1;");
    expect(h).toContain('href="https://example.com"');
    expect(h).toContain("<strong>bold</strong>");
  });
  it("never renders HTML or unsafe links from a reply", () => {
    const h = html('<img src=x onerror=alert(1)> [click](javascript:alert(1)) <script>bad()</script>');
    expect(h).not.toContain("<img");
    expect(h).not.toContain("<script");
    expect(h).not.toContain('href="javascript');
    expect(h).toContain("&lt;img");
  });
  it("keeps a code block readable while it's still streaming (no closing fence yet)", () => {
    expect(html("```py\nprint(1)")).toContain("print(1)");
  });
});

describe("voice mode", () => {
  it("reads replies aloud without Markdown, and not as an essay", () => {
    expect(speakable("**Done** — see [the list](https://x.y) and `this`.")).toBe("Done — see the list and this.");
    expect(speakable("```js\nx()\n```\nAll set.")).toBe("(code in the chat) All set.");
    const long = speakable("This is a sentence. ".repeat(60), 120);
    expect(long.length).toBeLessThan(170);
    expect(long).toMatch(/The rest is in the chat\.$/);
  });
  it("knows the chat agents (JARVIS isn't one — it keeps its voice console)", () => {
    expect(Object.keys(CHAT_AGENTS).sort()).toEqual(["darwin", "ev", "mike", "robin"]);
    expect(isChatAgent("jarvis")).toBe(false);
    expect(isChatAgent("darwin")).toBe(true);
  });
});
