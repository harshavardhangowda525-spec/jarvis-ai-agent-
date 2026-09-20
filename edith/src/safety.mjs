/**
 * Command safety policy. Classifies a shell command as SAFE / REVIEW / DANGEROUS.
 * The agent runs SAFE automatically, asks confirmation for REVIEW when configured,
 * and ALWAYS requires explicit confirmation for DANGEROUS — never silently runs
 * a destructive/production command.
 */
export const LEVEL = { SAFE: "safe", REVIEW: "review", DANGEROUS: "dangerous" };

const DANGEROUS = [
  /\brm\s+-rf?\b/i,
  /\brm\s+-[a-z]*f/i,
  /\bgit\s+push\b[^\n]*--force|\bgit\s+push\s+-f\b/i,
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bmkfs\b|\bdd\s+if=/i,
  /\b:\(\)\s*\{/, // fork bomb
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bkubectl\s+delete\b|\bterraform\s+destroy\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bsudo\b/i,
];

const REVIEW = [
  /\bgit\s+push\b/i,
  /\bgit\s+commit\b/i,
  /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i,
  /\bvercel\b|\bnetlify\b|\bwrangler\b/i, // deploy CLIs
  /\bdocker\s+(push|rm|rmi|system\s+prune)\b/i,
  /\bnpm\s+uninstall\b|\bpip\s+uninstall\b/i,
  /\bmv\b|\bcurl\b[^\n]*\|\s*(sh|bash)\b/i,
];

/** Classify a raw command string. */
export function classifyCommand(cmd) {
  const c = String(cmd || "");
  for (const re of DANGEROUS) if (re.test(c)) return { level: LEVEL.DANGEROUS, reason: `matches a destructive pattern (${re})` };
  for (const re of REVIEW) if (re.test(c)) return { level: LEVEL.REVIEW, reason: "changes state or reaches an external service" };
  return { level: LEVEL.SAFE, reason: "read/build/test-class command" };
}

/** Does this command require explicit confirmation under the given mode? */
export function commandNeedsConfirmation(cmd, mode) {
  const { level } = classifyCommand(cmd);
  if (level === LEVEL.DANGEROUS) return true;      // always
  if (mode === "manual") return true;               // manual confirms everything
  if (mode === "autonomous") return false;          // autonomous runs safe+review
  return level === LEVEL.REVIEW;                     // default: confirm review-level
}
