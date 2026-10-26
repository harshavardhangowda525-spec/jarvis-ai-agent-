export const CC_CSS = `
.cc{--bg:#030a14;--pan:rgba(8,26,44,.72);--pan2:rgba(10,34,58,.8);--line:rgba(64,190,255,.28);--line2:rgba(64,190,255,.14);--glow:#38d6ff;--ink:#e3f4ff;--ink2:#9fc3dc;--ink3:#5f86a3;--amber:#ffbe50;--red:#ff5d6c;--green:#3ee6a0;
  min-height:calc(100dvh - 4rem);color:var(--ink);font-size:13.5px;padding:10px clamp(10px,1.4vw,18px) 18px;
  background:radial-gradient(1100px 520px at 50% -12%,rgba(30,120,200,.30),transparent 70%),radial-gradient(700px 400px at 0% 100%,rgba(0,140,200,.12),transparent),linear-gradient(180deg,#041222,#020810);
  background-color:var(--bg);position:relative;overflow-x:hidden}
.cc::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(64,190,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(64,190,255,.05) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(180deg,#000,transparent 85%)}
.cc *{box-sizing:border-box}
.cc a{color:var(--glow)}
.cc-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;padding:6px 4px 10px;border-bottom:1px solid var(--line2);position:relative}
.cc-brand{font-weight:700;letter-spacing:.18em;font-size:16px;display:flex;align-items:center;gap:8px}
.cc-logo{color:var(--glow);text-shadow:0 0 10px var(--glow)}
.cc-title{letter-spacing:.32em;font-size:13px;color:var(--ink2);text-align:center;padding:6px 26px;border:1px solid var(--line2);border-top:0;border-radius:0 0 14px 14px;background:linear-gradient(180deg,rgba(56,214,255,.06),transparent)}
.cc-actions{display:flex;justify-content:flex-end;gap:8px}
.cc-icon{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:var(--pan);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none;font-size:15px;color:var(--ink)}
.cc-icon.on{box-shadow:0 0 0 2px var(--glow),0 0 18px rgba(56,214,255,.6)}
.cc-cmd{display:flex;gap:8px;align-items:center;margin:10px 0 6px;position:relative}
.cc-cmd input{flex:1;min-width:0;background:rgba(4,16,30,.8);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:8px 12px;font-size:13.5px}
.cc-cmd input:focus{outline:none;box-shadow:0 0 0 2px rgba(56,214,255,.35)}
.cc-reply{font-size:12.5px;color:#bff1ff;margin:0 0 6px;padding:6px 10px;border-left:2px solid var(--glow);background:rgba(56,214,255,.06)}
.cc-warn{font-size:12.5px;color:#ffd0d4;margin:6px 0;padding:8px 10px;border:1px solid rgba(255,93,108,.4);border-radius:10px;background:rgba(255,93,108,.08)}
.cc-btn{background:linear-gradient(180deg,rgba(40,140,210,.35),rgba(20,70,120,.35));border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 12px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.cc-btn:hover{border-color:var(--glow)}.cc-btn:disabled{opacity:.5}
.cc-btn.sm{padding:4px 9px;font-size:11.5px}.cc-btn.on{border-color:var(--glow);box-shadow:0 0 10px rgba(56,214,255,.35)}
.cc-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:6px 0 10px;position:relative}
.cc-label{font-size:11px;letter-spacing:.22em;color:var(--ink2)}
.cc-chips{display:flex;flex-wrap:wrap;gap:6px}.cc-chips.right{margin-left:auto}
.cc-chip{border:1px solid var(--line2);background:rgba(6,22,40,.7);color:var(--ink2);border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.cc-chip.on{color:var(--ink);border-color:var(--glow);background:rgba(56,214,255,.14);box-shadow:inset 0 0 12px rgba(56,214,255,.15)}
.cc-chip.em{border-color:rgba(255,190,80,.55)}
.cc-grid{display:grid;grid-template-columns:minmax(250px,1fr) minmax(0,2.35fr) minmax(270px,1.05fr);gap:12px;position:relative}
.cc-left,.cc-right,.cc-center{display:flex;flex-direction:column;gap:12px;min-width:0}
.cc-panel{position:relative;background:var(--pan);border:1px solid var(--line);border-radius:12px;padding:10px 12px 12px;box-shadow:inset 0 0 30px rgba(56,214,255,.05),0 8px 30px rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);min-width:0}
.cc-panel::before,.cc-panel::after{content:"";position:absolute;width:14px;height:14px;border:2px solid var(--glow);opacity:.7;pointer-events:none}
.cc-panel::before{top:-1px;left:-1px;border-right:0;border-bottom:0;border-radius:12px 0 0 0}
.cc-panel::after{bottom:-1px;right:-1px;border-left:0;border-top:0;border-radius:0 0 12px 0}
.cc-panel>header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.cc-panel h2{margin:0;font-size:12.5px;letter-spacing:.16em;font-weight:650;color:#cdeeff;text-shadow:0 0 8px rgba(56,214,255,.35)}
.cc-dim{color:var(--ink3);font-size:11.5px;line-height:1.45}
.cc-sub{color:var(--ink2);font-size:11.5px;letter-spacing:.06em;margin:6px 0 4px}
.cc-empty{color:var(--ink3);font-size:12.5px;padding:18px 6px;text-align:center;line-height:1.5}
.cc-link{display:block;font-size:12px;margin-top:6px;word-break:break-word}
.cc-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.cc-radar{width:100%;height:auto;display:block;margin:6px auto 0;max-width:380px}
.cc-rlabel{fill:var(--ink2);font-size:9.5px;cursor:pointer}.cc-rlabel.on{fill:#fff;font-weight:700}.cc-rlabel.em{fill:var(--amber)}
.cc-sector{cursor:pointer}
.cc-sweep{transform-origin:150px 150px;animation:ccsweep 6s linear infinite}
@keyframes ccsweep{to{transform:rotate(360deg)}}
.cc-blip{fill:#5fe3ff;stroke:#031220;stroke-width:1.5;cursor:pointer;filter:drop-shadow(0 0 4px rgba(56,214,255,.9))}
.cc-blip.raw{fill:#3a7ea8}.cc-blip.on{fill:#fff;filter:drop-shadow(0 0 8px #fff)}
.cc-rlist{list-style:none;margin:0;padding:0;font-size:12px}
.cc-rlist li{display:flex;justify-content:space-between;gap:6px;padding:4px 6px;border-bottom:1px solid var(--line2)}
.cc-rlist li.em{background:rgba(255,190,80,.07)}
.cc-rlist button{background:none;border:0;color:var(--ink);cursor:pointer;padding:0;font-size:12px}
.cc-rlist span{color:var(--ink3)}
.cc-readout-sel{margin-top:8px;border:1px solid var(--line2);border-radius:10px;padding:8px;background:rgba(56,214,255,.04)}
.cc-readout-sel p{margin:4px 0;font-size:12px;color:var(--ink2)}.cc-readout-sel span,.cc-card span,.cc-opp-d span,.cc-feature span{color:#8fd8ff}
.cc-center-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.9fr);gap:12px}
.cc-feature{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:12px}
.cc-feature h3{margin:2px 0 6px;font-size:21px;line-height:1.2;text-shadow:0 0 14px rgba(56,214,255,.25)}
.cc-feature p{margin:6px 0;color:var(--ink2);font-size:12.5px;line-height:1.5}
.cc-feature-r{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:rgba(56,214,255,.05)}
.cc-card{text-align:left;width:100%;background:rgba(5,20,36,.75);border:1px solid var(--line2);border-radius:10px;padding:9px 10px;color:var(--ink);cursor:pointer;display:flex;flex-direction:column;gap:3px;font:inherit}
.cc-card:hover{border-color:var(--line)}.cc-card.on{border-color:var(--glow);box-shadow:0 0 16px rgba(56,214,255,.25)}
.cc-card-t{font-weight:650;font-size:13.5px;line-height:1.3}
.cc-card-m{color:var(--ink3);font-size:11px}
.cc-card-k,.cc-card-s{font-size:11.5px;color:var(--ink2);line-height:1.4}
.cc-card-l{font-size:11px;color:var(--glow);margin-top:2px}
.cc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.cc-feed{position:relative}
.cc-analyst-wrap{position:absolute;inset:44px 10% auto 10%;z-index:6}
.cc-analyst{background:rgba(4,16,30,.96);border:1px solid var(--glow);border-radius:12px;padding:10px 12px;box-shadow:0 0 40px rgba(56,214,255,.25),0 20px 50px rgba(0,0,0,.6)}
.cc-analyst-h{display:flex;align-items:center;gap:8px;font-size:11.5px;letter-spacing:.14em;color:#cdeeff;margin-bottom:6px}
.cc-analyst-h .cc-x{margin-left:auto}
.cc-analyst-t{font-weight:650;margin-bottom:6px}
.cc-analyst table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}
.cc-analyst th{text-align:left;color:#8fd8ff;font-weight:600;font-size:10.5px;letter-spacing:.08em;padding:5px 8px;width:34%;vertical-align:top;border-bottom:1px solid var(--line2)}
.cc-analyst td{padding:5px 8px;color:var(--ink);border-bottom:1px solid var(--line2);line-height:1.4}
.cc-x{background:none;border:1px solid var(--line2);color:var(--ink2);border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:16px;line-height:1}
.cc-video{display:flex;flex-direction:column;gap:3px}
.cc-player{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#000}
.cc-player iframe{width:100%;height:100%;border:0}
.cc-thumb{width:100%;height:100%;border:0;background:#071a2c center/cover no-repeat;cursor:pointer;display:flex;align-items:center;justify-content:center}
.cc-play{width:52px;height:52px;border-radius:50%;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.5);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px}
.cc-live{position:absolute;top:8px;right:8px;background:rgba(10,40,20,.85);color:var(--green);border:1px solid var(--green);border-radius:8px;padding:2px 8px;font-size:11px;font-weight:700;letter-spacing:.1em}
.cc-upcoming{position:absolute;top:8px;right:8px;background:rgba(40,30,0,.85);color:var(--amber);border:1px solid var(--amber);border-radius:8px;padding:2px 8px;font-size:11px;font-weight:700}
.cc-video-t{font-weight:700;font-size:13.5px;margin-top:6px}
.cc-vlist{display:flex;flex-direction:column;gap:6px}
.cc-vitem{display:grid;grid-template-columns:96px 1fr;gap:8px;text-align:left;background:none;border:1px solid var(--line2);border-radius:9px;padding:5px;color:var(--ink);cursor:pointer;font-size:12px;font-family:inherit}
.cc-vitem small{display:block;color:var(--ink3);font-size:10.5px;margin-top:2px}
.cc-vthumb{aspect-ratio:16/9;border-radius:6px;background:#071a2c center/cover no-repeat;position:relative}
.cc-vthumb i{position:absolute;bottom:3px;left:3px;font-style:normal;font-size:9px;background:var(--red);color:#fff;border-radius:4px;padding:0 4px}
.cc-opp{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.4fr);gap:8px;margin-top:6px}
.cc-opp-list{display:flex;flex-direction:column;gap:4px}
.cc-opp-list button{text-align:left;background:rgba(5,20,36,.75);border:1px solid var(--line2);border-radius:8px;color:var(--ink2);padding:6px 8px;font-size:11.5px;cursor:pointer;line-height:1.3}
.cc-opp-list button b{color:var(--glow);margin-right:4px}
.cc-opp-list button.on{border-color:var(--glow);color:var(--ink)}
.cc-opp-d{font-size:12px;line-height:1.45}.cc-opp-d p{margin:3px 0}.cc-opp-d ul{margin:2px 0;padding-left:16px;color:var(--ink2)}.cc-opp-d small{color:var(--ink3)}
.cc-opp-t{font-weight:700;margin-bottom:4px}
.cc-status{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-top:12px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--pan)}
.cc-status div{display:flex;flex-direction:column;font-size:11.5px}.cc-status b{font-weight:600;color:#cdeeff}.cc-status span{color:var(--ink3)}
.cc-honest{max-width:420px;color:var(--ink3)}
.cc-drawer{position:fixed;top:4rem;right:0;bottom:0;width:min(620px,100vw);z-index:40;background:rgba(3,12,24,.97);border-left:1px solid var(--glow);box-shadow:-20px 0 60px rgba(0,0,0,.6);display:flex;flex-direction:column}
.cc-drawer-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line2)}
.cc-tabs{display:flex;gap:4px;flex-wrap:wrap;flex:1}
.cc-tabs button{background:none;border:1px solid var(--line2);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
.cc-tabs button.on{color:var(--ink);border-color:var(--glow);background:rgba(56,214,255,.12)}
.cc-drawer-body{padding:12px 14px;overflow-y:auto;flex:1}
.cc-drawer h4{margin:14px 0 6px;font-size:11.5px;letter-spacing:.14em;color:#8fd8ff;text-transform:uppercase}
.cc-drawer ul,.cc-drawer ol{margin:0;padding-left:18px;color:var(--ink2);font-size:12.5px;line-height:1.5}
.cc-prose{font-size:14px;line-height:1.6}
.cc-cite{font-size:11px;vertical-align:super;text-decoration:none}
.cc-sources li{margin:4px 0}
.cc-trend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--ink2)}
.cc-metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.cc-metrics div{border:1px solid var(--line2);border-radius:10px;padding:10px;background:rgba(56,214,255,.04)}
.cc-metrics b{display:block;font-size:20px}.cc-metrics span{font-size:11.5px;color:var(--ink3)}
.cc-topics{display:flex;flex-wrap:wrap;gap:6px}
.cc-drawer input,.cc-drawer select{background:rgba(4,16,30,.8);border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:6px 8px;font-size:12.5px}
@media (max-width:1280px){.cc-grid{grid-template-columns:minmax(240px,1fr) minmax(0,2fr)}.cc-right{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr}}
@media (max-width:980px){.cc-grid{grid-template-columns:1fr}.cc-center-top,.cc-feature,.cc-right{grid-template-columns:1fr}.cc-left{display:grid;grid-template-columns:1fr 1fr}.cc-analyst-wrap{position:static;margin-top:10px}}
@media (max-width:640px){.cc-left{grid-template-columns:1fr}.cc-top{grid-template-columns:1fr auto}.cc-title{display:none}.cc-chips.right{margin-left:0}.cc-opp{grid-template-columns:1fr}.cc-feature h3{font-size:18px}.cc-cmd{flex-wrap:wrap}.cc-cmd input{flex-basis:100%}}
@media (prefers-reduced-motion:reduce){.cc-sweep{animation:none;opacity:.5}.cc *{transition:none!important;scroll-behavior:auto!important}}

.cc.om{background:radial-gradient(1200px 700px at 50% -20%,rgba(56,120,255,.16),transparent 70%),radial-gradient(900px 600px at 100% 110%,rgba(155,123,255,.10),transparent 70%),linear-gradient(180deg,#040b17,#02050b)}
.cc-navrow{display:flex;justify-content:center;margin-bottom:12px;position:relative;z-index:2}
.cc.om .cc-top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:0;padding:0 2px 8px}
.cc-select{background:rgba(6,22,40,.7);border:1px solid var(--line2);color:var(--ink2);border-radius:8px;padding:5px 8px;font-size:12px;max-width:200px}
.cc-obs{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(320px,1fr);gap:12px;position:relative;align-items:start}
.cc-obs-main{display:flex;flex-direction:column;gap:12px;min-width:0}
.cc-obs-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:12px}
.cc-globe{position:relative;width:100%;height:clamp(320px,46vh,520px);border-radius:12px;overflow:hidden;background:radial-gradient(ellipse at center,rgba(20,60,110,.35),transparent 70%);touch-action:none}
.cc-globe.flat{height:auto;display:block}
.cc-globe canvas{display:block;cursor:grab}
.cc-globe-tip{position:absolute;z-index:3;pointer-events:none;background:rgba(3,10,20,.95);border:1px solid var(--line);border-radius:9px;padding:6px 9px;font-size:12px;white-space:nowrap}
.cc-globe-tip span{color:var(--ink3);font-size:11px}
.cc-map-legend{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;margin-top:8px}
.cc-place{margin-top:8px;border:1px solid var(--line2);border-radius:10px;padding:8px 10px;background:rgba(56,214,255,.04);font-size:12.5px}
.cc-place ul{margin:6px 0 0;padding-left:16px}.cc-place button{background:none;border:0;color:var(--glow);cursor:pointer;text-align:left;padding:2px 0;font:inherit}
.cc-stream{position:sticky;top:10px}
.cc-stream-list{max-height:calc(100dvh - 12rem);display:flex;flex-direction:column;gap:8px;padding-right:4px}
.cc-si{border:1px solid var(--line2);border-radius:11px;background:rgba(5,20,36,.7);transition:border-color .2s,box-shadow .2s}
.cc-si:hover{border-color:var(--line)}.cc-si.on{border-color:var(--glow);box-shadow:0 0 16px rgba(56,214,255,.2)}
.cc-si-main{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;background:none;border:0;color:var(--ink);padding:10px 11px 6px;cursor:pointer;font:inherit}
.cc-si-top{display:flex;justify-content:space-between;align-items:center}
.cc-si-cat{font:500 10px "Barlow Condensed",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8fd8ff}
.cc-si-score{font:700 12px Barlow,sans-serif;color:#041018;background:linear-gradient(135deg,#5fe1ff,#9b7bff);border-radius:6px;padding:1px 6px}
.cc-si-t{font-weight:600;font-size:13.5px;line-height:1.3}
.cc-si-m,.cc-si-v,.cc-si-also{font-size:11px;color:var(--ink3);display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.cc-si-s{font-size:12px;color:var(--ink2);line-height:1.4}
.cc-si-also{color:#a9c6e4}
.cc-si-actions{display:flex;gap:6px;padding:0 11px 9px}
.cc-modal{position:fixed;inset:0;z-index:50;background:rgba(1,5,12,.6);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px;overflow:auto}
.cc-modal .cc-analyst{width:min(760px,100%)}
.cc-impact{margin-top:10px;border-top:1px solid var(--line2);padding-top:8px;display:grid;gap:6px}
.cc-impact-row{display:grid;grid-template-columns:minmax(0,1.3fr) 110px minmax(0,1fr);gap:8px;align-items:center;font-size:12px}
.cc-impact-row em{color:var(--ink3);font-style:normal;font-size:11px}
.cc-impact-bar{height:6px;border-radius:99px;background:rgba(120,200,255,.12);overflow:hidden}.cc-impact-bar i{display:block;height:100%;background:linear-gradient(90deg,#5fe1ff,#9b7bff)}
.cc-oppr{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.cc-oppr-svg{width:100%;max-width:320px;height:auto;margin:0 auto;display:block;overflow:visible}
.cc-oppr-l{fill:var(--ink2);font-size:9px}
.cc-oppr-sweep{transform-origin:140px 140px;animation:ccsweep 7s linear infinite}
.cc-oppr-dot{filter:drop-shadow(0 0 5px rgba(95,225,255,.8))}
.cc-oppr-d{font-size:12px;line-height:1.45}
.cc-oppr-list{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.cc-oppr-list button{text-align:left;background:rgba(5,20,36,.75);border:1px solid var(--line2);border-radius:8px;color:var(--ink2);padding:5px 8px;font-size:11.5px;cursor:pointer}
.cc-oppr-list button b{color:var(--glow);margin-right:4px}.cc-oppr-list button.on{border-color:var(--glow);color:var(--ink)}
.cc-oppr-t{font-weight:700;margin-bottom:4px;font-size:13px}
.cc-oppr-d dl{display:grid;grid-template-columns:118px 1fr;gap:3px 8px;margin:6px 0}
.cc-oppr-d dt{color:#8fd8ff;font-size:11px}.cc-oppr-d dd{margin:0;color:var(--ink2)}.cc-oppr-d ul{margin:0;padding-left:14px}
.cc-oppr-d select,.cc-analyst select{background:rgba(6,22,40,.8);border:1px solid var(--line2);color:var(--ink);border-radius:8px;padding:4px 6px;font-size:11.5px}
.cc-weights{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px 14px;font-size:12px}.cc-weights label{display:flex;flex-direction:column;gap:2px;color:var(--ink2)}
@media (max-width:1200px){.cc-obs{grid-template-columns:1fr}.cc-stream{position:static}.cc-stream-list{max-height:none}}
@media (max-width:820px){.cc-obs-row{grid-template-columns:1fr}.cc-impact-row{grid-template-columns:1fr}.cc-oppr-d dl{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.cc-oppr-sweep{animation:none;opacity:.5}}
`;
