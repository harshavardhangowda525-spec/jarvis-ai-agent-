/**
 * DARWIN CRM styles: light surfaces, navy #0A2540 and blue #2563EB, compact.
 * Plain CSS (scoped with dc-) so the same screen works in JARVIS and inside
 * RUBEN's desktop window.
 */
export const DC_CSS = `
.dc { --navy: #0A2540; --blue: #2563EB; --bg: #F5F7FA; --line: #E3E8EF; --ink: #0F172A; --mute: #64748B; --soft: #EEF3FB;
  display: flex; flex-direction: column; min-height: 0; min-width: 0; width: 100%; flex: 1; background: var(--bg); color: var(--ink); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; position: relative; }
.dc *, .dc *::before, .dc *::after { box-sizing: border-box; }
.dc button, .dc input, .dc select, .dc textarea { font: inherit; color: inherit; }
.dc a { color: var(--blue); text-decoration: none; } .dc a:hover { text-decoration: underline; }
.dc-top { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--navy); color: #fff; flex-wrap: wrap; }
.dc-brand { font-weight: 700; letter-spacing: .02em; display: flex; align-items: baseline; gap: 8px; margin-right: 4px; }
.dc-brand small { font-weight: 500; color: #9FB3C8; font-size: 12px; }
.dc-search { flex: 1 1 160px; min-width: 140px; display: flex; align-items: center; gap: 6px; background: #fff; color: var(--ink); border-radius: 8px; padding: 0 10px; height: 34px; }
.dc-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; }
.dc-btn { height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: #fff; color: var(--ink); cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.dc-btn:hover:not(:disabled) { border-color: #C7D2E1; background: #FAFBFD; }
.dc-btn:disabled { opacity: .5; cursor: default; }
.dc-btn.pri { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 600; }
.dc-btn.pri:hover:not(:disabled) { background: #1D4ED8; }
.dc-btn.ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,.25); }
.dc-btn.ghost:hover { background: rgba(255,255,255,.1); }
.dc-btn.sm { height: 28px; padding: 0 10px; font-size: 12px; }
.dc-btn.danger { color: #B42318; border-color: #F5C2BD; } .dc-btn.danger.pri { background: #B42318; border-color: #B42318; color: #fff; }
.dc-btn.on { background: var(--soft); border-color: #BFD3F5; color: var(--blue); }
.dc-filters { background: #fff; border-bottom: 1px solid var(--line); padding: 8px 14px; display: flex; flex-direction: column; gap: 8px; }
.dc-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.dc-chips::-webkit-scrollbar { display: none; }
.dc-chip { flex: none; height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line); background: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #334155; }
.dc-chip b { font-weight: 600; color: var(--mute); font-variant-numeric: tabular-nums; }
.dc-chip.on { background: var(--navy); border-color: var(--navy); color: #fff; } .dc-chip.on b { color: #C9D6E5; }
.dc-selects { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dc-sel { height: 30px; border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; background: #fff; max-width: 190px; }
.dc-clear { border: 0; background: none; color: var(--blue); cursor: pointer; font-size: 12.5px; }
.dc-flash { margin: 8px 14px 0; padding: 8px 12px; border-radius: 8px; display: flex; gap: 10px; align-items: center; font-size: 13px; }
.dc-flash.ok { background: #ECFDF3; border: 1px solid #ABEFC6; color: #067647; } .dc-flash.bad { background: #FEF3F2; border: 1px solid #FECDCA; color: #B42318; }
.dc-flash.info { background: var(--soft); border: 1px solid #C9D9F5; color: var(--navy); }
.dc-flash button { margin-left: auto; border: 0; background: none; cursor: pointer; color: inherit; }
.dc-main { flex: 1; min-height: 0; overflow: auto; padding: 10px 14px 18px; }
.dc-meta { display: flex; align-items: center; gap: 10px; color: var(--mute); font-size: 12.5px; margin: 2px 0 8px; }
.dc-meta .dc-sort { margin-left: auto; }
.dc-table { width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.dc-table th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); font-weight: 600; background: #FAFBFD; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.dc-table td { padding: 8px 10px; border-bottom: 1px solid #F0F3F7; vertical-align: top; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.dc-table tr:last-child td { border-bottom: 0; }
.dc-table td.nw { white-space: nowrap; }
.dc-table tbody tr { cursor: pointer; } .dc-table tbody tr:hover td { background: #F7FAFF; } .dc-table tbody tr.sel td { background: var(--soft); }
.dc-name b { display: block; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-name small { color: var(--mute); }
.dc-unk { color: #94A3B8; font-style: italic; }
.dc-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; border: 1px solid transparent; }
.dc-pill.t-gray { background: #F2F4F7; color: #475467; } .dc-pill.t-slate { background: #EEF2F6; color: #364152; border-color: #DCE3EC; }
.dc-pill.t-blue { background: #EFF4FF; color: #1D4ED8; } .dc-pill.t-indigo { background: #EEF0FF; color: #3538CD; } .dc-pill.t-violet { background: #F4F0FF; color: #6927DA; }
.dc-pill.t-teal { background: #E7F8F4; color: #0E7A63; } .dc-pill.t-green { background: #ECFDF3; color: #067647; } .dc-pill.t-red { background: #FEF3F2; color: #B42318; }
.dc-next { white-space: nowrap; } .dc-next.late { color: #B42318; font-weight: 600; }
.dc-cards { display: none; flex-direction: column; gap: 8px; }
.dc-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; text-align: left; cursor: pointer; display: grid; gap: 4px; width: 100%; }
.dc-card .r { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.dc-empty { padding: 30px 10px; text-align: center; color: var(--mute); background: #fff; border: 1px dashed var(--line); border-radius: 10px; }
.dc-more { display: flex; justify-content: center; margin-top: 10px; }
/* the lead panel */
.dc-scrim { position: absolute; inset: 0; background: rgba(10,37,64,.28); z-index: 20; }
.dc-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(520px, 100%); background: #fff; z-index: 21; border-left: 1px solid var(--line); display: flex; flex-direction: column; box-shadow: -12px 0 32px rgba(10,37,64,.12); }
.dc-ph { padding: 12px 14px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: flex-start; }
.dc-ph h2 { margin: 0; font-size: 17px; line-height: 1.25; }
.dc-ph small { color: var(--mute); }
.dc-ph .x { margin-left: auto; }
.dc-pb { flex: 1; overflow: auto; padding: 12px 14px 20px; display: flex; flex-direction: column; gap: 14px; }
.dc-sec h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); display: flex; align-items: center; gap: 8px; }
.dc-sec h3 .dc-btn { margin-left: auto; text-transform: none; letter-spacing: 0; }
.dc-kv { display: grid; grid-template-columns: 110px 1fr; gap: 5px 10px; }
.dc-kv dt { color: var(--mute); } .dc-kv dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
.dc-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dc-in, .dc-ta { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; background: #fff; }
.dc-in:focus, .dc-ta:focus, .dc-sel:focus { outline: 2px solid #BFD3F5; border-color: var(--blue); }
.dc-ta { resize: vertical; min-height: 60px; }
.dc-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .dc-form label { display: grid; gap: 3px; font-size: 12px; color: var(--mute); } .dc-form .full { grid-column: 1 / -1; }
.dc-confirm { padding: 10px 12px; border-radius: 8px; background: #FFFAEB; border: 1px solid #FEDF89; color: #93370D; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dc-task { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid #F0F3F7; } .dc-task:last-child { border-bottom: 0; }
.dc-task span { flex: 1; } .dc-task small { display: block; color: var(--mute); } .dc-task.late small { color: #B42318; }
.dc-tl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dc-tl li { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding-left: 12px; border-left: 2px solid var(--line); }
.dc-tl li.k-call { border-color: #84CAA4; } .dc-tl li.k-message { border-color: #93B4F0; } .dc-tl li.k-stage { border-color: #B8A6F0; } .dc-tl li.k-task { border-color: #F2C27B; } .dc-tl li.k-note { border-color: #E9D57A; }
.dc-tl em { font-style: normal; color: var(--mute); font-size: 12px; white-space: nowrap; }
.dc-tl p { grid-column: 1 / -1; margin: 0; color: #475467; white-space: pre-wrap; user-select: text; }
.dc-tag { display: inline-block; margin-left: 6px; font-size: 11px; padding: 0 6px; border-radius: 6px; background: #F2F4F7; color: #475467; text-transform: capitalize; }
.dc-evi { background: #FAFBFD; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
/* dialogs */
.dc-dlg { position: absolute; inset: 0; z-index: 30; background: rgba(10,37,64,.35); display: flex; align-items: flex-start; justify-content: center; padding: 30px 12px; overflow: auto; }
.dc-box { width: min(640px, 100%); background: #fff; border-radius: 12px; box-shadow: 0 20px 50px rgba(10,37,64,.25); display: flex; flex-direction: column; max-height: calc(100% - 20px); }
.dc-box > header { padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; } .dc-box > header h2 { margin: 0; font-size: 16px; }
.dc-box > header .x { margin-left: auto; }
.dc-box > div { padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.dc-box > footer { padding: 10px 16px; border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.dc-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.dc-stat { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; } .dc-stat span { display: block; color: var(--mute); font-size: 12px; } .dc-stat b { font-size: 18px; font-variant-numeric: tabular-nums; }
.dc-mini { width: 100%; border-collapse: collapse; font-size: 12.5px; } .dc-mini th, .dc-mini td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #F0F3F7; } .dc-mini th { color: var(--mute); font-weight: 600; }
.dc-note { color: var(--mute); font-size: 12.5px; margin: 0; }
.dc-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #C9D9F5; border-top-color: var(--blue); animation: dc-rot .8s linear infinite; display: inline-block; vertical-align: -2px; }
@keyframes dc-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dc-spin { animation: none; } }
@media (max-width: 1000px) { .dc-table .c-src { display: none; } }
@media (max-width: 760px) {
  .dc-table { display: none; } .dc-cards { display: flex; }
  .dc-top { padding: 8px 10px; } .dc-filters, .dc-main { padding-left: 10px; padding-right: 10px; }
  .dc-form { grid-template-columns: 1fr; } .dc-kv { grid-template-columns: 96px 1fr; }
  .dc-hide-sm { display: none; }
}
`;
