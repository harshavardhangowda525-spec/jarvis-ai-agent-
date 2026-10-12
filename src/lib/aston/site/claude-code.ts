import "server-only";
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ASTON's website builder on the owner's own Claude Code.
 *
 * When ASTON runs on the owner's PC and Claude Code is installed and signed in
 * there, each build step is handed to the local `claude` CLI in headless mode
 * (`claude -p`). It runs on the owner's Claude subscription — no API key, no
 * per-use bill; each step counts toward the plan's normal usage limits.
 *
 * Guarantees:
 * - Subscription only: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN and cloud-provider
 *   switches are removed from the child's environment (in `-p` mode an API key
 *   would otherwise win and be billed).
 * - Text only: every tool is disabled, one turn, no MCP servers, no saved
 *   session, run from an empty temp folder (no project files or CLAUDE.md).
 * - Never on a server: unavailable on Vercel / when ASTON_CLAUDE_CODE=off.
 * - Never silent: limits, sign-in problems and a missing install come back as
 *   ClaudeCodeError with a plain-English message; nothing falls back by itself.
 */

export type ClaudeModel = "opus" | "sonnet" | "haiku";
export const CLAUDE_MODELS: ClaudeModel[] = ["opus", "sonnet", "haiku"];
export const MODEL_LABEL: Record<ClaudeModel, string> = { opus: "Claude Opus", sonnet: "Claude Sonnet", haiku: "Claude Haiku" };

export type ClaudeErrorKind = "not_installed" | "not_signed_in" | "limit" | "disabled" | "timeout" | "failed";

export class ClaudeCodeError extends Error {
  constructor(message: string, public kind: ClaudeErrorKind) { super(message); this.name = "ClaudeCodeError"; }
}

type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
type Env = Record<string, string | undefined>;
export interface ClaudeDeps { spawn: Spawn; env: Env; platform: NodeJS.Platform }
const defaults = (): ClaudeDeps => ({ spawn: nodeSpawn as unknown as Spawn, env: process.env, platform: process.platform });

/** Environment for the child: the owner's login, never an API key or a cloud provider. */
export function childEnv(env: Env): Env {
  const out: Env = { ...env };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) delete out[k];
  return out;
}

/** Why Claude Code can't be used in this deployment at all (null = it may be). */
export function disabledReason(env: Env): string | null {
  if (/^(off|false|0|no)$/i.test(env.ASTON_CLAUDE_CODE ?? "")) return "Turned off with ASTON_CLAUDE_CODE=off.";
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) return "Claude Code only works when ASTON runs on your own PC.";
  return null;
}

/** Plain-English message for something Claude Code printed. */
export function classify(text: string): { kind: ClaudeErrorKind; message: string } {
  const t = text.replace(/\s+/g, " ").trim();
  const resets = t.match(/resets? ([^.·]{1,40})/i)?.[1]?.trim();
  if (/hit your (session|weekly|opus|usage)? ?limit|usage limit|limit reached|rate limit/i.test(t)) {
    return { kind: "limit", message: `Your Claude plan's usage limit is reached${resets ? ` (resets ${resets})` : ""}. Switch this website to Groq, or try again later.` };
  }
  if (/not logged in|login expired|please run \/login|invalid authentication|401/i.test(t)) {
    return { kind: "not_signed_in", message: "Claude Code isn't signed in on this PC. Open a terminal, run `claude`, and log in with your Claude account — then press Resume." };
  }
  if (/is not recognized as an internal|command not found|ENOENT/i.test(t)) return { kind: "not_installed", message: notInstalled().message };
  if (/invalid api key/i.test(t)) {
    return { kind: "not_signed_in", message: "Claude Code is set up with an API key instead of your Claude login. Run `claude` in a terminal and use /login with your Claude account." };
  }
  return { kind: "failed", message: `Claude Code couldn't finish this step${t ? `: ${t.slice(0, 160)}` : ""}. Press Resume to try again.` };
}

function launch(d: ClaudeDeps, args: string[], cwd: string): ChildProcess {
  const cmd = d.env.CLAUDE_CODE_PATH || "claude";
  const opts: SpawnOptions = { cwd, env: childEnv(d.env) as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true };
  // Windows: the native installer gives claude.exe, an npm install a claude.cmd
  // shim — only a shell finds both. (Set CLAUDE_CODE_PATH to a .exe to skip it.)
  if (d.platform === "win32" && !/\.exe$/i.test(cmd)) {
    return d.spawn(cmd, args.map((a) => (a === "" ? '""' : /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)), { ...opts, shell: true });
  }
  return d.spawn(cmd, args, opts);
}

const notInstalled = () => new ClaudeCodeError("Claude Code isn't installed on this PC (or `claude` isn't on the PATH). Install it from claude.com/code, sign in once by running `claude`, then try again.", "not_installed");

interface Status { available: boolean; reason: string | null; account: string | null; checkedAt: number }
let cached: Status | null = null;

/** Is Claude Code installed and signed in with a Claude subscription? (cached for a minute) */
export async function claudeStatus(opts: { deps?: Partial<ClaudeDeps>; fresh?: boolean } = {}): Promise<Omit<Status, "checkedAt">> {
  const d = { ...defaults(), ...opts.deps };
  const off = disabledReason(d.env);
  if (off) return { available: false, reason: off, account: null };
  if (!opts.fresh && cached && Date.now() - cached.checkedAt < 60_000) return { available: cached.available, reason: cached.reason, account: cached.account };
  const out = await new Promise<Omit<Status, "checkedAt">>((resolve) => {
    let stdout = "", done = false;
    const finish = (s: Omit<Status, "checkedAt">) => { if (!done) { done = true; resolve(s); } };
    let child: ChildProcess;
    try { child = launch(d, ["auth", "status"], tmpdir()); } catch { finish({ available: false, reason: notInstalled().message, account: null }); return; }
    const timer = setTimeout(() => { child.kill(); finish({ available: false, reason: "Claude Code didn't answer in time.", account: null }); }, 15_000);
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on("data", (b: Buffer) => { stderr = (stderr + b.toString()).slice(-2000); });
    child.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(timer); finish({ available: false, reason: e.code === "ENOENT" ? notInstalled().message : `Claude Code couldn't start: ${e.message}`, account: null }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let info: { loggedIn?: boolean; authMethod?: string; email?: string; account?: { email?: string } } = {};
      try { info = JSON.parse(stdout.trim()); } catch { /* older versions print text */ }
      const method = String(info.authMethod ?? "");
      if (code !== 0 && classify(stderr + stdout).kind === "not_installed") return finish({ available: false, reason: notInstalled().message, account: null });
      if (code !== 0 || info.loggedIn === false || method === "none") return finish({ available: false, reason: classify("not logged in").message, account: null });
      if (method && !/claude\.ai|oauth_token/i.test(method)) {
        return finish({ available: false, reason: `Claude Code is signed in with "${method}", not your Claude subscription. Run \`claude\` and use /login with your Claude account so builds stay on your plan.`, account: null });
      }
      finish({ available: true, reason: null, account: info.email ?? info.account?.email ?? null });
    });
  });
  cached = { ...out, checkedAt: Date.now() };
  return out;
}

export interface ClaudeStreamInput { system: string; user: string; model: ClaudeModel; timeoutMs?: number }

/**
 * One text-only Claude Code run, streaming the reply through `onDelta`.
 * Resolves with the full text; rejects with ClaudeCodeError.
 */
export async function claudeStream(input: ClaudeStreamInput, onDelta: (text: string) => void, opts: { deps?: Partial<ClaudeDeps> } = {}): Promise<string> {
  const d = { ...defaults(), ...opts.deps };
  const off = disabledReason(d.env);
  if (off) throw new ClaudeCodeError(off, "disabled");
  const dir = await mkdtemp(join(tmpdir(), "aston-claude-"));
  try {
    const sysFile = join(dir, "system.txt");
    await writeFile(sysFile, input.system, "utf8");
    const args = [
      "-p",
      "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--model", input.model,
      "--system-prompt-file", sysFile,
      "--tools", "",
      "--max-turns", "1",
      "--strict-mcp-config",
      "--no-session-persistence",
    ];
    return await new Promise<string>((resolve, reject) => {
      let child: ChildProcess;
      try { child = launch(d, args, dir); } catch { reject(notInstalled()); return; }
      let buf = "", text = "", stderr = "", settled = false, resultText: string | null = null, failure: string | null = null;
      const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => { child.kill(); settle(() => reject(new ClaudeCodeError("Claude Code took too long on this step. Press Resume to try again.", "timeout"))); }, input.timeoutMs ?? 6 * 60_000);
      const line = (raw: string) => {
        if (!raw.trim()) return;
        let ev: any;
        try { ev = JSON.parse(raw); } catch { return; }
        if (ev?.type === "stream_event" && ev.event?.delta?.type === "text_delta" && typeof ev.event.delta.text === "string") {
          text += ev.event.delta.text;
          onDelta(ev.event.delta.text);
        } else if (ev?.type === "result") {
          if (ev.is_error || (ev.subtype && ev.subtype !== "success")) failure = [ev.result, ...(Array.isArray(ev.errors) ? ev.errors : [])].filter(Boolean).join(" ") || String(ev.subtype ?? "error");
          else if (typeof ev.result === "string") resultText = ev.result;
        }
      };
      child.stdout?.on("data", (b: Buffer) => {
        buf += b.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
      });
      child.stderr?.on("data", (b: Buffer) => { stderr = (stderr + b.toString()).slice(-4000); });
      child.on("error", (e: NodeJS.ErrnoException) => settle(() => reject(e.code === "ENOENT" ? notInstalled() : new ClaudeCodeError(`Claude Code couldn't start: ${e.message}`, "failed"))));
      child.on("close", (code) => {
        line(buf);
        settle(() => {
          if (failure) { const c = classify(failure); reject(new ClaudeCodeError(c.message, c.kind)); return; }
          const out = text || resultText || "";
          if (code !== 0 && !out) { const c = classify(stderr); reject(new ClaudeCodeError(c.message, c.kind)); return; }
          // the streamed text is the reply; if nothing streamed, show the final result at once
          if (!text && resultText) onDelta(resultText);
          resolve(out);
        });
      });
      child.stdin?.on("error", () => { /* child exited early; handled on close */ });
      child.stdin?.end(input.user);
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Groq-style chat messages → one Claude Code run (system prompt + the user turn). */
export function fromMessages(messages: { role: "system" | "user" | "assistant"; content: string }[]): { system: string; user: string } {
  return {
    system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
    user: messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n"),
  };
}
