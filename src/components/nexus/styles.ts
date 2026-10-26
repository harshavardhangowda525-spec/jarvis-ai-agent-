export const NX_CSS = `
.nx{padding:14px clamp(12px,2vw,28px) 40px}
.nx-top{display:flex;justify-content:center;margin-bottom:12px}
.nx-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:6px}
.nx-status{display:flex;flex-wrap:wrap;gap:6px}
.nx-err{margin:8px 0;padding:8px 12px;border:1px solid rgba(255,107,122,.4);border-radius:10px;background:rgba(255,107,122,.08);color:#ffc5cc;font-size:13px}
.nx-stage{position:relative;display:grid;grid-template-columns:1fr;gap:14px;transition:grid-template-columns .5s var(--om-ease)}
.nx-stage.has-panel{grid-template-columns:minmax(0,1fr) min(440px,40%)}
.nx-map{position:relative;aspect-ratio:1000/640;min-height:380px;border-radius:22px;overflow:hidden;background:radial-gradient(ellipse at 50% 50%,rgba(20,50,90,.35),transparent 70%);border:1px solid rgba(120,200,255,.08)}
.nx-map::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(140,200,255,.10) 1px,transparent 1px);background-size:26px 26px;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}
.nx-core{position:absolute;left:50%;top:50%;width:46%;aspect-ratio:1;transform:translate(-50%,-50%)}
.nx-net{position:absolute;inset:0;width:100%;height:100%;z-index:1}
.nx-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--om-ink-3)}
.nx-core-label{fill:#dff6ff;font:500 13px "Barlow Condensed",sans-serif;letter-spacing:.5em}
.nx-node{cursor:pointer;outline:none}
.nx-node .nx-halo{fill:rgba(4,14,28,.55);stroke-width:1;stroke-opacity:.22;transition:stroke-opacity .3s}
.nx-node .nx-hex{fill:rgba(8,24,44,.82);stroke-width:1.2;stroke-opacity:.75}
.nx-node:hover .nx-halo,.nx-node:focus-visible .nx-halo,.nx-node.on .nx-halo{stroke-opacity:.9}
.nx-node.on .nx-hex{fill:rgba(20,50,90,.9);stroke-width:2}
.nx-node.off{opacity:.55}
.nx-node .nx-orbit{fill:none;stroke-width:1.2;stroke-dasharray:4 10;animation:nx-spin 8s linear infinite;transform-origin:0 0}
.nx-node.f-fail .nx-hex{stroke:#ff6b7a!important;stroke-width:2.4}
.nx-node.f-return .nx-halo{stroke:#4ce0a6!important;stroke-opacity:1}
.nx-name{fill:#f0f8ff;font:600 12px "Barlow Condensed",sans-serif;letter-spacing:.24em}
.nx-sub{fill:#8fa9c4;font:400 11px Barlow,sans-serif}
.nx-when{fill:#5d7590;font:400 10px Barlow,sans-serif}
.nx-state-bg{fill:rgba(3,10,20,.85);stroke-width:1;stroke-opacity:.6}
.nx-state{fill:#cfe2f5;font:500 10.5px Barlow,sans-serif;letter-spacing:.04em}
.nx-flow{animation:nx-dash 1.2s linear infinite}
.nx-trace{animation:om-pulse 1.6s ease-in-out}
@keyframes nx-dash{to{stroke-dashoffset:-32}}
@keyframes nx-spin{to{transform:rotate(360deg)}}
.nx-phases{display:flex;gap:4px;flex-wrap:wrap;margin-top:12px}
.nx-phases span{font:500 10px "Barlow Condensed",sans-serif;letter-spacing:.24em;color:#4b6178;padding:4px 9px;border-radius:999px;border:1px solid transparent;transition:all .3s}
.nx-phases span.on{color:#eaf8ff;border-color:rgba(95,225,255,.5);background:rgba(95,225,255,.1);box-shadow:0 0 16px rgba(95,225,255,.25)}
.nx-panel{padding:16px;max-height:calc(100dvh - 9rem);overflow:auto;scrollbar-width:thin;align-self:start;position:sticky;top:12px;border-color:color-mix(in srgb,var(--ac) 45%,transparent)}
.nx-panel-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.nx-panel-id{display:flex;gap:12px;align-items:center}
.nx-panel-glyph{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--ac) 50%,transparent);background:rgba(4,14,28,.6)}
.nx-panel h4{margin:16px 0 6px;font:500 11px "Barlow Condensed",sans-serif;letter-spacing:.26em;text-transform:uppercase;color:#8fd8ff}
.nx-state-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0 4px;font-size:13px}
.nx-task{border:1px solid var(--om-line);border-radius:12px;padding:10px;background:rgba(4,12,24,.5)}
.nx-task-t{font-weight:600;margin-bottom:2px}
.nx-steps{list-style:none;margin:8px 0;padding:0;font-size:12.5px;color:var(--om-ink-2);display:flex;flex-direction:column;gap:4px}
.nx-steps li{padding-left:10px;border-left:2px solid rgba(120,200,255,.25)}
.nx-steps li span{color:var(--om-ink-3);font-size:11px;margin-right:4px}
.nx-steps li.k-approval{border-color:#f4c35a}.nx-steps li.k-error{border-color:#ff6b7a}
.nx-list{list-style:none;margin:0;padding:0;font-size:12.5px;display:flex;flex-direction:column;gap:6px;color:var(--om-ink-2)}
.nx-list li{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.nx-list.err li{color:#ffc5cc}
.nx-badge{font:600 9.5px Barlow,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:5px;background:rgba(120,200,255,.12)}
.nx-badge.s-completed{background:rgba(76,224,166,.15);color:#7ff0c2}.nx-badge.s-failed{background:rgba(255,107,122,.15);color:#ffa3ad}
.nx-link{font-size:12px}
.nx-caps{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.nx-caps li{display:flex;flex-direction:column;gap:2px;padding:7px 9px;border:1px solid var(--om-line);border-radius:10px;background:rgba(4,12,24,.45);font-size:12.5px}
.nx-perm{font-size:10px;color:#f4c35a;letter-spacing:.06em;text-transform:uppercase}
.nx-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.nx-row.between{justify-content:space-between;margin-top:0}
.nx-cmd{display:flex;gap:10px;align-items:center;padding:10px 12px;margin:14px auto 0;max-width:980px}
.nx-cmd .om-input{flex:1;min-width:0}
.nx-overlay{position:fixed;right:clamp(10px,2vw,24px);bottom:clamp(10px,2vw,24px);width:min(520px,calc(100vw - 20px));max-height:55vh;overflow:auto;z-index:30;padding:14px}
.nx-overlay-h{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.nx-phase-now{margin-left:auto;font:600 11px "Barlow Condensed",sans-serif;letter-spacing:.26em;color:#5fe1ff}
.nx-acts{list-style:none;padding:0;margin:0 0 8px;font-size:12.5px;color:var(--om-ink-2)}
.nx-acts li.error{color:#ffa3ad}
.nx-reply{white-space:pre-wrap;line-height:1.55;font-size:14px}
.nx-lower{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px}
.nx-tl-wrap{padding:14px}
.nx-tl{position:relative;margin-top:10px}
.nx-tl svg{width:100%;height:auto;display:block}
.nx-tl-grid{stroke:rgba(120,200,255,.08)}.nx-tl-axis{fill:#5d7590;font:400 10px Barlow,sans-serif}
.nx-tl-now{stroke:#5fe1ff;stroke-width:1;stroke-dasharray:3 3;opacity:.6}
.nx-tl-lane{font:600 10.5px "Barlow Condensed",sans-serif;letter-spacing:.2em}
.nx-tl-dep{fill:none;stroke:#9b7bff;stroke-width:1.2;stroke-dasharray:3 3;opacity:.8}
.nx-tl-bar{cursor:pointer}.nx-tl-bar.on rect{stroke:#fff;stroke-width:1}
.nx-tl-tip{position:absolute;top:0;right:0;background:rgba(3,10,20,.95);border:1px solid var(--om-line);border-radius:10px;padding:8px 10px;font-size:12px;pointer-events:none;max-width:320px}
.nx-tl-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--om-ink-3);margin-top:6px}
.nx-tl-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.nx-tl-legend i.dia{background:#f4c35a;transform:rotate(45deg) scale(.8);border-radius:1px}
.nx-empty{color:var(--om-ink-3);font-size:13px;padding:24px 8px;text-align:center}
.nx-pick{margin-top:10px;border-top:1px solid var(--om-line);padding-top:10px}
.nx-result{white-space:pre-wrap;font-size:12.5px;color:var(--om-ink-2);max-height:200px;overflow:auto;border-left:2px solid rgba(76,224,166,.4);padding-left:8px}
.nx-feed{padding:14px;max-height:420px;overflow:auto}
.nx-feed ul{list-style:none;padding:0;margin:8px 0 0;font-size:12.5px;display:flex;flex-direction:column;gap:6px}
.nx-feed li{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;color:var(--om-ink-2)}
.nx-tiles{display:none}
.nx-tile{display:flex;flex-direction:column;gap:3px;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--ac) 40%,transparent);background:rgba(6,18,34,.7);color:var(--om-ink);font:inherit;cursor:pointer}
.nx-tile.on{box-shadow:0 0 0 1px var(--ac),0 0 18px color-mix(in srgb,var(--ac) 35%,transparent)}
.nx-tile-n{font:600 12px "Barlow Condensed",sans-serif;letter-spacing:.24em;color:var(--ac)}
.nx-tile-s{display:flex;gap:6px;align-items:center;font-size:12.5px}
.om-input.sm{padding:5px 8px;font-size:12px;border-radius:9px}
@media (max-width:1100px){.nx-stage.has-panel{grid-template-columns:1fr}.nx-panel{position:static;max-height:none}.nx-lower{grid-template-columns:1fr}}
@media (max-width:640px){.nx-map{aspect-ratio:auto;height:240px;min-height:0}.nx-net{display:none}.nx-core{width:80%}.nx-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}.nx-cmd{flex-wrap:wrap}.nx-cmd .om-input{flex-basis:100%}.nx-head .om-h1{font-size:20px}}

.nx-top-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:14px;margin-top:10px}
.nx-core-panel,.nx-entities,.nx-conn{padding:16px}
.nx-core-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:12px;align-items:center;margin-top:6px}
.nx-core-stats{list-style:none;padding:0;margin:12px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.nx-core-stats li{border:1px solid var(--om-line);border-radius:10px;padding:8px 10px;background:rgba(4,12,24,.45)}
.nx-core-stats b{display:block;font:600 22px "Barlow Condensed",sans-serif;color:#eaf8ff}
.nx-core-stats span{font-size:11px;color:var(--om-ink-3);letter-spacing:.06em}
.nx-core-visual{position:relative;aspect-ratio:1;max-height:340px;max-width:340px;justify-self:center;width:100%}
.nx-core-big{position:absolute;left:50%;top:50%;width:180%;height:180%;transform:translate(-50%,-50%)}
.nx-core-name{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:500 14px "Barlow Condensed",sans-serif;letter-spacing:.5em;padding-left:.5em;color:#fff;text-shadow:0 0 14px #5fe1ff,0 0 2px #000}
.nx-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}
.nx-card{display:flex;gap:10px;align-items:center;text-align:left;padding:10px;border-radius:14px;border:1px solid color-mix(in srgb,var(--ac) 30%,transparent);background:linear-gradient(160deg,color-mix(in srgb,var(--ac) 10%,rgba(6,16,30,.85)),rgba(4,10,20,.85));color:var(--om-ink);font:inherit;cursor:pointer;transition:border-color .25s,box-shadow .25s,transform .25s}
.nx-card:hover{border-color:color-mix(in srgb,var(--ac) 70%,transparent);transform:translateY(-1px)}
.nx-card.on{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac),0 0 24px color-mix(in srgb,var(--ac) 30%,transparent)}
.nx-card-hex{position:relative;flex:none;width:52px;height:52px;display:flex;align-items:center;justify-content:center}
.nx-card-hex>svg{position:absolute;inset:0;width:100%;height:100%}
.nx-card-hex polygon{fill:rgba(4,14,28,.85);stroke:var(--ac);stroke-width:1.6;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--ac) 60%,transparent))}
.nx-card-hex>span{position:relative;display:flex}
.nx-card-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.nx-card-n{font:600 13px "Barlow Condensed",sans-serif;letter-spacing:.24em;color:var(--ac)}
.nx-card-r{font-size:12px;color:var(--om-ink-2)}
.nx-card-s{display:flex;gap:5px;align-items:center;font-size:11.5px;color:#cfe2f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nx-conn{margin-top:14px}
.nx-conn-body{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:14px;margin-top:10px}
.nx-conn .nx-feed{padding:0;max-height:520px;overflow:auto}
.nx-drawer{position:fixed;inset:0;z-index:45;background:rgba(1,5,12,.45);backdrop-filter:blur(2px);display:flex;justify-content:flex-end}
.nx-drawer .nx-panel{position:relative;top:auto;width:min(460px,100%);height:100%;max-height:none;border-radius:0;animation:nx-slide .35s var(--om-ease) both}
@keyframes nx-slide{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
@media (max-width:1100px){.nx-top-grid{grid-template-columns:1fr}.nx-conn-body{grid-template-columns:1fr}}
@media (max-width:760px){.nx-cards{grid-template-columns:1fr 1fr}.nx-core-body{grid-template-columns:1fr}.nx-core-visual{max-height:220px;max-width:220px}}
@media (max-width:420px){.nx-cards{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.nx-drawer .nx-panel{animation:none}}
`;
