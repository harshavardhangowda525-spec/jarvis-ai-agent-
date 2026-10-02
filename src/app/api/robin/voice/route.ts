import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { createRobinVoice, ensureRobinVoice, robinVoiceStatus } from "@/lib/robin/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Rubin's own designed voice: status, create (or re-create from your description), or ensure on first open. */
export async function GET(req: Request) {
  return robinApi(req, "voice", async (user) => ok(await robinVoiceStatus(user.id)));
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ensure") }),
  z.object({ action: z.literal("create"), description: z.string().trim().max(1000).optional() }),
]);
export async function POST(req: Request) {
  return robinApi(req, "voice-create", async (user) => {
    const b = schema.parse(await req.json());
    if (b.action === "ensure") return ok({ ensure: await ensureRobinVoice(user.id), ...(await robinVoiceStatus(user.id)) });
    const r = await createRobinVoice(user.id, b.description);
    return ok({ ...r, ...(await robinVoiceStatus(user.id)) });
  }, 6);
}
