import "server-only";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import type { AssetRef, Candle, Timeframe } from "./types";
import { closedBars, fetchSeries, type DataOpts } from "./data";
import { analyzeAt, prepare } from "./timeframe";
import { analyzeAsset } from "./analyze";
import { fmtPrice } from "./format";

/**
 * MIKE's alerts. They NOTIFY — MIKE never places, changes or closes an order.
 * Each alert fires once, from real bars formed after it was created.
 */

export const ALERT_KINDS = ["price_above", "price_below", "breakout", "breakdown", "volume_spike", "trend_reversal", "rsi_above", "rsi_below", "new_setup"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_LABEL: Record<AlertKind, string> = {
  price_above: "Price above", price_below: "Price below", breakout: "Breakout", breakdown: "Breakdown",
  volume_spike: "Volume spike", trend_reversal: "Trend reversal", rsi_above: "RSI above", rsi_below: "RSI below", new_setup: "New validated setup",
};
export const NEEDS_LEVEL: AlertKind[] = ["price_above", "price_below", "rsi_above", "rsi_below"];

export interface FiredAlert { id: string; asset: string; kind: AlertKind; message: string }

/** Pure: does this alert fire on these bars (only bars after `since`)? */
export function alertHits(kind: AlertKind, level: number | null, bars: Candle[], since: number, timeframe: Timeframe, hasVolume: boolean): { hit: boolean; detail: string; price: number | null } {
  const fresh = bars.filter((b) => b.t >= since);
  if (!fresh.length) return { hit: false, detail: "", price: null };
  const last = bars[bars.length - 1];
  if (kind === "price_above" && level != null) {
    const b = fresh.find((x) => x.h >= level);
    return { hit: !!b, detail: `traded at or above ${fmtPrice(level)}`, price: b ? Math.max(level, b.o) : null };
  }
  if (kind === "price_below" && level != null) {
    const b = fresh.find((x) => x.l <= level);
    return { hit: !!b, detail: `traded at or below ${fmtPrice(level)}`, price: b ? Math.min(level, b.o) : null };
  }
  if (bars.length < 60) return { hit: false, detail: "", price: null };
  const a = analyzeAt(prepare(bars, timeframe, hasVolume), bars.length - 1);
  const ev = a.scanEvents;
  switch (kind) {
    case "breakout": return { hit: ev.includes("breakout"), detail: "closed above its 20-bar range", price: last.c };
    case "breakdown": return { hit: ev.includes("breakdown"), detail: "closed below its 20-bar range", price: last.c };
    case "volume_spike": return { hit: ev.includes("volume_spike"), detail: `volume ${a.snapshot.volumeRatio.toFixed(1)}× its 20-bar average`, price: last.c };
    case "trend_reversal": return { hit: ev.includes("trend_reversal"), detail: `change of character (${a.events.at(-1)?.dir ?? ""})`, price: last.c };
    case "rsi_above": return { hit: level != null && a.snapshot.rsi >= level, detail: `RSI ${a.snapshot.rsi.toFixed(1)} ≥ ${level}`, price: last.c };
    case "rsi_below": return { hit: level != null && a.snapshot.rsi <= level, detail: `RSI ${a.snapshot.rsi.toFixed(1)} ≤ ${level}`, price: last.c };
    default: return { hit: false, detail: "", price: null };
  }
}

export async function checkAlerts(userId: string, opts: DataOpts = {}): Promise<FiredAlert[]> {
  const db = getDb();
  const alerts = await db.mikeAlert.findMany({ where: { userId, status: "active" }, orderBy: { createdAt: "asc" }, take: 40 });
  const fired: FiredAlert[] = [];
  let setupRuns = 0;
  for (const al of alerts) {
    const asset: AssetRef = { display: al.asset, symbol: al.symbol, provider: al.provider as AssetRef["provider"], kind: al.provider === "binance" ? "crypto" : "stock", exchange: "", group: "" };
    const tf = al.timeframe as Timeframe;
    let hit = false, detail = "", price: number | null = null;
    if (al.kind === "new_setup") {
      // a full multi-timeframe analysis is heavier — at most 3 per check, and at most every 15 minutes each
      if (setupRuns >= 3 || (al.lastCheckedAt && Date.now() - al.lastCheckedAt.getTime() < 15 * 60_000)) continue;
      setupRuns++;
      const a = await analyzeAsset(userId, asset, tf, { ...opts, journal: false, news: false });
      hit = a.decision === "setup";
      detail = hit && a.setup ? `${a.setup.direction.toUpperCase()} setup, confidence ${a.confidence.score}` : "";
      price = a.primary?.snapshot.price ?? null;
      if (hit) await analyzeAsset(userId, asset, tf, { ...opts, news: true }); // journal the validated setup
    } else {
      const s = await fetchSeries(asset, tf, opts);
      if (!s.candles.length) continue; // no data → never fire on a guess
      const bars = NEEDS_LEVEL.slice(0, 2).includes(al.kind as AlertKind) ? s.candles : closedBars(s, opts.now ?? Date.now());
      const since = (al.lastCheckedAt ?? al.createdAt).getTime() - 60_000;
      ({ hit, detail, price } = alertHits(al.kind as AlertKind, al.level, bars, NEEDS_LEVEL.slice(0, 2).includes(al.kind as AlertKind) ? al.createdAt.getTime() : since, tf, s.hasVolume));
    }
    if (!hit) { await db.mikeAlert.update({ where: { id: al.id }, data: { lastCheckedAt: new Date() } }); continue; }
    const message = `${al.asset}: ${ALERT_LABEL[al.kind as AlertKind]} — ${detail}${price != null ? ` (price ${fmtPrice(price)})` : ""}.`;
    const upd = await db.mikeAlert.updateMany({
      where: { id: al.id, status: "active" },
      data: { status: "triggered", triggeredAt: new Date(), lastCheckedAt: new Date(), triggerInfo: { detail, price, message } as Prisma.InputJsonValue },
    });
    if (upd.count) {
      fired.push({ id: al.id, asset: al.asset, kind: al.kind as AlertKind, message });
      await recordActivity(userId, { category: "notice", agent: "MIKE", source: "mike", action: `MIKE alert: ${message}`, status: "info", importance: 3 });
    }
  }
  return fired;
}
