import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { getDb } from "@/lib/db";
import { briefingView, generateBriefing } from "@/lib/intel/briefing";
import { commandCenter, refreshNow } from "@/lib/intel/service";
import { refreshIntel } from "@/lib/intel/collect";
import { internalSnapshot } from "@/lib/intel/internal";
import { CATEGORIES, type CategoryId } from "@/lib/intel/topics";
import { istDate, weekOf } from "@/lib/trading/week";

/**
 * Business environment intelligence for Infinity Web & Apps: real articles and
 * official videos with publisher, date and link; analysis grounded on the
 * headline and summary only; opportunities scored from cited items.
 */

const schema = z.object({
  action: z.enum(["briefing", "generate_briefing", "news", "opportunities", "live", "refresh", "internal", "explain"]),
  kind: z.enum(["daily", "weekly"]).optional(),
  category: z.enum(["all", ...CATEGORIES.map((c) => c.id)] as [string, ...string[]]).optional(),
  query: z.string().max(120).optional(),
  itemId: z.string().optional(),
});

const LINK = "/dashboard/intel";
const cite = (i: { title: string; publisher: string | null; publishedAt: string | null; url: string }) => ({ title: i.title, publisher: i.publisher, date: i.publishedAt?.slice(0, 10) ?? null, url: i.url });

export const businessIntelTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "business_intel",
  description:
    "Business environment intelligence for Infinity Web & Apps (the user's web & app development business): today's briefing or the weekly review, the latest important developments by category (AI, software, wearables, commerce, cyber, economy, policy…), " +
    "scored opportunities with evidence, official company livestreams/videos with their real live status, and internal CRM numbers. Every item has a source, date and link — cite them. Never claim to have watched a video or read a full article.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["briefing", "generate_briefing", "news", "opportunities", "live", "refresh", "internal", "explain"], description: "briefing = latest briefing; generate_briefing = make it now; news = top items (optionally by category/query); opportunities; live = official livestreams/videos; refresh = fetch sources now; internal = CRM/lead numbers; explain = one item's full analysis" },
      kind: { type: "string", enum: ["daily", "weekly"] },
      category: { type: "string", enum: ["all", ...CATEGORIES.map((c) => c.id)] },
      query: { type: "string", description: "Words to filter headlines by, e.g. 'smart glasses'." },
      itemId: { type: "string" },
    },
    required: ["action"],
  },
  activityLabel: "Scanning the business environment",
  async execute(input, ctx) {
    const kind = input.kind ?? "daily";
    switch (input.action) {
      case "briefing": {
        const b = await getDb().intelBriefing.findFirst({ where: { userId: ctx.userId, kind, status: "ready" }, orderBy: { period: "desc" } });
        if (!b) {
          // No briefing yet (e.g. the first day) — answer from the latest real items now, and start the first briefing.
          ctx.activity("Reading the latest sources…");
          await refreshIntel(ctx.userId).catch(() => null);
          const cc = await commandCenter(ctx.userId);
          const period = kind === "daily" ? istDate(Date.now()) : weekOf(istDate(Date.now())).start;
          void generateBriefing(ctx.userId, kind, period, { trigger: "manual" }).catch((e) => console.error("[intel] first briefing:", (e as Error).message));
          return {
            data: {
              noBriefingYet: true,
              note: `There's no ${kind} briefing yet — one is being prepared now (it also runs automatically ${kind === "daily" ? "every day at 08:00" : "every Sunday at 19:00"} IST). Answer from these latest real items and cite them; don't say there is nothing.`,
              lastRefreshAt: cc.status.lastRefreshAt,
              items: cc.priority.slice(0, 8).map((i) => ({ ...cite(i), category: i.category, importance: i.importance, relevance: i.relevance, whyItMatters: i.analysis?.whyItMatters ?? null, opportunity: i.analysis?.opportunity ?? null })),
              topOpportunities: cc.opportunities.slice(0, 3).map((o) => ({ title: o.title, score: o.score })),
              link: LINK,
            },
            summary: `${cc.priority.length} latest items (briefing being prepared)`,
          };
        }
        const v = briefingView(b);
        return { data: { ...v, link: `${LINK}?briefing=${kind}:${b.period}` }, summary: `${kind === "daily" ? "Daily briefing" : "Weekly review"} — ${b.period}` };
      }
      case "generate_briefing": {
        ctx.activity("Collecting sources and writing the briefing…");
        const period = kind === "daily" ? istDate(Date.now()) : weekOf(istDate(Date.now())).start;
        const b = await generateBriefing(ctx.userId, kind, period, { trigger: "manual", force: true });
        return { data: { ...briefingView(b), link: `${LINK}?briefing=${kind}:${period}` }, summary: `${kind} briefing ${b.status}` };
      }
      case "refresh": {
        ctx.activity("Fetching news and official channels…");
        const r = await refreshNow(ctx.userId);
        return { data: { added: r.report.added, sources: r.report.sources.map((s) => `${s.name}: ${s.ok ? s.count : `failed (${s.error})`}`), youtube: r.report.youtube, analysed: r.analysis?.analyzed ?? 0, ai: r.ai }, summary: `${r.report.added} new items` };
      }
      case "internal":
        return { data: { ...(await internalSnapshot(ctx.userId)), note: "Counts from JARVIS's own CRM, DARWIN leads and ASTON projects." }, summary: "Internal metrics" };
      case "explain": {
        const it = input.itemId ? await getDb().intelItem.findFirst({ where: { id: input.itemId, userId: ctx.userId } }) : null;
        if (!it) return { data: { error: "Item not found." }, summary: "Not found" };
        return { data: { ...cite({ ...it, publishedAt: it.publishedAt?.toISOString() ?? null }), summary: it.summary, analysis: it.analysis, importance: it.importance, relevance: it.relevance }, summary: it.title };
      }
      default: {
        const cc = await commandCenter(ctx.userId, { category: (input.category ?? "all") as CategoryId | "all", q: input.query });
        if (input.action === "opportunities") return { data: { opportunities: cc.opportunities.slice(0, 6), scoreRule: cc.scoreRule, link: LINK }, summary: `${cc.opportunities.length} opportunities` };
        if (input.action === "live") return { data: { youtube: cc.status.youtube, videos: cc.videos.slice(0, 10).map((v) => ({ ...cite(v), channel: v.media?.channel, liveNow: v.media?.liveNow, live: v.media?.live, checkedAt: v.media?.checkedAt, viewers: v.media?.liveNow ? v.media.viewers : null })), note: "Live status is YouTube's own at the check time shown.", link: LINK }, summary: `${cc.status.counts.liveNow} live now` };
        return {
          data: {
            lastRefreshAt: cc.status.lastRefreshAt,
            items: cc.priority.slice(0, 10).map((i) => ({ id: i.id, ...cite(i), category: i.category, importance: i.importance, relevance: i.relevance, analysis: i.analysis && { whatHappened: i.analysis.whatHappened, whyItMatters: i.analysis.whyItMatters, businessImpact: i.analysis.businessImpact, opportunity: i.analysis.opportunity, risk: i.analysis.risk, recommendedAction: i.analysis.recommendedAction, sourceConfidence: i.analysis.confidence, basis: i.analysis.basis } })),
            link: LINK,
          },
          summary: `${cc.priority.length} items`,
        };
      }
    }
  },
};
