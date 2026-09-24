/**
 * Conversation-history shaping. A local model on a CPU has to re-read every
 * message it's sent before it can answer, so it gets a short recent window
 * (with long messages clipped); cloud models get the full window.
 */
export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * @param total how many messages the whole conversation has (history may be
 *   only its tail). The window's start moves in STEPS rather than sliding by one
 *   turn each time, so the start of the prompt stays identical for a few turns
 *   and Ollama can reuse what it already read (its prompt cache) instead of
 *   re-reading the whole history on every question.
 */
export function trimHistoryForLocal(history: ChatTurn[], maxMessages = 8, maxChars = 1200, total = history.length): ChatTurn[] {
  const max = Math.max(0, maxMessages);
  let recent: ChatTurn[];
  if (max === 0) recent = [];
  else {
    const step = Math.max(2, max - 2);
    const absStart = Math.max(0, Math.ceil((total - max) / step) * step); // index in the whole conversation
    const offset = total - history.length; // messages older than what we were given
    recent = history.slice(Math.max(0, absStart - offset));
    if (recent.length > max) recent = recent.slice(-max);
  }
  // Keep the window starting on a user turn so the model sees a coherent exchange.
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  return recent.map((m) =>
    m.content.length > maxChars ? { ...m, content: `${m.content.slice(0, maxChars)}… [trimmed]` } : m,
  );
}
