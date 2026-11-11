import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { CrmError, finderStatus, pairFinder, queueSearch, saveSchedule, stopSearch, unpairFinder, MAX_DAILY } from "@/lib/prospects/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Google Maps finder: is the operator on your laptop connected, and the daily schedule. */
export async function GET() {
  try { const user = await requireUser(); return ok(await finderStatus(user.id)); }
  catch (e) { return handleError(e); }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pair") }),
  z.object({ action: z.literal("unpair") }),
  z.object({ action: z.literal("search"), category: z.string().trim().min(1).max(80), area: z.string().trim().min(1).max(80), city: z.string().trim().max(60).optional(), limit: z.number().int().min(1).max(MAX_DAILY).optional() }),
  z.object({ action: z.literal("stop"), id: z.string().min(1) }),
]);

/** pair → a token for the operator (shown once) · unpair · search → queue one now · stop a search. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const a = Action.parse(await req.json());
    if (a.action === "pair") {
      const token = await pairFinder(user.id);
      // JARVIS running on this laptop (npm run local) next to the operator: hand it the token directly
      const host = new URL(req.url).hostname;
      const opDir = path.join(process.cwd(), "operator");
      let connectedHere = false;
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && fs.existsSync(path.join(opDir, "run.mjs"))) {
        try {
          fs.writeFileSync(path.join(opDir, ".finder.json"), JSON.stringify({ url: `http://127.0.0.1:${new URL(req.url).port || "3000"}`, token }), { mode: 0o600 });
          connectedHere = true;
        } catch { /* read-only install: show the token instead */ }
      }
      return ok({ token: connectedHere ? null : token, connectedHere, status: await finderStatus(user.id) });
    }
    if (a.action === "unpair") { await unpairFinder(user.id); return ok({ status: await finderStatus(user.id) }); }
    if (a.action === "stop") { await stopSearch(user.id, a.id); return ok({ stopped: true }); }
    const r = await queueSearch(user.id, { ...a, trigger: "you" });
    return ok(r, { status: 201 });
  } catch (e) { return e instanceof CrmError ? fail(e.message) : handleError(e); }
}

const Schedule = z.object({
  scheduleOn: z.boolean().optional(), scheduleDays: z.array(z.number().int().min(0).max(6)).max(7).optional(), scheduleTime: z.string().max(5).optional(),
  dailyLimit: z.number().int().min(1).max(MAX_DAILY).optional(), categories: z.array(z.string().max(80)).max(30).optional(), areas: z.array(z.string().max(80)).max(30).optional(), city: z.string().max(60).optional(),
});

export async function PATCH(req: Request) {
  try { const user = await requireUser(); return ok(await saveSchedule(user.id, Schedule.parse(await req.json()))); }
  catch (e) { return e instanceof CrmError ? fail(e.message) : handleError(e); }
}
