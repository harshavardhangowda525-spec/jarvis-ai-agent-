/**
 * EV creative studio — what the EV dashboard shows, derived ONLY from real data:
 * EV's content memory (EvContent rows), the brand facts EV is configured with,
 * and live Instagram numbers when an account is connected. Decorative motion on
 * the page never feeds into anything here. Client-safe (no server imports).
 */
import { EV_BUSINESS, EV_NICHES, EV_VOICE } from "./config";

/** The creative pipeline, left to right. */
export const EV_PIPELINE = ["IDEA", "SCRIPT", "CREATIVE", "REVIEW", "APPROVED", "PUBLISHED"] as const;
export type EvStage = (typeof EV_PIPELINE)[number];

/** Shapes the creative canvas can take. */
export type CreativeFormat = "post" | "reel" | "story" | "ad" | "product" | "video" | "campaign" | "typography" | "brand";

export interface StudioItem {
  id: string;
  kind: string;
  status: string;
  title: string;
  niche: string | null;
  theme: string | null;
  /** First useful line of text (hook, else caption, else body). */
  excerpt: string;
  createdAt: string;
  mediaUrl: string | null;
  isVideo: boolean;
}

export interface BrandNode {
  key: "style" | "tone" | "visual" | "themes" | "audience" | "campaigns";
  label: string;
  value: string;
}

export type StudioInstagram =
  | { connected: false }
  | { connected: true; error: string }
  | { connected: true; username: string | null; followers: number | null; mediaCount: number | null; recentPosts: number; recentLikes: number; recentComments: number };

export interface StudioData {
  pipeline: Record<EvStage, number>;
  recent: StudioItem[];
  brand: BrandNode[];
  instagram: StudioInstagram;
  totals: { items: number; last7Days: number };
}

/** Where a stored content item sits in the pipeline (null = rejected / failed). */
export function stageOfItem(i: { kind: string; status: string; hasMedia: boolean }): EvStage | null {
  switch (i.status) {
    case "published": return "PUBLISHED";
    case "approved":
    case "scheduled": return "APPROVED";
    case "ready": return "REVIEW";
    case "rejected":
    case "failed": return null;
    default:
      if (i.hasMedia) return "CREATIVE";
      return i.kind === "idea" ? "IDEA" : "SCRIPT";
  }
}

export function studioPipeline(items: { kind: string; status: string; hasMedia: boolean }[]): Record<EvStage, number> {
  const out = Object.fromEntries(EV_PIPELINE.map((s) => [s, 0])) as Record<EvStage, number>;
  for (const i of items) { const s = stageOfItem(i); if (s) out[s]++; }
  return out;
}

/** The stage the creative currently on screen is at, from EV's live state. */
export function liveStage(
  state: string,
  o: { hasMedia: boolean; publish: "idle" | "publishing" | "done" | "error" },
): EvStage | null {
  if (o.publish === "done") return "PUBLISHED";
  if (o.publish === "publishing") return "APPROVED";
  if (o.hasMedia || state === "WAITING_FOR_APPROVAL") return "REVIEW";
  if (state === "GENERATING" || state === "EXECUTING") return "CREATIVE";
  if (state === "THINKING") return "SCRIPT";
  if (state === "LISTENING") return "IDEA";
  return null;
}

/** Which canvas shape a command / activity asks for (null = no preference). */
export function formatFromText(text: string): CreativeFormat | null {
  const t = text.toLowerCase();
  if (/\bcampaigns?\b/.test(t)) return "campaign";
  if (/\breels?\b|\bshorts?\b|\bvideos?\b|\btiktok\b/.test(t)) return "reel";
  if (/\bstor(y|ies)\b/.test(t)) return "story";
  if (/\b(ads?|advert(isement)?s?|banner)\b/.test(t)) return "ad";
  if (/\bproducts?\b/.test(t)) return "product";
  if (/\btypograph|\bquotes?\b|\btext post\b/.test(t)) return "typography";
  if (/\bbrand(ing)?\b|\blogo\b|\bidentity\b/.test(t)) return "brand";
  if (/\bposts?\b|\bcarousel\b|\bcreative\b|\bgraphic\b|\bimage\b|\bposter\b|\bflyer\b/.test(t)) return "post";
  if (/\bpromo(tion(al)?)?s?\b/.test(t)) return "ad";
  return null;
}

/** Canvas shape for a stored content kind. */
export function formatOfKind(kind: string): CreativeFormat {
  switch (kind) {
    case "reel": return "reel";
    case "story": return "story";
    case "ad": return "ad";
    case "campaign": return "campaign";
    case "website":
    case "app": return "product";
    case "hook":
    case "caption":
    case "cta": return "typography";
    default: return "post";
  }
}

/** Kinetic label for a content kind in the idea stream. */
export function kindLabel(kind: string): string {
  return ({
    reel: "REEL CONCEPT", campaign: "PROMOTIONAL CAMPAIGN", ad: "LOCAL BUSINESS AD", post: "SOCIAL POST",
    story: "STORY", educational: "EDUCATIONAL POST", idea: "IDEA", caption: "CAPTION", hook: "HOOK", cta: "CALL TO ACTION",
    growth: "GROWTH PLAY", website: "PRODUCT STORY", app: "PRODUCT STORY", outreach: "OUTREACH", note: "NOTE",
  } as Record<string, string>)[kind] ?? kind.toUpperCase();
}

/** Formats offered when EV's memory is still empty (labels, not data). */
export const STARTER_FORMATS: { label: string; command: string; format: CreativeFormat }[] = [
  { label: "REEL CONCEPT", command: "Create a reel concept", format: "reel" },
  { label: "PROMOTIONAL CAMPAIGN", command: "Plan a promotional campaign", format: "campaign" },
  { label: "LOCAL BUSINESS AD", command: "Create a local business ad", format: "ad" },
  { label: "PRODUCT STORY", command: "Create a product story post", format: "product" },
  { label: "EDUCATIONAL POST", command: "Create an educational post", format: "post" },
];

const FORMAT_WORD: Record<string, string> = {
  reel: "Reels", post: "Posts", story: "Stories", ad: "Ads", campaign: "Campaigns", educational: "Educational posts",
  caption: "Captions", hook: "Hooks", growth: "Growth plays", idea: "Ideas", website: "Website stories", app: "App stories",
};

/**
 * The brand DNA nodes. Every value is either a configured brand fact or a count
 * / summary of EV's own stored content — "—" when there's nothing yet.
 */
export function brandDna(items: { kind: string; status: string; niche: string | null; theme: string | null }[]): BrandNode[] {
  const count = (key: (i: (typeof items)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const i of items) { const k = key(i)?.trim(); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const formats = count((i) => (FORMAT_WORD[i.kind] ? i.kind : null)).slice(0, 3).map((k) => FORMAT_WORD[k]);
  const themes = count((i) => i.theme).slice(0, 3);
  const niches = count((i) => i.niche).slice(0, 3);
  const published = items.filter((i) => i.status === "published").length;
  const campaigns = items.filter((i) => i.kind === "campaign").length;
  return [
    { key: "style", label: "STYLE", value: formats.length ? formats.join(" · ") : "—" },
    { key: "tone", label: "TONE", value: EV_VOICE.join(" · ") },
    { key: "visual", label: "VISUAL IDENTITY", value: `${EV_BUSINESS.instagram} · ${EV_BUSINESS.tagline}` },
    { key: "themes", label: "THEMES", value: themes.length ? themes.join(" · ") : "—" },
    { key: "audience", label: "AUDIENCE", value: niches.length ? niches.join(" · ") : `Targets: ${EV_NICHES.slice(0, 3).join(" · ")}` },
    { key: "campaigns", label: "PREVIOUS CAMPAIGNS", value: `${published} published · ${campaigns} campaign${campaigns === 1 ? "" : "s"}` },
  ];
}

/** "1234" → "1.2K" for the live metrics strip. */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}
