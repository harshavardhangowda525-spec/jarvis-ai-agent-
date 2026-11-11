/**
 * "JARVIS is working" — the visible label on every page JARVIS controls, like
 * Claude in Chrome: a glowing frame around the page and a pill at the bottom
 * saying what JARVIS is doing, with a Stop button.
 *
 * It lives in a closed shadow root (the page's own CSS/JS can't restyle or hide
 * it), ignores the mouse except for the pill, and it is re-drawn on every new
 * page/navigation from the operator's state — so it can't silently disappear
 * while JARVIS is still driving.
 */

/** Runs inside each page (string-serialised by Playwright). */
function pageOverlay() {
  if (window.top !== window) return; // frames: the top page draws it
  if (location.pathname.startsWith("/live/maps")) return; // JARVIS's own live CRM window has its own animation
  let host = null, root = null, last = null;
  const draw = (st) => {
    const on = !!(st && st.working);
    if (!on) { if (host) host.style.display = "none"; return; }
    if (!host || !host.isConnected) {
      host = document.createElement("jarvis-working");
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block";
      root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>
        .frame{position:fixed;inset:0;pointer-events:none;border:3px solid rgba(34,211,238,.9);box-shadow:inset 0 0 22px 4px rgba(34,211,238,.45),0 0 0 1px rgba(14,116,144,.6);animation:glow 2.4s ease-in-out infinite}
        @keyframes glow{50%{box-shadow:inset 0 0 34px 8px rgba(34,211,238,.6),0 0 0 1px rgba(14,116,144,.8);border-color:rgba(103,232,249,1)}}
        .pill{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:min(92vw,720px);
          background:rgba(6,14,24,.94);color:#e6fbff;border:1px solid rgba(34,211,238,.6);border-radius:999px;padding:8px 8px 8px 14px;
          font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 18px rgba(34,211,238,.35)}
        .dot{width:9px;height:9px;border-radius:50%;background:#22d3ee;box-shadow:0 0 10px #22d3ee;animation:pulse 1.2s ease-in-out infinite;flex:none}
        @keyframes pulse{50%{opacity:.35}}
        .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .t b{color:#67e8f9;font-weight:700;letter-spacing:.04em}
        button{all:unset;cursor:pointer;flex:none;background:#ef4444;color:#fff;font-weight:600;font-size:12px;border-radius:999px;padding:6px 12px}
        button:hover{background:#dc2626}
        .scan{position:fixed;left:0;top:0;width:min(470px,42vw);height:100%;pointer-events:none;overflow:hidden;display:none}
        .scan.on{display:block}
        .scan::before{content:"";position:absolute;left:0;right:0;height:120px;background:linear-gradient(180deg,rgba(34,211,238,0),rgba(34,211,238,.16) 70%,rgba(103,232,249,.9) 98%,rgba(34,211,238,0));animation:sweep 1.6s cubic-bezier(.45,0,.55,1) infinite}
        .scan::after{content:"";position:absolute;inset:0;border-right:1px solid rgba(34,211,238,.45);background:repeating-linear-gradient(0deg,rgba(34,211,238,.035) 0 2px,transparent 2px 6px)}
        @keyframes sweep{from{transform:translateY(-130px)}to{transform:translateY(100vh)}}
        .card{position:fixed;left:24px;top:42%;max-width:min(420px,40vw);pointer-events:none;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;
          font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;background:rgba(6,18,30,.96);border:1px solid rgba(34,211,238,.8);box-shadow:0 0 0 1px rgba(34,211,238,.3),0 0 30px rgba(34,211,238,.55)}
        .card .sc{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#22d3ee;color:#04202a;font-weight:800;font-size:12px}
        .card small{display:block;font-weight:500;color:#9be9f7}
        .card.fly{animation:fly 1.5s cubic-bezier(.55,0,.2,1) forwards}
        @keyframes fly{0%{opacity:0;transform:scale(.6)}18%{opacity:1;transform:scale(1.05)}38%{transform:scale(1)}100%{opacity:0;transform:translateX(calc(100vw + 40px)) scale(.7);filter:blur(1px)}}
        .card.trail::after{content:"";position:absolute;right:100%;top:50%;height:2px;width:120px;background:linear-gradient(90deg,transparent,#67e8f9);opacity:0;animation:trail 1.5s forwards}
        @keyframes trail{40%{opacity:0}55%{opacity:1}100%{opacity:0}}
        .card.skip{border-color:rgba(148,163,184,.5);box-shadow:none;color:#cbd5e1;animation:fade 1.6s ease forwards}
        .card.skip .sc{background:#475569;color:#e2e8f0}
        @keyframes fade{0%{opacity:0;transform:translateY(8px)}20%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0;transform:translateY(24px)}}
      </style><div class="scan"></div><div class="frame"></div><div class="pill" role="status" aria-live="polite"><span class="dot"></span><span class="t"><b>JARVIS</b> is working<span class="d"></span></span><button type="button" title="Stop JARVIS">Stop</button></div>`;
      root.querySelector("button").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); try { window.__jarvisStop && window.__jarvisStop(); } catch {} });
      (document.documentElement || document.body).appendChild(host);
    }
    host.style.display = "block";
    const d = root.querySelector(".d");
    const text = st.text ? ` — ${st.text}` : "";
    if (d.textContent !== text) d.textContent = text;
  };
  window.__jarvisDraw = (st) => { last = st; draw(st); };
  // Google Maps effects: the scanning beam while a listing is read; a card flying to the CRM when a lead is added
  window.__jarvisFx = (ev) => {
    if (!root) return;
    if (ev.type === "scan") { root.querySelector(".scan").classList.toggle("on", !!ev.on); return; }
    const c = document.createElement("div");
    const added = ev.type === "added";
    c.className = `card ${added ? "fly trail" : "skip"}`;
    const sc = document.createElement("span"); sc.className = "sc"; sc.textContent = added ? String(ev.score ?? "✓") : ev.type === "dup" ? "=" : "–";
    const tx = document.createElement("span");
    tx.textContent = added ? "Added to CRM ✓" : ev.type === "dup" ? "Already in the CRM" : "Skipped";
    const sm = document.createElement("small"); sm.textContent = `${ev.name || ""}${ev.detail ? ` · ${ev.detail}` : ""}`.slice(0, 90);
    tx.appendChild(sm); c.append(sc, tx); root.appendChild(c);
    setTimeout(() => c.remove(), 1700);
  };
  const start = () => { try { window.__jarvisState && window.__jarvisState().then((st) => { last = st; draw(st); }); } catch {} };
  if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start);
  // pages that rebuild <html> (Google Maps, SPAs) — put it back if it was removed
  setInterval(() => { if (last && last.working && (!host || !host.isConnected)) draw(last); }, 1000);
}

export class WorkingLabel {
  constructor() { this.state = { working: false, text: "" }; this.contexts = new WeakSet(); this.onStop = null; }

  /** Install once per browser context. */
  async attach(context) {
    if (this.contexts.has(context)) return;
    this.contexts.add(context);
    await context.exposeBinding("__jarvisState", () => this.state);
    await context.exposeBinding("__jarvisStop", () => { this.onStop?.(); });
    await context.addInitScript(`(${pageOverlay.toString()})()`);
    // pages that were already open before attach
    for (const p of context.pages()) await p.evaluate(`(${pageOverlay.toString()})()`).catch(() => {});
    this.context = context;
  }

  async set(working, text = "") {
    this.state = { working: !!working, text: String(text || "").slice(0, 160) };
    const ctx = this.context;
    if (!ctx) return;
    await Promise.all(ctx.pages().map((p) => p.evaluate((st) => { try { window.__jarvisDraw && window.__jarvisDraw(st); } catch {} }, this.state).catch(() => {})));
  }
  on(text) { return this.set(true, text); }
  /** An effect on one page (Google Maps): { type: "scan", on } or { type: "added" | "skipped" | "dup", name, detail, score }. */
  async fx(page, ev) { await page.evaluate((e) => { try { window.__jarvisFx && window.__jarvisFx(e); } catch {} }, ev).catch(() => {}); }
  off() { return this.set(false); }
}
