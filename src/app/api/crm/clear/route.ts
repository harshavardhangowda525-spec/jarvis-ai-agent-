import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { clearDarwin, clearPreview } from "@/lib/crm/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What clearing DARWIN's records would remove — nothing is deleted. */
export async function GET(req: Request) {
  return robinApi(req, "crm-clear", async (user) => ok(await clearPreview(user.id)));
}

/** Clear, after a backup. `expect` must match the preview you confirmed. */
export async function POST(req: Request) {
  return robinApi(req, "crm-clear", async (user) => {
    const b = z.object({
      confirm: z.literal(true),
      includeUntouchedCrm: z.boolean().default(false),
      expect: z.object({ darwinLeads: z.number().int().min(0), untouchedCrmLeads: z.number().int().min(0) }),
    }).parse(await req.json());
    return ok(await clearDarwin(user.id, b));
  }, 4);
}
