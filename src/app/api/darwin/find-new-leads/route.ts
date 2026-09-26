import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { findNewLeads } from "@/lib/darwin/discovery";
import { GeoapifyError, geoapifyHttpStatus } from "@/lib/darwin/geoapify";
import { LEAD_FILTER_IDS } from "@/lib/darwin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  category: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(50).default(20),
  filter: z.enum(LEAD_FILTER_IDS).default("all"),
  radiusKm: z.number().min(0.5).max(50).optional(),
});

/**
 * FIND NEW LEADS — real Geoapify businesses the user has never been shown,
 * continuing from where the same search stopped last time. The Geoapify key
 * stays on the server; the browser only ever talks to this route.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`darwin-find:${user.id}`, 10, 60_000);
    if (!rl.allowed) return fail(`Too many searches — try again in ${rl.retryAfter}s.`, 429);
    const body = schema.parse(await req.json());
    try {
      return ok(await findNewLeads({ userId: user.id, ...body }));
    } catch (err) {
      if (err instanceof GeoapifyError) return fail(err.message, geoapifyHttpStatus(err.kind), { kind: err.kind });
      throw err;
    }
  } catch (err) {
    return handleError(err);
  }
}
