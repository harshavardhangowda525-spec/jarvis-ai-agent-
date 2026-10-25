/**
 * The format ASTON's brain writes code in, and a parser that understands it
 * WHILE it streams (client-safe, pure — tested):
 *
 *   <<<FILE css/styles.css>>>
 *   …the whole file…
 *   <<<END>>>
 *
 * Plain markers survive any code (no JSON escaping of a 20 KB page), and each
 * file is known the moment its marker arrives, so the editor can show it being
 * written.
 */
export type FileEvent = { type: "open"; path: string } | { type: "delta"; path: string; text: string } | { type: "close"; path: string; content: string };

const OPEN = /<<<FILE\s+([^\s>]+)\s*>>>[ \t]*\r?\n/; // the whole marker line, newline included
const CLOSE = "<<<END>>>";

export class FileStreamParser {
  private buf = "";
  private cur: { path: string; content: string } | null = null;
  readonly files = new Map<string, string>();

  /** Feed more streamed text; returns what happened. */
  push(text: string): FileEvent[] {
    this.buf += text;
    const out: FileEvent[] = [];
    for (;;) {
      if (!this.cur) {
        const m = OPEN.exec(this.buf);
        if (!m) { this.buf = this.buf.slice(Math.max(0, this.buf.length - 200)); break; } // text between files is ignored
        this.cur = { path: m[1], content: "" };
        this.buf = this.buf.slice(m.index + m[0].length);
        out.push({ type: "open", path: m[1] });
        continue;
      }
      const end = this.buf.indexOf(CLOSE);
      if (end >= 0) {
        const piece = this.buf.slice(0, end).replace(/\r?\n$/, "");
        if (piece) { this.cur.content += piece; out.push({ type: "delta", path: this.cur.path, text: piece }); }
        this.files.set(this.cur.path, this.cur.content);
        out.push({ type: "close", path: this.cur.path, content: this.cur.content });
        this.buf = this.buf.slice(end + CLOSE.length);
        this.cur = null;
        continue;
      }
      // keep back a tail that might be "\n<<<END>>>" arriving in pieces
      const safe = this.buf.length - (CLOSE.length + 1);
      if (safe > 0) {
        const piece = this.buf.slice(0, safe);
        this.cur.content += piece;
        out.push({ type: "delta", path: this.cur.path, text: piece });
        this.buf = this.buf.slice(safe);
      }
      break;
    }
    return out;
  }

  /** The stream ended: a file still open counts only if it looks complete. */
  end(): FileEvent[] {
    if (!this.cur) return [];
    const content = (this.cur.content + this.buf).replace(/\s+$/, "");
    const path = this.cur.path;
    this.cur = null; this.buf = "";
    const complete = /\.html$/.test(path) ? /<\/html>\s*$/i.test(content) : content.length > 0;
    if (!complete) return [];
    this.files.set(path, content);
    return [{ type: "close", path, content }];
  }
}

/** A path the brain may write: inside the site, known kinds only. */
export function safeSitePath(p: string): string | null {
  const t = p.trim().replace(/^\.?\/+/, "");
  if (!/^(?:[a-z0-9][a-z0-9_-]*\/)?[a-z0-9][a-z0-9._-]*\.(html|css|js|svg|json|txt|xml|webmanifest)$/i.test(t)) return null;
  if (t.includes("..") || /^_aston\//.test(t)) return null;
  return t;
}
