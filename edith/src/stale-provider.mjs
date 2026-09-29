import fs from "node:fs";

/** ULTRON's old default brains (Groq/Gemini) — a line saying exactly this is a leftover, not a choice. */
const OLD_ULTRON_DEFAULT = /^\s*(groq|gemini|groq\s*[,>]\s*gemini|gemini\s*[,>]\s*groq)\s*$/i;

/**
 * ULTRON now runs on OpenRouter, with this PC's Ollama as the backup. A leftover
 * line from an older default in edith/.env (`ULTRON_AI_PROVIDER=groq,gemini`, or
 * the old name EDITH_AI_PROVIDER) would silently keep it there. Turn such a line
 * off (commented, with a note, easy to undo). A deliberate choice (e.g. "ollama",
 * "ollama,groq", "auto") is left alone — ULTRON says at startup that it's in
 * effect. Returns the lines that were turned off.
 */
export function retireOldUltronProvider(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const retired = [];
  const out = text.split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*(?:export\s+)?(ULTRON_AI_PROVIDER|EDITH_AI_PROVIDER)\s*=\s*(["']?)([^"'#\r\n]*)\2\s*(#.*)?$/);
    if (!m || !OLD_ULTRON_DEFAULT.test(m[3])) return line;
    retired.push(`${m[1]}=${m[3].trim()}`);
    return `# ${line.trim()}   # turned off by JARVIS — ULTRON runs on OpenRouter, with this PC's Ollama as backup (delete the "# " to go back)`;
  });
  if (retired.length) fs.writeFileSync(file, out.join(eol));
  return retired;
}
