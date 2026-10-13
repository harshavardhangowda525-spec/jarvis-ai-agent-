import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { STAGES } from "@/lib/robin/types";
import { islandNotices, runIslandCommand } from "@/lib/robin/island";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  text: z.string().trim().min(1).max(600),
  leadId: z.string().max(40).nullable().optional(),
  pending: z.object({ kind: z.literal("move"), leadId: z.string().max(40), stage: z.enum(STAGES), name: z.string().max(200) }).nullable().optional(),
});

/** RUBEN's desktop island: one command → the real CRM action → a short answer + the card that answers it. */
export async function POST(req: Request) {
  return robinApi(req, "island", async (user) => ok(await runIslandCommand(user.id, schema.parse(await req.json()))), 40);
}

/** What the outline should announce since `since` (due follow-ups, new notifications). */
export async function GET(req: Request) {
  return robinApi(req, "island-notices", async (user) => {
    const s = Number(new URL(req.url).searchParams.get("since"));
    const since = new Date(Number.isFinite(s) && s > 0 ? s : Date.now() - 60_000);
    return ok({ notices: await islandNotices(user.id, since), now: Date.now() });
  });
}
