import fs from "node:fs";

/**
 * Minimal .env loader (no dependency). Real environment variables win over the
 * file. Handles quotes, Windows line endings and an inline "  # note" after an
 * unquoted value.
 */
export function loadEnv(file, { only } = {}) {
  if (!fs.existsSync(file)) { aliasLegacyNames(); return false; }
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
    if (only && !only.test(k)) continue;
    // A blank (or Vercel "[SENSITIVE]") value means "not set" — so a key filled
    // in another file (e.g. the app's .env.local) can still be picked up.
    if (!v || /^\[sensitive\]$/i.test(v)) continue;
    if (!process.env[k]) process.env[k] = v;
  }
  aliasLegacyNames();
  return true;
}

/**
 * ULTRON was called EDITH before — settings written with the old names
 * (EDITH_TOKEN, EDITH_WORKSPACE, EDITH_ALLOWED_ORIGINS, …) keep working.
 */
export function aliasLegacyNames() {
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("EDITH_")) continue;
    const nk = `ULTRON_${k.slice("EDITH_".length)}`;
    if (!(nk in process.env)) process.env[nk] = v;
  }
}
