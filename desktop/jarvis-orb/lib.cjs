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

module.exports = { ORB, POPUP, MARGIN, orbBounds, displayFor, readSettings };
