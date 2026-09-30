import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { recordActivity } from "@/lib/activity/record";
import { loadSettings, saveSettings } from "@/lib/mike/analyze";
import { TIMEFRAMES } from "@/lib/mike/types";
import { capabilities } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MIKE's risk settings (account size, risk per trade, limits, watchlist). */
export async function GET() {
  try {
    const user = await requireUser();
    return ok({ settings: await loadSettings(user.id), newsAvailable: capabilities.search });
  } catch (err) {
    return handleError(err);
  }
}

const patch = z.object({
  accountSize: z.number().min(0).max(1e12).optional(),
  currency: z.string().min(1).max(8).optional(),
  riskPct: z.number().min(0.01).max(10).optional(),
  maxDailyRiskPct: z.number().min(0.01).max(50).optional(),
  // floors: MIKE never lowers its own bar below these
  minConfidence: z.number().int().min(60).max(95).optional(),
  minRiskReward: z.number().min(1).max(10).optional(),
  defaultTimeframe: z.enum(TIMEFRAMES).optional(),
  watchlist: z.array(z.string().min(1).max(30)).min(1).max(20).optional(),
});

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const settings = await saveSettings(user.id, patch.parse(await req.json()));
    await recordActivity(user.id, { category: "decision", agent: "MIKE", source: "mike", action: "MIKE risk settings updated", result: `risk ${settings.riskPct}%/trade, ${settings.maxDailyRiskPct}%/day, min confidence ${settings.minConfidence}, min R:R ${settings.minRiskReward}`, status: "success", importance: 2 });
    return ok({ settings });
  } catch (err) {
    return handleError(err);
  }
}
