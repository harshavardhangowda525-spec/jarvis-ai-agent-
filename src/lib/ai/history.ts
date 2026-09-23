/**
 * Conversation-history shaping. A local model on a CPU has to re-read every
 * message it's sent before it can answer, so it gets a short recent window
 * (with long messages clipped); cloud models get the full window.
 */
export type ChatTurn = { role: "user" | "assistant"; content: string };

export function trimHistoryForLocal(history: ChatTurn[], maxMessages = 8, maxChars = 1200): ChatTurn[] {
  let recent = history.slice(-Math.max(0, maxMessages));
  // Keep the window starting on a user turn so the model sees a coherent exchange.
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  return recent.map((m) =>
    m.content.length > maxChars ? { ...m, content: `${m.content.slice(0, maxChars)}… [trimmed]` } : m,
  );
}
