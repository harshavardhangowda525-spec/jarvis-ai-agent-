/**
 * ULTRON tool registry. Every tool maps to a REAL backend implementation
 * (filesystem / terminal / git / build). Each declares a risk level so the
 * agent and safety policy can gate execution. No tool returns fabricated data.
 */
import { makeFsTools } from "./tools/fs.mjs";
import { makeGitTools } from "./tools/git.mjs";
import { makeBuildTools } from "./tools/build.mjs";
import { deploymentAdapters } from "./tools/deploy.mjs";
import { runCommand } from "./tools/terminal.mjs";
import { classifyCommand } from "./safety.mjs";

/**
 * Build the registry bound to a workspace. onChange(fileChange) is called for
 * every real file mutation so the UI can show the file-change panel.
 */
export function buildRegistry(ws, { onChange } = {}) {
  const fsT = makeFsTools(ws, onChange);
  const gitT = makeGitTools(ws);
  const buildT = makeBuildTools(ws);
  const deploy = deploymentAdapters(ws);

  /** name -> { risk, run(input) } */
  const tools = {
    "ultron.list_files":   { risk: "safe",   run: (i) => fsT.list(i) },
    "ultron.read_file":    { risk: "safe",   run: (i) => fsT.read(i) },
    "ultron.search_code":  { risk: "safe",   run: (i) => fsT.search(i) },
    "ultron.write_file":   { risk: "review", run: (i) => fsT.write(i) },
    "ultron.edit_file":    { risk: "review", run: (i) => fsT.edit(i) },
    "ultron.move_file":    { risk: "review", run: (i) => fsT.move(i) },
    "ultron.delete_file":  { risk: "dangerous", run: (i) => fsT.remove(i) },

    "ultron.run_command":  { risk: "dynamic", run: (i) => runCommand(ws, i.command, { cwdRel: i.cwd, timeoutMs: i.timeoutMs }) },
    "ultron.detect_project": { risk: "safe", run: () => buildT.detect() },
    "ultron.install":      { risk: "review", run: () => buildT.install() },
    "ultron.build":        { risk: "safe",   run: () => buildT.build() },
    "ultron.test":         { risk: "safe",   run: () => buildT.test() },
    "ultron.lint":         { risk: "safe",   run: () => buildT.lint() },
    "ultron.health_check": { risk: "safe",   run: (i) => buildT.healthCheck(i) },

    "ultron.git_status":   { risk: "safe",   run: () => gitT.status() },
    "ultron.git_diff":     { risk: "safe",   run: (i) => gitT.diff(i) },
    "ultron.git_log":      { risk: "safe",   run: (i) => gitT.log(i) },
    "ultron.git_init":     { risk: "review", run: () => gitT.init() },
    "ultron.git_commit":   { risk: "review", run: (i) => gitT.commit(i) },

    "ultron.deploy":       { risk: "dangerous", run: (i) => runDeploy(deploy, i) },
  };

  /** Effective risk for a call (run_command depends on the command text). */
  function riskOf(name, input) {
    const t = tools[name];
    if (!t) return "review";
    if (t.risk === "dynamic") return classifyCommand(input?.command || "").level;
    return t.risk;
  }

  return { tools, riskOf, deploy };
}

async function runDeploy(deploy, { provider = "vercel", prod = false } = {}) {
  const adapter = deploy[provider];
  if (!adapter) return { ok: false, message: `Unknown deploy provider "${provider}". Available: ${Object.keys(deploy).join(", ")}.` };
  if (!adapter.connected) {
    return { ok: false, connected: false, message: `${provider} is not connected. Set ${adapter.requires.join(", ")} to enable real deployment.` };
  }
  return adapter.deploy({ prod });
}

/** The tool catalog shown to the model (name + when to use). */
export const TOOL_CATALOG = `
ultron.list_files {dir?} — list a directory.
ultron.read_file {file} — read a file's contents.
ultron.search_code {query, glob?} — search text across the workspace.
ultron.write_file {file, content} — create or overwrite a file.
ultron.edit_file {file, find, replace, all?} — exact-string replace in a file.
ultron.move_file {from, to} — move/rename a file.
ultron.delete_file {file} — delete a file (DANGEROUS; needs confirmation).
ultron.run_command {command, cwd?, timeoutMs?} — run a real shell command (risk depends on the command).
ultron.detect_project {} — detect framework, package manager, scripts.
ultron.install {} — install dependencies with the detected package manager.
ultron.build {} — run the project's build script.
ultron.test {} — run the project's test script.
ultron.lint {} — run lint or typecheck.
ultron.health_check {url} — real HTTP check of a deployed URL.
ultron.git_status {} / ultron.git_diff {staged?} / ultron.git_log {n?} — real git inspection.
ultron.git_init {} / ultron.git_commit {message} — init / commit (real hash reported).
ultron.deploy {provider, prod?} — deploy via a connected provider (fails clearly if not connected).
`.trim();
