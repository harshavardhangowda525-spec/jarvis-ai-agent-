import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { checkForUser, getSettings, latestNotices, saveSettings, userSources } from "@/lib/nios/watch";
import { regionalSource } from "@/lib/nios/sources";

/**
 * nios — the NIOS board watcher. Reads only the official NIOS websites; every
 * notice returned is exactly as published there (title, date, link).
 */
const schema = z.object({
  action: z.enum(["latest", "check", "settings"]).describe(
    "latest: notices on file (newest first). check: read the NIOS websites right now and report anything new. settings: turn the watch or email alerts on/off, or add/remove a regional centre.",
  ),
  category: z.enum(["exam", "result", "admission", "fee", "general"]).nullable().optional().describe("Only this kind of notice (for latest)."),
  limit: z.number().int().min(1).max(30).nullable().optional(),
  enabled: z.boolean().nullable().optional().describe("settings: watch on/off."),
  email: z.boolean().nullable().optional().describe("settings: email alerts on/off."),
  addRegion: z.string().max(30).nullable().optional().describe("settings: regional centre to also watch, e.g. 'bengaluru', 'delhi'."),
  removeRegion: z.string().max(30).nullable().optional(),
});
type Input = z.infer<typeof schema>;

export const niosTool: ToolDefinition<Input> = {
  name: "nios",
  description:
    "The NIOS (National Institute of Open Schooling) board watcher. JARVIS watches the official NIOS websites (main site, " +
    "Secondary & Sr. Secondary, Vocational, Results, and chosen regional centres) and alerts the user to new notices — exams, date sheets, " +
    "practicals, results, admissions, fees. Use it for any question about NIOS notifications/updates. Report titles, dates and links exactly " +
    "as returned; never invent a notice or a date.",
  schema,
  activityLabel: "Checking NIOS notices",
  async execute(input, ctx) {
    if (input.action === "settings") {
      const s = await getSettings(ctx.userId);
      let regions = s.regions;
      const add = input.addRegion ? regionalSource(input.addRegion) : null;
      if (input.addRegion && !add) return { data: { error: "Unknown regional centre name." }, summary: "That isn't a regional centre name I can watch." };
      if (add) regions = [...new Set([...regions, add.key.slice(3)])];
      if (input.removeRegion) { const r = regionalSource(input.removeRegion)?.key.slice(3); regions = regions.filter((x) => x !== r); }
      const next = await saveSettings(ctx.userId, {
        regions, ...(input.enabled != null ? { enabled: input.enabled } : {}), ...(input.email != null ? { email: input.email } : {}),
      });
      return {
        data: { enabled: next.enabled, email: next.email, watching: userSources(next).map((x) => x.label) },
        summary: `NIOS watch ${next.enabled ? "on" : "off"} · email alerts ${next.email ? "on" : "off"}.`,
      };
    }
    if (input.action === "check") {
      ctx.activity("Reading the NIOS websites…");
      const r = await checkForUser(ctx.userId, { force: true });
      const failed = r.sources.filter((x) => !x.ok);
      return {
        data: {
          newNotices: r.newNotices.map(({ title, dateText, category, url, sourceLabel }) => ({ title, date: dateText, category, url, source: sourceLabel })),
          pagesRead: r.sources.filter((x) => x.ok).map((x) => x.label),
          pagesFailed: failed.map((x) => `${x.label}: ${x.error}`),
          storedAsHistory: r.baselineAdded,
          email: r.emailNote,
        },
        summary: r.newNotices.length ? `${r.newNotices.length} new NIOS notice${r.newNotices.length === 1 ? "" : "s"}.`
          : r.baselineAdded ? `NIOS watch started — ${r.baselineAdded} current notices on file; new ones will be announced.`
          : `No new NIOS notices${failed.length ? ` (${failed.length} page${failed.length === 1 ? "" : "s"} couldn't be read)` : ""}.`,
      };
    }
    const list = await latestNotices(ctx.userId, { category: input.category ?? undefined, limit: input.limit ?? 10 });
    return {
      data: { notices: list.map(({ title, dateText, category, url, sourceLabel, isNew }) => ({ title, date: dateText, category, url, source: sourceLabel, newSinceWatching: isNew })) },
      summary: list.length ? `${list.length} NIOS notice${list.length === 1 ? "" : "s"} on file.` : "No NIOS notices on file yet — try a check.",
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["latest", "check", "settings"] },
      category: { type: "string", enum: ["exam", "result", "admission", "fee", "general"] },
      limit: { type: "integer" },
      enabled: { type: "boolean" },
      email: { type: "boolean" },
      addRegion: { type: "string" },
      removeRegion: { type: "string" },
    },
    required: ["action"],
  },
};
