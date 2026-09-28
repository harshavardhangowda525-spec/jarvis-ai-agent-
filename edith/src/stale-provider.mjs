import fs from "node:fs";

/** ULTRON's old default brains — a line saying exactly this is a leftover, not a choice. */
const OLD_ULTRON_DEFAULT = /^\s*(groq|gemini|groq\s*[,>]\s*gemini|gemini\s*[,>]\s*groq)\s*$/i;

/**
 * ULTRON now runs on this PC's Ollama. A leftover `ULTRON_AI_PROVIDER=groq,gemini`
 * (or the old name EDITH_AI_PROVIDER) in edith/.env — copied from the old example
 * file — would silently keep it on Groq. Turn such a line off (commented, with a
 * note, easy to undo). A deliberate custom choice (e.g. "ollama,groq",
 * "openrouter") is left alone. Returns the lines that were turned off.
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
    return `# ${line.trim()}   # turned off by JARVIS — ULTRON runs on this PC's Ollama now (delete the "# " to go back)`;
  });
  if (retired.length) fs.writeFileSync(file, out.join(eol));
  return retired;
}
