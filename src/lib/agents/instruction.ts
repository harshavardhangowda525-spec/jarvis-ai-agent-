import type { ChatAgentId } from "./catalog";

/**
 * Which agents a spoken/typed command names, and the instruction meant for one
 * of them ("activate Darwin and find 30 salons", "ask Evie to …", "Darwin, …").
 * Client-safe and pure. Day names and "mic" are not agents: "Friday" only counts
 * as FRIDAY when it is addressed, and the instruction pattern requires that.
 */
const NAMES: [ChatAgentId, RegExp][] = [
  ["darwin", /\bdarwin\b/],
  ["robin", /\b(?:rubin|robin|ruben|reuben)\b/],
  ["ev", /\b(?:evie|ev|eve)\b/],
  ["mike", /\bmike\b/],
  ["aston", /\b(?:aston|austin)\b/],
  ["friday", /\bfriday\b/],
];
const NAME_SRC: Record<ChatAgentId, string> = {
  darwin: "darwin", robin: "(?:rubin|robin|ruben|reuben)", ev: "(?:evie|ev|eve)", mike: "mike", aston: "(?:aston|austin)", friday: "friday",
};

/** The agents a command mentions, in the order they're mentioned. */
export function agentsNamed(text: string): ChatAgentId[] {
  const low = text.toLowerCase();
  return NAMES.map(([id, re]) => ({ id, at: low.search(re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.id);
}

/** The instruction addressed to one agent, or null when it's just "open Darwin" (or not addressed to it at all). */
export function agentInstruction(text: string, id: ChatAgentId): string | null {
  const t = text.trim();
  const lead = String.raw`^(?:(?:hey|ok|okay)\s+)?(?:jarvis[,!.\s]+)?(?:please\s+)?(?:can you\s+|could you\s+)?`;
  const name = NAME_SRC[id];
  const verbs = String.raw`(?:activate|open|launch|start|ask|tell|get|have|make|let|use)`;
  const m = t.match(new RegExp(`${lead}${verbs}\\s+${name}\\b\\s*(?:,|:|\\s+to\\s+|\\s+and\\s+|\\s+[-—]\\s+)\\s*(.+)$`, "i"))
    ?? t.match(new RegExp(`${lead}${name}\\s*[,:]\\s*(.+)$`, "i"));
  const rest = m?.[1]?.replace(/[\s.!]+$/, "").trim() ?? "";
  if (rest.split(/\s+/).length < 2 || rest.length < 6) return null;
  // "open Darwin and take over" / "… and go online" are activations, not tasks
  if (/^(?:take over|go online|come online|wake up|start up|get ready|be ready)$/i.test(rest)) return null;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
