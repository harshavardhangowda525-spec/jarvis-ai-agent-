import { evaluateExpression } from "@/lib/tools/mathEval";

/**
 * Questions JARVIS can answer INSTANTLY in the browser — no AI round trip:
 * the time, the date, and plain arithmetic. Returns null for anything else
 * (which goes to the AI as usual). Client-safe and pure.
 */
export function instantAnswer(text: string, now = new Date()): string | null {
  const q = text.toLowerCase().trim().replace(/^(hey |ok |okay )?jarvis[,!.\s]+/, "").replace(/[?!.]+$/, "").trim();

  if (/^(what('?s| is) the (current )?time( now| right now)?|what time is it( now| right now)?|(tell me )?the time( now)?|current time|time now|time please)$/.test(q)) {
    return `It's ${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`;
  }
  if (/^(what('?s| is) (the |today'?s )?date( today)?|what('?s| is) today'?s date|what day is (it|today)( today)?|today'?s date|what('?s| is) the day today)$/.test(q)) {
    return `It's ${now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
  }

  // "what is 25 times 4", "calculate 18% of 2500", "12.5 + 7 / 2"
  const m = q.match(/^(?:what(?:'s| is)|calculate|compute|how much is|solve)?\s*(.+)$/);
  if (!m) return null;
  let expr = m[1]
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)/g, "($1/100*$2)")
    .replace(/\bmultiplied by\b|\btimes\b|×|\bx\b/g, "*")
    .replace(/\bdivided by\b|\bover\b|÷/g, "/")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\bsquared\b/g, "^2")
    .replace(/\bto the power of\b/g, "^")
    .replace(/,(?=\d{3}\b)/g, "") // 2,500 → 2500
    .replace(/\s+/g, "");
  // Only digits/operators may remain, with at least one operator between numbers.
  if (!/^[-+*/^%().\d]+$/.test(expr) || !/\d[-+*/^%(]*[-+*/^][-+(]*\d|\(\d/.test(expr) || !/[-+*/^]/.test(expr.replace(/^-/, ""))) return null;
  try {
    const v = evaluateExpression(expr);
    if (!Number.isFinite(v)) return null;
    const rounded = Math.round(v * 1e8) / 1e8;
    const shown = Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0)
      ? v.toExponential(6)
      : rounded.toLocaleString(undefined, { maximumFractionDigits: 8 });
    return `That's ${shown}.`;
  } catch {
    return null;
  }
}
