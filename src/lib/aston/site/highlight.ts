/**
 * A tiny syntax highlighter for ASTON's live-code window (HTML, CSS, JSON,
 * JS). Pure and fast enough to re-run on every streamed chunk; it returns
 * tokens that React renders as text (never as HTML), so it is injection-safe.
 */
export type Tok = { c: string; t: string };
export type Lang = "html" | "css" | "json" | "js";

type Rule = [string, RegExp];

const CSS: Rule[] = [
  ["com", /\/\*[\s\S]*?(?:\*\/|$)/y],
  ["str", /"[^"\n]*"?|'[^'\n]*'?/y],
  ["at", /@[\w-]+/y],
  ["prop", /(?<=[{;]\s*)--?[\w-]+(?=\s*:)/y],
  ["sel", /[^{};@\s][^{};]*?(?=\s*\{)/y],
  ["num", /#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|rem|em|%|vh|vw|svh|dvh|s|ms|deg|fr|ch)?\b/y],
  ["fn", /[\w-]+(?=\()/y],
  ["pun", /[{}:;(),]/y],
];
const JSON_RULES: Rule[] = [
  ["key", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y],
  ["str", /"(?:[^"\\\n]|\\.)*"?/y],
  ["num", /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/y],
  ["pun", /[{}[\]:,]/y],
];
const JS: Rule[] = [
  ["com", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
  ["str", /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?/y],
  ["kw", /\b(?:const|let|var|function|return|if|else|for|of|in|new|true|false|null|undefined|typeof|async|await|class|this)\b/y],
  ["num", /\b\d+(?:\.\d+)?\b/y],
  ["fn", /[A-Za-z_$][\w$]*(?=\()/y],
  ["pun", /[{}()[\];,.=>+\-*/!?:&|]/y],
];

function lex(code: string, rules: Rule[], out: Tok[]) {
  let i = 0, plain = "";
  const flush = () => { if (plain) { out.push({ c: "", t: plain }); plain = ""; } };
  outer: while (i < code.length) {
    for (const [c, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) { flush(); out.push({ c, t: m[0] }); i += m[0].length; continue outer; }
    }
    plain += code[i++];
  }
  flush();
}

function lexHtml(code: string, out: Tok[]) {
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][\w-]*|\/?>|\s[\w:@.-]+(?==)|"[^"]*"?|'[^']*'?/g;
  let last = 0, m: RegExpExecArray | null, inTag = false;
  while ((m = re.exec(code))) {
    const s = m[0];
    if (!inTag && (s.startsWith('"') || s.startsWith("'") || /^\s/.test(s) || s.endsWith(">") && !s.startsWith("<"))) continue; // quotes/attrs in text
    if (m.index > last) out.push({ c: "", t: code.slice(last, m.index) });
    if (s.startsWith("<!--")) out.push({ c: "com", t: s });
    else if (s.startsWith("<")) { out.push({ c: "tag", t: s }); inTag = true; }
    else if (s.endsWith(">")) { out.push({ c: "tag", t: s }); inTag = false; }
    else if (/^\s/.test(s)) out.push({ c: "attr", t: s });
    else out.push({ c: "str", t: s });
    last = m.index + s.length;
  }
  if (last < code.length) out.push({ c: "", t: code.slice(last) });
}

export function highlight(code: string, lang: Lang): Tok[] {
  const out: Tok[] = [];
  if (lang === "css") lex(code, CSS, out);
  else if (lang === "json") lex(code, JSON_RULES, out);
  else if (lang === "js") lex(code, JS, out);
  else {
    // HTML, with CSS highlighting inside <style> blocks
    const parts = code.split(/(<style[^>]*>[\s\S]*?(?:<\/style>|$))/i);
    for (const p of parts) {
      const st = p.match(/^(<style[^>]*>)([\s\S]*?)(<\/style>)?$/i);
      if (st) { lexHtml(st[1], out); lex(st[2], CSS, out); if (st[3]) lexHtml(st[3], out); }
      else lexHtml(p, out);
    }
  }
  return out;
}

export const langOf = (file: string): Lang =>
  file.endsWith(".css") ? "css" : file.endsWith(".json") ? "json" : file.endsWith(".js") ? "js" : "html";
