import { z } from "zod";
import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { generateScript, listScripts } from "@/lib/aston/scripts/service";
import { detailsSchema, SCRIPT_KINDS } from "@/lib/aston/scripts/format";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The script library: ?scope=saved|recent&q=&kind=&type= */
export async function GET(req: Request) {
  try {
    const user = await requireOwner();
    const sp = new URL(req.url).searchParams;
    return ok(await listScripts(user.id, {
      scope: sp.get("scope") === "recent" ? "recent" : "saved",
      q: sp.get("q") ?? undefined, kind: sp.get("kind") ?? undefined, businessType: sp.get("type") ?? undefined,
    }));
  } catch (err) {
    return astonError(err);
  }
}

const schema = z.object({ request: z.string().trim().min(3).max(1500), kind: z.enum(SCRIPT_KINDS).optional(), details: detailsSchema.optional() });

/** Generate a new script with Groq (stored as a draft until saved). */
export async function POST(req: Request) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:script:gen:${user.id}`, 30, 60 * 60_000).allowed) return fail("That's a lot of scripts this hour — try again a bit later.", 429);
    return ok(await generateScript(user.id, schema.parse(await req.json())), { status: 201 });
  } catch (err) {
    return astonError(err);
  }
}
