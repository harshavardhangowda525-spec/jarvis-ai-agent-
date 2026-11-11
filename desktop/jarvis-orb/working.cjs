/**
 * "JARVIS is working" on the desktop — while JARVIS controls apps and windows,
 * a glowing frame around the screen (click-through: it never gets in your way)
 * and a pill at the bottom saying what it's doing, with a Stop button.
 * Same idea as the label on pages the JARVIS Operator drives.
 */
const { BrowserWindow, screen } = require("electron");

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.f{position:fixed;inset:0;border:4px solid rgba(34,211,238,.9);box-shadow:inset 0 0 30px 6px rgba(34,211,238,.45);animation:g 2.4s ease-in-out infinite}
@keyframes g{50%{box-shadow:inset 0 0 44px 10px rgba(34,211,238,.6);border-color:#67e8f9}}
</style></head><body><div class="f"></div></body></html>`;

const pillHtml = (text) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:500 13px/1.3 "Segoe UI",system-ui,sans-serif}
.p{position:absolute;inset:4px;display:flex;align-items:center;gap:10px;background:rgba(6,14,24,.95);color:#e6fbff;border:1px solid rgba(34,211,238,.6);border-radius:999px;padding:0 8px 0 14px;box-shadow:0 0 16px rgba(34,211,238,.35)}
.d{width:9px;height:9px;border-radius:50%;background:#22d3ee;box-shadow:0 0 10px #22d3ee;animation:p 1.2s infinite;flex:none}@keyframes p{50%{opacity:.35}}
.t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t b{color:#67e8f9;letter-spacing:.04em}
a{flex:none;background:#ef4444;color:#fff;text-decoration:none;font-weight:600;font-size:12px;border-radius:999px;padding:6px 12px}a:hover{background:#dc2626}
</style></head><body><div class="p"><span class="d"></span><span class="t"><b>JARVIS</b> is working<span id="x">${text ? ` — ${esc(text)}` : ""}</span></span><a href="jarvis-stop://now" title="Stop JARVIS (Ctrl+Alt+Backspace)">Stop</a></div></body></html>`;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

function createWorkingLabel({ onStop }) {
  let frame = null, pill = null, hideTimer = null;
  const alive = (w) => w && !w.isDestroyed();
  const opts = { frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    alwaysOnTop: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: false } };

  function ensure() {
    const { bounds } = screen.getPrimaryDisplay();
    if (!alive(frame)) {
      frame = new BrowserWindow({ ...opts, ...bounds });
      frame.setIgnoreMouseEvents(true);
      frame.setAlwaysOnTop(true, "screen-saver");
      frame.setVisibleOnAllWorkspaces?.(true);
      frame.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(FRAME_HTML)}`);
    }
    if (!alive(pill)) {
      const w = Math.min(640, bounds.width - 40), h = 48;
      pill = new BrowserWindow({ ...opts, focusable: true, width: w, height: h, x: Math.round(bounds.x + (bounds.width - w) / 2), y: bounds.y + bounds.height - h - 56 });
      pill.setAlwaysOnTop(true, "screen-saver");
      // the Stop link: handled here, never navigated
      pill.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (url.startsWith("jarvis-stop:")) onStop?.(); });
    }
  }

  return {
    show(text = "") {
      clearTimeout(hideTimer);
      ensure();
      pill.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pillHtml(String(text).slice(0, 140)))}`);
      if (!frame.isVisible()) frame.showInactive();
      if (!pill.isVisible()) pill.showInactive();
    },
    /** Hide shortly after the work ends (so back-to-back steps don't flicker). */
    hide(delay = 600) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (alive(frame)) frame.hide(); if (alive(pill)) pill.hide(); }, delay);
    },
    destroy() { clearTimeout(hideTimer); if (alive(frame)) frame.destroy(); if (alive(pill)) pill.destroy(); frame = pill = null; },
    _windows: () => ({ frame, pill }),
  };
}

module.exports = { createWorkingLabel, pillHtml };
