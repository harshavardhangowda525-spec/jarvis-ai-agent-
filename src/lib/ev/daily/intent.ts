/**
 * What you say to EV about today's content. Pure and client-safe. `weak` marks a
 * bare "yes"/"no" — only meaningful right after EV asked "Would you like me to
 * publish it?".
 */

export type DailyAction =
  | { action: "approve"; weak?: boolean }
  | { action: "decline"; weak: true }
  | { action: "reject"; instruction: string }
  | { action: "regenerate"; instruction: string }
  | { action: "another"; instruction: string }
  | { action: "caption"; instruction: string; caption?: string }
  | { action: "tone"; instruction: string; tone: string }
  | { action: "video"; instruction: string }
  | { action: "retry" }
  | { action: "show" }
  | { action: "status" };

const clean = (t: string) => t.toLowerCase().replace(/[“”"']/g, "").replace(/^(ev|hey ev|ok(ay)? ev)[,\s]+/, "").replace(/[.!?]+$/, "").trim();

export function parseDailyCommand(text: string): DailyAction | null {
  const raw = text.trim();
  const t = clean(raw);
  if (!t) return null;

  if (/^(show|open|display)\s+(me\s+)?(today'?s|todays|the daily)\s+(content|post|reel|package)\b|^today'?s content$|^todays content$/.test(t)) return { action: "show" };
  if (/\b(is|are)\s+(today'?s|todays)\s+(content|post|reel)\s+(ready|done)\b|\bstatus of (today'?s|todays) (content|post)\b/.test(t)) return { action: "status" };

  // Revisions — checked before approval so "publish a new idea" isn't a publish.
  const caption = raw.match(/\b(?:change|rewrite|replace|update|set)\s+(?:the\s+)?caption\s+(?:to|with|as)\s*[:\-–]?\s*([\s\S]{3,2200})$/i)?.[1]?.trim().replace(/^["“']|["”']$/g, "");
  if (caption) return { action: "caption", instruction: raw, caption };
  if (/\b(change|rewrite|redo|fix|improve|shorten|tweak|update)\s+(the\s+)?caption\b|\b(new|different|another|better|shorter|longer)\s+caption\b/.test(t)) return { action: "caption", instruction: raw };
  if (/\b(change|redo|remake|regenerate|re-?render|replace|update|fix)\s+(the\s+)?(video|reel)\b|\b(new|different|another)\s+(video|reel)\b/.test(t)) return { action: "video", instruction: raw };
  const tone = t.match(/\bmake\s+(it|this|the (post|content|caption|reel))\s+(more\s+|a bit more\s+|less\s+)?(professional|engaging|fun|funny|punchy|formal|casual|premium|friendly|exciting|emotional|bold|simple|clear|local)\b/);
  if (tone) return { action: "tone", instruction: raw, tone: `${tone[3] ?? "more "}${tone[4]}`.trim() };
  if (/\bmore (professional|engaging)\b/.test(t)) return { action: "tone", instruction: raw, tone: `more ${t.match(/\bmore (professional|engaging)\b/)![1]}` };
  if (/\b(show me |give me |try |need |want )?(another|a different|a new|one more)\s+(idea|topic|concept|angle)\b/.test(t)) return { action: "another", instruction: raw };
  if (/\breject(ed)?\b|\bi don'?t like (it|this)\b|\bnot good\b|\bscrap (it|this)\b/.test(t)) return { action: "reject", instruction: raw };
  if (/\bretry\b|\btry (it )?again\b/.test(t)) return { action: "retry" };
  if (/\b(regenerate|redo|remake|recreate|start over)\b(\s+(it|this|that|everything|the (content|post|package)))?/.test(t)) return { action: "regenerate", instruction: raw };

  if (/^(approved?|approve (it|this|that|today'?s content)|publish( it| this| that| now| today'?s content| it now)?|go ahead( and publish( it)?)?|looks (good|great|perfect)( to me)?|post it( now)?|ship it|yes,? (publish|post|go ahead)( it)?)( please)?$/.test(t)) return { action: "approve" };
  if (/^(yes|yeah|yep|yup|sure|ok(ay)?|do it|please do)( please)?$/.test(t)) return { action: "approve", weak: true };
  if (/^(no|nope|not yet|not now|hold( it| on)?|wait|later)( thanks)?$/.test(t)) return { action: "decline", weak: true };
  return null;
}
