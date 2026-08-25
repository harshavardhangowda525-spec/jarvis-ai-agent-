import { planRoute } from "./planner.mjs";
import { route } from "./router.mjs";
import { log } from "./log.mjs";

/**
 * Session — orchestrates ONE command end-to-end and streams events to the UI:
 *   plan (route) → announce plan → run adapter → report result.
 *
 * A single command runs at a time. Additional commands queue behind it. Control
 * signals (stop / pause / resume / confirm) are delivered from the server.
 */
export class Session {
  constructor({ mgr, send }) {
    this.mgr = mgr;
    this.send = send;                 // (event) => void  — to the paired client
    this.mode = "confirmation";       // default mode
    this.queue = [];
    this.running = false;
    this._pendingConfirm = null;      // { resolve } awaiting a confirm signal
  }

  setMode(mode) {
    if (["autonomous", "confirmation", "manual"].includes(mode)) {
      this.mode = mode;
      this.send({ kind: "mode", mode });
      log.info(`mode → ${mode}`);
    }
  }

  /** Queue a natural-language command. */
  enqueue(command) {
    this.queue.push(command);
    this.send({ kind: "queued", command, position: this.queue.length });
    this._drain();
  }

  // --- control signals -----------------------------------------------------
  stop() {
    this.mgr.stop();
    this.queue = [];
    if (this._pendingConfirm) { this._pendingConfirm.resolve(false); this._pendingConfirm = null; }
    this.send({ kind: "stopped", message: "Emergency stop. Browser left open; control returned to you." });
  }
  pause() { this.mgr.paused = true; this.send({ kind: "paused" }); }
  resume() { this.mgr.paused = false; this.send({ kind: "resumed" }); }
  /** Answer an outstanding confirmation request. */
  confirmDecision(approved) {
    if (this._pendingConfirm) { this._pendingConfirm.resolve(!!approved); this._pendingConfirm = null; }
  }

  // --- confirmation bridge (adapters call this) ----------------------------
  confirm({ title, detail, risk }) {
    return new Promise((resolve) => {
      this._pendingConfirm = { resolve };
      this.send({ kind: "confirm", title, detail, risk });
    });
  }

  // --- run loop ------------------------------------------------------------
  async _drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        if (this.mgr.stopped) { this.mgr.reset(); break; }
        const command = this.queue.shift();
        await this._runOne(command);
      }
    } finally {
      this.running = false;
      this.mgr.reset(); // clear stop/pause flags for the next command
    }
  }

  async _runOne(command) {
    this.send({ kind: "command", command });
    this.send({ kind: "activity", label: "Understanding command…" });

    let plan;
    try {
      plan = await planRoute(command);
    } catch (err) {
      this.send({ kind: "error", message: `Planner failed: ${err.message}` });
      return;
    }
    this.send({ kind: "plan", application: plan.application, intent: plan.intent, summary: plan.summary, steps: plan.steps });

    const ctx = {
      mgr: this.mgr,
      mode: this.mode,
      goal: command,
      emit: (ev) => this.send(ev),
      confirm: (req) => this.confirm(req),
    };

    try {
      const result = await route(plan.application, ctx);
      this.send({
        kind: "result",
        ok: !!result.ok,
        message: result.message || (result.ok ? "Done." : "Could not complete."),
        needUser: !!result.needUser,
        cancelled: !!result.cancelled,
      });
    } catch (err) {
      log.error(err);
      this.send({ kind: "error", message: `Execution error: ${err.message}` });
    }
  }
}
