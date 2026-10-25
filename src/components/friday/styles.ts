/** FRIDAY's look: a calm chat by default; a holographic, full-screen workspace in agentic view. */
export const CSS = `
.fr{--c:#22d3ee;--c2:#0e7490;--bg:#05080f;--pan:rgba(8,20,32,.86);--line:rgba(34,211,238,.22);--tx:#d7f6ff;--dim:#7fa3b3;--bad:#f87171;--ok:#4ade80;color:var(--tx);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.fr button{font:inherit;color:inherit;cursor:pointer}
.fr-dim{color:var(--dim)}.fr .bad{color:var(--bad)}.fr .ok{color:var(--ok)}
.fr-chat{max-width:860px;margin:0 auto;min-height:calc(100dvh - 4rem);display:flex;flex-direction:column;gap:12px;padding:16px;background:transparent}
.fr-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:10px}
.fr-head h1{margin:0;font-size:1.25rem;letter-spacing:.18em;color:var(--c)}.fr-head span{color:var(--dim);font-size:.85rem}
.fr-cta{background:linear-gradient(90deg,#0891b2,#22d3ee);border:0;border-radius:999px;padding:8px 16px;color:#001018!important;font-weight:600}
.fr-warn{border:1px solid rgba(248,113,113,.4);background:rgba(127,29,29,.25);padding:10px 12px;border-radius:10px;color:#fecaca}
.fr-card{display:flex;gap:12px;border:1px solid var(--line);background:var(--pan);border-radius:14px;padding:10px;flex-wrap:wrap}
.fr-card>img{width:220px;max-width:100%;border-radius:10px;cursor:zoom-in}
.fr-strip{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}.fr-strip img{width:54px;height:40px;object-fit:cover;border-radius:4px;cursor:zoom-in;border:1px solid var(--line)}
.fr-msgs{flex:1;display:flex;flex-direction:column;gap:10px;min-height:200px}
.fr-hello{color:var(--tx);padding:20px 4px}.fr-sugs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.fr-sugs button{border:1px solid var(--line);background:rgba(34,211,238,.06);border-radius:999px;padding:6px 12px}
.fr-m{max-width:88%;padding:8px 12px;border-radius:14px;overflow-wrap:anywhere}.fr-m p{margin:0}
.fr-m.user{align-self:flex-end;background:#0e3a4a}.fr-m.assistant{align-self:flex-start;background:var(--pan);border:1px solid var(--line)}.fr-m.err{border-color:rgba(248,113,113,.5)}
.fr-tools{list-style:none;margin:6px 0 0;padding:0;font-size:.8rem;color:var(--dim)}.fr-tools .err{color:var(--bad)}
.fr-prog{border:1px solid var(--line);background:var(--pan);border-radius:12px;padding:10px 12px}
.fr-prog-h{display:flex;justify-content:space-between;gap:8px}.fr-prog-h button{background:none;border:1px solid var(--line);border-radius:8px;padding:2px 10px}
.fr-bar{position:relative;height:16px;background:#0b1b26;border-radius:8px;margin:8px 0 4px;overflow:hidden}.fr-bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#0891b2,#22d3ee);transition:width .4s}
.fr-bar span{position:relative;font-size:.72rem;padding-left:8px;line-height:16px}.fr-bar.ind i{width:30%;animation:frind 1.4s infinite ease-in-out}
@keyframes frind{0%{left:-30%}100%{left:100%}}
.fr-in{display:flex;gap:8px;position:sticky;bottom:0;padding:8px 0;background:inherit}
.fr-in input{flex:1;min-width:0;background:#07131c;border:1px solid var(--line);border-radius:12px;padding:10px 12px;color:var(--tx)}
.fr-in button{background:#0e3a4a;border:1px solid var(--line);border-radius:12px;padding:0 14px}.fr-in button:disabled{opacity:.4}
.fr-lb{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.88);display:grid;place-items:center;cursor:zoom-out;padding:16px}.fr-lb img{max-width:100%;max-height:100%;border-radius:8px}
/* —— agentic view —— */
.fw{position:fixed;inset:0;z-index:70;background:radial-gradient(ellipse at 50% 30%,#0a1d2b 0%,#03060b 70%);display:grid;grid-template-columns:76px 1fr 300px;grid-template-rows:auto 1fr 190px;grid-template-areas:"top top top" "rail view insp" "rail con insp";gap:8px;padding:8px}
.fw>*{min-width:0;min-height:0}
.fw-top{grid-area:top;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid var(--line);background:var(--pan);border-radius:10px;padding:6px 12px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em}
.fw-top span{color:var(--dim)}.fw-top .busy{color:#fde68a}.fw-top .bad{color:var(--bad)}
.fw-top button{margin-left:6px;background:#0e3a4a;border:1px solid var(--line);border-radius:6px;padding:1px 8px;font-size:11px}
.fw-brand{color:var(--c);letter-spacing:.3em}.fw-x{margin-left:auto!important;font-size:14px!important}
.fw-rail{grid-area:rail;display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);background:var(--pan);border-radius:10px;padding:6px;overflow:auto}
.fw-rail button{background:none;border:1px solid transparent;border-radius:8px;padding:6px 2px;display:flex;flex-direction:column;align-items:center;gap:2px}
.fw-rail button span{font-size:18px}.fw-rail button small{font-size:9.5px;color:var(--dim);text-align:center;line-height:1.1}
.fw-rail button.on,.fw-rail button:hover{border-color:var(--line);background:rgba(34,211,238,.08)}
.fw-view{grid-area:view;position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.fw-insp{grid-area:insp;border:1px solid var(--line);background:var(--pan);border-radius:10px;padding:10px 12px;overflow:auto;font-size:13px}
.fw-insp h3{margin:10px 0 6px;font:600 11px ui-monospace,monospace;letter-spacing:.2em;color:var(--c)}.fw-insp h3:first-child{margin-top:0}
.fw-insp h4{margin:8px 0 2px;font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.1em}.fw-insp ul{margin:0;padding-left:16px}
.fw-sel dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0}.fw-sel dt{color:var(--dim)}.fw-sel dd{margin:0}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;border:1px solid #fff4;vertical-align:middle}
.fw-mat label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}.fw-mat button,.fw-g button,.fw-exp button,.fw-new button{background:#0e3a4a;border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin:4px 0}
.fw-vers{list-style:none;padding:0!important}.fw-vers li{display:flex;flex-direction:column;border-left:2px solid transparent;padding:2px 6px}.fw-vers li.on{border-color:var(--c)}
.fw-vers button{background:none;border:0;text-align:left;padding:0;color:var(--tx)}.fw-vers button:disabled{color:var(--dim)}.fw-vers small{color:var(--dim)}
.fw-console{grid-area:con;display:flex;flex-direction:column;border:1px solid var(--line);background:var(--pan);border-radius:10px;padding:6px 10px}
.fw-log{flex:1;overflow:auto;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;display:flex;flex-direction:column-reverse}
.fw-log>div{order:0}.fw-log time{color:#3f6b7c}.l-ok{color:#86efac}.l-error{color:var(--bad)}.l-cmd{color:var(--c)}.l-friday{color:#c4b5fd}
.fw-log{flex-direction:column;justify-content:flex-end}
.fw-drawer{position:absolute;left:8px;top:8px;bottom:56px;width:min(340px,calc(100% - 16px));background:var(--pan);border:1px solid var(--line);border-radius:10px;padding:10px;overflow:auto;z-index:3;backdrop-filter:blur(6px)}
.fw-list{list-style:none;padding:0;margin:0}.fw-list button{width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:8px;padding:6px;display:flex;flex-direction:column}.fw-list button.on,.fw-list button:hover{border-color:var(--line)}.fw-list small{color:var(--dim)}
.fw-lib{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fw-lib button{background:none;border:1px solid var(--line);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:4px}.fw-lib img{width:100%;border-radius:6px}
.fw-noimg{display:grid;place-items:center;min-height:70px;color:var(--dim);font-size:11px;border:1px dashed var(--line);border-radius:6px}
.fw-tree h4{margin:8px 0 2px;font-size:11px;color:var(--dim);text-transform:uppercase}.fw-tree button{display:block;width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:6px;padding:3px 6px}.fw-tree button.on{border-color:var(--c);background:rgba(34,211,238,.1)}
.fw-g label{display:flex;gap:8px;align-items:center}.fw-guide{padding-left:16px}
.fw-exp{display:flex;flex-direction:column;gap:4px}.fw-exp a{color:var(--c)}.fw-dl{font-size:12px}
.fw-new label{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}.fw-new input,.fw-new textarea{background:#07131c;border:1px solid var(--line);border-radius:8px;padding:8px;color:var(--tx);font:inherit}
.fw-gal{position:absolute;inset:0;z-index:4;background:rgba(3,6,11,.96);display:flex;flex-direction:column;padding:10px}
.fw-gal-h{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.fw-gal-h button{margin-left:auto;background:#0e3a4a;border:1px solid var(--line);border-radius:8px;padding:4px 10px}
.fw-gal-h select{background:#07131c;color:var(--tx);border:1px solid var(--line);border-radius:6px}
.fw-grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.fw-grid.cmp{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.fw-grid figure{margin:0;border:1px solid var(--line);border-radius:8px;padding:4px;background:#050b12}.fw-grid .pair{display:flex;gap:4px}.fw-grid img{flex:1;min-width:0;width:100%;border-radius:4px;cursor:zoom-in}
.fw-grid figcaption{font-size:11px;color:var(--dim);display:flex;justify-content:space-between;align-items:center;gap:4px;padding:2px}
.fw-grid figcaption button{background:none;border:1px solid var(--line);border-radius:6px;padding:0 6px}.fw-grid figcaption button:disabled{opacity:.35}
.fw-progwrap{position:absolute;right:8px;top:8px;width:min(320px,calc(100% - 16px));z-index:2}
.fw-hud{position:absolute;left:50%;transform:translateX(-50%);top:8px;z-index:2;background:var(--pan);border:1px solid var(--line);border-radius:8px;padding:4px 10px;font:11px ui-monospace,monospace;display:flex;gap:10px;align-items:center;pointer-events:none}
.fw-hud b{color:var(--c);letter-spacing:.12em}.fw-hud .hold{position:absolute;left:0;bottom:0;height:2px;background:var(--c)}
.fw-hud .dot{position:fixed;width:14px;height:14px;margin:-7px;border-radius:50%;border:2px solid var(--c);box-shadow:0 0 10px var(--c)}
.fw-cam{position:absolute;left:8px;bottom:56px;width:160px;aspect-ratio:4/3;object-fit:cover;transform:scaleX(-1);border:1px solid var(--line);border-radius:8px;z-index:2;display:none}.fw-cam.on{display:block}
/* viewer */
.fv{position:absolute;inset:0;background:#05080f}.fv-host{position:absolute;inset:0}
.fv-empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--dim);text-align:center;padding:24px;pointer-events:none}
.fv-bar{position:absolute;left:8px;right:8px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;background:var(--pan);border:1px solid var(--line);border-radius:10px;padding:4px 6px;z-index:2}
.fv-b{background:none;border:1px solid transparent;border-radius:6px;padding:2px 8px;font-size:12px!important}.fv-b.on,.fv-b:hover{border-color:var(--line);background:rgba(34,211,238,.1)}
.fv-sep{width:1px;height:18px;background:var(--line);margin:0 2px}.fv-sl{display:flex;align-items:center;gap:4px;font-size:12px}.fv-sl input,.fv-range{width:90px}
.fv-sel{background:#07131c;color:var(--tx);border:1px solid var(--line);border-radius:6px;font-size:12px}
.fv-meter{position:absolute;right:10px;bottom:52px;font:10px ui-monospace,monospace;color:#3f6b7c;pointer-events:none}
.fv-cubewrap{position:absolute;right:14px;top:14px;width:56px;height:56px;perspective:300px;z-index:2}
.fv-cube{position:absolute;inset:0;transform-style:preserve-3d}
.fv-face{position:absolute;inset:0;width:56px;height:56px;display:grid;place-items:center;font:600 8px ui-monospace,monospace;letter-spacing:.08em;background:rgba(14,58,74,.75);border:1px solid var(--c);color:var(--tx);backface-visibility:hidden;padding:0}
.fv-face:hover{background:rgba(34,211,238,.4)}
@media (max-width:900px){
 .fw{grid-template-columns:56px 1fr;grid-template-rows:auto minmax(260px,1fr) 160px auto;grid-template-areas:"top top" "rail view" "rail con" "insp insp";overflow:auto}
 .fw-insp{max-height:40vh}.fw-rail small{display:none}.fw-top{font-size:10.5px;gap:8px}
}
`;
