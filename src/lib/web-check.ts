import "server-only";
import { isPrivateIp, resolveHost } from "@/lib/darwin/daily/checks";
import { frameAllowed } from "@/lib/web-embed";

/**
 * Look at a web page from the server: may JARVIS show it in an iframe, and what
 * is it (title, description, image — for the pop-up's preview card)?
 * SSRF-guarded like DARWIN's checks: http(s) on default ports, public IPs only,
 * each redirect re-validated.
 */
export interface PageCheck {
  url: string;
  reachable: boolean;
  frameable: boolean | null; // null = couldn't tell
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  icon: string | null;
  error?: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}

/** og:/twitter:/<title> metadata from a page's HTML. */
export function pageMeta(html: string, base: string): Pick<PageCheck, "title" | "description" | "image" | "siteName" | "icon"> {
  const head = html.slice(0, 300_000);
  const meta = (names: string[]) => {
    for (const n of names) {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, "i");
      const tag = head.match(re)?.[0];
      const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
      if (c && c.trim()) return decode(c).slice(0, 300);
    }
    return null;
  };
  const abs = (u: string | null) => { if (!u) return null; try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
  const title = meta(["og:title", "twitter:title"]) ?? (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).slice(0, 200) : null);
  const iconHref = head.match(/<link[^>]+rel=["'][^"']*\bicon\b[^"']*["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1] ?? "/favicon.ico";
  return {
    title: title || null,
    description: meta(["og:description", "twitter:description", "description"]),
    image: abs(meta(["og:image", "og:image:url", "twitter:image"])),
    siteName: meta(["og:site_name", "application-name"]),
    icon: abs(iconHref),
  };
}

export async function checkPage(input: string, appOrigin: string, timeoutMs = 7000): Promise<PageCheck> {
  const out: PageCheck = { url: input, reachable: false, frameable: null, title: null, description: null, image: null, siteName: null, icon: null };
  let current: URL;
  try { current = new URL(input); } catch { return { ...out, error: "invalid URL" }; }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(current.protocol) || (current.port && current.port !== "80" && current.port !== "443")) return { ...out, error: "can't check this address from the server" };
    const r = await resolveHost(current.hostname);
    if (r.state !== "ok") return { ...out, error: r.state === "nxdomain" ? "that site doesn't exist" : "DNS lookup failed" };
    if (r.ips.some(isPrivateIp)) return { ...out, error: "private address" };
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { ...out, error: (e as Error)?.name === "TimeoutError" ? "timed out" : "couldn't connect" };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      try { current = new URL(res.headers.get("location")!, current); } catch { return { ...out, error: "bad redirect" }; }
      continue;
    }
    out.url = current.toString();
    out.reachable = res.status < 500;
    out.frameable = frameAllowed({ xFrameOptions: res.headers.get("x-frame-options"), csp: res.headers.get("content-security-policy") }, appOrigin);
    if (res.status >= 400) out.frameable = res.status === 404 ? out.frameable : null; // bot walls lie about headers
    if (/text\/html|xhtml/i.test(res.headers.get("content-type") ?? "")) {
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let n = 0;
      while (reader && n < 300_000) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); n += value.length; }
      reader?.cancel().catch(() => {});
      Object.assign(out, pageMeta(new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), out.url));
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return out;
  }
  return { ...out, error: "too many redirects" };
}
