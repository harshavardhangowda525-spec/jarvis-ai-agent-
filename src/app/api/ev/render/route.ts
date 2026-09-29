import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { isConfigured } from "@/lib/ev/magichour";
import { finishMagicHour } from "@/lib/ev/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?kind=video|image&projectId=… — how a Magic Hour render EV started is
 * doing. The app polls this in the background after EV says "it's rendering":
 * once Magic Hour finishes, the file is stored with EV's media (only once) and
 * its link comes back; if Magic Hour failed, its own reason comes back.
 */
const query = z.object({
  kind: z.enum(["image", "video"]),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/),
  label: z.string().max(120).optional(),
  // an image-to-video Magic Hour can't read the picture for is started again from this description
  prompt: z.string().min(3).max(1500).optional(),
  seconds: z.coerce.number().int().min(3).max(60).optional(),
  aspect: z.enum(["square", "portrait", "landscape"]).optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) return fail("Give kind (image|video) and a Magic Hour projectId.", 400);
    const rl = rateLimit(`ev-render:${user.id}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many checks — wait a moment.", 429);
    if (!isConfigured()) return fail("Magic Hour isn't connected (MAGICHOUR_API_KEY).", 409);
    const { prompt, seconds, aspect } = q.data;
    const state = await finishMagicHour(user.id, q.data.kind, q.data.projectId, {
      budgetMs: 8_000, label: q.data.label, ...(prompt ? { fallback: { prompt, seconds, aspect } } : {}),
    });
    return ok(state);
  } catch (err) {
    return handleError(err);
  }
}
