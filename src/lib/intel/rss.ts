/** A small, dependency-free RSS 2.0 / Atom reader. */

export interface FeedItem { title: string; link: string; summary: string | null; publishedAt: Date | null; publisher: string | null }

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const strip = (s: string) => decode(decode(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (block: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1] ?? null;

export function parseFeed(xml: string, publisher: string | null = null): FeedItem[] {
  const out: FeedItem[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of items) {
    const title = strip(tag(b, "title") ?? "");
    let link = decode(tag(b, "link") ?? "").trim();
    if (!link) link = /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? "";
    if (!title || !/^https?:\/\//.test(link)) continue;
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const d = date ? new Date(decode(date).trim()) : null;
    const src = tag(b, "source");
    const summary = strip(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "");
    out.push({ title, link, summary: summary && summary !== title ? summary.slice(0, 700) : null, publishedAt: d && !isNaN(d.getTime()) ? d : null, publisher: src ? strip(src) : publisher });
  }
  return out;
}

/** Google News puts " - Publisher" at the end of each title; split it off so the title stays the headline. */
export function splitPublisher(title: string, publisher: string | null): { title: string; publisher: string | null } {
  if (!publisher) {
    const m = /^(.*\S)\s+-\s+([^-]{2,60})$/.exec(title);
    return m ? { title: m[1], publisher: m[2].trim() } : { title, publisher };
  }
  const suffix = ` - ${publisher}`;
  return { title: title.endsWith(suffix) ? title.slice(0, -suffix.length) : title, publisher };
}

export async function fetchFeed(url: string, publisher: string | null, f: typeof fetch = fetch): Promise<FeedItem[]> {
  const r = await f(url, { headers: { "User-Agent": "JARVIS-Intel/1.0 (+personal news reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseFeed(await r.text(), publisher);
}
