"use strict";
/**
 * JARVIS 2.0 — where the orb window goes (pure, tested). The orb is anchored by
 * its bottom-right corner: it starts in the screen's bottom-right corner, the
 * chat opens above and to the left of it, and wherever you drag it, it never
 * leaves the screen or slips under the taskbar.
 */
const ORB = { w: 168, h: 168 };
const POPUP = { w: 420, h: 640 };
const MARGIN = 16;

/** The display a saved anchor is on (falls back to the main one if that monitor is gone). */
function displayFor(anchor, displays, primary) {
  if (!anchor) return primary;
  return displays.find((d) => { const a = d.workArea; return anchor.right > a.x && anchor.right <= a.x + a.width + 1 && anchor.bottom > a.y && anchor.bottom <= a.y + a.height + 1; }) || primary;
}

/** Window bounds for the orb ("orb") or the orb with its chat open ("popup"). anchor = { right, bottom } in screen pixels. */
function orbBounds(anchor, displays, primary, mode) {
  const d = displayFor(anchor, displays, primary);
  const a = d.workArea;
  const size = mode === "popup" ? { w: Math.min(POPUP.w, a.width - 2 * MARGIN), h: Math.min(POPUP.h, a.height - 2 * MARGIN) } : ORB;
  let right = anchor ? anchor.right : a.x + a.width - MARGIN;
  let bottom = anchor ? anchor.bottom : a.y + a.height - MARGIN;
  right = Math.min(Math.max(right, a.x + size.w), a.x + a.width);
  bottom = Math.min(Math.max(bottom, a.y + size.h), a.y + a.height);
  return { x: Math.round(right - size.w), y: Math.round(bottom - size.h), width: size.w, height: size.h };
}

/** Settings file → settings (anything malformed is ignored). */
function readSettings(text) {
  let s = {};
  try { s = JSON.parse(text || "{}") || {}; } catch { s = {}; }
  const list = (v, keys) => (Array.isArray(v) ? v.filter((x) => x && keys.every((k) => typeof x[k] === "string" && x[k].trim())).slice(0, 50) : []);
  return {
    url: typeof s.url === "string" ? s.url : "http://localhost:3000",
    anchor: s.anchor && Number.isFinite(s.anchor.right) && Number.isFinite(s.anchor.bottom) ? { right: s.anchor.right, bottom: s.anchor.bottom } : null,
    floating: s.floating !== false,
    control: s.control === true, // desktop control is off until you allow it once
    projects: list(s.projects, ["name", "path"]),
    sites: list(s.sites, ["name", "url"]),
    searchRoots: Array.isArray(s.searchRoots) ? s.searchRoots.filter((x) => typeof x === "string").slice(0, 20) : [],
    projectsRoot: typeof s.projectsRoot === "string" ? s.projectsRoot : "",
    wakePhrase: typeof s.wakePhrase === "string" && s.wakePhrase.trim() ? s.wakePhrase.trim().slice(0, 40) : "jarvis",
    voiceMode: ["wake", "push", "off"].includes(s.voiceMode) ? s.voiceMode : "push",
    volume: Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 1,
    rate: Number.isFinite(s.rate) ? Math.min(1.6, Math.max(0.7, s.rate)) : 1,
    micId: typeof s.micId === "string" ? s.micId : "",
    language: typeof s.language === "string" ? s.language.slice(0, 10) : "en",
  };
}

const XDO = { ENTER: "Return", TAB: "Tab", ESC: "Escape", BS: "BackSpace", DEL: "Delete", UP: "Up", DOWN: "Down", LEFT: "Left", RIGHT: "Right", HOME: "Home", END: "End", PGUP: "Prior", PGDN: "Next" };
/**
 * SendKeys text ("hello{ENTER}", "^s", "^+{TAB}") → xdotool steps for Linux:
 * [{ text }] runs typed as-is, [{ key }] real key presses ("Return", "ctrl+s").
 * A typed newline is not Enter in many apps, so Enter is always a key press.
 */
function xdoSteps(keys) {
  const out = [];
  const s = String(keys);
  let i = 0, text = "";
  const flush = () => { if (text) { out.push({ text }); text = ""; } };
  while (i < s.length) {
    let mods = [];
    let j = i;
    while ("^%+".includes(s[j]) && j < s.length - 1) { mods.push({ "^": "ctrl", "%": "alt", "+": "shift" }[s[j]]); j++; }
    let name = null, lit = null, end = j + 1;
    if (s[j] === "{") {
      const close = s.indexOf("}", j + 2);
      const tok = close > 0 ? s.slice(j + 1, close) : "";
      end = close + 1;
      if (/^F([1-9]|1[0-2])$/.test(tok)) name = tok; else if (XDO[tok]) name = XDO[tok]; else lit = tok; // {+} {^} {%} {~} {(} … are literal
    } else lit = s[j];
    if (!mods.length && lit !== null) { text += lit; i = end; continue; }
    flush();
    out.push({ key: [...mods, name || (lit.length === 1 ? lit : lit)].join("+") });
    i = end;
  }
  flush();
  return out;
}

module.exports = { ORB, POPUP, MARGIN, orbBounds, displayFor, readSettings, xdoSteps };
