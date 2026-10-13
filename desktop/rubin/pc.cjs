"use strict";
/**
 * RUBEN's hands on this PC: open installed apps, switch between / minimise /
 * maximise / restore / close their windows, type text and press keys in them.
 *
 * Who decides:
 * - The island page only sends the words you said or typed. Everything here
 *   runs in RUBEN's own main process.
 * - Opening an installed app and switching, minimising or maximising a window
 *   happen straight away.
 * - Closing an app, typing and pressing keys only happen after you click
 *   "Yes" in a Windows dialog that RUBEN shows itself (see main.cjs). The web
 *   page can't answer that dialog, and neither can a spoken "yes". A typed
 *   Enter can send a message, so it is confirmed the same way.
 * - Apps are found in the computer's own installed-app list (ULTRON's
 *   launcher). Windows are found among the ones open right now.
 * - The OS is reached through fixed PowerShell code with arguments passed as
 *   data (an environment variable), never pasted into a command line.
 * - There is no mouse control and nothing runs on its own.
 */
const path = require("node:path");
const { execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");

// ---------------- understanding the words (pure — tested) ----------------

/** Words that mean the CRM, not an app ("open this business", "close CRM"). */
const CRM_WORDS = /\b(crm|lead|leads|client|clients|prospects?|business|businesses|details?|follow[- ]?ups?|this|that|pitch|pipeline|dashboard|summary|activity|today|tomorrow|quotation|proposal|demo|gym|salon|cafe|café|restaurant|shop|store|clinic)\b/i;

const KEY_NAMES = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", escape: "{ESC}", esc: "{ESC}", backspace: "{BS}", delete: "{DEL}",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}", "page up": "{PGUP}", "page down": "{PGDN}",
};

/** A spoken key or shortcut ("enter", "ctrl+s", "control shift t", "alt f4") → SendKeys syntax, or null. */
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
  if (!k || (!pre && k.length === 1)) return null; // a bare letter is typing, not a key press
  return pre + k;
}

/** Text → SendKeys literal (its special characters escaped, newlines as Enter). */
function literalKeys(text) {
  return String(text).replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
}

const strip = (raw) => String(raw || "").trim().replace(/[.!?]+$/, "")
  .replace(/^(?:hey |ok |okay |hi )?(?:rubin|ruben|reuben|rueben|robin)[,\s]+/i, "")
  .replace(/^(?:please |can you |could you |would you )+/i, "").replace(/\s+please$/i, "").trim();
const appName = (s) => s.replace(/^(?:the|my)\s+/i, "").replace(/\s+(?:app|application|program|window)$/i, "").trim();

/**
 * A PC command, or null when the words are for the CRM.
 * explicit = the words can only mean an app ("launch Spotify", "open the app
 * Spotify"). Otherwise RUBEN acts only if a real installed app or open window
 * matches, so "open ABC Cafe" still opens the lead.
 */
function parsePcCommand(raw) {
  const t = strip(raw);
  if (!t || t.length > 300) return null;
  let m;
  if (/^(?:what|which) (?:apps|programs|windows) (?:are )?(?:open|running)|^list (?:the |my )?(?:open )?(?:apps|windows|programs)$/i.test(t)) return { kind: "list", explicit: true };
  if (/^(?:show (?:me )?(?:the )?desktop|minimi[sz]e (?:all|everything)(?: windows)?)$/i.test(t)) return { kind: "desktop", explicit: true };
  if ((m = t.match(/^(?:type|write)\s+["“']?([\s\S]+?)["”']?\s+(?:in|into|on)\s+(.+)$/i))) return { kind: "type", text: m[1], app: appName(m[2]), explicit: true };
  if ((m = t.match(/^(?:type|write)\s+["“']?([\s\S]+?)["”']?$/i))) return { kind: "type", text: m[1], app: null, explicit: true };
  if ((m = t.match(/^(?:press|hit)\s+(.+?)(?:\s+(?:in|on)\s+(.+))?$/i))) {
    const keys = keysFor(m[1]);
    return keys ? { kind: "key", keys, label: m[1], app: m[2] ? appName(m[2]) : null, explicit: true } : null;
  }
  if ((m = t.match(/^(?:close|quit|exit|shut down|kill)\s+(.+)$/i))) {
    const a = appName(m[1]);
    return CRM_WORDS.test(a) ? null : { kind: "close", app: a, explicit: true };
  }
  if ((m = t.match(/^(minimi[sz]e|maximi[sz]e|restore)\s+(.+)$/i))) {
    const a = appName(m[2]);
    if (CRM_WORDS.test(a)) return null;
    return { kind: /^min/i.test(m[1]) ? "minimize" : /^max/i.test(m[1]) ? "maximize" : "restore", app: a, explicit: true };
  }
  if ((m = t.match(/^(?:switch to|focus(?: on)?|bring up|bring)\s+(.+?)(?:\s+to (?:the )?front)?$/i))) {
    const a = appName(m[1]);
    return CRM_WORDS.test(a) ? null : { kind: "focus", app: a, explicit: true };
  }
  if ((m = t.match(/^go (?:to|back to)\s+(.+)$/i))) {
    const a = appName(m[1]);
    return CRM_WORDS.test(a) ? null : { kind: "focus", app: a, explicit: false };
  }
  if ((m = t.match(/^(?:open|launch|start|run)\s+(?:the\s+)?(?:app|application|program)\s+(.+)$/i))) return { kind: "open", app: appName(m[1]), explicit: true };
  if ((m = t.match(/^(?:launch|run)\s+(.+)$/i))) { const a = appName(m[1]); return CRM_WORDS.test(a) ? null : { kind: "open", app: a, explicit: true }; }
  if ((m = t.match(/^(?:open|start)\s+(?:up\s+)?(.+)$/i))) {
    const a = appName(m[1]);
    if (CRM_WORDS.test(a) || /^#?\d+$/.test(a)) return null;
    return { kind: "open", app: a, explicit: /\s(?:app|application|program)$/i.test(m[1]) };
  }
  return null;
}

/** The open window that best matches a spoken app name (process name or title). */
function pickWindow(query, windows, matchScore, normalizeName) {
  const q = normalizeName(query);
  if (!q) return null;
  let best = null, bestS = 0;
  for (const w of windows) {
    const title = String(w.title || ""), name = String(w.name || "");
    const s = Math.max(matchScore(query, name), matchScore(query, title.split(" - ").pop() || title),
      normalizeName(name) === q.replace(/\s+/g, "") ? 100 : 0, normalizeName(title).includes(q) && q.length >= 3 ? 70 : 0);
    if (s > bestS) { best = w; bestS = s; }
  }
  return bestS >= 62 ? best : null;
}

const labelOf = (w) => (String(w.title || "").split(" - ").pop() || w.name || "that app").trim();

// ---------------- doing it (Windows) ----------------

const PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$a = $env:RUBIN_PC_ARGS | ConvertFrom-Json
if ($a.op -eq 'list') {
  $w = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle } })
  ConvertTo-Json -InputObject $w -Compress; exit
}
if ($a.op -eq 'desktop') { (New-Object -ComObject Shell.Application).MinimizeAll(); '{"ok":true}'; exit }
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class RubinW {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
}
"@
$p = Get-Process -Id ([int]$a.id) -ErrorAction SilentlyContinue
if (-not $p -or $p.MainWindowHandle -eq 0) { '{"ok":false,"error":"That window is no longer open."}'; exit }
$h = $p.MainWindowHandle
function Front {
  if ([RubinW]::IsIconic($h)) { [RubinW]::ShowWindow($h, 9) | Out-Null }
  [RubinW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [RubinW]::SetForegroundWindow($h) | Out-Null; [RubinW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}
switch ($a.op) {
  'focus'    { Front }
  'minimize' { [RubinW]::ShowWindow($h, 6) | Out-Null }
  'maximize' { [RubinW]::ShowWindow($h, 3) | Out-Null; Front }
  'restore'  { [RubinW]::ShowWindow($h, 9) | Out-Null; Front }
  'close'    { $p.CloseMainWindow() | Out-Null }
  'keys'     {
    Front; Start-Sleep -Milliseconds 400
    # only type if that window really is in front — never into whatever else has focus
    if ([RubinW]::GetForegroundWindow() -ne $h) { '{"ok":false,"error":"Windows wouldn''t bring that app to the front, so nothing was typed."}'; exit }
    Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([string]$a.keys)
  }
}
'{"ok":true}'
`;

function powershell(args) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS],
      { timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, RUBIN_PC_ARGS: JSON.stringify(args) } },
      (err, stdout, stderr) => {
        const out = String(stdout || "").trim().replace(/^﻿/, "");
        try { resolve(JSON.parse(out.split(/\r?\n/).pop() || "null")); }
        catch { resolve({ ok: false, error: String(stderr || err?.message || "Windows didn't answer").trim().slice(0, 200) }); }
      });
  });
}

let appsMod = null;
async function apps() {
  // ULTRON's installed-app finder: one list, one set of matching rules
  if (!appsMod) appsMod = await import(pathToFileURL(path.join(__dirname, "..", "..", "edith", "src", "apps.mjs")).href);
  return appsMod;
}

async function listWindows(selfPids) {
  if (process.platform !== "win32") return [];
  const r = await powershell({ op: "list" });
  const list = Array.isArray(r) ? r : r && r.id ? [r] : [];
  return list.filter((w) => w && !selfPids.includes(w.id)); // RUBEN itself is never a target
}

/**
 * Work out what a command means. Returns:
 * - { handled: false } when the words are for the CRM;
 * - { handled: true, ok, say } once something is done (or can't be);
 * - { handled: true, confirm: { question, detail, action } } when it needs your "Yes" first.
 * Nothing that needs confirmation is done here.
 */
async function planPc(text, o = {}) {
  const cmd = parsePcCommand(text);
  if (!cmd) return { handled: false };
  const A = o.appsModule || (await apps());
  const win = o.platform ?? process.platform;
  const run = o.powershell || powershell;
  const selfPids = o.selfPids || [process.pid];

  if (cmd.kind === "open") {
    let installed = [];
    try { installed = await A.listApps(); } catch { installed = []; }
    const hit = A.findApp(cmd.app, installed);
    if (!hit.app && !cmd.explicit) return { handled: false, hint: `no installed app called "${cmd.app}"${hit.suggestions?.length ? ` (closest: ${hit.suggestions.join(", ")})` : ""}`, app: cmd.app }; // "open ABC Cafe" may be a lead
    const r = await A.openApp(cmd.app);
    return { handled: true, ok: !!r.ok, say: r.ok ? r.message : `${r.message}${r.suggestions?.length ? ` Did you mean ${r.suggestions.join(" or ")}?` : ""}` };
  }
  if (win !== "win32") return cmd.explicit ? { handled: true, ok: false, say: "Controlling app windows works on Windows only." } : { handled: false };
  if (cmd.kind === "list") {
    const w = o.windows || (await listWindows(selfPids));
    const names = [...new Set(w.map(labelOf))].slice(0, 12);
    return { handled: true, ok: true, say: names.length ? `Open now: ${names.join(", ")}.` : "No app windows are open." };
  }
  if (cmd.kind === "desktop") { const r = await run({ op: "desktop" }); return { handled: true, ok: !!r?.ok, say: r?.ok ? "Showing the desktop." : `That didn't work: ${r?.error}` }; }

  const windows = o.windows || (await listWindows(selfPids));
  const target = cmd.app ? pickWindow(cmd.app, windows, A.matchScore, A.normalizeName) : null;
  if (cmd.app && !target) {
    if (!cmd.explicit) return { handled: false };
    return { handled: true, ok: false, say: `${cmd.app} isn't open${cmd.kind === "focus" || cmd.kind === "type" || cmd.kind === "key" ? ` — say "open ${cmd.app}" first` : ""}.` };
  }
  if (cmd.kind === "type" || cmd.kind === "key") {
    if (!target) return { handled: true, ok: false, say: `Which app? Say, for example, "${cmd.kind === "type" ? `type ${cmd.text.slice(0, 30)} in Notepad` : `press ${cmd.label} in Word`}".` };
    const label = labelOf(target);
    const keys = cmd.kind === "type" ? literalKeys(cmd.text) : cmd.keys;
    if (keys.length > 2000) return { handled: true, ok: false, say: "That's too much to type in one go." };
    const what = cmd.kind === "type" ? `Type this into ${label}?` : `Press ${cmd.label.toUpperCase()} in ${label}?`;
    const detail = cmd.kind === "type" ? `“${cmd.text.slice(0, 400)}${cmd.text.length > 400 ? "…" : ""}”${/\n/.test(cmd.text) ? "\n\n(Line breaks are typed as Enter, which can send a message.)" : ""}` : /ENTER/.test(keys) ? "Enter can send a message or submit a form in that app." : "";
    return { handled: true, confirm: { question: what, detail, action: { op: "keys", id: target.id, keys }, done: cmd.kind === "type" ? `Typed it into ${label}.` : `Pressed ${cmd.label} in ${label}.` } };
  }
  const label = labelOf(target);
  if (cmd.kind === "close") {
    return { handled: true, confirm: { question: `Close ${label}?`, detail: "If it has unsaved work, it will ask you to save first.", action: { op: "close", id: target.id }, done: `Asked ${label} to close.` } };
  }
  const r = await run({ op: cmd.kind, id: target.id });
  const done = { focus: `Switched to ${label}.`, minimize: `Minimised ${label}.`, maximize: `Maximised ${label}.`, restore: `Restored ${label}.` }[cmd.kind];
  return { handled: true, ok: !!r?.ok, say: r?.ok ? done : `That didn't work: ${r?.error || "Windows refused"}.` };
}

/** Carry out a confirmed action (only these two kinds ever need it). */
async function runConfirmed(c, o = {}) {
  const a = c && c.action;
  if (!a || !["keys", "close"].includes(a.op) || !Number.isInteger(a.id)) return { ok: false, say: "Nothing to do." };
  const r = await (o.powershell || powershell)({ op: a.op, id: a.id, keys: a.keys });
  return { ok: !!r?.ok, say: r?.ok ? c.done : `That didn't work: ${r?.error || "Windows refused"}.` };
}

module.exports = { parsePcCommand, keysFor, literalKeys, pickWindow, planPc, runConfirmed };
