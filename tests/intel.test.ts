import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";
import { parseFeed, splitPublisher } from "@/lib/intel/rss";
import { categorize } from "@/lib/intel/topics";
import { istInstant } from "@/lib/trading/week";

const now = new Date(istInstant("2026-10-25", 9));
const iso = (h: number) => new Date(now.getTime() - h * 3600_000).toUTCString();
const rss = (items: { t: string; l: string; d?: string; h?: number; src?: string }[]) =>
  `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title><![CDATA[${i.t}]]></title><link>${i.l}</link><pubDate>${iso(i.h ?? 2)}</pubDate>${i.d ? `<description>&lt;p&gt;${i.d}&lt;/p&gt;</description>` : ""}${i.src ? `<source url="x">${i.src}</source>` : ""}</item>`).join("")}</channel></rss>`;

describe("feeds and classification", () => {
  it("reads RSS with CDATA, entities, publisher and date", () => {
    const items = parseFeed(rss([{ t: "Meta &amp; Ray-Ban launch new smart glasses", l: "https://x.com/a?utm_source=rss", d: "The glasses ship in India" }]), "The Verge");
    expect(items[0]).toMatchObject({ title: "Meta & Ray-Ban launch new smart glasses", publisher: "The Verge", summary: "The glasses ship in India" });
    expect(items[0].publishedAt).toBeInstanceOf(Date);
    expect(splitPublisher("Nvidia unveils chip - Reuters", null)).toEqual({ title: "Nvidia unveils chip", publisher: "Reuters" });
  });
  it("puts headlines in radar categories", () => {
    expect(categorize("Ransomware hits Indian hospital data")).toBe("cyber");
    expect(categorize("New AI coding assistant for developers")).toBe("ai");
    expect(categorize("RBI keeps interest rate unchanged as inflation eases")).toBe("economic");
    expect(categorize("nothing matches here", "commerce")).toBe("commerce");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("business intelligence pipeline (integration)", () => {
  let userId = "";
  let C: typeof import("@/lib/intel/collect");
  let B: typeof import("@/lib/intel/briefing");
  let A: typeof import("@/lib/intel/analyze");
  let O: typeof import("@/lib/intel/opportunities");
  let S: typeof import("@/lib/intel/service");
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    if (url.includes("techcrunch")) return new Response(rss([
      { t: "OpenAI launches new AI coding agent for developers", l: "https://techcrunch.com/ai-agent", d: "The agent writes and reviews code in the browser.", h: 3 },
      { t: "Old story", l: "https://techcrunch.com/old", h: 24 * 20 },
    ]));
    if (url.includes("engadget")) return new Response(rss([{ t: "OpenAI launches new AI coding agent for developers worldwide", l: "https://engadget.com/agent", d: "OpenAI's coding agent", h: 4 }]));
    if (url.includes("news.google.com") && url.includes("smart%20glasses")) return new Response(rss([{ t: "Smart glasses sales jump in India - Economic Times", l: "https://news.google.com/rss/articles/abc", h: 5 }]));
    if (url.includes("googleapis.com/youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: "UC1", snippet: { title: "OpenAI" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] }));
    if (url.includes("playlistItems")) return new Response(JSON.stringify({ items: [{ contentDetails: { videoId: "vLive" } }, { contentDetails: { videoId: "vOld" } }] }));
    if (url.includes("youtube/v3/videos")) return new Response(JSON.stringify({ items: [
      { id: "vLive", snippet: { title: "OpenAI DevDay livestream", description: "Keynote", publishedAt: now.toISOString(), channelTitle: "OpenAI", channelId: "UC1", liveBroadcastContent: "live", thumbnails: { high: { url: "https://i.ytimg.com/x.jpg" } } }, liveStreamingDetails: { concurrentViewers: "1200", actualStartTime: now.toISOString() } },
      { id: "vOld", snippet: { title: "Recap", description: "", publishedAt: now.toISOString(), channelTitle: "OpenAI", channelId: "UC1", liveBroadcastContent: "none" } },
    ] }));
    return new Response("<rss><channel></channel></rss>");
  }) as unknown as typeof fetch;

  const ai = {
    provider: "test",
    ask: async (system: string, user: string) => {
      if (system.includes("For each news item")) {
        const items = JSON.parse(user.slice(user.indexOf("["))) as { id: string; headline: string }[];
        return JSON.stringify({ items: items.map((i) => ({ id: i.id, category: /glasses/i.test(i.headline) ? "consumer" : "ai", importance: 4, relevance: /coding|glasses/i.test(i.headline) ? 5 : 2, whatHappened: i.headline, whyItMatters: "Clients will ask about it.", businessImpact: "Faster builds.", opportunity: "Offer AI-assisted development.", risk: "Price pressure on simple sites.", recommendedAction: "Trial it on one project." })) });
      }
      if (system.includes("You find business opportunities")) return JSON.stringify({ opportunities: [
        { title: "AI-assisted website packages", whatHappened: "Coding agents launched", whoBenefits: "SMB clients", howWeCouldUseIt: "Faster delivery", difficulty: "low", evidence: ["i1", "i2"] },
        { title: "Invented opportunity", whatHappened: "x", whoBenefits: "y", howWeCouldUseIt: "z", difficulty: "low", evidence: ["i99"] },
      ] });
      return JSON.stringify({ summary: "OpenAI launched a coding agent [1] and smart-glasses sales rose [2].", actions: [{ action: "Trial the agent", cite: [1] }], risks: [] });
    },
  };

  beforeAll(async () => {
    C = await import("@/lib/intel/collect"); B = await import("@/lib/intel/briefing"); A = await import("@/lib/intel/analyze"); O = await import("@/lib/intel/opportunities"); S = await import("@/lib/intel/service");
    userId = (await getDb().user.create({ data: { email: `intel-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await getDb().intelSettings.create({ data: { userId, topics: [{ id: "wearables", label: "Wearables", query: "smart glasses", category: "consumer", on: true }] } });
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("collects real-shaped items with source, date and link; skips old ones; reports YouTube as not configured without a key", async () => {
    const saved = env.youtubeApiKey; env.youtubeApiKey = "";
    try {
      const r = await C.refreshIntel(userId, { force: true, fetch: fakeFetch, now });
      expect(r.youtube.configured).toBe(false);
      expect(r.youtube.message).toMatch(/YOUTUBE_API_KEY/);
      const items = await getDb().intelItem.findMany({ where: { userId } });
      expect(items.map((i) => i.url).sort()).toEqual(["https://engadget.com/agent", "https://news.google.com/rss/articles/abc", "https://techcrunch.com/ai-agent"]);
      const gn = items.find((i) => i.via === "google_news")!;
      expect(gn).toMatchObject({ title: "Smart glasses sales jump in India", publisher: "Economic Times", topic: "wearables", category: "consumer" });
      // cached for 15 minutes
      expect((await C.refreshIntel(userId, { fetch: fakeFetch, now })).note).toBe("cached");
    } finally { env.youtubeApiKey = saved; }
  });

  it("reads official videos with YouTube's own live status and its check time", async () => {
    const saved = env.youtubeApiKey; env.youtubeApiKey = "test-key";
    try {
      const r = await C.refreshIntel(userId, { force: true, fetch: fakeFetch, now: new Date() });
      expect(r.youtube).toMatchObject({ configured: true, videos: 2, live: 1 });
      expect(calls.some((c) => c.includes("youtube/v3/search"))).toBe(false); // no 100-unit search calls
      const cc = await S.commandCenter(userId);
      const live = cc.videos.find((v) => v.media?.videoId === "vLive")!;
      expect(live.media).toMatchObject({ liveNow: true, viewers: 1200, live: "live" });
      expect(cc.videos.find((v) => v.media?.videoId === "vOld")!.media?.liveNow).toBe(false);
      // an old check is never shown as live
      await getDb().intelItem.updateMany({ where: { userId, url: { contains: "vLive" } }, data: { media: { ...live.media!, checkedAt: new Date(Date.now() - 3600_000).toISOString() } } });
      const later = (await S.commandCenter(userId)).videos.find((v) => v.media?.videoId === "vLive")!;
      expect(later.media).toMatchObject({ liveNow: false, stale: true });
    } finally { env.youtubeApiKey = saved; }
  });

  it("analyses with computed source confidence and finds opportunities only with real evidence", async () => {
    const res = await A.analyzePending(userId, ai.ask, { provider: "test" });
    expect(res.analyzed).toBeGreaterThanOrEqual(3);
    const agent = await getDb().intelItem.findFirstOrThrow({ where: { userId, url: "https://techcrunch.com/ai-agent" } });
    const an = agent.analysis as unknown as import("@/lib/intel/analyze").ItemAnalysis;
    expect(an.confidence.level).toBe("medium"); // TechCrunch + Engadget carry the same story
    expect(an.confidence.publishers.sort()).toEqual(["Engadget", "TechCrunch"]);
    expect(an.basis).toMatch(/not the full article/);
    const yt = await getDb().intelItem.findFirstOrThrow({ where: { userId, via: "youtube", url: { contains: "vLive" } } });
    expect((yt.analysis as unknown as { confidence: { level: string } }).confidence.level).toBe("high");
    await O.detectOpportunities(userId, ai.ask, { now: new Date() });
    const opps = await getDb().intelOpportunity.findMany({ where: { userId } });
    expect(opps.map((o) => o.title)).toEqual(["AI-assisted website packages"]); // the one citing i99 was dropped
    expect(opps[0].score).toBeGreaterThan(50);
    expect((opps[0].evidence as unknown[]).length).toBe(2);
  });

  it("scores opportunities by a fixed rule", () => {
    const fresh = O.scoreOpportunity([{ relevance: 5, publishedAt: new Date(), analysis: { confidence: { level: "high" } } as never }], "low");
    const weak = O.scoreOpportunity([{ relevance: 2, publishedAt: new Date(Date.now() - 9 * 86_400_000), analysis: { confidence: { level: "low" } } as never }], "high");
    expect(fresh.score).toBeGreaterThan(weak.score);
    expect(fresh.score).toBeLessThanOrEqual(100);
  });

  it("writes a cited briefing and throws away AI text that cites or numbers what isn't there", async () => {
    const b = await B.generateBriefing(userId, "daily", "2026-10-25", { trigger: "manual", ai, refresh: false, now });
    expect(b.status).toBe("ready");
    const c = b.content as { summary: { by: string; summary: string }; headlines: { n: number; url: string; publisher: string }[] };
    expect(c.summary.by).toBe("ai");
    expect(c.headlines[0].url).toMatch(/^https:\/\//);
    const hs = c.headlines as never;
    const badCite = await B.writeSummary(hs, { provider: "t", ask: async () => JSON.stringify({ summary: "Big news from a source we never collected [9].", actions: [], risks: [] }) });
    expect(badCite.by).toBe("rules");
    expect(badCite.rejected).toMatch(/cited a headline that isn't/);
    const badNum = await B.writeSummary(hs, { provider: "t", ask: async () => JSON.stringify({ summary: "Smart glasses sales rose 340% this week [1].", actions: [], risks: [] }) });
    expect(badNum.rejected).toMatch(/numbers not in the sources \(340\)/);
    const none = await B.writeSummary(hs, null);
    expect(none.by).toBe("rules");
    expect(none.summary).toMatch(/\[1\]/);
  });

  it("schedules daily 08:00 and weekly Sunday 19:00 IST, idempotently", async () => {
    expect(B.duePeriods(istInstant("2026-10-25", 7, 59)).daily).toBeNull();
    expect(B.duePeriods(istInstant("2026-10-25", 8, 0)).daily).toBe("2026-10-25");
    expect(B.duePeriods(istInstant("2026-10-25", 18, 59)).weekly.start).toBe("2026-10-12");
    expect(B.duePeriods(istInstant("2026-10-25", 19, 0)).weekly.start).toBe("2026-10-19");
    const at = new Date(istInstant("2026-10-25", 19, 5));
    let out = await B.runDueIntel({ now: at, ai, userIds: [userId], notify: false, fetch: fakeFetch });
    expect(out.map((o) => [o.kind, o.period, o.status, o.trigger])).toEqual([["daily", "2026-10-25", "ready", "manual"], ["weekly", "2026-10-19", "ready", "scheduled"]]);
    out = await B.runDueIntel({ now: new Date(at.getTime() + 600_000), ai, userIds: [userId], notify: false, fetch: fakeFetch });
    expect(out.every((o) => !o.fresh)).toBe(true);
    const wk = await getDb().intelBriefing.findUniqueOrThrow({ where: { userId_kind_period: { userId, kind: "weekly", period: "2026-10-19" } } });
    expect((wk.content as { trend: Record<string, { now: number }> }).trend.ai.now).toBeGreaterThan(0);
    expect((wk.content as { internal: { leadsTotal: number } }).internal.leadsTotal).toBe(0);
  });
  it("'how's the business environment?' with no briefing yet answers from the latest real items", async () => {
    const { businessIntelTool } = await import("@/lib/tools/intel");
    await getDb().intelBriefing.deleteMany({ where: { userId } });
    const r = await businessIntelTool.execute({ action: "briefing", kind: "weekly" }, { userId, timezone: "Asia/Kolkata", activity: () => {} });
    const d = r.data as { noBriefingYet: boolean; items: { url: string; publisher: string | null }[]; note: string };
    expect(d.noBriefingYet).toBe(true);
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.items[0].url).toMatch(/^https:\/\//);
    expect(d.note).toMatch(/being prepared/);
  });
});
