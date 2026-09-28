import { describe, it, expect } from "vitest";
import { parseOpenLinkRef, parseOpenSite, pickLink, resolveSite } from "@/lib/open-site";
import { openLinkTool } from "@/lib/tools/openLink";

describe("open a website instantly", () => {
  it("understands 'open <site>' for well-known sites", () => {
    expect(parseOpenSite("open amazon")).toEqual({ url: "https://www.amazon.com/", label: "Amazon" });
    expect(parseOpenSite("Jarvis, open Amazon.", { india: true })).toEqual({ url: "https://www.amazon.in/", label: "Amazon" });
    expect(parseOpenSite("go to youtube")?.url).toBe("https://www.youtube.com/");
    expect(parseOpenSite("please open up the flipkart website")?.url).toBe("https://www.flipkart.com/");
    expect(parseOpenSite("open chrome")?.url).toBe("https://www.google.com/");
  });

  it("searches on the site when asked", () => {
    expect(parseOpenSite("open amazon and search for wireless earbuds", { india: true })?.url).toBe("https://www.amazon.in/s?k=wireless%20earbuds");
    expect(parseOpenSite("search youtube for lofi music")?.url).toBe("https://www.youtube.com/results?search_query=lofi%20music");
    expect(parseOpenSite("search for running shoes on flipkart")?.url).toBe("https://www.flipkart.com/search?q=running%20shoes");
  });

  it("opens any address", () => {
    expect(parseOpenSite("open infinitywebandapps.com")?.url).toBe("https://infinitywebandapps.com/");
    expect(parseOpenSite("visit https://example.com/Some/Path")?.url).toBe("https://example.com/Some/Path");
  });

  it("opens links however they're said", () => {
    expect(parseOpenSite("open youtube in a new tab")?.url).toBe("https://www.youtube.com/");
    expect(parseOpenSite("Jarvis, could you please open gmail in a new tab for me?")?.url).toBe("https://mail.google.com/");
    expect(parseOpenSite("open this link https://github.com/vercel/next.js/issues?q=is%3Aopen")?.url).toBe("https://github.com/vercel/next.js/issues?q=is%3Aopen");
    expect(parseOpenSite("open the link: www.example.org/docs")?.url).toBe("https://www.example.org/docs");
    expect(parseOpenSite("https://news.ycombinator.com/item?id=1")?.url).toBe("https://news.ycombinator.com/item?id=1");
    expect(parseOpenSite("www.flipkart.com")?.url).toBe("https://www.flipkart.com/");
    expect(parseOpenSite("open localhost:3000/dashboard")?.url).toBe("http://localhost:3000/dashboard");
    expect(parseOpenSite("open http://192.168.1.1")?.url).toBe("http://192.168.1.1/");
    expect(parseOpenSite("go to example.com/Path in my browser")?.url).toBe("https://example.com/Path");
    expect(parseOpenSite("open amazon in a new window and search for usb cable", { india: true })?.url).toBe("https://www.amazon.in/s?k=usb%20cable");
    expect(parseOpenSite("open a new tab")?.url).toBe("https://www.google.com/");
  });

  it("finds a link JARVIS already showed", () => {
    const msgs = [
      { role: "assistant", links: [{ url: "https://old.example.com/", label: "Old" }] },
      { role: "user" },
      { role: "assistant", links: [{ url: "https://a.com/", label: "A" }, { url: "https://b.com/", label: "B" }] },
      { role: "assistant", content: "no links" },
    ];
    expect(pickLink(msgs, parseOpenLinkRef("open that link")!)?.url).toBe("https://a.com/");
    expect(pickLink(msgs, parseOpenLinkRef("Jarvis, open the second link in a new tab")!)?.url).toBe("https://b.com/");
    expect(pickLink(msgs, parseOpenLinkRef("click the last link")!)?.url).toBe("https://b.com/");
    expect(pickLink(msgs, parseOpenLinkRef("open the fifth link")!)).toBeNull();
    expect(pickLink([], parseOpenLinkRef("open the link")!)).toBeNull();
    for (const t of ["open linkedin", "open the link to amazon.com", "what is a link", "open youtube"]) expect(parseOpenLinkRef(t)).toBeNull();
  });

  it("never turns a bare word, localhost or a non-web scheme into a link", () => {
    for (const t of ["localhost", "open localhost", "node.js", "open javascript:alert(1)", "open file:///etc/passwd"]) expect(parseOpenSite(t)).toBeNull();
  });

  it("leaves everything else to JARVIS (its own pages, tasks, questions)", () => {
    for (const t of ["open settings", "open my notes", "open darwin", "search for the best laptop", "what is amazon", "find gyms in bangalore", "open the pod bay doors"]) {
      expect(parseOpenSite(t)).toBeNull();
    }
  });
});

describe("open_link tool", () => {
  const ctx = { userId: "u", timezone: "Asia/Kolkata", activity: () => {} };
  it("accepts plain names, bare domains and a search", async () => {
    expect((await openLinkTool.execute({ site: "amazon", search: "iphone case" }, ctx)).data).toMatchObject({ openUrl: "https://www.amazon.in/s?k=iphone%20case" });
    expect((await openLinkTool.execute({ url: "www.flipkart.com" }, ctx)).data).toMatchObject({ openUrl: "https://www.flipkart.com/" });
    expect(resolveSite("YouTube")?.label).toBe("YouTube");
  });
  it("an unknown name becomes a Google search, never a made-up address", async () => {
    const r = await openLinkTool.execute({ site: "my cousin's bakery" }, ctx);
    expect((r.data as any).openUrl).toBe("https://www.google.com/search?q=my%20cousin's%20bakery");
    await expect(openLinkTool.execute({ url: "javascript:alert(1)" }, ctx)).rejects.toThrow();
  });
});
