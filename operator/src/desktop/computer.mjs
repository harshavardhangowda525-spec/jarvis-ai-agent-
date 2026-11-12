/**
 * JARVIS working on your screen ("computer use"). Each step: capture the
 * screen + the clickable things the system lists → ask JARVIS which ONE step
 * is next → ask you first if it's risky → do it (mouse / keyboard) → repeat.
 * Everything the outside world touches is injected (deps), so it is tested
 * with fakes; worker.mjs wires the real screen, input and JARVIS's server.
 *
 * Always visible: the "JARVIS is working" frame + pill with Stop, a ripple
 * where it clicks. Never: typing passwords / OTPs (the server blocks them too).
 */
const BROWSER = /\b(chrome|edge|firefox|brave|opera|browser)\b/i;

export function createComputer(deps) {
  const d = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: () => {}, onStep: () => {}, maxSteps: 30, settleMs: 700, ...deps };
  let stopped = false, running = null;

  const describe = (a) => ({ click: `click ${a.target}`, double_click: `double-click ${a.target}`, right_click: `right-click ${a.target}`, type: `type "${String(a.text).slice(0, 40)}"${a.enter ? " + Enter" : ""}`, key: `press ${a.keys}`, scroll: `scroll ${a.direction}`, open_app: `open ${a.app}`, wait: `wait ${a.seconds}s`, done: "done", fail: "stop" })[a.type] || a.type;

  async function exec(a, factor) {
    const P = (v) => Math.round(v * factor); // image pixels → real screen pixels
    switch (a.type) {
      case "click": case "double_click": case "right_click":
        d.ripple?.(P(a.x), P(a.y));
        return d.input({ kind: a.type === "click" ? "click" : a.type === "double_click" ? "double" : "right", x: P(a.x), y: P(a.y) });
      case "type":
        // a field was named: click into it first, so the text lands there
        if (Number.isFinite(a.x) && Number.isFinite(a.y)) { d.ripple?.(P(a.x), P(a.y)); await d.input({ kind: "click", x: P(a.x), y: P(a.y) }); await d.sleep(250); }
        return d.input({ kind: "type", text: a.text, enter: !!a.enter });
      case "key": return d.input({ kind: "key", keys: a.keys });
      case "scroll": return d.input({ kind: "scroll", direction: a.direction, amount: a.amount });
      case "open_app": {
        const r = await d.openApp(a.app);
        // a browser that was already open (maybe showing JARVIS itself): work in a fresh tab
        if (r && r.ok !== false && BROWSER.test(a.app)) { await d.sleep(600); await d.input({ kind: "key", keys: "ctrl+t" }); }
        return r;
      }
      case "wait": await d.sleep(a.seconds * 1000); return { ok: true };
      default: return { ok: true };
    }
  }

  async function run(task) {
    if (running) return { ok: false, status: "busy", say: "I'm already working on something on the screen." };
    stopped = false;
    const history = [];
    const finish = async (status, result) => {
      d.label(null);
      await d.report(task.id, { status, result }).catch(() => {});
      return { ok: status === "done", status, say: result };
    };
    running = task.id;
    try {
      d.label(`${task.goal.slice(0, 90)}`);
      for (let n = 0; n < (task.maxSteps || d.maxSteps); n++) {
        if (stopped) return await finish("stopped", "Stopped.");
        const shot = await d.capture();
        if (!shot.ok) return await finish("failed", `I couldn't see the screen: ${shot.error}`);
        const elements = await d.elements(shot.factor).catch(() => []);
        let step;
        try { step = await d.act({ id: task.id, image: shot.dataUrl, elements, history, screen: { w: shot.w, h: shot.h } }); }
        catch (e) { return await finish("failed", e.message || "JARVIS couldn't decide the next step."); }
        if (stopped) return await finish("stopped", "Stopped.");
        const a = step.action;
        if (step.blocked) return await finish("failed", step.blocked);
        if (a.type === "done") return await finish("done", a.summary);
        if (a.type === "fail") return await finish("failed", a.reason);
        d.label(`${step.say}`);
        if (step.confirm && !(await d.confirm(step.confirm, `JARVIS wants to ${describe(a)}.`))) return await finish("stopped", `Stopped — you said no to: ${step.confirm}`);
        const r = await exec(a, shot.factor || 1);
        const line = `${step.say} (${describe(a)})${r && r.ok === false ? ` — failed: ${r.error || r.say || "?"}` : ""}`;
        history.push(line);
        d.onStep({ n: n + 1, say: step.say, action: describe(a) });
        await d.report(task.id, { step: { say: step.say, action: describe(a) } }).then((x) => { if (x && x.stop) stopped = true; }).catch(() => {});
        await d.sleep(a.type === "open_app" ? 2500 : d.settleMs);
      }
      return await finish("failed", `I stopped after ${task.maxSteps || d.maxSteps} steps without finishing.`);
    } finally { running = null; }
  }

  return { run, stop: () => { stopped = true; }, busy: () => !!running };
}
