"use client";

import { Fragment, useState, type ReactNode } from "react";

/**
 * A small, safe Markdown renderer for agent replies: headings, paragraphs,
 * bold / italic / inline code, fenced code blocks (with Copy), bullet and
 * numbered lists, tables, quotes and links. It builds React elements — never
 * raw HTML — so a reply can't inject anything into the page. Links open only
 * for http(s) and mailto.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code first (its contents are literal), then links, bold, italic, bare URLs
  const re = /(`[^`\n]+`)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k} className="md-ic">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(SAFE_LINK.test(m[4]) ? <a key={k} href={m[4]} target="_blank" rel="noreferrer noopener">{inline(m[3], k)}</a> : m[3]);
    else if (m[5]) out.push(<strong key={k}>{inline(m[6], k)}</strong>);
    else if (m[7]) out.push(<strong key={k}>{inline(m[8], k)}</strong>);
    else if (m[9]) out.push(<em key={k}>{inline(m[10], k)}</em>);
    else if (m[11]) out.push(<em key={k}>{inline(m[12], k)}</em>);
    else if (m[13]) out.push(<a key={k} href={m[13]} target="_blank" rel="noreferrer noopener">{m[13]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-h">
        <span>{lang || "code"}</span>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code (an unclosed fence while streaming still renders)
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<CodeBlock key={k++} code={body.join("\n")} lang={fence[1]} />);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2], `h${k}`);
      blocks.push(level <= 2 ? <h3 key={k++} className="md-h">{content}</h3> : <h4 key={k++} className="md-h4">{content}</h4>);
      i++; continue;
    }
    // table: header row, then a |---| row
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="md-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${ri}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k++} className="md-q">{inline(q.join(" "), `q${k}`)}</blockquote>);
      continue;
    }
    const bullet = /^\s*[-*•]\s+/, num = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || num.test(line)) {
      const ordered = num.test(line) && !bullet.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? num : bullet).test(lines[i])) {
        let item = lines[i++].replace(ordered ? num : bullet, "");
        // wrapped continuation lines belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !bullet.test(lines[i]) && !num.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      const li = items.map((it, j) => <li key={j}>{inline(it, `li${k}${j}`)}</li>);
      blocks.push(ordered ? <ol key={k++} className="md-ol">{li}</ol> : <ul key={k++} className="md-ul">{li}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*[-*•]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    blocks.push(<p key={k++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${k}${j}`)}</Fragment>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
