import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { robinOverview } from "@/lib/robin/overview";
import { syncFromDarwin } from "@/lib/robin/darwin-sync";
import { demoReminders } from "@/lib/robin/engage";
import { expireQuotations } from "@/lib/robin/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The command center's live data. Each poll first takes over DARWIN's new
 * leads (when auto-import is on), announces demos starting within 30 minutes,
 * and expires quotations past their validity — then returns the real CRM.
 */
export async function GET(req: Request) {
  return robinApi(req, "overview", async (user) => {
    const sync = await syncFromDarwin(user.id).catch(() => null);
    const [reminders] = await Promise.all([demoReminders(user.id).catch(() => []), expireQuotations(user.id).catch(() => 0)]);
    return ok({ overview: await robinOverview(user.id), sync, reminders });
  }, 120);
}
