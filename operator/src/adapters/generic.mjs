import { observe, describeState } from "../browser/observe.mjs";
import { executeAction } from "../browser/actions.mjs";
import { decideNextAction } from "../planner.mjs";
import { needsConfirmation, actionRisk } from "../risk.mjs";
import { log } from "../log.mjs";

/**
 * GenericWebAdapter — the core agent loop that works on ANY website:
 * observe → decide next action → (confirm if risky) → execute → repeat.
 *
 * Contract:
 *   ctx.mgr      BrowserManager
 *   ctx.mode     "autonomous" | "confirmation" | "manual"
 *   ctx.emit(ev) push a UI event { kind, ... }
 *   ctx.confirm({ title, detail, risk }) -> Promise<boolean>
 *   ctx.goal     natural-language goal for this command
 */
export async function runGeneric(ctx, { maxSteps = 18 } = {}) {
  const { mgr, emit } = ctx;
  const history = [];

  for (let step = 0; step < maxSteps; step++) {
    if (mgr.stopped) return { ok: false, halted: true, message: "Stopped." };

    const page = await mgr.activePage();
    const snap = await observe(page);
    emit({ kind: "observe", summary: describeState(snap), url: snap.url, title: snap.title });

    let action;
    try {
      action = await decideNextAction({ goal: ctx.goal, observation: snap, history });
    } catch (err) {
      emit({ kind: "error", message: `Brain error: ${err.message}` });
      return { ok: false, message: err.message };
    }

    if (action.type === "done") {
      emit({ kind: "activity", label: action.message || "Task complete." });
      return { ok: true, message: action.message || "Done." };
    }
    if (action.type === "ask") {
      // Login / OTP / CAPTCHA / clarification — hand control to the user.
      emit({ kind: "needUser", message: action.question || "I need your help to continue." });
      return { ok: false, needUser: true, message: action.question };
    }

    // Manual mode never executes — it only suggests.
    if (ctx.mode === "manual") {
      emit({ kind: "suggest", action, label: describeAction(action) });
      return { ok: true, suggestion: action, message: "Manual mode: suggested next action." };
    }

    // Risk gate.
    const risk = actionRisk(action);
    if (needsConfirmation(action, ctx.mode)) {
      const approved = await ctx.confirm({
        title: describeAction(action),
        detail: previewFor(action),
        risk,
      });
      if (!approved) {
        emit({ kind: "activity", label: "Action cancelled by user." });
        return { ok: false, cancelled: true, message: "Cancelled." };
      }
    }

    emit({ kind: "acting", label: describeAction(action), risk });
    const result = await executeAction(mgr, action);
    emit({ kind: result.ok ? "did" : "actionError", label: result.message, ok: result.ok });
    history.push(`${describeAction(action)} → ${result.ok ? "ok" : "FAILED: " + result.message}`);

    if (result.halted) return { ok: false, halted: true, message: "Stopped." };
    if (!result.ok && result.notFound) {
      // Error recovery: let the brain re-plan against the refreshed page next
      // iteration. If it keeps failing, the step cap ends the loop.
      log.warn("element not found; re-planning next step");
    }
    await page.waitForTimeout(400);
  }

  emit({ kind: "activity", label: "Reached the step limit for this command." });
  return { ok: false, message: "I couldn't finish within the step limit. Want me to continue?" };
}

export function describeAction(a) {
  switch (a.type) {
    case "navigate": return `Open ${a.url}`;
    case "click": return `Click ${a.label ? `"${a.label}"` : `#${a.id}`}`;
    case "type": return `Type into ${a.label ? `"${a.label}"` : `#${a.id}`}${a.submit ? " and search" : ""}`;
    case "select": return `Select "${a.value}"`;
    case "scroll": return `Scroll ${a.direction || "down"}`;
    case "wait": return "Wait";
    default: return a.type;
  }
}

function previewFor(a) {
  if (a.type === "type" || a.type === "fill") return String(a.text ?? "");
  if (a.type === "navigate") return a.url;
  return "";
}
