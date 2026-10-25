/**
 * Light syntax colouring for the studio's code pane (HTML, CSS, JS, JSON, SVG).
 * Fast enough to re-run while code streams in; escapes everything first, so a
 * file's content can never become markup in JARVIS itself.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (c: string, s: string) => `<span class="hl-${c}">${s}</span>`;

function tokens(src: string, rules: [RegExp, string | null][]) {
  // one combined pass: each match is coloured by the first rule that matches at that point
  const re = new RegExp(rules.map(([r]) => `(${r.source})`).join("|"), "gs");
  let out = "", last = 0;
  for (const m of src.matchAll(re)) {
    const i = m.index ?? 0;
    out += esc(src.slice(last, i));
    const g = m.slice(1).findIndex((x) => x !== undefined);
    const cls = rules[g]?.[1];
    out += cls ? span(cls, esc(m[0])) : esc(m[0]);
    last = i + m[0].length;
  }
  return out + esc(src.slice(last));
}

const JS: [RegExp, string | null][] = [
  [/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/, "c"],
  [/`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/, "s"],
  [/\b(?:const|let|var|function|return|if|else|for|while|of|in|new|class|extends|import|export|from|async|await|try|catch|finally|throw|this|typeof|null|undefined|true|false|document|window)\b/, "k"],
  [/\b\d+(?:\.\d+)?\b/, "n"],
];
const CSSR: [RegExp, string | null][] = [
  [/\/\*[\s\S]*?(?:\*\/|$)/, "c"],
  [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/, "s"],
  [/@[a-z-]+/, "k"],
  [/--[a-zA-Z0-9-]+|[a-z-]+(?=\s*:)/, "p"],
  [/#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg|fr)?\b/, "n"],
];
const HTML: [RegExp, string | null][] = [
  [/<!--[\s\S]*?(?:-->|$)/, "c"],
  [/<\/?[a-zA-Z][\w:-]*|\/?>/, "t"],
  [/\s[a-zA-Z_:][\w:.-]*(?==)/, "a"],
  [/"[^"]*"?|'[^']*'?/, "s"],
];

export function highlight(code: string, file: string): string {
  if (!code) return "";
  if (code.length > 400_000) return esc(code);
  if (/\.(js|mjs)$/.test(file)) return tokens(code, JS);
  if (/\.css$/.test(file)) return tokens(code, CSSR);
  if (/\.json$/.test(file)) return tokens(code, [[/"(?:\\.|[^"\\])*"(?=\s*:)/, "p"], [/"(?:\\.|[^"\\])*"?/, "s"], [/\b(?:true|false|null)\b/, "k"], [/-?\b\d+(?:\.\d+)?\b/, "n"]]);
  if (/\.(html|svg|xml)$/.test(file)) {
    // inline <style>/<script> get their own colouring
    return code.split(/(<style[^>]*>[\s\S]*?(?:<\/style>|$)|<script[^>]*>[\s\S]*?(?:<\/script>|$))/i).map((part) => {
      const m = /^(<(style|script)[^>]*>)([\s\S]*?)(<\/\2>)?$/i.exec(part);
      if (!m) return tokens(part, HTML);
      return tokens(m[1], HTML) + tokens(m[3], m[2].toLowerCase() === "style" ? CSSR : JS) + (m[4] ? tokens(m[4], HTML) : "");
    }).join("");
  }
  return esc(code);
}
