import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { getDb } from "@/lib/db";
import { EV_NICHES } from "@/lib/ev/config";
import { checkDuplicate, storeItem, recentItems } from "@/lib/ev/memory";

/**
 * EV's idea engine. It does NOT invent ideas itself (EV's brain does that) —
 * it steers EV toward FRESH territory by reporting which target niches are
 * under-served and which themes were used recently (to avoid), then stores a
 * batch of new ideas with per-idea duplicate rejection.
 */

const schema = z.object({
  action: z
    .enum(["gaps", "store_batch"])
    .describe("gaps: which niches are under-served + recent themes to avoid. store_batch: save new ideas (each deduped)."),
  ideas: z
    .array(
      z.object({
        title: z.string().max(200),
        niche: z.string().max(60).optional(),
        theme: z.string().max(200).optional(),
        body: z.string().max(4000).optional(),
      }),
    )
    .max(20)
    .optional()
    .describe("Ideas to store (for store_batch)."),
});

type Input = z.infer<typeof schema>;

export const evIdeasTool: ToolDefinition<Input> = {
  name: "ev_ideas",
  description:
    "EV's idea engine for Infinity Web & Apps. Call 'gaps' before brainstorming to see which target niches " +
    "are under-served and which recent themes to avoid, so ideas stay fresh and non-repetitive. Use 'store_batch' " +
    "to save the new ideas — each is checked against memory and duplicates are skipped.",
  schema,
  agentScope: "ev",
  activityLabel: "Running EV's idea engine",
  async execute(input, ctx) {
    const userId = ctx.userId;

    if (input.action === "gaps") {
      ctx.activity("Analyzing content coverage for gaps…");
      const items = await recentItems(userId, 200);
      const nicheCount = new Map<string, number>();
      for (const n of EV_NICHES) nicheCount.set(n, 0);
      const recentThemes: string[] = [];
      for (const i of items) {
        if (i.niche) nicheCount.set(i.niche.toLowerCase(), (nicheCount.get(i.niche.toLowerCase()) ?? 0) + 1);
        if (i.theme) recentThemes.push(i.theme);
      }
      const ranked = [...nicheCount.entries()].sort((a, b) => a[1] - b[1]);
      const underserved = ranked.filter(([, c]) => c === 0).map(([n]) => n);
      const leastUsed = ranked.slice(0, 6).map(([n, c]) => ({ niche: n, count: c }));
      return {
        data: {
          totalItems: items.length,
          underservedNiches: underserved.length ? underserved : leastUsed.map((x) => x.niche),
          leastUsedNiches: leastUsed,
          recentThemesToAvoid: [...new Set(recentThemes)].slice(0, 15),
        },
        summary: underserved.length
          ? `Untapped niches: ${underserved.slice(0, 6).join(", ")}${underserved.length > 6 ? "…" : ""}.`
          : `Least-covered niches: ${leastUsed.map((x) => x.niche).slice(0, 4).join(", ")}.`,
      };
    }

    // store_batch
    const ideas = input.ideas ?? [];
    if (ideas.length === 0) return { data: { stored: 0, skipped: 0 }, summary: "No ideas provided to store." };
    ctx.activity(`Storing ${ideas.length} idea(s) with duplicate checks…`);
    let stored = 0;
    const skipped: { title: string; reason: string }[] = [];
    for (const idea of ideas) {
      const candidate = [idea.title, idea.theme, idea.body].filter(Boolean).join(" \n ");
      const dup = await checkDuplicate(userId, candidate, { niche: idea.niche });
      if (dup.isDuplicate) {
        skipped.push({ title: idea.title, reason: "too similar to existing content" });
        continue;
      }
      await storeItem(userId, {
        kind: "idea",
        status: "draft",
        niche: idea.niche ?? null,
        theme: idea.theme ?? null,
        title: idea.title,
        body: idea.body ?? null,
      });
      stored++;
    }
    return {
      data: { stored, skipped: skipped.length, skippedDetail: skipped },
      summary: `Stored ${stored} fresh idea(s)${skipped.length ? `, skipped ${skipped.length} near-duplicate(s)` : ""}.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["gaps", "store_batch"] },
      ideas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            niche: { type: "string" },
            theme: { type: "string" },
            body: { type: "string" },
          },
          required: ["title"],
        },
      },
    },
    required: ["action"],
  },
};
