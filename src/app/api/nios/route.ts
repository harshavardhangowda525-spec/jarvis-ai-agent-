import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { emailChannelReady } from "@/lib/darwin/email";
import { getSettings, latestNotices, saveSettings, unseenNotices, userSources } from "@/lib/nios/watch";
import { regionalSource } from "@/lib/nios/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** NIOS watch status: settings, watched pages, unseen new notices and the latest on file. */
export async function GET() {
  try {
    const user = await requireUser();
    const settings = await getSettings(user.id);
    const [unseen, recent, emailReady] = await Promise.all([
      unseenNotices(user.id, settings), latestNotices(user.id, { limit: 15 }), emailChannelReady(user.id),
    ]);
    return ok({
      enabled: settings.enabled, email: settings.email, emailReady, regions: settings.regions,
      lastCheckedAt: settings.lastCheckedAt, lastEmailError: settings.lastEmailError ?? null,
      sources: userSources(settings).map(({ key, label, url }) => ({ key, label, url })),
      unseen, recent,
    });
  } catch (err) {
    return handleError(err);
  }
}

const patch = z.object({
  enabled: z.boolean().optional(),
  email: z.boolean().optional(),
  regions: z.array(z.string().max(30)).max(10).optional(),
});

/** Turn the watch / email alerts on or off, or set regional centres. */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const b = patch.parse(await req.json());
    const regions = b.regions?.map((r) => regionalSource(r)?.key.slice(3)).filter((x): x is string => !!x);
    const s = await saveSettings(user.id, { ...b, ...(regions ? { regions } : {}) });
    return ok({ enabled: s.enabled, email: s.email, regions: s.regions });
  } catch (err) {
    return handleError(err);
  }
}
