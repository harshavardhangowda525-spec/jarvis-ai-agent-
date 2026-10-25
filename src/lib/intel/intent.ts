/**
 * "Open business environment", "how's the business environment?" (speech
 * recognition often hears "how's" as "house") → open the Command Center with
 * today's full briefing. Client-safe and pure.
 */
const SUBJECT = String.raw`(?:the\s+)?(?:business\s+environment|business\s+intel(?:ligence)?|environment\s+(?:dashboard|command\s+cent(?:er|re))|business\s+(?:dashboard|briefing|brief)|command\s+cent(?:er|re))`;

export function businessEnvCommand(text: string): boolean {
  const q = text.toLowerCase().replace(/^(hey |ok |okay )?jarvis[,!.\s]*/, "").replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (new RegExp(String.raw`^(?:please\s+)?(?:open|show(?:\s+me)?|launch|start|bring\s+up|pull\s+up|go\s+to|take\s+me\s+to|display)\s+(?:up\s+|me\s+)?${SUBJECT}(?:\s+(?:dashboard|page|now|please))*$`).test(q)) return true;
  if (new RegExp(String.raw`^(?:how(?:'?s|\s+is|\s+are|\s+was)?|house|hows|what(?:'?s|\s+is)\s+(?:the\s+)?(?:status|update|latest)\s+(?:of|on|in)|what(?:'?s|\s+is)\s+happening\s+in|give\s+me|brief\s+me\s+on|update\s+me\s+on|tell\s+me\s+about)\s+${SUBJECT}(?:\s+(?:today|now|looking|doing|this\s+week))*$`).test(q)) return true;
  return /^(?:the\s+)?business\s+environment$/.test(q);
}
