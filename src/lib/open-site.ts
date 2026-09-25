/**
 * "Open Amazon", "go to youtube.com", "open Flipkart and search for shoes",
 * "search YouTube for lo-fi music" — understood right in the browser, so the
 * tab opens instantly (no AI round trip, and still inside the click/keypress
 * that allows a new tab). Also used by the open_link tool to turn a plain name
 * ("amazon") into a real address. Client-safe and pure.
 */

export interface SiteTarget { url: string; label: string }

interface Site { label: string; home: string; search?: string }

/** Well-known sites (home page + search URL with %s for the query). */
const SITES: Record<string, Site> = {
  amazon: { label: "Amazon", home: "https://www.amazon.com/", search: "https://www.amazon.com/s?k=%s" },
  "amazon.in": { label: "Amazon", home: "https://www.amazon.in/", search: "https://www.amazon.in/s?k=%s" },
  flipkart: { label: "Flipkart", home: "https://www.flipkart.com/", search: "https://www.flipkart.com/search?q=%s" },
  myntra: { label: "Myntra", home: "https://www.myntra.com/", search: "https://www.myntra.com/%s" },
  meesho: { label: "Meesho", home: "https://www.meesho.com/", search: "https://www.meesho.com/search?q=%s" },
  ebay: { label: "eBay", home: "https://www.ebay.com/", search: "https://www.ebay.com/sch/i.html?_nkw=%s" },
  youtube: { label: "YouTube", home: "https://www.youtube.com/", search: "https://www.youtube.com/results?search_query=%s" },
  "youtube music": { label: "YouTube Music", home: "https://music.youtube.com/", search: "https://music.youtube.com/search?q=%s" },
  google: { label: "Google", home: "https://www.google.com/", search: "https://www.google.com/search?q=%s" },
  "google maps": { label: "Google Maps", home: "https://www.google.com/maps/", search: "https://www.google.com/maps/search/%s" },
  maps: { label: "Google Maps", home: "https://www.google.com/maps/", search: "https://www.google.com/maps/search/%s" },
  gmail: { label: "Gmail", home: "https://mail.google.com/", search: "https://mail.google.com/mail/u/0/#search/%s" },
  "google calendar": { label: "Google Calendar", home: "https://calendar.google.com/" },
  calendar: { label: "Google Calendar", home: "https://calendar.google.com/" },
  "google drive": { label: "Google Drive", home: "https://drive.google.com/", search: "https://drive.google.com/drive/search?q=%s" },
  drive: { label: "Google Drive", home: "https://drive.google.com/", search: "https://drive.google.com/drive/search?q=%s" },
  "google docs": { label: "Google Docs", home: "https://docs.google.com/" },
  "google sheets": { label: "Google Sheets", home: "https://sheets.google.com/" },
  "google photos": { label: "Google Photos", home: "https://photos.google.com/" },
  "google translate": { label: "Google Translate", home: "https://translate.google.com/" },
  netflix: { label: "Netflix", home: "https://www.netflix.com/", search: "https://www.netflix.com/search?q=%s" },
  "prime video": { label: "Prime Video", home: "https://www.primevideo.com/" },
  hotstar: { label: "JioHotstar", home: "https://www.hotstar.com/" },
  spotify: { label: "Spotify", home: "https://open.spotify.com/", search: "https://open.spotify.com/search/%s" },
  instagram: { label: "Instagram", home: "https://www.instagram.com/" },
  facebook: { label: "Facebook", home: "https://www.facebook.com/", search: "https://www.facebook.com/search/top?q=%s" },
  twitter: { label: "X", home: "https://x.com/", search: "https://x.com/search?q=%s" },
  x: { label: "X", home: "https://x.com/", search: "https://x.com/search?q=%s" },
  linkedin: { label: "LinkedIn", home: "https://www.linkedin.com/", search: "https://www.linkedin.com/search/results/all/?keywords=%s" },
  whatsapp: { label: "WhatsApp Web", home: "https://web.whatsapp.com/" },
  telegram: { label: "Telegram Web", home: "https://web.telegram.org/" },
  reddit: { label: "Reddit", home: "https://www.reddit.com/", search: "https://www.reddit.com/search/?q=%s" },
  pinterest: { label: "Pinterest", home: "https://www.pinterest.com/", search: "https://www.pinterest.com/search/pins/?q=%s" },
  wikipedia: { label: "Wikipedia", home: "https://www.wikipedia.org/", search: "https://en.wikipedia.org/w/index.php?search=%s" },
  github: { label: "GitHub", home: "https://github.com/", search: "https://github.com/search?q=%s" },
  "stack overflow": { label: "Stack Overflow", home: "https://stackoverflow.com/", search: "https://stackoverflow.com/search?q=%s" },
  chatgpt: { label: "ChatGPT", home: "https://chatgpt.com/" },
  claude: { label: "Claude", home: "https://claude.ai/" },
  outlook: { label: "Outlook", home: "https://outlook.live.com/" },
  swiggy: { label: "Swiggy", home: "https://www.swiggy.com/" },
  zomato: { label: "Zomato", home: "https://www.zomato.com/" },
  canva: { label: "Canva", home: "https://www.canva.com/" },
  figma: { label: "Figma", home: "https://www.figma.com/" },
  notion: { label: "Notion", home: "https://www.notion.so/" },
  vercel: { label: "Vercel", home: "https://vercel.com/dashboard" },
  // "Open Chrome / a browser / a new tab" — a web page can't start apps, so a fresh Google tab.
  browser: { label: "a new browser tab", home: "https://www.google.com/", search: "https://www.google.com/search?q=%s" },
};
const ALIASES: Record<string, string> = {
  "amazon india": "amazon.in", "amazon in": "amazon.in", "you tube": "youtube", yt: "youtube", "google map": "google maps",
  "google mail": "gmail", mail: "gmail", "g mail": "gmail", insta: "instagram", ig: "instagram", fb: "facebook",
  "stackoverflow": "stack overflow", "chat gpt": "chatgpt", "disney hotstar": "hotstar", jiohotstar: "hotstar",
  "amazon prime": "prime video", "prime": "prime video", "whats app": "whatsapp", "wiki": "wikipedia",
  chrome: "browser", "google chrome": "browser", "a browser": "browser", "the browser": "browser", "new tab": "browser",
  "a new tab": "browser", edge: "browser", firefox: "browser", "web browser": "browser",
};

const DOMAIN = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i;

/**
 * A site name or address → its real URL (null if unknown). `india` picks the
 * Indian Amazon for a plain "amazon".
 */
export function resolveSite(name: string, query?: string | null, opts: { india?: boolean } = {}): SiteTarget | null {
  let key = name.toLowerCase().trim().replace(/^(the|my)\s+/, "").replace(/\s+(website|site|web ?site|app|page|homepage|home page)$/, "").trim();
  key = ALIASES[key] ?? key;
  if (key === "amazon" && opts.india) key = "amazon.in";
  const q = query?.trim();
  const site = SITES[key];
  if (site) {
    const url = q && site.search ? site.search.replace("%s", encodeURIComponent(q)) : site.home;
    return { url, label: site.label };
  }
  // An address: keep the path's own letter case (only the host is case-free).
  const d = (/\s/.test(name.trim()) ? key.replace(/\s+/g, "") : name.trim()).match(DOMAIN);
  if (d) {
    const host = d[1].toLowerCase();
    return { url: `https://${host}${d[2] ?? "/"}`, label: host.replace(/^www\./, "") };
  }
  return null;
}

const OPEN = "(?:please\\s+)?(?:can you\\s+|could you\\s+)?(?:open(?:\\s+up)?|launch|go to|goto|visit|take me to|bring up|pull up|load|navigate to)";

/** Parse a spoken/typed "open <site>" command. Null → not a website command. */
export function parseOpenSite(text: string, opts: { india?: boolean } = {}): SiteTarget | null {
  const s = text.trim().replace(/^(hey |ok |okay )?jarvis[,!.\s]+/i, "").replace(/[.!?]+$/, "").trim();
  // "search amazon for headphones" / "search for headphones on amazon"
  let m = s.match(/^(?:please\s+)?(?:search|look up|find)\s+(.+?)\s+for\s+(.+)$/i);
  if (m) { const t = resolveSite(m[1], m[2], opts); if (t && SITES[normalizeKey(m[1], opts)]?.search) return t; }
  m = s.match(/^(?:please\s+)?(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+(.+)$/i);
  if (m) { const t = resolveSite(m[2], m[1], opts); if (t && SITES[normalizeKey(m[2], opts)]?.search) return t; }
  // "open amazon", "open flipkart and search for shoes", "go to youtube.com"
  m = s.match(new RegExp(`^${OPEN}\\s+(.+?)(?:\\s+(?:and|&)\\s+(?:search|look)\\s+(?:for\\s+)?(.+))?$`, "i"));
  if (m) return resolveSite(m[1], m[2], opts);
  return null;
}

function normalizeKey(name: string, opts: { india?: boolean }): string {
  let k = name.toLowerCase().trim().replace(/^(the|my)\s+/, "").replace(/\s+(website|site|app|page)$/, "").trim();
  k = ALIASES[k] ?? k;
  return k === "amazon" && opts.india ? "amazon.in" : k;
}

/** Is the user's browser set to India (for amazon.in)? */
export function inIndia(): boolean {
  try { return /^Asia\/(Kolkata|Calcutta)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return false; }
}
