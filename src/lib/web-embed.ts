/**
 * Can a website be shown inside JARVIS's glass browser pop-up? Pure and
 * client-safe (the header check itself runs on the server).
 *
 * - Some sites publish an official player/embed page (YouTube videos, Google
 *   Maps, Spotify, Vimeo) — those always work in the pop-up.
 * - Other sites say in their response headers whether other pages may frame
 *   them (X-Frame-Options / CSP frame-ancestors). Most big sites refuse; those
 *   run in ULTRON's live browser instead.
 */

export interface Embed { url: string; label: string }

const ytId = (s: string | null | undefined) => (s && /^[\w-]{11}$/.test(s) ? s : null);

function ytStart(u: URL): string {
  const t = u.searchParams.get("t") || u.searchParams.get("start");
  if (!t) return "";
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const secs = m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
  return secs > 0 ? `&start=${secs}` : "";
}

/** A page's official embeddable version, or null. */
export function officialEmbed(raw: string): Embed | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = ytId(parts[0]);
    else if (parts[0] === "watch") id = ytId(u.searchParams.get("v"));
    else if (["shorts", "live", "embed", "v"].includes(parts[0])) id = ytId(parts[1]);
    const list = u.searchParams.get("list");
    if (id) return { url: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0${ytStart(u)}${list && /^[\w-]+$/.test(list) ? `&list=${list}` : ""}`, label: "YouTube" };
    if (parts[0] === "playlist" && list && /^[\w-]+$/.test(list)) return { url: `https://www.youtube.com/embed/videoseries?list=${list}`, label: "YouTube" };
    return null;
  }

  if ((host === "google.com" || host.startsWith("google.") || host === "maps.google.com") && (parts[0] === "maps" || host === "maps.google.com")) {
    let q = u.searchParams.get("q") || u.searchParams.get("query") || "";
    if (!q && parts[1] === "search" && parts[2]) q = decodeURIComponent(parts[2]).replace(/\+/g, " ");
    if (!q && parts[1] === "place" && parts[2]) q = decodeURIComponent(parts[2]).replace(/\+/g, " ");
    if (!q && parts[1] === "dir") return null;
    const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (!q && at) q = `${at[1]},${at[2]}`;
    if (!q) return { url: "https://maps.google.com/maps?output=embed&z=3&q=world", label: "Google Maps" };
    return { url: `https://maps.google.com/maps?output=embed&q=${encodeURIComponent(q)}`, label: "Google Maps" };
  }

  if (host === "open.spotify.com") {
    const i = parts[0]?.startsWith("intl-") ? 1 : 0;
    const [kind, id] = [parts[i], parts[i + 1]];
    if (["track", "album", "playlist", "artist", "episode", "show"].includes(kind) && id && /^[A-Za-z0-9]+$/.test(id)) {
      return { url: `https://open.spotify.com/embed/${kind}/${id}`, label: "Spotify" };
    }
    return null;
  }

  if (host === "vimeo.com" && /^\d+$/.test(parts[0] ?? "")) return { url: `https://player.vimeo.com/video/${parts[0]}?autoplay=1`, label: "Vimeo" };
  if (host === "player.vimeo.com" || (host === "youtube.com" && parts[0] === "embed")) return { url: u.toString(), label: "Video" };
  return null;
}

function sourceMatches(src: string, origin: URL): boolean {
  const s = src.trim().toLowerCase().replace(/^'|'$/g, "");
  if (s === "*") return true;
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return origin.protocol === s; // "https:"
  const m = s.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([a-z0-9.-]+)(?::(\d+|\*))?(?:\/.*)?$/);
  if (!m) return false;
  const [, scheme, wild, host, port] = m;
  if (scheme && `${scheme}:` !== origin.protocol) return false;
  if (!scheme && origin.protocol !== "https:" && origin.protocol !== "http:") return false;
  const h = origin.hostname.toLowerCase();
  if (wild ? !h.endsWith(`.${host}`) : h !== host) return false;
  if (port && port !== "*") {
    const op = origin.port || (origin.protocol === "https:" ? "443" : "80");
    if (port !== op) return false;
  }
  return true;
}

/**
 * From a response's headers: may a page at `appOrigin` show it in an iframe?
 * CSP frame-ancestors wins over X-Frame-Options when both are present (as in
 * browsers).
 */
export function frameAllowed(headers: { xFrameOptions?: string | null; csp?: string | null }, appOrigin: string): boolean {
  let origin: URL;
  try { origin = new URL(appOrigin); } catch { return false; }
  const policies = (headers.csp ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  let sawAncestors = false;
  for (const policy of policies) {
    const dir = policy.split(";").map((d) => d.trim()).find((d) => /^frame-ancestors\b/i.test(d));
    if (!dir) continue;
    sawAncestors = true;
    const sources = dir.split(/\s+/).slice(1);
    // every policy must allow it
    if (!sources.length || sources.some((s) => s.toLowerCase() === "'none'")) return false;
    if (!sources.some((s) => sourceMatches(s, origin))) return false;
  }
  if (sawAncestors) return true;
  const xfo = (headers.xFrameOptions ?? "").trim().toLowerCase();
  if (!xfo) return true;
  // DENY, SAMEORIGIN (JARVIS is never the same origin), ALLOW-FROM (unsupported) → no
  return !/\b(deny|sameorigin|allow-from)\b/.test(xfo);
}

export type BrowserMode = "embed" | "frame" | "live" | "preview";

/**
 * How the pop-up should show a page: an official embed, a plain iframe, the
 * live browser (via ULTRON), or a preview card with an "open in new tab"
 * button when nothing else can show it.
 */
export function chooseMode(o: { embed: boolean; frameable: boolean | null; live: boolean; mixedContent: boolean }): BrowserMode {
  if (o.embed) return "embed";
  if (o.frameable && !o.mixedContent) return "frame";
  if (o.live) return "live";
  if (o.frameable === null && !o.mixedContent) return "frame"; // couldn't check (e.g. your own localhost) — try it
  return "preview";
}
