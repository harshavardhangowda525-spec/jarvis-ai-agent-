import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { syncFromDarwin } from "@/lib/robin/darwin-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Send to Rubin": these DARWIN leads (or all DARWIN leads Rubin hasn't received yet). */
export async function POST(req: Request) {
  return robinApi(req, "import", async (user) => {
    const b = z.object({ darwinLeadIds: z.array(z.string()).max(500).optional() }).parse(await req.json().catch(() => ({})));
    // ids given → works even with auto-import off; none → everything not yet received
    return ok(await syncFromDarwin(user.id, { ids: b.darwinLeadIds ?? undefined, limit: 500, source: "user" }));
  }, 10);
}
