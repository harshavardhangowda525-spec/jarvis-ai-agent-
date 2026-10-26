"use strict";
/**
 * JARVIS 2.0 — what a spoken/typed desktop command means (pure, tested).
 *
 * Words → an ordered list of steps the executor can carry out, a short
 * clarifying question, or null when it isn't a desktop command at all (then
 * JARVIS's brain answers). Nothing here touches the computer.
 *
 * Step kinds:
 *   open_app {app}            launch (or switch to, if already open) an installed app
 *   show_apps                 the searchable app launcher next to the orb
 *   list_windows / active     what's open / which app is in front
 *   focus {app}               bring an open app to the front
 *   window {op, app}          minimize | maximize | restore | close (close asks first)
 *   arrange {left, right}     two apps side by side
 *   desktop                   minimise everything
 *   new_window {app}          Ctrl+N in that app
 *   scroll {dir, app?}        Page Down / Page Up
 *   folder {folder}           Downloads, Documents, Desktop, Pictures, Music, Videos, home
 *   find {query, kind, latest} search your folders for a project / folder / file
 *   project {name}            open a project (configured name or found folder)
 *   open_last                 open what was just found, with its usual app
 *   url {url? , site?}        a web address or a site you've named in settings
 *   new_folder {name, where}  create a folder (never overwrites)
 *   type {text, app?} / key {keys, label, app?}   always confirmed in a native dialog
 *   screenshot                saved on this computer only
 *   stop | pause | resume     emergency stop, pause / resume all automation
 */

const WAKE = /^(?:(?:hey|ok|okay|hi|yo)\s+)?(?:jarvis|j\.a\.r\.v\.i\.s\.?)[,!.:\s]*/i;
const POLITE = /^(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+|i want you to\s+|i'd like you to\s+)+/i;
const trimEnd = (s) => s.replace(/[\s.!?]+$/, "").replace(/\s+please$/i, "").trim();

/** "Hey JARVIS, please open Chrome." → "open Chrome" */
function clean(raw) {
  return trimEnd(String(raw || "").replace(/\s+/g, " ").trim().replace(WAKE, "").replace(POLITE, ""));
}

/** Is this just the wake word ("JARVIS", "hey jarvis")? */
const isWakeOnly = (raw) => !clean(raw) && WAKE.test(String(raw || "").trim());

const FOLDERS = {
  downloads: "downloads", download: "downloads", documents: "documents", document: "documents", docs: "documents", "my documents": "documents",
  desktop: "desktop", pictures: "pictures", photos: "pictures", images: "pictures", music: "music", videos: "videos", movies: "videos",
  home: "home", "home folder": "home", "user folder": "home",
};

const KEY_NAMES = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", escape: "{ESC}", esc: "{ESC}", backspace: "{BS}", delete: "{DEL}",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}", "page up": "{PGUP}", "page down": "{PGDN}", space: " ",
};
/** A spoken key or shortcut ("ctrl+s", "control shift t", "alt f4") → SendKeys syntax, or null. */
function keysFor(spoken) {
  const s = String(spoken).toLowerCase().trim().replace(/\s*(?:\+|plus)\s*/g, "+").replace(/\s+/g, " ");
  if (KEY_NAMES[s]) return KEY_NAMES[s];
  const parts = s.split(/[+ ]/).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const mods = { ctrl: "^", control: "^", alt: "%", shift: "+" };
  let pre = "";
  for (const p of parts.slice(0, -1)) { if (!mods[p]) return null; pre += mods[p]; }
  const last = parts[parts.length - 1];
  let k = null;
  if (/^[a-z0-9]$/.test(last)) k = last;
  else if (/^f([1-9]|1[0-2])$/.test(last)) k = `{${last.toUpperCase()}}`;
  else if (KEY_NAMES[last]) k = KEY_NAMES[last];
  if (!k || (!pre && k.length === 1)) return null;
  return pre + k;
}
/** Keys that only move around (never send, submit or delete) — no confirmation needed. */
const SAFE_KEYS = new Set(["{PGDN}", "{PGUP}", "{UP}", "{DOWN}", "{LEFT}", "{RIGHT}", "{HOME}", "{END}", "{TAB}", "{ESC}", "^n", "^t", "^{TAB}", "^+{TAB}"]);

const appName = (s) => trimEnd(String(s || "").replace(/^(?:the|my|a|an)\s+/i, "").replace(/\s+(?:app|application|program|window|browser)$/i, ""));
/** "Chrome, Spotify and VS Code" → ["Chrome", "Spotify", "VS Code"] */
const SENTENCE = /^(?:tell|give|show|explain|what|why|how|who|when|where|write|send|make|find|search|say|let|help|can|could|would|is|are|do|does|i|me|you|it|that|this)\b/i;
/** null when a part reads like a sentence ("tell me a joke"), not an app name. */
const appList = (s) => {
  const items = String(s).split(/\s*(?:,|\band\b|&|\bplus\b|\balso\b)\s*/i).map(appName).filter((x) => x && !/^(?:then|also)$/i.test(x));
  return items.some((x) => x.split(/\s+/).length > 4 || SENTENCE.test(x)) ? null : items;
};

const VERB = String.raw`(?:open|launch|start|run|switch|go|focus|bring|close|quit|exit|minimi[sz]e|maximi[sz]e|restore|find|search|look|show|type|write|press|hit|create|make|take|put|arrange|tile|scroll|stop|pause|resume)`;
/** "open Chrome, open my site, and then open Claude Code" → three parts (but "Chrome and Claude Code" stays one). */
function splitSteps(t) {
  return t.split(new RegExp(String.raw`\s*(?:;|,?\s+and then\s+|,?\s+then\s+|,\s*(?:and\s+)?(?=${VERB}\b)|\s+and\s+(?=${VERB}\b)|\s+after that\s+)\s*`, "i"))
    .map(trimEnd).filter(Boolean);
}

/**
 * One part → a step, a question ({ clarify }), or null (not a desktop command).
 * ctx.pending = "open" when JARVIS just asked which app to open.
 */
function parseStep(p, ctx = {}) {
  const t = clean(p);
  if (!t) return null;
  const low = t.toLowerCase();
  let m;

  if (/^(?:stop|cancel|abort|halt|stop it|stop everything|stop that|never ?mind|enough)$/i.test(t)) return { kind: "stop" };
  if (/^(?:pause|suspend|freeze)(?: all)?(?: (?:the )?automation| everything| control)?$/i.test(t)) return { kind: "pause" };
  if (/^(?:resume|unpause|continue)(?: (?:the )?automation| control)?$/i.test(t)) return { kind: "resume" };

  // "open apps" / "open an app" → which one?
  if (/^(?:open|launch|start)\s+(?:(?:some|an?|the|my)\s+)?(?:apps?|applications?|programs?)$/i.test(t)) return { clarify: "Which application would you like to open?", pending: "open" };
  if (/^(?:show|list|display)\s+(?:me\s+)?(?:all\s+)?(?:my\s+|the\s+|installed\s+)*(?:apps|applications|programs)(?: launcher)?$|^(?:app launcher|launcher)$/i.test(t)) return { kind: "show_apps" };
  if (/^(?:what|which)\s+(?:apps|applications|programs|windows)\s+(?:are\s+)?(?:open|running)|^list\s+(?:the\s+|my\s+)?(?:open\s+)?windows$/i.test(t)) return { kind: "list_windows" };
  if (/^(?:what|which)\s+(?:app|application|program|window)\s+(?:am i (?:in|on|using)|is (?:active|open|in front|focused))|^(?:active|current) (?:app|window)$/i.test(t)) return { kind: "active" };
  if (/^(?:show (?:me )?(?:the )?desktop|minimi[sz]e (?:all|everything)(?: windows)?|clear (?:the )?screen)$/i.test(t)) return { kind: "desktop" };
  if (/^(?:take|grab|capture)\s+(?:a\s+)?screen ?shot$|^screen ?shot$/i.test(t)) return { kind: "screenshot" };

  // type / press (always confirmed by the executor)
  if ((m = t.match(/^(?:type|write)\s+["“']?([\s\S]+?)["”']?\s+(?:in|into|on)\s+(.+)$/i))) return { kind: "type", text: m[1], app: appName(m[2]) };
  if ((m = t.match(/^(?:type|write)\s+["“']?([\s\S]+?)["”']?$/i))) return { kind: "type", text: m[1], app: null };
  if ((m = t.match(/^(?:press|hit)\s+(.+?)(?:\s+(?:in|on)\s+(.+))?$/i))) {
    const keys = keysFor(m[1]);
    return keys ? { kind: "key", keys, label: m[1], app: m[2] ? appName(m[2]) : null, safe: SAFE_KEYS.has(keys) } : { clarify: `I don't know the key "${m[1]}". Try "press enter" or "press control s".` };
  }
  if ((m = t.match(/^scroll\s+(up|down)(?:\s+(?:in|on)\s+(.+))?$/i))) return { kind: "scroll", dir: m[1].toLowerCase(), app: m[2] ? appName(m[2]) : null };
  if ((m = t.match(/^(?:open|start)\s+(?:a\s+)?new\s+(.+?)\s+window$|^new window in\s+(.+)$/i))) return { kind: "new_window", app: appName(m[1] || m[2]) };

  // side by side
  if ((m = t.match(/^(?:put|arrange|tile|place|show|snap)\s+(.+?)\s+(?:and|&)\s+(.+?)\s+side[- ]by[- ]side$/i))) return { kind: "arrange", left: appName(m[1]), right: appName(m[2]) };

  // folders and files
  if ((m = t.match(/^(?:open|show|go to|take me to)\s+(?:my\s+|the\s+)?(downloads?|documents?|docs|desktop|pictures|photos|images|music|videos|movies|home)(?:\s+folder)?$/i))) return { kind: "folder", folder: FOLDERS[m[1].toLowerCase()] };
  if ((m = t.match(/^(?:create|make)\s+(?:a\s+)?new\s+(?:project\s+)?folder(?:\s+(?:called|named)\s+["“']?(.+?)["”']?)?(?:\s+(?:in|on)\s+(?:my\s+|the\s+)?(documents|desktop|downloads|home))?$/i))) {
    return { kind: "new_folder", name: m[1] ? trimEnd(m[1]) : null, where: m[2] ? FOLDERS[m[2].toLowerCase()] : null, project: /project/i.test(t) };
  }
  if ((m = t.match(/^(?:find|search(?: for)?|look for|locate|where(?:'s| is))\s+(?:my\s+|the\s+)?(latest|newest|most recent|last)?\s*(.+?)\s+(project|folder|file|repo|repository)$/i))) {
    return { kind: "find", query: trimEnd(m[2].replace(/^(?:my|the)\s+/i, "")), type: /file/i.test(m[3]) ? "file" : /folder/i.test(m[3]) ? "folder" : "project", latest: !!m[1] };
  }
  if ((m = t.match(/^(?:find|search(?: for)?|look for|locate)\s+(?:a\s+)?(?:file|document)\s+(?:called|named)\s+["“']?(.+?)["”']?$/i))) return { kind: "find", query: m[1], type: "file", latest: false };
  if (/^open\s+(?:it|this|that|this file|that file|this folder|that folder|the file|the folder|the first one|the result)(?:\s+with the (?:right|correct) app(?:lication)?)?$/i.test(t)) return { kind: "open_last" };
  if ((m = t.match(/^(?:switch to|go to|open|show|bring up|work on|load)\s+(?:my\s+|the\s+)?(.+?)\s+(?:project|repo|repository|workspace)$/i))) return { kind: "project", name: trimEnd(m[1]) };

  // web
  if ((m = t.match(/^(?:open|go to|visit|show|browse to|load)\s+(?:the\s+)?(?:website\s+|site\s+|page\s+)?((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i))) return { kind: "url", url: /^https?:/i.test(m[1]) ? m[1] : `https://${m[1]}` };
  if ((m = t.match(/^(?:open|go to|visit|show|load)\s+(?:my\s+|the\s+|our\s+)?(.+?\s+(?:website|site|web ?page|homepage|dashboard))$/i))) return { kind: "url", site: trimEnd(m[1]) };

  // windows
  if ((m = t.match(/^(?:close|quit|exit|shut down|kill)\s+(.+)$/i))) return { kind: "window", op: "close", app: appName(m[1]) };
  if ((m = t.match(/^(minimi[sz]e|maximi[sz]e|restore|hide)\s+(.+)$/i))) return { kind: "window", op: /^min|^hide/i.test(m[1]) ? "minimize" : /^max/i.test(m[1]) ? "maximize" : "restore", app: appName(m[2]) };
  if ((m = t.match(/^(?:switch(?: over)? to|focus(?: on)?|bring up|bring|go (?:back )?to|jump to|change to)\s+(.+?)(?:\s+to (?:the )?front)?$/i))) return { kind: "focus", app: appName(m[1]) };

  // open apps — "open Chrome and Claude Code"
  if ((m = t.match(/^(?:open|launch|start|run|fire up|load up|start up)\s+(?:up\s+)?(.+)$/i))) {
    const apps = appList(m[1]);
    if (!apps) return null;
    if (!apps.length) return { clarify: "Which application would you like to open?", pending: "open" };
    return apps.length === 1 ? { kind: "open_app", app: apps[0] } : { multi: apps.map((a) => ({ kind: "open_app", app: a })) };
  }

  // after "which app?", a bare name means open it
  if (ctx.pending === "open" && low.split(/\s+/).length <= 8 && !/[?]/.test(p)) {
    const apps = appList(t);
    if (apps && apps.length) return { multi: apps.map((a) => ({ kind: "open_app", app: a })) };
  }
  return null;
}

/**
 * A whole command → { steps } | { clarify, pending? } | null (for JARVIS's brain).
 * If any part isn't a desktop command, the whole thing goes to the brain —
 * half-understood multi-step commands are never run.
 */
function plan(raw, ctx = {}) {
  const t = clean(raw);
  if (!t) return isWakeOnly(raw) ? { clarify: "Yes? I'm listening.", wake: true } : null;
  const parts = splitSteps(t);
  if (parts.length > 8) return { clarify: "That's a lot of steps at once — give me up to eight at a time." };
  const steps = [];
  for (const part of parts) {
    const s = parseStep(part, ctx);
    if (!s) return null;
    if (s.clarify) return parts.length === 1 ? s : { clarify: `I understood most of that, but not "${part}". ${s.clarify}`, pending: s.pending };
    if (s.multi) steps.push(...s.multi); else steps.push(s);
  }
  const control = steps.find((s) => ["stop", "pause", "resume"].includes(s.kind));
  return control ? { steps: [control] } : { steps };
}

/** Text → SendKeys literal (special characters escaped, newlines as Enter). */
function literalKeys(text) {
  return String(text).replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
}

module.exports = { clean, isWakeOnly, splitSteps, parseStep, plan, keysFor, literalKeys, SAFE_KEYS, FOLDERS };
