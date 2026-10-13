"use strict";
/**
 * RUBEN desktop — the pure parts (no Electron here, so they can be unit-tested):
 * settings, where the island may sit on screen, and which pages it may load.
 */

const WIDTH = 420; // the island window; the capsule is centred at its top
const COLLAPSED_H = 76; // room for the widest capsule state + its glow
const OPEN_H = 680; // capsule + the liquid-glass CRM dashboard
const OPEN_W = 920;
const MARGIN = 8;
const EDGE = 4;

const DEFAULTS = Object.freeze({
  url: "http://localhost:3000",
  wake: false,
  voiceReplies: true,
  micId: null,
  launchAtLogin: false,
  shortcut: "CommandOrControl+Shift+Space",
  talkShortcut: "CommandOrControl+Shift+R",
  pos: null, // { x, y } — top-left of the island window, in screen DIPs
});

/** Settings from disk, with anything missing or malformed replaced by the default. */
function readSettings(raw) {
  let s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch { s = {}; }
  if (!s || typeof s !== "object" || Array.isArray(s)) s = {};
  const out = { ...DEFAULTS };
  if (typeof s.url === "string" && isHttpUrl(s.url)) out.url = s.url.replace(/\/+$/, "");
  for (const k of ["wake", "voiceReplies", "launchAtLogin"]) if (typeof s[k] === "boolean") out[k] = s[k];
  for (const k of ["shortcut", "talkShortcut"]) if (typeof s[k] === "string" && s[k].trim()) out[k] = s[k].trim();
  if (typeof s.micId === "string" && s.micId) out.micId = s.micId;
  if (s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y)) out.pos = { x: Math.round(s.pos.x), y: Math.round(s.pos.y) };
  return out;
}

/** Only these keys may be changed from the island page. */
function pagePatch(patch) {
  const p = {};
  if (!patch || typeof patch !== "object") return p;
  for (const k of ["wake", "voiceReplies", "launchAtLogin"]) if (typeof patch[k] === "boolean") p[k] = patch[k];
  if (patch.micId === null || (typeof patch.micId === "string" && patch.micId.length < 512)) p.micId = patch.micId || null;
  return p;
}

function isHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; }
}

/** Same scheme + host + port as JARVIS. */
function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** The display a point is on (nearest one when it's between screens). */
function displayFor(displays, pt) {
  let best = displays[0], bestD = Infinity;
  for (const d of displays) {
    const w = d.workArea;
    const dx = Math.max(w.x - pt.x, 0, pt.x - (w.x + w.width));
    const dy = Math.max(w.y - pt.y, 0, pt.y - (w.y + w.height));
    const dist = Math.hypot(dx, dy);
    if (dist < bestD) { best = d; bestD = dist; }
  }
  return best;
}

/** Keep the whole island window inside one display's work area (taskbar excluded). */
function clampToWorkArea(bounds, workArea) {
  const w = Math.min(bounds.width, workArea.width), h = Math.min(bounds.height, workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - w);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - h);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/** Where the island goes: the saved spot if that screen still exists, else top-centre of the main screen. */
function initialBounds(saved, displays, primary, height = COLLAPSED_H) {
  if (saved) {
    const centre = { x: saved.x + WIDTH / 2, y: saved.y + 20 };
    const d = displays.find((x) => { const w = x.workArea; return centre.x >= w.x && centre.x <= w.x + w.width && centre.y >= w.y && centre.y <= w.y + w.height; });
    if (d) return clampToWorkArea({ x: saved.x, y: saved.y, width: WIDTH, height }, d.workArea);
  }
  const w = primary.workArea;
  return clampToWorkArea({ x: w.x + Math.round((w.width - WIDTH) / 2), y: w.y + EDGE, width: WIDTH, height }, w);
}

/**
 * The window for the open dashboard (or back to the outline): it grows around
 * the outline's centre, so the glass seems to come out of the outline, and is
 * kept inside the screen (laptop screens get a smaller dashboard).
 */
function resizeAround(cur, open, workArea) {
  const width = open ? Math.min(OPEN_W, workArea.width - MARGIN * 2) : WIDTH;
  const height = open ? Math.min(OPEN_H, workArea.height - MARGIN * 2) : COLLAPSED_H;
  const cx = cur.x + cur.width / 2;
  return clampToWorkArea({ x: Math.round(cx - width / 2), y: cur.y, width, height }, workArea);
}

/** After signing in / unlocking in the auth window: has JARVIS let us through? */
function authFinished(url, jarvisUrl) {
  if (!sameOrigin(url, jarvisUrl)) return false;
  const p = new URL(url).pathname;
  return p === "/island" || p === "/dashboard" || p.startsWith("/dashboard/");
}

/** Pages the auth window may open (sign-in, sign-up, the face/PIN gate). */
function authPath(p) {
  return p === "/login" || p === "/unlock" ? p : null;
}

module.exports = { WIDTH, COLLAPSED_H, OPEN_H, OPEN_W, resizeAround, EDGE, DEFAULTS, readSettings, pagePatch, isHttpUrl, sameOrigin, displayFor, clampToWorkArea, initialBounds, authFinished, authPath };
