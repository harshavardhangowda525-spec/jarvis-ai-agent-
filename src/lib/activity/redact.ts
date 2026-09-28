/**
 * Keep secrets out of the activity history. Anything that looks like a
 * password, API key, token, private key, connection string or card number is
 * replaced with "[redacted]" before an event is stored. Client-safe (pure).
 */
const R = "[redacted]";
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, R],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, R], // JWT
  [/\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g, R],
  [/\bgsk_[A-Za-z0-9]{16,}/g, R], // Groq
  [/\bAIza[0-9A-Za-z_-]{30,}/g, R], // Google
  [/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R], // Slack
  [/\bAKIA[0-9A-Z]{16}\b/g, R], // AWS
  [/\bIG[A-Za-z0-9]{40,}/g, R], // Instagram tokens
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@]+@/gi, `$1${R}@`], // user:pass@ in URLs
  [/\b(password|passwd|pwd|passcode|pass ?phrase|api[ _-]?key|secret|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|bearer|token|otp|pin|cvv)\b(\s*(?:is|was|=|:)\s*|\s+)(?!\[redacted\])["']?[^\s"',]{3,}["']?/gi, `$1$2${R}`],
  [/\b(?:\d[ -]?){13,19}\b/g, R], // card-like numbers (phone numbers are shorter)
  [/\b[A-Fa-f0-9]{32,}\b/g, R], // long hex secrets
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/g, R], // long base64-ish blobs
];

export function redact(text: string): string {
  let t = text;
  for (const [re, rep] of PATTERNS) t = t.replace(re, rep);
  return t;
}

const SECRET_KEY = /(pass|secret|token|api.?key|auth|cookie|credential|private|session|otp|pin|cvv)/i;

/** Deep-copy metadata without secret-looking keys, redacting string values. */
export function redactMeta(v: unknown, depth = 0): unknown {
  if (v == null || depth > 4) return v ?? null;
  if (typeof v === "string") return redact(v).slice(0, 500);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redactMeta(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = redactMeta(x, depth + 1);
    }
    return out;
  }
  return null;
}
