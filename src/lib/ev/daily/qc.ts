import { EV_BUSINESS } from "@/lib/ev/config";
import { findSimilar, tokenSet } from "@/lib/ev/dedup";

/**
 * The quality gate a daily package must pass before it's marked READY FOR
 * APPROVAL. Pure: the pipeline passes in what it measured (image size, the
 * MP4's real duration/size, recent history) and gets back every check with the
 * reason it failed. Nothing is waved through.
 */

export interface QcCheck { key: string; label: string; ok: boolean; detail: string; severity: "error" | "warn" }
export interface QcResult { passed: boolean; checks: QcCheck[]; at: string }

export interface QcInput {
  topic: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  beats: string[];
  creativeConcept: string;
  videoConcept: string;
  postingTime: string | null;
  image: { url: string | null; bytes: number; width: number; height: number } | null;
  video: { url: string | null; bytes: number; mimeType: string; seconds: number; width: number; height: number } | null;
  /** Recent packages / EV items to compare against (excluding this package's own lineage). */
  history: { id: string; title: string; text: string; hook?: string | null }[];
  /** Whether the app's public URL is https (Instagram must be able to fetch the media). */
  publicUrl: boolean;
}

const PLACEHOLDER = /\[[^\]]{0,40}\]|\{\{?[^}]{0,40}\}?\}|<[a-z_ ]{2,30}>|\blorem\b|\bipsum\b|\bTBD\b|\bTODO\b|\bplaceholder\b|\binsert (your|a|the)\b|\byour (business|brand|company) name\b|\bXXX+\b|\bN\/A\b|\bexample\.com\b|\b(phone|number):?\s*x{3,}/i;
const HYPE = /\b\d{1,3}\s?%|\bguarantee(d|s)?\b|\b100\s?%|\b\d+\s?x (more|growth|sales|revenue|leads)\b|#1\b|\bnumber one\b|\bbest in (the )?(city|town|india|world|business)\b|\baward[- ]winning\b|\b\d[\d,]*\+?\s+(happy )?(clients|customers|businesses) (served|trust)|\btrusted by\b|\b5[- ]star\b|\brated\b|\btop[- ]rated\b|\bstudies show\b|\bresearch shows\b|\bstatistic(s|ally)\b/i;
const OWN_PRICES = [EV_BUSINESS.websiteFrom, EV_BUSINESS.appFrom].map((p) => p.replace(/[^\d]/g, ""));
const SERVICE_WORDS = /\b(website|web ?site|site|app|apps|mobile app|automation|automate|ai|online (ordering|booking|orders|bookings|store|menu)|booking|ordering|software|crm|redesign|digital|online presence|google|marketing|whatsapp ordering|dashboard|system)\b/i;
const HASHTAG = /^#[\p{L}\p{N}_]{2,60}$/u;

export function findPlaceholders(text: string): string | null {
  return text.match(PLACEHOLDER)?.[0] ?? null;
}

/** Claims we can't back up: stats, guarantees, rankings, prices that aren't ours. */
export function findFakeClaims(text: string): string[] {
  const out: string[] = [];
  const hype = text.match(new RegExp(HYPE.source, "gi"));
  if (hype) out.push(...hype.map((h) => h.trim()));
  for (const m of text.matchAll(/(?:₹\s?|\b(?:rs\.?|inr)\s?)(\d[\d,]*)/gi)) {
    const digits = m[1].replace(/,/g, "");
    if (!OWN_PRICES.includes(digits)) out.push(m[0].trim());
  }
  return [...new Set(out)];
}

/** Every mention of the brand must be spelled exactly. */
export function brandIssues(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![@#\w])infinity[\s-]*web[\w\s&.-]{0,12}?(apps?|applications?)\b/gi)) {
    if (m[0] !== EV_BUSINESS.name) out.push(m[0]);
  }
  for (const m of text.matchAll(/@infinity[\w.]*\w/gi)) if (m[0].toLowerCase() !== EV_BUSINESS.instagram) out.push(m[0]);
  const phones = text.match(/\b\d{10}\b/g) ?? [];
  for (const p of phones) if (p !== EV_BUSINESS.phone) out.push(p);
  return out;
}

const STOP = new Set(["your", "with", "that", "this", "from", "have", "they", "their", "what", "when", "will", "more", "into", "just", "about", "every", "than", "then", "them", "make", "like", "need", "only", "also"]);
function keyTokens(s: string): Set<string> {
  return new Set([...tokenSet(s)].filter((t) => t.length > 3 && !STOP.has(t)));
}

export function qualityCheck(p: QcInput, now = new Date()): QcResult {
  const checks: QcCheck[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string, severity: QcCheck["severity"] = "error") => checks.push({ key, label, ok, detail, severity });
  const allText = [p.hook, p.caption, p.cta, ...p.beats].join("\n");

  // 1. media exists
  const imgOk = !!p.image?.url && p.image.bytes > 5_000 && p.image.width > 0 && p.image.height > 0;
  const vidOk = !!p.video?.url && p.video.bytes > 10_000;
  add("media", "Media exists", imgOk && vidOk,
    !p.image?.url ? "The post image is missing." : !imgOk ? "The post image file is empty or unreadable." : !p.video?.url ? "The Reel video is missing." : !vidOk ? "The Reel file is empty." : `Image ${p.image!.width}×${p.image!.height} · Reel ${(p.video!.bytes / 1_048_576).toFixed(1)} MB`);

  // 2. caption exists
  add("caption", "Caption exists", p.caption.trim().length >= 60, p.caption.trim().length >= 60 ? `${p.caption.trim().length} characters` : "The caption is missing or too short to post.");

  // 3. caption matches the creative (shares the topic's key words)
  const creativeTokens = keyTokens([p.topic, p.creativeConcept, p.videoConcept, p.hook, ...p.beats].join(" "));
  const shared = [...keyTokens(p.caption)].filter((t) => creativeTokens.has(t));
  add("match", "Caption matches the creative", shared.length >= 2, shared.length >= 2 ? `Shares: ${shared.slice(0, 5).join(", ")}` : "The caption doesn't talk about what the image and Reel show.");

  // 4. video is playable (real MP4 with a readable duration, 9:16)
  const v = p.video;
  const ratio = v && v.height ? v.width / v.height : 0;
  const playable = !!v && /mp4/i.test(v.mimeType) && v.seconds >= 3 && v.seconds <= 90 && Math.abs(ratio - 9 / 16) < 0.02;
  add("playable", "Video is playable", playable,
    !v ? "No video file." : !/mp4/i.test(v.mimeType) ? `Unexpected format ${v.mimeType}.` : !(v.seconds >= 3 && v.seconds <= 90) ? `Duration ${v.seconds.toFixed(1)}s is outside Reels' 3–90s.` : Math.abs(ratio - 9 / 16) >= 0.02 ? `Frame ${v.width}×${v.height} isn't 9:16.` : `MP4 · ${v.seconds.toFixed(1)}s · ${v.width}×${v.height}`);

  // 5. not a duplicate of recent content
  const dupText = [p.topic, p.hook, p.caption].join("\n");
  const similar = findSimilar(dupText, p.history, 0.6);
  const hookHit = p.history.find((h) => (h.hook && jaccardTokens(h.hook, p.hook) >= 0.7) || jaccardTokens(h.title, p.topic) >= 0.75);
  add("unique", "Not a repeat of recent content", !similar.length && !hookHit,
    similar.length ? `Too close to "${similar[0].title}".` : hookHit ? `Topic or hook repeats "${hookHit.title}".` : `Checked against ${p.history.length} recent pieces.`);

  // 6. brand name correct
  const brand = brandIssues(allText);
  const named = allText.includes(EV_BUSINESS.name) || allText.toLowerCase().includes(EV_BUSINESS.instagram);
  add("brand", "Brand name correct", !brand.length && named, brand.length ? `Wrong brand details: ${brand.slice(0, 3).join(", ")}` : !named ? `The caption never names ${EV_BUSINESS.name}.` : EV_BUSINESS.name);

  // 7. positioning — about what the business sells, to business owners
  add("positioning", "Positioning is correct", SERVICE_WORDS.test(allText), SERVICE_WORDS.test(allText) ? "Talks about a service Infinity Web & Apps offers." : "The content never connects to a service we sell.");

  // 8. no placeholder text
  const ph = findPlaceholders([allText, p.hashtags.join(" ")].join("\n"));
  add("placeholder", "No placeholder text", !ph, ph ? `Found "${ph}".` : "Clean.");

  // 9. no fake claims
  const claims = findFakeClaims(allText);
  add("claims", "No fake claims", !claims.length, claims.length ? `Unbacked: ${claims.slice(0, 3).join(", ")}` : "No stats, guarantees or made-up prices.");

  // 10. Instagram-friendly
  const fullCaption = `${p.caption}\n\n${p.hashtags.join(" ")}`;
  const badTags = p.hashtags.filter((h) => !HASHTAG.test(h));
  const igIssues = [
    fullCaption.length > 2200 && `caption is ${fullCaption.length} chars (max 2200)`,
    (p.hashtags.length < 3 || p.hashtags.length > 30) && `${p.hashtags.length} hashtags (3–30)`,
    badTags.length > 0 && `invalid hashtag ${badTags[0]}`,
    p.hook.length > 110 && "hook is too long to read in the first second",
    new Set(p.hashtags.map((h) => h.toLowerCase())).size !== p.hashtags.length && "duplicate hashtags",
  ].filter(Boolean) as string[];
  add("instagram", "Instagram-friendly format", !igIssues.length, igIssues.length ? igIssues.join("; ") : `${fullCaption.length} chars · ${p.hashtags.length} hashtags · 9:16 Reel`);

  // 11. publishing information present
  const missing = [!p.caption && "caption", !p.hashtags.length && "hashtags", !p.postingTime && "posting time", !p.image?.url && "image", !p.video?.url && "video", !p.cta && "call to action"].filter(Boolean);
  add("publishing", "Publishing info complete", !missing.length, missing.length ? `Missing: ${missing.join(", ")}` : `Posting at ${p.postingTime}`);
  add("public", "Media reachable by Instagram", p.publicUrl, p.publicUrl ? "Served from your public https URL." : "APP_URL isn't a public https address, so Instagram can't fetch the media until it is.", "warn");

  return { passed: checks.every((c) => c.ok || c.severity === "warn"), checks, at: now.toISOString() };
}

function jaccardTokens(a: string, b: string): number {
  const A = keyTokens(a), B = keyTokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const t of A) if (B.has(t)) i++;
  return i / (A.size + B.size - i);
}
