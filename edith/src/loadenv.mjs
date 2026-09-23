import fs from "node:fs";

/**
 * Minimal .env loader (no dependency). Real environment variables win over the
 * file. Handles quotes, Windows line endings and an inline "  # note" after an
 * unquoted value.
 */
export function loadEnv(file) {
  if (!fs.existsSync(file)) return false;
  // Strip a UTF-8 BOM (Notepad adds one) so the first key isn't misread.
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("="); if (eq === -1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "").trim(); // drop an inline "  # note" after an unquoted value
    if (!(k in process.env)) process.env[k] = v;
  }
  return true;
}
