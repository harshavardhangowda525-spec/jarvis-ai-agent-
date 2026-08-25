import { executeAction } from "../browser/actions.mjs";
import { observe } from "../browser/observe.mjs";
import { runGeneric } from "./generic.mjs";

/**
 * Simple site adapters for open + search flows (Google, YouTube). These are
 * SAFE actions, so they run without confirmation. Anything more complex on the
 * page falls back to the generic agent loop.
 */

export async function runGoogle(ctx, query) {
  const { mgr, emit } = ctx;
  const q = extractQuery(ctx.goal, query, ["google", "search for", "search"]);
  if (q) {
    emit({ kind: "activity", label: `Searching Google for "${q}"…` });
    await executeAction(mgr, { type: "navigate", url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
    return { ok: true, message: `Google results for "${q}".` };
  }
  emit({ kind: "activity", label: "Opening Google…" });
  await executeAction(mgr, { type: "navigate", url: "https://www.google.com/" });
  return { ok: true, message: "Opened Google." };
}

export async function runYouTube(ctx, query) {
  const { mgr, emit } = ctx;
  const q = extractQuery(ctx.goal, query, ["youtube", "search for", "search", "play"]);
  if (q) {
    emit({ kind: "activity", label: `Searching YouTube for "${q}"…` });
    await executeAction(mgr, {
      type: "navigate",
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    });
    return { ok: true, message: `YouTube results for "${q}".` };
  }
  emit({ kind: "activity", label: "Opening YouTube…" });
  await executeAction(mgr, { type: "navigate", url: "https://www.youtube.com/" });
  return { ok: true, message: "Opened YouTube." };
}

/** Open an arbitrary URL/site, then let the generic agent take over the goal. */
export async function runOpenSite(ctx, url) {
  const { mgr, emit } = ctx;
  const target = url || firstUrl(ctx.goal);
  if (target) {
    emit({ kind: "activity", label: `Opening ${target}…` });
    await executeAction(mgr, { type: "navigate", url: target });
    await observe(await mgr.activePage());
  }
  // If the goal implies more than just opening, run the agent loop.
  if (/\b(find|click|fill|search|login|log in|sign in|contact|buy|add|book|apply)\b/i.test(ctx.goal)) {
    return runGeneric(ctx, { maxSteps: 16 });
  }
  return { ok: true, message: target ? `Opened ${target}.` : "Opened site." };
}

function extractQuery(goal, explicit, stripWords) {
  if (explicit) return explicit.trim();
  let g = goal.toLowerCase();
  for (const w of stripWords) g = g.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  g = g.replace(/\b(on|in|the|for|please|jarvis|open|a|an)\b/gi, " ").replace(/\s+/g, " ").trim();
  return g.length > 1 ? g : "";
}

function firstUrl(text) {
  const m = text.match(/https?:\/\/[^\s]+|\b[\w-]+\.(com|org|net|io|ai|co|in|dev|app)\b[^\s]*/i);
  return m ? m[0] : "";
}
