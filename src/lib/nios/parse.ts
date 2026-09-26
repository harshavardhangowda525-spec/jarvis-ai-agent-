/**
 * NIOS notice extraction. The NIOS websites (main site, SDMIS, Vocational,
 * Results, regional centres) list notices as rows of links — usually a PDF with
 * a title and a date in the same table row / list item. This parser doesn't
 * depend on any one page's markup: it walks every link, keeps the ones that
 * look like notices (a document, or notice-like wording), takes the date from
 * the same row, and drops site navigation. Everything returned is exactly what
 * the page says — nothing is summarised or guessed. Client-safe (pure).
 */

export type NiosCategory = "exam" | "result" | "admission" | "fee" | "general";

export interface ParsedNotice {
  title: string;
  url: string;
  /** The date text as printed next to the notice (null when the row has none). */
  dateText: string | null;
  publishedAt: Date | null;
  category: NiosCategory;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const text = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Site chrome that is never a notice. */
const NAV = /^(home|about( us| nios)?|contact( us)?|site ?map|log ?in|sign ?in|sign ?up|register|faqs?|rti|tenders?|careers?|jobs|gallery|photo gallery|screen reader( access)?|skip to (main )?content|feedback|help|help ?desk|disclaimer|privacy policy|terms( (&|and) conditions)?|copyright policy|hyperlink policy|accessibility( statement)?|hindi|english|हिन्दी|a\+?|a-|more|view all|read more|archives?|back|next|previous|prev|top|search|menu|facebook|twitter|x|youtube|instagram|linkedin|whatsapp|telegram|koo)$/i;
/** Link text that says nothing on its own — the row text is the title then. */
const GENERIC = /^(click here( to (view|download|see))?|here|download|view|view details|details|pdf|link|open|read more|new|more|click)$/i;
const NOTICE_WORDS = /\b(notice|notification|circular|press release|announcement|advertisement|corrigendum|addendum|exam(ination)?s?|date ?sheet|practical|hall ?ticket|admit ?card|results?|marks?|re-?evaluation|re-?totall?ing|admission|registration|enrol(l)?ment|fees?|payment|last date|extension|extended|schedule|time ?table|on[- ]demand|toc|transfer of credit|study cent(re|er)|accredited|scholarship|revised|guidelines|instructions?|important)\b/i;
const DOC_HREF = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|zip)(\?|#|$)/i;
const NOTICE_HREF = /(notif|notice|circular|press|news|announce|media\/documents|documents?\/|uploads?\/|pdf)/i;
const SKIP_HREF = /^(#|javascript:|mailto:|tel:|data:)/i;

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Find the first printed date in a string (Indian d/m/y order for numeric dates). */
export function findDate(s: string): { text: string; date: Date } | null {
  const tries: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
    [/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/, (m) => mk(+m[3], +m[2] - 1, +m[1])],
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => mk(+m[1], +m[2] - 1, +m[3])],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.-]*${MONTH_RE}[\\s.,-]*(\\d{4})\\b`, "i"), (m) => mk(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1])],
    [new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"), (m) => mk(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])],
  ];
  let best: { text: string; date: Date; at: number } | null = null;
  for (const [re, f] of tries) {
    const m = s.match(re);
    if (!m || m.index == null) continue;
    const d = f(m);
    if (d && (!best || m.index < best.at)) best = { text: m[0], date: d, at: m.index };
  }
  return best ? { text: best.text, date: best.date } : null;
}
function mk(y: number, mo: number, d: number): Date | null {
  if (y < 2000 || y > 2100 || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.getUTCMonth() === mo ? dt : null;
}

export function categorize(title: string): NiosCategory {
  if (/\b(results?|marks?|re-?evaluation|re-?totall?ing|re-?checking|verification of marks|scorecard|mark ?sheets?|merit)\b/i.test(title)) return "result";
  if (/\b(fees?|payment|refund)\b/i.test(title)) return "fee";
  if (/\b(exam(ination)?s?|date ?sheet|practicals?|hall ?tickets?|admit ?cards?|theory|on[- ]demand|odes|time ?table|question papers?|exam cent(re|er)s?)\b/i.test(title)) return "exam";
  if (/\b(admissions?|registrations?|enrol(l)?ments?|toc|transfer of credit|re-?admission|stream|block)\b/i.test(title)) return "admission";
  return "general";
}

function cleanTitle(t: string) {
  return t
    .replace(/\s*[([]?\s*new\s*[)\]]?\s*$/i, "")
    .replace(/\s*(click here|download|view)\s*(to (view|download))?\s*$/i, "")
    .replace(/^[\s•·\-–»>|:]+|[\s•·\-–|:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove the row's date (with brackets / "dated") from either end of a title. */
function stripDate(title: string, date: string) {
  const d = date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cleanTitle(title
    .replace(new RegExp(`^[\\s([]*(?:dated|date|on)?\\s*:?\\s*${d}[\\s)\\],:–-]*`, "i"), "")
    .replace(new RegExp(`[\\s([,–-]*(?:dated|date|on)?\\s*:?\\s*${d}[\\s)\\].]*$`, "i"), ""));
}

/** Every notice-like link on a NIOS page, in page order, de-duplicated. */
export function parseNotices(html: string, pageUrl: string): ParsedNotice[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[\s\S]*?<\/\1>/gi, " ");
  const blocks = body.split(/<\/(?:tr|li|p|div|dd|dt|h[1-6]|marquee|section|article)>|<br\s*\/?>/i);
  const out: ParsedNotice[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const block of blocks) {
    if (!/<a\b/i.test(block)) continue;
    const blockText = text(block);
    anchorRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(block))) {
      const attrs = m[1];
      const href = decodeEntities((attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(2).find((x) => x != null) ?? "").trim());
      if (!href || SKIP_HREF.test(href)) continue;
      let url: string;
      try { url = new URL(href.replace(/ /g, "%20"), pageUrl).toString(); } catch { continue; }
      if (!/^https?:/i.test(url)) continue;

      const inner = text(m[2]) || text(attrs.match(/\btitle\s*=\s*"([^"]*)"/i)?.[1] ?? "");
      const anchorOnly = inner.replace(/\s+/g, " ").trim();
      let title = cleanTitle(anchorOnly);
      // "Notification regarding X … Click here" → the row's text is the title
      if (!title || GENERIC.test(title)) title = cleanTitle(blockText.replace(anchorOnly, " "));
      // strip a leading/trailing date that belongs to the row, not the title
      const dateHit = findDate(blockText.replace(anchorOnly, " ")) ?? (title === cleanTitle(blockText) ? findDate(title) : null);
      if (dateHit) title = stripDate(title, dateHit.text);

      if (title.length < 10 || title.length > 400) continue;
      if (NAV.test(title) || GENERIC.test(title)) continue;
      const isDoc = DOC_HREF.test(url);
      if (!isDoc && !NOTICE_WORDS.test(title) && !NOTICE_HREF.test(url)) continue;

      const key = `${url}|${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, url, dateText: dateHit?.text ?? null, publishedAt: dateHit?.date ?? null, category: categorize(title) });
    }
  }
  return out;
}
