import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { approveBatch, callsBoard, cancelCalls, CallError, planCalls, saveSettings } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prospect calls: settings, planned batches waiting for your approval, live and finished calls. */
export async function GET() {
  try { const user = await requireUser(); return ok(await callsBoard(user.id)); }
  catch (e) { return handleError(e); }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), prospectIds: z.array(z.string()).max(60).optional(), limit: z.number().int().min(1).max(60).optional() }),
  z.object({ action: z.literal("approve"), batchId: z.string().min(1).max(40) }),
  z.object({ action: z.literal("cancel"), batchId: z.string().max(40).optional(), id: z.string().max(40).optional() }),
  z.object({ action: z.literal("settings"), enabled: z.boolean().optional(), dailyCap: z.number().int().min(1).max(60).optional(), hoursFrom: z.string().max(5).optional(), hoursTo: z.string().max(5).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(), recordingNotice: z.boolean().optional(), callerName: z.string().max(40).optional(), company: z.string().max(80).optional(), ownerName: z.string().max(60).optional(), city: z.string().max(60).optional() }),
]);

/** plan → JARVIS proposes a batch · approve → YOU approve that batch · cancel · settings. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const a = Action.parse(await req.json());
    if (a.action === "plan") return ok(await planCalls(user.id, a));
    if (a.action === "approve") return ok({ approved: await approveBatch(user.id, a.batchId) });
    if (a.action === "cancel") return ok({ cancelled: await cancelCalls(user.id, a) });
    const { action: _a, ...s } = a;
    await saveSettings(user.id, s);
    return ok(await callsBoard(user.id));
  } catch (e) { return e instanceof CallError ? fail(e.message) : handleError(e); }
}
