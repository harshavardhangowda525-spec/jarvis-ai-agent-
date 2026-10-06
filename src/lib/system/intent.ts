/**
 * "Analyze the system", "run a self-diagnostic", "JARVIS, diagnose yourself"
 * → the system analysis. Client-safe (pure).
 */
export function isSystemAnalysis(text: string): boolean {
  const s = text.trim().toLowerCase()
    .replace(/^(hey |ok |okay )?jarvis[,!.\s]+/, "")
    .replace(/^(please |can you |could you |would you )+/, "")
    .replace(/[.!?]+$/, "")
    .trim();
  return /^(?:run\s+(?:a\s+|the\s+)?)?(?:full\s+|complete\s+)?(?:system\s+(?:analysis|diagnostics?|check|scan|audit)|self[-\s]?(?:diagnostics?|diagnosis|check|scan|test)|diagnostics?)(?:\s+(?:now|mode|please))?$/.test(s)
    || /^(?:analy[sz]e|diagnose|scan|check|audit)\s+(?:the\s+|your\s+|my\s+|whole\s+|entire\s+)*(?:system|systems|yourself|jarvis|architecture)(?:\s+(?:now|please))?$/.test(s);
}
