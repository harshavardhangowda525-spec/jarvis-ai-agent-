/**
 * OMEGA INTERFACE — the shared design language of JARVIS's intelligence
 * workspaces: obsidian depth, midnight-blue atmosphere, cyan / arctic / violet
 * light, thin luminous outlines and restrained glow. Every workspace includes
 * OMEGA_CSS once and builds on the om-* classes.
 */
export const OMEGA_CSS = `
.om{--om-void:#02050b;--om-deep:#040b17;--om-mid:#071427;--om-glass:rgba(10,24,44,.55);--om-glass-2:rgba(14,32,58,.7);
  --om-line:rgba(120,200,255,.18);--om-line-2:rgba(120,200,255,.32);--om-cyan:#5fe1ff;--om-arctic:#a9d8ff;--om-violet:#9b7bff;
  --om-ink:#e8f3ff;--om-ink-2:#9fb7d0;--om-ink-3:#5d7590;--om-good:#4ce0a6;--om-warn:#f4c35a;--om-bad:#ff6b7a;
  --om-r:14px;--om-ease:cubic-bezier(.2,.8,.2,1);
  position:relative;min-height:calc(100dvh - 4rem);color:var(--om-ink);font-family:Barlow,system-ui,sans-serif;font-size:14px;overflow-x:hidden;
  background:radial-gradient(1200px 700px at 50% -20%,rgba(56,120,255,.16),transparent 70%),radial-gradient(900px 600px at 100% 110%,rgba(155,123,255,.10),transparent 70%),linear-gradient(180deg,var(--om-deep),var(--om-void));}
.om *{box-sizing:border-box}
.om a{color:var(--om-cyan)}
.om-title{font-family:"Barlow Condensed",Barlow,sans-serif;font-weight:500;letter-spacing:.32em;text-transform:uppercase;font-size:12px;color:#cfe8ff}
.om-h1{font-family:"Barlow Condensed",Barlow,sans-serif;font-weight:300;letter-spacing:.18em;text-transform:uppercase;font-size:clamp(20px,2.4vw,30px);margin:0;color:#f2f8ff;text-shadow:0 0 24px rgba(95,225,255,.18)}
.om-sub{color:var(--om-ink-2);font-size:12.5px;line-height:1.5}
.om-dim{color:var(--om-ink-3);font-size:11.5px;line-height:1.45}
.om-glass{position:relative;background:linear-gradient(180deg,rgba(18,40,70,.42),rgba(8,18,34,.55));border:1px solid var(--om-line);border-radius:var(--om-r);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:inset 0 1px 0 rgba(200,235,255,.07),0 18px 50px rgba(0,0,0,.45)}
.om-glass::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(120deg,rgba(160,220,255,.10),transparent 30%,transparent 70%,rgba(155,123,255,.07));mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);-webkit-mask-composite:xor;mask-composite:exclude;padding:1px}
.om-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(20,48,84,.45);border:1px solid var(--om-line-2);color:var(--om-ink);border-radius:10px;padding:7px 12px;font:500 12.5px Barlow,sans-serif;cursor:pointer;text-decoration:none;transition:border-color .2s var(--om-ease),box-shadow .2s var(--om-ease)}
.om-btn:hover{border-color:var(--om-cyan);box-shadow:0 0 0 1px rgba(95,225,255,.25),0 0 18px rgba(95,225,255,.15)}
.om-btn:disabled{opacity:.45;cursor:default;box-shadow:none}
.om-btn.primary{background:linear-gradient(135deg,rgba(40,140,230,.55),rgba(120,90,240,.45));border-color:transparent}
.om-btn.good{border-color:rgba(76,224,166,.5)}.om-btn.bad{border-color:rgba(255,107,122,.45)}
.om-btn.sm{padding:4px 9px;font-size:11.5px}
.om-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--om-line);border-radius:999px;padding:3px 10px;font-size:11.5px;color:var(--om-ink-2);background:rgba(4,12,24,.5)}
.om-chip.on{color:var(--om-ink);border-color:var(--om-cyan);background:rgba(95,225,255,.10)}
.om-dot{width:7px;height:7px;border-radius:50%;background:var(--c,var(--om-ink-3));box-shadow:0 0 8px var(--c,transparent)}
.om-input{background:rgba(3,10,20,.7);border:1px solid var(--om-line);border-radius:12px;color:var(--om-ink);padding:10px 14px;font:400 14px Barlow,sans-serif;outline:none;transition:border-color .2s,box-shadow .2s}
.om-input:focus{border-color:var(--om-cyan);box-shadow:0 0 0 3px rgba(95,225,255,.12),0 0 30px rgba(95,225,255,.10)}
.om-scroll{overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(120,200,255,.25) transparent}
.om-fade-in{animation:om-in .5s var(--om-ease) both}
@keyframes om-in{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}
@keyframes om-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.om *,.om *::before,.om *::after{animation:none!important;transition:none!important}}
`;

export const STATE_COLOR: Record<string, string> = {
  idle: "#5d7590", ready: "#5fe1ff", listening: "#a9d8ff", planning: "#9b7bff", working: "#5fe1ff", waiting_approval: "#f4c35a",
  completed: "#4ce0a6", error: "#ff6b7a", offline: "#3d4f63", unknown: "#5d7590",
};
