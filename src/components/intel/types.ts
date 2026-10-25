import type { ItemView } from "@/lib/intel/service";
export type { ItemView };

export type Radar = { id: string; label: string; total: number; last24: number; perDayBefore: number; emerging: boolean; analysed: number }[];
export type Opportunity = {
  id: string; title: string; score: number; status: string; updatedAt: string;
  detail: { whatHappened: string; whoBenefits: string; howWeCouldUseIt: string; difficulty: "low" | "medium" | "high"; scoreParts: { relevance: number; confidence: number; recency: number; evidence: number; ease: number } };
  evidence: { itemId: string; title: string; publisher: string | null; url: string; publishedAt: string | null; confidence: string }[];
};
export type SourceRun = { name: string; kind: string; ok: boolean; count: number; error?: string };
export type CC = {
  now: string;
  status: {
    lastRefreshAt: string | null; nextRefreshAfter: string | null;
    report: { at: string; sources: SourceRun[]; added: number; youtube: { configured: boolean; message: string | null; videos: number; live: number; errors: string[] }; tavily: boolean } | null;
    youtube: { configured: boolean; message: string | null };
    counts: { news: number; analysed: number; videos: number; liveNow: number };
  };
  topics: { id: string; label: string; query: string; category: string; on: boolean }[];
  settings: { dailyEnabled: boolean; weeklyEnabled: boolean; notifyEmail: boolean; notifyWhatsapp: boolean };
  radar: Radar; priority: ItemView[]; videos: ItemView[]; opportunities: Opportunity[]; scoreRule: string;
  briefings: { id: string; kind: string; period: string; label: string; status: string; revision: number; generatedAt: string | null }[];
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.data as T;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";
}
