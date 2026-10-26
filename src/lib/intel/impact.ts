/**
 * The business-impact score — transparent and configurable. Each part says
 * whether it is MEASURED (from the record: dates, sources) or an AI JUDGEMENT
 * (the analysis's relevance/importance rating). Client-safe and pure.
 */
export interface Weights { relevance: number; urgency: number; evidence: number; recency: number }
export const DEFAULT_WEIGHTS: Weights = { relevance: 0.4, urgency: 0.2, evidence: 0.2, recency: 0.2 };

export interface ImpactInput { relevance: number | null; importance: number | null; publishedAt: string | null; fetchedAt: string; confidence: "high" | "medium" | "low" | null; publishers: number; official: boolean; hasSummary: boolean }
export interface ImpactPart { key: keyof Weights; label: string; value: number; basis: "measured" | "ai_judgement" | "mixed"; why: string }

export function impactScore(i: ImpactInput, w: Weights = DEFAULT_WEIGHTS, now = Date.now()) {
  const ageH = Math.max(0, (now - Date.parse(i.publishedAt ?? i.fetchedAt)) / 3600_000);
  const recency = Math.max(0, 1 - ageH / 168);
  const parts: ImpactPart[] = [
    { key: "relevance", label: "Relevance to Infinity Web & Apps", value: i.relevance == null ? 0 : (i.relevance - 1) / 4, basis: "ai_judgement", why: i.relevance == null ? "Not analysed yet" : `AI rated ${i.relevance}/5` },
    { key: "urgency", label: "Urgency", value: ((i.importance == null ? 0 : (i.importance - 1) / 4) + recency) / 2, basis: "mixed", why: `${i.importance == null ? "importance not rated" : `AI importance ${i.importance}/5`} · ${Math.round(ageH)} h old` },
    { key: "evidence", label: "Evidence quality", value: i.official ? 1 : Math.min(1, (i.publishers - 1) / 2 + (i.hasSummary ? 0.25 : 0)), basis: "measured", why: i.official ? "Official company channel" : `${i.publishers} publisher${i.publishers === 1 ? "" : "s"}${i.hasSummary ? ", with a summary" : ", headline only"}` },
    { key: "recency", label: "Recency", value: recency, basis: "measured", why: `${i.publishedAt ? "Published" : "Retrieved"} ${Math.round(ageH)} h ago` },
  ];
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const score = Math.round((parts.reduce((a, p) => a + p.value * w[p.key], 0) / total) * 100);
  return { score, parts, weights: w };
}

export function sanitizeWeights(v: unknown): Weights {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof Weights, unknown>>;
  const n = (x: unknown, d: number) => (typeof x === "number" && x >= 0 && x <= 1 ? x : d);
  return { relevance: n(o.relevance, DEFAULT_WEIGHTS.relevance), urgency: n(o.urgency, DEFAULT_WEIGHTS.urgency), evidence: n(o.evidence, DEFAULT_WEIGHTS.evidence), recency: n(o.recency, DEFAULT_WEIGHTS.recency) };
}

/** The service an opportunity points at (for the radar's sectors) — keyword based, shown as such. */
export const SERVICES = [
  { id: "website", label: "Websites", re: /website|landing page|web ?site|seo|wordpress|php|web design/i },
  { id: "mobile", label: "Mobile apps", re: /mobile app|android|ios|app store|\bapp\b/i },
  { id: "ai", label: "AI workflows", re: /\bai\b|agent|automation|chatbot|llm|gpt|assistant/i },
  { id: "clinic", label: "Clinic automation", re: /clinic|hospital|doctor|patient|appointment|healthcare|dental/i },
  { id: "software", label: "Business software", re: /crm|erp|saas|software|dashboard|portal|inventory/i },
  { id: "transform", label: "Digital transformation", re: /digital|smb|msme|small business|local business|upi|payments?|ondc/i },
  { id: "marketing", label: "Marketing & content", re: /marketing|instagram|content|social media|campaign|brand|ads?\b/i },
  { id: "product", label: "AI products", re: /product|platform|launch|wearable|glasses|device/i },
] as const;
export function serviceOf(text: string): (typeof SERVICES)[number] {
  return SERVICES.find((s) => s.re.test(text)) ?? SERVICES[5];
}
