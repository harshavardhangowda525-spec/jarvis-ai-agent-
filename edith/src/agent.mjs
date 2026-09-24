/**
 * ULTRON's agentic coding loop.
 *
 * UNDERSTAND → INSPECT → PLAN → EDIT → RUN → TEST → VERIFY → REPORT.
 *
 * The model chooses ONE real tool call at a time from the registry, given the
 * goal, the project state, and the history of what already happened (with real
 * results). Every tool call actually executes. Risky calls are gated by the
 * safety policy and the confirmation bridge. Nothing is simulated: the model
 * only ever sees real tool output, and the final report is grounded in it.
 */
import { askJson } from "./provider.mjs";
import { buildRegistry, TOOL_CATALOG } from "./registry.mjs";
import { commandNeedsConfirmation, classifyCommand } from "./safety.mjs";
import { detectProject } from "./tools/build.mjs";
import { log } from "./log.mjs";

const SYSTEM = `You are ULTRON, JARVIS's software-development subagent. You accomplish the user's development goal by choosing ONE real tool call at a time and reacting to its REAL result. You are action-oriented and honest.

Return ONLY JSON, one of:
{"thought":"one short line of what you're doing","tool":"<ultron.tool>","input":{...}}
{"done":true,"report":"<concise, honest summary of what you actually did and verified>"}
{"ask":"<a question or missing-credential message>"}

Rules:
- Use ONLY these tools:
${TOOL_CATALOG}
- Inspect before you change: detect the project / read files before editing.
- Preserve existing functionality; do not overwrite a whole project unless asked.
- Never claim success you didn't verify. After code changes, run build/test/lint when available and react to the REAL result.
- If a tool fails, read the real error and fix the actual cause; don't loop blindly.
- NEVER start a long-running / blocking server to preview or run the site (no http-server, python -m http.server, vite/next dev, serve, etc.) — those never return and will hang you. The dashboard shows a LIVE preview automatically once an index.html exists, so just finish and report. Only use run_command for commands that terminate (install, build, test, lint, git).
- If a required credential/integration is missing (e.g. a deploy token), return {"ask": ...} explaining exactly what to configure. Never pretend it worked.
- Keep "thought" to one short line. Do not expose long reasoning.
- Stop with {"done"} when the goal is achieved and verified, or {"ask"} when you genuinely need the user.`;

export class UltronAgent {
  constructor({ ws, audit, emit, confirm, mode = "confirmation", userContext = "" }) {
    this.ws = ws;
    this.audit = audit;
    this.emit = emit;                 // (event) => void
    this.confirm = confirm;           // ({title, detail, level}) => Promise<bool>
    this.mode = mode;
    // The user's saved preferences from JARVIS (e.g. preferred stack, style).
    this.system = userContext.trim()
      ? `${SYSTEM}\n\nWhat JARVIS knows about the user (their saved preferences — follow them when relevant; they never override the rules above):\n${userContext.trim()}`
      : SYSTEM;
    this.registry = buildRegistry(ws, { onChange: (c) => emit({ kind: "file", ...c }) });
    this.stopped = false;
  }

  stop() { this.stopped = true; }

  async run(goal, { maxSteps = 40 } = {}) {
    this.stopped = false;
    const history = [];
    const project = detectProject(this.ws);
    this.emit({ kind: "project", ...project });
    this.audit.record({ type: "goal", goal });

    for (let step = 0; step < maxSteps; step++) {
      if (this.stopped) { this.emit({ kind: "stopped" }); return { ok: false, stopped: true }; }

      let decision;
      try {
        decision = await askJson(this.system, buildUserMessage(goal, project, this.ws.root, history));
      } catch (err) {
        this.emit({ kind: "error", message: `ULTRON brain error: ${err.message}` });
        return { ok: false, message: err.message };
      }

      if (decision.done) {
        this.emit({ kind: "report", report: decision.report || "Done." });
        this.audit.record({ type: "done", report: decision.report });
        return { ok: true, report: decision.report };
      }
      if (decision.ask) {
        this.emit({ kind: "ask", message: decision.ask });
        this.audit.record({ type: "ask", message: decision.ask });
        return { ok: false, needUser: true, message: decision.ask };
      }
      if (!decision.tool || !this.registry.tools[decision.tool]) {
        history.push(`Invalid tool "${decision.tool}". Choose one from the catalog.`);
        continue;
      }

      const input = decision.input || {};
      const level = this.registry.riskOf(decision.tool, input);
      const label = describeCall(decision.tool, input);
      if (decision.thought) this.emit({ kind: "activity", label: decision.thought });

      // Safety gate.
      const needsConfirm =
        decision.tool === "ultron.run_command"
          ? commandNeedsConfirmation(input.command || "", this.mode)
          : gateByRisk(level, this.mode);
      if (needsConfirm) {
        const approved = await this.confirm({
          title: label,
          detail: input.command || input.file || JSON.stringify(input).slice(0, 300),
          level,
        });
        if (!approved) {
          this.emit({ kind: "cancelled", label });
          history.push(`User DECLINED: ${label}. Choose a different approach or ask.`);
          continue;
        }
      }

      this.emit({ kind: "tool", name: decision.tool, label, level, status: "running" });
      const started = Date.now();
      let result;
      try {
        result = await this.registry.tools[decision.tool].run(input);
      } catch (err) {
        result = { ok: false, error: String(err.message) };
      }
      const ms = Date.now() - started;
      const ok = result?.ok !== false && !result?.error;

      // Emit a terminal event for command-like tools.
      if (decision.tool === "ultron.run_command" || result?.exitCode !== undefined) {
        this.emit({ kind: "terminal", command: input.command || decision.tool, exitCode: result.exitCode ?? (ok ? 0 : 1),
          stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs ?? ms });
      }
      this.emit({ kind: "tool", name: decision.tool, label, level, status: ok ? "ok" : "error",
        summary: summarize(decision.tool, result) });
      this.audit.record({ type: "tool", tool: decision.tool, input: redact(input), ok, ms });

      history.push(`${label} → ${ok ? "OK" : "FAILED"}: ${summarize(decision.tool, result)}`);
      // Give the model the real (trimmed) result to reason over next turn.
      history.push(`RESULT ${JSON.stringify(trimResult(result)).slice(0, 4000)}`);
    }

    this.emit({ kind: "activity", label: "Reached ULTRON's step limit for this goal." });
    return { ok: false, message: "Step limit reached before completion." };
  }
}

function gateByRisk(level, mode) {
  if (level === "dangerous") return true;
  if (mode === "manual") return true;
  if (mode === "autonomous") return false;
  return level === "review";
}

function buildUserMessage(goal, project, root, history) {
  return [
    `GOAL: ${goal}`,
    `WORKSPACE: ${root}`,
    `PROJECT: ${JSON.stringify(project)}`,
    history.length ? `HISTORY (real results so far):\n${history.slice(-24).join("\n")}` : "No actions yet.",
    "Choose the single next tool call, or finish.",
  ].join("\n\n");
}

function describeCall(tool, input) {
  const short = tool.replace("ultron.", "");
  if (tool === "ultron.run_command") return `run: ${input.command}`;
  if (input.file) return `${short}: ${input.file}`;
  if (input.from) return `${short}: ${input.from} → ${input.to}`;
  if (input.message) return `${short}: "${String(input.message).slice(0, 60)}"`;
  if (input.url) return `${short}: ${input.url}`;
  return short;
}

function summarize(tool, r) {
  if (!r) return "no result";
  if (r.provider && (r.url !== undefined || r.connected === false)) return r.message || (r.url ? `deployed ${r.url}` : "deploy");
  if (r.error) return r.error;
  if (r.exitCode !== undefined) return `exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}`;
  if (r.action) return `${r.action} ${r.file || ""}`.trim();
  if (r.matches) return `${r.matches.length} matches`;
  if (r.entries) return `${r.entries.length} entries`;
  if (r.hash) return `commit ${r.hash}`;
  if (r.status !== undefined && r.url) return `HTTP ${r.status}`;
  if (r.framework) return `${r.framework} / ${r.packageManager}`;
  return "ok";
}

function trimResult(r) {
  if (!r) return r;
  const c = { ...r };
  if (typeof c.content === "string" && c.content.length > 3000) c.content = c.content.slice(0, 3000) + "…";
  if (typeof c.stdout === "string" && c.stdout.length > 3000) c.stdout = c.stdout.slice(-3000);
  if (typeof c.patch === "string" && c.patch.length > 3000) c.patch = c.patch.slice(0, 3000);
  return c;
}

function redact(input) {
  const s = JSON.stringify(input);
  return s.length > 500 ? s.slice(0, 500) + "…" : input;
}
