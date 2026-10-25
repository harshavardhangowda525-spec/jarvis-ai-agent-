export const TI_CSS = `
.ti{--bg:#05070c;--glass:rgba(16,24,38,.62);--glass2:rgba(22,33,52,.72);--line:rgba(120,170,230,.16);--ink:#e9eef6;--ink2:#a9b6c8;--ink3:#6f7e93;--accent:#5cc8ff;--good:#3ecf8e;--warn:#e8b14a;--bad:#ef6a6a;
  min-height:calc(100dvh - 4rem);background:radial-gradient(1200px 600px at 10% -10%,rgba(57,135,229,.16),transparent),radial-gradient(900px 500px at 110% 10%,rgba(25,158,112,.10),transparent),var(--bg);color:var(--ink);padding:18px clamp(12px,2.4vw,28px) 48px;font-size:14px}
.ti h1{font-size:22px;font-weight:700;letter-spacing:.02em;margin:0}
.ti h2{font-size:13px;font-weight:650;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin:0 0 10px}
.ti h3{font-size:15px;font-weight:650;margin:0}
.ti-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:14px}
.ti-sub{color:var(--ink2);font-size:13px;margin-top:4px}
.ti-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ti-btn{background:var(--glass2);border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:7px 12px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;gap:6px;align-items:center}
.ti-btn:hover{border-color:rgba(92,200,255,.5)}
.ti-btn:disabled{opacity:.5;cursor:default}
.ti-btn.primary{background:linear-gradient(135deg,#1f6fd1,#1aa5c9);border-color:transparent;font-weight:600}
.ti select,.ti input[type=text]{background:var(--glass2);border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:7px 10px;font-size:13px}
.ti-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--ink2);background:rgba(10,16,26,.5)}
.ti-chip.good{color:var(--good);border-color:rgba(62,207,142,.4)}.ti-chip.warn{color:var(--warn);border-color:rgba(232,177,74,.4)}.ti-chip.bad{color:var(--bad);border-color:rgba(239,106,106,.4)}
.ti-chip button{background:none;border:0;color:inherit;cursor:pointer;padding:0}
.ti-chip.on{color:var(--ink);border-color:rgba(92,200,255,.6);background:rgba(57,135,229,.18)}
.ti-glass{background:var(--glass);border:1px solid var(--line);border-radius:16px;padding:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 30px rgba(0,0,0,.25)}
.ti-banner{border-radius:12px;padding:10px 14px;font-size:13px;border:1px solid rgba(232,177,74,.35);background:rgba(232,177,74,.08);color:#f2d39a;margin-bottom:12px}
.ti-banner.info{border-color:rgba(92,200,255,.3);background:rgba(57,135,229,.08);color:#bfe3ff}
.ti-banner.bad{border-color:rgba(239,106,106,.4);background:rgba(239,106,106,.08);color:#f6b4b4}
.ti-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0}
.ti-card{background:var(--glass);border:1px solid var(--line);border-radius:14px;padding:12px 14px;min-height:96px}
.ti-card .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.ti-card .v{font-size:26px;font-weight:700;margin-top:6px;font-variant-numeric:tabular-nums}
.ti-card .v.nd{font-size:15px;font-weight:500;color:var(--ink3);margin-top:12px}
.ti-card .s{font-size:12px;color:var(--ink2);margin-top:4px}
.ti-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:12px;margin-top:12px}
.ti-grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}
.ti-chart{position:relative}
.ti-chart svg,.ti-mini svg{width:100%;height:auto;display:block;overflow:visible}
.ti-grid{stroke:rgba(150,180,220,.10);stroke-width:1}
.ti-zero{stroke:rgba(150,180,220,.35);stroke-width:1}
.ti-cross{stroke:rgba(220,235,255,.35);stroke-width:1;stroke-dasharray:3 3}
.ti-axis{fill:var(--ink3);font-size:10px}
.ti-mini{position:relative;background:rgba(8,13,22,.4);border:1px solid var(--line);border-radius:12px;padding:6px}
.ti-mini-t{fill:var(--ink2);font-size:11px}.ti-mini-v{fill:var(--ink);font-size:12px;font-weight:650}
.ti-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--ink2);margin-top:6px}
.ti-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.ti-tip{position:absolute;z-index:5;pointer-events:none;background:rgba(6,10,18,.95);border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:12px;color:var(--ink);white-space:nowrap;transform:translateX(-50%)}
.ti-chart>.ti-tip:not([style*="%"]){transform:none}
.ti-tip-h{color:var(--ink2);margin-bottom:2px}
.ti-empty{color:var(--ink3);font-size:13px;padding:24px 0;text-align:center}
.ti-strat{display:flex;flex-direction:column;gap:8px}
.ti-strat .tag{font-size:11px;font-weight:700;color:var(--accent);letter-spacing:.1em}
.ti-kv{display:grid;grid-template-columns:1fr auto auto;gap:3px 10px;font-size:12.5px;font-variant-numeric:tabular-nums}
.ti-kv .h{color:var(--ink3);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.ti-kv .l{color:var(--ink2)}
.ti-nd{color:var(--ink3)}
.ti-find{border-top:1px solid var(--line);padding:8px 0}
.ti-find summary{cursor:pointer;display:flex;gap:8px;align-items:center;list-style:none}
.ti-find summary::-webkit-details-marker{display:none}
.ti-find ul{margin:6px 0 0;padding-left:18px;color:var(--ink2);font-size:12.5px}
.ti-sev{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:6px;padding:2px 6px}
.ti-sev.high{background:rgba(239,106,106,.16);color:var(--bad)}.ti-sev.medium{background:rgba(232,177,74,.16);color:var(--warn)}.ti-sev.low{background:rgba(150,180,220,.12);color:var(--ink2)}
.ti-meter{position:relative;height:10px;border-radius:999px;background:rgba(150,180,220,.12);overflow:visible;margin:8px 0}
.ti-meter-fill{height:100%;border-radius:999px}
.ti-meter-mark{position:absolute;top:-3px;width:2px;height:16px;background:rgba(233,238,246,.55)}
.ti-phases{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;margin-top:8px}
.ti-phase{height:28px;border-radius:6px;background:rgba(150,180,220,.10);position:relative;font-size:10px;color:var(--ink3);display:flex;align-items:center;justify-content:center}
.ti-phase.done{background:rgba(25,158,112,.45);color:#e8fff4}.ti-phase.now{outline:2px solid var(--accent)}
.ti-list{margin:6px 0 0;padding-left:18px;color:var(--ink2);font-size:13px}
.ti-list li{margin:3px 0}
.ti-prose{color:var(--ink);line-height:1.55;font-size:14px}
.ti-label{font-size:11px;color:var(--warn);letter-spacing:.06em}
.ti-table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.ti-table th{text-align:left;color:var(--ink3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;border-bottom:1px solid var(--line)}
.ti-table td{padding:6px 8px;border-bottom:1px solid rgba(120,170,230,.08);color:var(--ink2)}
.ti-scroll{overflow-x:auto}
.ti-spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:tispin 1s linear infinite}
@keyframes tispin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ti-spin{animation:none}}
@media (max-width:640px){.ti-card .v{font-size:21px}.ti h1{font-size:19px}}
`;
