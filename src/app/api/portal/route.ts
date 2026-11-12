import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { portalConfigured, portalOverview, portalProject, portalReply, PortalError } from "@/lib/portal/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The Client Portal: overview, or one project (?project=…). */
export async function GET(req: Request) {
  try {
    await requireUser();
    if (!portalConfigured()) return ok({ connected: false });
    const q = new URL(req.url).searchParams.get("project");
    return ok(q ? { connected: true, detail: await portalProject(q) } : { connected: true, overview: await portalOverview() });
  } catch (e) { return e instanceof PortalError ? fail(e.message) : handleError(e); }
}

const Body = z.object({ action: z.literal("reply"), project: z.string().min(1).max(100), message: z.string().min(1).max(4000) });
/** You replying to a client from JARVIS (you pressed Send yourself). */
export async function POST(req: Request) {
  try {
    await requireUser();
    const b = Body.parse(await req.json());
    return ok(await portalReply(b.project, b.message));
  } catch (e) { return e instanceof PortalError ? fail(e.message) : handleError(e); }
}
