/**
 * "JARVIS is working" on the desktop — while JARVIS controls apps and the
 * screen: a glowing frame around the screen (click-through: it never gets in
 * your way), a pill at the bottom saying what it's doing with a Stop button,
 * and a ripple wherever it clicks. Everything fades in and out smoothly.
 */
const { BrowserWindow, screen } = require("electron");

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.f{position:fixed;inset:0;border:4px solid rgba(34,211,238,.9);box-shadow:inset 0 0 30px 6px rgba(34,211,238,.45);opacity:0;transition:opacity .35s ease;animation:g 2.4s ease-in-out infinite}
body.on .f{opacity:1}
@keyframes g{50%{box-shadow:inset 0 0 46px 10px rgba(34,211,238,.6);border-color:#67e8f9}}
.r{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:3px solid #67e8f9;box-shadow:0 0 18px #22d3ee;pointer-events:none;animation:rip .75s cubic-bezier(.2,.7,.3,1) forwards}
.r::after{content:"";position:absolute;inset:4px;border-radius:50%;background:#a5f3fc;opacity:.9}
@keyframes rip{0%{transform:scale(.4);opacity:1}100%{transform:scale(3.2);opacity:0}}
</style></head><body><div class="f"></div><script>
window.ripple=(x,y)=>{const r=document.createElement("div");r.className="r";r.style.left=x+"px";r.style.top=y+"px";document.body.appendChild(r);setTimeout(()=>r.remove(),800)};
window.on=(v)=>document.body.classList.toggle("on",!!v);
</script></body></html>`;

const PILL_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:500 13px/1.3 "Segoe UI",system-ui,sans-serif}
.p{position:absolute;inset:4px;display:flex;align-items:center;gap:10px;background:rgba(6,14,24,.95);color:#e6fbff;border:1px solid rgba(34,211,238,.6);border-radius:999px;padding:0 8px 0 14px;box-shadow:0 0 16px rgba(34,211,238,.35);opacity:0;transform:translateY(14px) scale(.97);transition:opacity .3s ease,transform .35s cubic-bezier(.2,.9,.25,1.1)}
body.on .p{opacity:1;transform:none}
.d{width:9px;height:9px;border-radius:50%;background:#22d3ee;box-shadow:0 0 10px #22d3ee;animation:p 1.2s infinite;flex:none}@keyframes p{50%{opacity:.35}}
.t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t b{color:#67e8f9;letter-spacing:.04em}
#x{transition:opacity .2s}#x.fade{opacity:0}
a{flex:none;background:#ef4444;color:#fff;text-decoration:none;font-weight:600;font-size:12px;border-radius:999px;padding:6px 12px}a:hover{background:#dc2626}
</style></head><body><div class="p"><span class="d"></span><span class="t"><b>JARVIS</b> is working<span id="x"></span></span><a href="jarvis-stop://now" title="Stop JARVIS (Ctrl+Alt+Backspace)">Stop</a></div><script>
window.on=(v)=>document.body.classList.toggle("on",!!v);
window.say=(t)=>{const x=document.getElementById("x");const v=t?" — "+t:"";if(x.textContent===v)return;x.classList.add("fade");setTimeout(()=>{x.textContent=v;x.classList.remove("fade")},180)};
</script></body></html>`;

function pillHtml(text) { return PILL_HTML.replace('<span id="x"></span>', `<span id="x">${text ? ` — ${esc(text)}` : ""}</span>`); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

function createWorkingLabel({ onStop }) {
  let frame = null, pill = null, hideTimer = null, ready = Promise.resolve();
  const alive = (w) => w && !w.isDestroyed();
  const opts = { frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    alwaysOnTop: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } };
  const js = (w, code) => (alive(w) ? w.webContents.executeJavaScript(code).catch(() => {}) : Promise.resolve());

  function ensure() {
    const { bounds } = screen.getPrimaryDisplay();
    const loads = [];
    if (!alive(frame)) {
      frame = new BrowserWindow({ ...opts, ...bounds });
      frame.setIgnoreMouseEvents(true);
      frame.setAlwaysOnTop(true, "screen-saver");
      frame.setVisibleOnAllWorkspaces?.(true);
      // the frame never navigates; only our own page
      frame.webContents.on("will-navigate", (e) => e.preventDefault());
      loads.push(frame.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(FRAME_HTML)}`).catch(() => {}));
    }
    if (!alive(pill)) {
      const w = Math.min(640, bounds.width - 40), h = 48;
      pill = new BrowserWindow({ ...opts, focusable: true, width: w, height: h, x: Math.round(bounds.x + (bounds.width - w) / 2), y: bounds.y + bounds.height - h - 56 });
      pill.setAlwaysOnTop(true, "screen-saver");
      // the Stop link: handled here, never navigated
      pill.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (url.startsWith("jarvis-stop:")) onStop?.(); });
      loads.push(pill.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PILL_HTML)}`).catch(() => {}));
    }
    if (loads.length) ready = Promise.all(loads);
    return ready;
  }

  return {
    async show(text = "") {
      clearTimeout(hideTimer);
      await ensure();
      if (!frame.isVisible()) frame.showInactive();
      if (!pill.isVisible()) pill.showInactive();
      await js(pill, `window.say(${JSON.stringify(String(text).slice(0, 140))});window.on(true)`);
      await js(frame, "window.on(true)");
    },
    /** A ripple where JARVIS clicks (screen pixels). */
    async ripple(x, y) {
      await ensure();
      const sf = screen.getPrimaryDisplay().scaleFactor || 1; // real pixels → the frame's own (DPI-scaled) pixels
      if (!frame.isVisible()) frame.showInactive();
      await js(frame, `window.ripple(${Math.round(x / sf)},${Math.round(y / sf)})`);
    },
    /** Fade out shortly after the work ends (so back-to-back steps don't flicker). */
    hide(delay = 600) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(async () => {
        await Promise.all([js(frame, "window.on(false)"), js(pill, "window.on(false)")]);
        setTimeout(() => { if (alive(frame)) frame.hide(); if (alive(pill)) pill.hide(); }, 380);
      }, delay);
    },
    destroy() { clearTimeout(hideTimer); if (alive(frame)) frame.destroy(); if (alive(pill)) pill.destroy(); frame = pill = null; },
    _windows: () => ({ frame, pill }),
  };
}

module.exports = { createWorkingLabel, pillHtml };
