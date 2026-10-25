/**
 * What the command center watches for Infinity Web & Apps — the categories on
 * the radar, the topics (each a real news search) and the publishers read
 * directly. All editable per user (topics) — nothing here is a result.
 */

export const BUSINESS = {
  name: "Infinity Web & Apps",
  what: "a web and app development studio in India that builds websites, web apps and mobile apps for small and mid-sized businesses",
};

export const CATEGORIES = [
  { id: "ai", label: "AI & ML" },
  { id: "software", label: "Software" },
  { id: "business", label: "Business" },
  { id: "consumer", label: "Consumer Tech" },
  { id: "robotics", label: "Robotics" },
  { id: "cyber", label: "Cyber" },
  { id: "commerce", label: "Commerce" },
  { id: "economic", label: "Economic" },
  { id: "legal", label: "Legal & Policy" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

export interface Topic { id: string; label: string; query: string; category: CategoryId; on: boolean }

export const DEFAULT_TOPICS: Topic[] = [
  { id: "ai-dev-tools", label: "AI developer tools", query: "AI coding assistant OR AI developer tools", category: "ai", on: true },
  { id: "ai-models", label: "New AI models & platforms", query: "new AI model launch OR AI platform release", category: "ai", on: true },
  { id: "wearables", label: "Wearables & smart glasses", query: "smart glasses OR AR glasses OR wearable launch", category: "consumer", on: true },
  { id: "web-dev", label: "Web development", query: "web development framework release OR web platform update", category: "software", on: true },
  { id: "app-dev", label: "Mobile app development", query: "Android iOS app developers update OR app store policy", category: "software", on: true },
  { id: "nocode", label: "No-code & website builders", query: "no-code platform OR AI website builder", category: "software", on: true },
  { id: "india-smb", label: "Indian SMB digital adoption", query: "India small business digital adoption OR MSME digital", category: "business", on: true },
  { id: "india-startups", label: "Indian startups & funding", query: "Indian startup funding tech", category: "business", on: true },
  { id: "ecommerce", label: "E-commerce & D2C", query: "India ecommerce D2C ONDC", category: "commerce", on: true },
  { id: "payments", label: "Payments & UPI", query: "UPI payments India merchants", category: "commerce", on: true },
  { id: "cyber", label: "Cybersecurity", query: "website security vulnerability OR data breach India", category: "cyber", on: true },
  { id: "robotics", label: "Robotics & automation", query: "robotics automation launch", category: "robotics", on: false },
  { id: "india-economy", label: "Indian economy", query: "India economy RBI GDP inflation", category: "economic", on: true },
  { id: "policy", label: "Tech policy & data protection", query: "DPDP Act India OR MeitY rules OR digital regulation India", category: "legal", on: true },
];

/** Publishers read directly (RSS). */
export const FEEDS: { name: string; url: string; category: CategoryId }[] = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "software" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "consumer" },
  { name: "Inc42", url: "https://inc42.com/feed/", category: "business" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/technology-lab", category: "software" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", category: "ai" },
  { name: "Economic Times Tech", url: "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms", category: "business" },
];

/** Official YouTube channels watched for livestreams and new videos (handles, resolved with the YouTube Data API). */
export const CHANNELS: { handle: string; name: string; category: CategoryId }[] = [
  { handle: "@OpenAI", name: "OpenAI", category: "ai" },
  { handle: "@Google", name: "Google", category: "software" },
  { handle: "@GoogleDevelopers", name: "Google for Developers", category: "software" },
  { handle: "@Microsoft", name: "Microsoft", category: "software" },
  { handle: "@NVIDIA", name: "NVIDIA", category: "ai" },
  { handle: "@Apple", name: "Apple", category: "consumer" },
  { handle: "@Meta", name: "Meta", category: "consumer" },
  { handle: "@anthropic-ai", name: "Anthropic", category: "ai" },
  { handle: "@Samsung", name: "Samsung", category: "consumer" },
  { handle: "@awsevents", name: "AWS Events", category: "software" },
];

const KEYWORDS: Record<CategoryId, RegExp> = {
  ai: /\b(ai|a\.i\.|artificial intelligence|llm|gpt|gemini|claude|copilot|machine learning|neural|chatbot|agentic|agents?)\b/i,
  software: /\b(software|developer|devs?|framework|javascript|typescript|react|next\.js|api|sdk|cloud|open[- ]source|github|app store|android|ios|web)\b/i,
  business: /\b(startup|funding|raises|acquisition|acquires|ipo|revenue|layoffs?|smb|msme|enterprise|valuation)\b/i,
  consumer: /\b(smartphone|phone|glasses|wearable|headset|watch|earbuds|vr|ar|iphone|pixel|galaxy)\b/i,
  robotics: /\b(robot|robotics|humanoid|drone|automation|autonomous)\b/i,
  cyber: /\b(security|breach|hack|hacked|ransomware|vulnerability|malware|phishing|cyber)\b/i,
  commerce: /\b(e-?commerce|retail|d2c|ondc|upi|payments?|checkout|marketplace|shopify)\b/i,
  economic: /\b(economy|gdp|inflation|rbi|interest rate|rupee|recession|budget|tariff)\b/i,
  legal: /\b(regulation|law|act|policy|ban|court|sebi|meity|dpdp|compliance|antitrust|privacy)\b/i,
};

/** The category a headline is about — the topic's own category when it came from a topic search. */
export function categorize(text: string, fallback?: CategoryId): CategoryId {
  const scores = (Object.keys(KEYWORDS) as CategoryId[]).map((c) => [c, (text.match(new RegExp(KEYWORDS[c], "gi")) ?? []).length] as const);
  const best = scores.sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : fallback ?? "business";
}
