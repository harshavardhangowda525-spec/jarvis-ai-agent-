/**
 * Risk classification + confirmation gating.
 *
 * Every action carries a risk level. The active mode decides whether an action
 * runs automatically or waits for explicit user confirmation.
 *
 *   SAFE      — open/search/read/scroll/navigate: run automatically.
 *   MODERATE  — fill a form, create a draft, add an event: confirm unless in
 *               autonomous mode.
 *   HIGH      — send, submit, delete, purchase, publish, change settings:
 *               ALWAYS confirm immediately before the final action.
 *
 * Modes: "autonomous" | "confirmation" (default) | "manual".
 *   manual — nothing executes automatically; JARVIS only observes/suggests.
 */

export const RISK = { SAFE: "safe", MODERATE: "moderate", HIGH: "high" };

const HIGH_WORDS = /\b(send|submit|delete|remove|buy|purchase|order|pay|checkout|publish|post|confirm|deactivate|change password|change settings|transfer|unfriend|unfollow|block)\b/i;
const MODERATE_WORDS = /\b(fill|draft|compose|create|add|schedule|like|save|upload|attach|reply)\b/i;

/** Classify a single low-level action into a risk level. */
export function actionRisk(action) {
  if (typeof action.risk === "string") return action.risk; // explicit override from a plan step
  switch (action.type) {
    case "navigate":
    case "scroll":
    case "wait":
    case "read":
      return RISK.SAFE;
    case "click": {
      const name = (action.target?.name || action.label || "").toString();
      if (HIGH_WORDS.test(name)) return RISK.HIGH;
      if (MODERATE_WORDS.test(name)) return RISK.MODERATE;
      return RISK.SAFE; // most clicks (links, tabs, menus) are navigation
    }
    case "type":
    case "fill":
    case "select":
      return RISK.MODERATE;
    case "press":
      return String(action.key).toLowerCase() === "enter" ? RISK.MODERATE : RISK.SAFE;
    default:
      return RISK.MODERATE;
  }
}

/** Does this action require explicit confirmation under the given mode? */
export function needsConfirmation(action, mode) {
  const risk = actionRisk(action);
  if (mode === "manual") return true;             // manual: confirm everything (nothing auto-runs)
  if (risk === RISK.HIGH) return true;             // high impact: always confirm
  if (mode === "autonomous") return false;         // autonomous: safe + moderate auto-run
  return risk === RISK.MODERATE;                   // confirmation mode: moderate needs a yes
}
