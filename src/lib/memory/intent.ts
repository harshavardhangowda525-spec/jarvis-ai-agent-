/**
 * What you tell JARVIS to remember / forget, understood without the AI (so it
 * works even when the PC brain is off). Pure and client-safe.
 */

export type MemoryCommand =
  | { kind: "remember"; fact: string }
  | { kind: "forget"; query: string }
  | { kind: "list" };

const strip = (t: string) => t.trim().replace(/^(?:(?:hey|ok|okay)\s+)?jarvis[,!.:\s]+/i, "").trim();

function tidy(s: string): string {
  const t = s.trim().replace(/^["“']+|["”']+$/g, "").replace(/[.!?\s]+$/, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) + "." : "";
}

const REMINDER = /^(to|what|when|where|who|how|why|which|if|whether|the time|me)\b/i;
const REMEMBER_VERB = "(?:remember|memori[sz]e|don'?t forget|do not forget|keep in mind|make a note|note down|note|save (?:this |that |it )?(?:to|in) (?:your )?memory|store (?:this |that |it )?(?:in|to) (?:your )?memory|add (?:this |that |it )?to (?:your )?memory)";

export function parseMemoryCommand(text: string): MemoryCommand | null {
  let s = strip(text);
  if (!s) return null;

  // ---- what do you remember?
  if (/^(?:what|tell me what)\s+(?:do|did|have)\s+you\s+(?:remember(?:ed)?|know|saved|stored)(?:\s+about\s+me)?[?.!\s]*$/i.test(s)
    || /^(?:show|list|read)(?:\s+me)?\s+(?:my|your|all)?\s*(?:saved\s+)?memor(?:y|ies)[?.!\s]*$/i.test(s)
    || /^what(?:'s| is) in your memory[?.!\s]*$/i.test(s)) return { kind: "list" };

  // ---- forget …
  let m = s.match(/^(?:please\s+)?(?:forget|erase)\s+(?:about\s+|that\s+|what i (?:told|said to) you about\s+|the (?:memory|fact|thing) (?:about|that)\s+)?(.{2,200}?)[.!?\s]*$/i);
  if (!m) m = s.match(/^(?:please\s+)?(?:delete|remove|erase)\s+(?:the\s+)?(?:memory\s+(?:about|that)\s+)?(.{2,200}?)\s+from\s+(?:your\s+)?memory[.!?\s]*$/i);
  if (!m) m = s.match(/^(?:please\s+)?(?:delete|remove)\s+(?:the\s+)?memory\s+(?:about|that)\s+(.{2,200}?)[.!?\s]*$/i);
  if (m) {
    const q = m[1].trim();
    // "forget it", "forget this event" (the briefing's own command), "forget everything" → not this
    if (/^(it|this|that|about it|this event|that event|the last event|last event|event|everything|all|all of it)$/i.test(q) || /\bevent\b/i.test(q)) return null;
    return { kind: "forget", query: q };
  }

  // ---- remember …  (questions like "do you remember …?" are questions, not instructions)
  const polite = s.match(new RegExp(`^(?:please\\s+)?(?:(?:can|could|would|will) you\\s+(?:please\\s+)?)${REMEMBER_VERB}\\b`, "i"));
  if (!polite && /\?\s*$/.test(s)) return null;
  s = s.replace(/\?\s*$/, "");
  m = s.match(new RegExp(`^(?:please\\s+)?(?:(?:can|could|would|will) you\\s+(?:please\\s+)?)?${REMEMBER_VERB}(?:\\s+(?:this|that|it))?(?:\\s+for\\s+(?:me|later|the future))?(?:\\s*[,:;-]\\s*|\\s+)(?:that\\s+)?(.{3,600})$`, "i"));
  if (m) {
    const fact = m[1].trim();
    if (REMINDER.test(fact)) return null; // "remember to call mom at 5" is a reminder, not a fact
    const t = tidy(fact);
    return t.length > 3 ? { kind: "remember", fact: t } : null;
  }
  m = s.match(/^(?:for future reference|for the record|note that|fyi|keep this in mind)\s*[,:;-]?\s*(.{3,600})$/i);
  if (m) return { kind: "remember", fact: tidy(m[1]) };
  m = s.match(/^from now on\s*[,:;-]?\s*(.{3,600})$/i);
  if (m) return { kind: "remember", fact: `From now on: ${tidy(m[1])}` };
  return null;
}

/**
 * The thing a fact is about, so a correction replaces the old value:
 * "My favourite colour is blue." → "favourite colour"; "Call me Harsha." → "name".
 */
export function subjectKey(fact: string): string | null {
  const f = fact.trim().replace(/[.!]+$/, "");
  let m = f.match(/^my\s+(.{2,40}?)\s+(?:is|are|was|were|=)\s+\S/i);
  if (m) {
    const k = m[1].toLowerCase().replace(/\bfavorite\b/g, "favourite").replace(/\bcolor\b/g, "colour").replace(/\s+/g, " ").trim();
    return k === "full name" ? "name" : k;
  }
  if (/^(?:call me|my name's|i'?m called)\s+\S/i.test(f)) return "name";
  if (/^i\s+(?:live|stay)\s+in\s+\S/i.test(f)) return "where i live";
  if (/^i\s+work\s+(?:at|for)\s+\S/i.test(f)) return "where i work";
  if (/^i(?:'m| am)\s+\d{1,3}(?:\s+years?\s+old)?$/i.test(f)) return "age";
  if (/^my\s+birthday\s+(?:is\s+)?(?:on\s+)?\S/i.test(f)) return "birthday";
  return null;
}

/** "My favourite colour is blue." → "your favourite colour is blue" (for JARVIS to say back, mid-sentence). */
export function inSecondPerson(fact: string): string {
  const swaps: [RegExp, string][] = [
    [/\bi am\b/gi, "you are"], [/\bi'm\b/gi, "you're"], [/\bi was\b/gi, "you were"], [/\bi've\b/gi, "you've"], [/\bi'll\b/gi, "you'll"], [/\bi'd\b/gi, "you'd"],
    [/\bmyself\b/gi, "yourself"], [/\bmine\b/gi, "yours"], [/\bmy\b/gi, "your"], [/\bme\b/gi, "you"], [/\bi\b/gi, "you"],
  ];
  let out = fact.replace(/[.!]+$/, "");
  for (const [re, to] of swaps) out = out.replace(re, to);
  return out.charAt(0).toLowerCase() + out.slice(1);
}
