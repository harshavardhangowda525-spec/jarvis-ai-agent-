import { z } from "zod";
import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { createSite, listSites } from "@/lib/aston/site/builder";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner's websites (newest first). */
export async function GET() {
  try {
    const user = await requireOwner();
    return ok(await listSites(user.id));
  } catch (err) {
    return astonError(err);
  }
}

const schema = z.object({ brief: z.string().trim().min(8).max(2000) });

/** Start a new website build from a brief. The steps run via /next. */
export async function POST(req: Request) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:site:new:${user.id}`, 10, 60 * 60_000).allowed) return fail("That's a lot of websites in one hour — try again a bit later.", 429);
    const { brief } = schema.parse(await req.json());
    return ok(await createSite(user.id, brief), { status: 201 });
  } catch (err) {
    return astonError(err);
  }
}
