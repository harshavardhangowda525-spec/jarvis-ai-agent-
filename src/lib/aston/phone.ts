import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Optional phone-call alerts. OFF by default and provider-independent: the
 * dispatcher talks to a CallProvider; the AI only supplies the text.
 *
 *   ASTON_PHONE_ALERTS_ENABLED=false (default) → never calls.
 *   enabled + ASTON_PHONE_MODE=test (default) → the TestCallProvider records
 *     what WOULD have been said; nothing is dialled, nothing is charged.
 *   enabled + ASTON_PHONE_MODE=live → Twilio places a real (billable) call.
 *
 * Every call — test or live — passes the guard: per-day call cap, cooldown,
 * and (live) a daily spending ceiling. Calls are never claimed to be free.
 */

export interface CallProvider {
  name: string;
  live: boolean;
  place(to: string, message: string): Promise<{ ref: string }>;
}

export class TestCallProvider implements CallProvider {
  name = "test";
  live = false;
  readonly placed: { to: string; message: string }[] = [];
  async place(to: string, message: string) {
    this.placed.push({ to, message });
    return { ref: `test-${Date.now().toString(36)}` };
  }
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

/** Twilio Programmable Voice via REST (API key + secret, Basic auth). No SDK needed. */
export class TwilioCallProvider implements CallProvider {
  name = "twilio";
  live = true;
  constructor(private cfg: { accountSid: string; apiKey: string; apiSecret: string; from: string }, private fetchImpl: typeof fetch = fetch) {}
  async place(to: string, message: string) {
    const text = xml(message.slice(0, 600));
    const twiml = `<Response><Say>This is ASTON with an urgent alert.</Say><Pause length="1"/><Say>${text}</Say><Pause length="1"/><Say>Repeating.</Say><Say>${text}</Say></Response>`;
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.apiKey}:${this.cfg.apiSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: this.cfg.from, Twiml: twiml }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    // Twilio's error text never contains our credentials; still keep it short.
    if (!res.ok) throw new Error(`Twilio refused the call (HTTP ${res.status}${j.code ? `, code ${j.code}` : ""}): ${(j.message ?? "").slice(0, 200)}`);
    return { ref: j.sid ?? "twilio-call" };
  }
}

export function twilioConfigured(): boolean {
  return !!(env.twilioAccountSid && env.twilioApiKey && env.twilioApiSecret && env.twilioPhoneNumber);
}

/** The provider for the current mode — Twilio only when phone alerts are enabled AND the mode is "live". */
export function callProvider(): CallProvider | null {
  if (!env.astonPhoneAlertsEnabled) return null;
  if (env.astonPhoneMode !== "live") return new TestCallProvider();
  if (!twilioConfigured()) return null;
  return new TwilioCallProvider({ accountSid: env.twilioAccountSid, apiKey: env.twilioApiKey, apiSecret: env.twilioApiSecret, from: env.twilioPhoneNumber });
}

export interface PhoneStatus {
  enabled: boolean;
  mode: "test" | "live";
  provider: string | null;
  ownerNumberSet: boolean;
  twilioConfigured: boolean;
  callsLast24h: number;
  spendLast24hUsd: number;
  maxCallsPerDay: number;
  maxDailyUsd: number;
  cooldownMinutes: number;
}

/** Can ASTON place a call now? Checks configuration, the daily cap, cooldown and spend ceiling. */
export async function phoneGuard(userId: string, now = new Date()): Promise<{ allowed: boolean; reason?: string; status: PhoneStatus }> {
  const db = getDb();
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const calls = await db.astonAlert.findMany({
    where: { userId, channel: "phone", status: "delivered", deliveredAt: { gte: since } },
    select: { deliveredAt: true, costUsd: true, testMode: true },
  });
  const spend = calls.filter((c) => !c.testMode).reduce((a, c) => a + (c.costUsd ?? 0), 0);
  const status: PhoneStatus = {
    enabled: env.astonPhoneAlertsEnabled, mode: env.astonPhoneMode, provider: callProvider()?.name ?? null,
    ownerNumberSet: !!env.astonOwnerPhone, twilioConfigured: twilioConfigured(),
    callsLast24h: calls.length, spendLast24hUsd: Math.round(spend * 100) / 100,
    maxCallsPerDay: env.astonPhoneMaxCallsPerDay, maxDailyUsd: env.astonPhoneMaxDailyUsd, cooldownMinutes: env.astonPhoneCooldownMin,
  };
  const no = (reason: string) => ({ allowed: false, reason, status });
  if (!env.astonPhoneAlertsEnabled) return no("Phone alerts are off (ASTON_PHONE_ALERTS_ENABLED=false).");
  if (!/^\+[1-9]\d{6,14}$/.test(env.astonOwnerPhone)) return no("ASTON_OWNER_PHONE_NUMBER is missing or not in E.164 format (e.g. +9198…).");
  if (env.astonPhoneMode === "live" && !twilioConfigured()) return no("Live calls need TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET and TWILIO_PHONE_NUMBER.");
  if (calls.length >= env.astonPhoneMaxCallsPerDay) return no(`Daily call limit reached (${env.astonPhoneMaxCallsPerDay} in 24 h).`);
  const last = calls.reduce((m, c) => Math.max(m, c.deliveredAt?.getTime() ?? 0), 0);
  if (last && now.getTime() - last < env.astonPhoneCooldownMin * 60_000) return no(`Cooling down — the last call was under ${env.astonPhoneCooldownMin} minutes ago.`);
  if (env.astonPhoneMode === "live" && spend + env.astonPhoneEstCostUsd > env.astonPhoneMaxDailyUsd) return no(`Daily phone budget reached ($${env.astonPhoneMaxDailyUsd.toFixed(2)}).`);
  return { allowed: true, status };
}
