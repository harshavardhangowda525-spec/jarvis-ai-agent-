/**
 * EDITH tool registry. Every tool maps to a REAL backend implementation
 * (filesystem / terminal / git / build). Each declares a risk level so the
 * agent and safety policy can gate execution. No tool returns fabricated data.
 */
import { makeFsTools } from "./tools/fs.mjs";
import { makeGitTools } from "./tools/git.mjs";
import { makeBuildTools, deploymentAdapters } from "./tools/build.mjs";
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
    "edith.list_files":   { risk: "safe",   run: (i) => fsT.list(i) },
    "edith.read_file":    { risk: "safe",   run: (i) => fsT.read(i) },
    "edith.search_code":  { risk: "safe",   run: (i) => fsT.search(i) },
    "edith.write_file":   { risk: "review", run: (i) => fsT.write(i) },
    "edith.edit_file":    { risk: "review", run: (i) => fsT.edit(i) },
    "edith.move_file":    { risk: "review", run: (i) => fsT.move(i) },
    "edith.delete_file":  { risk: "dangerous", run: (i) => fsT.remove(i) },

    "edith.run_command":  { risk: "dynamic", run: (i) => runCommand(ws, i.command, { cwdRel: i.cwd, timeoutMs: i.timeoutMs }) },
    "edith.detect_project": { risk: "safe", run: () => buildT.detect() },
    "edith.install":      { risk: "review", run: () => buildT.install() },
    "edith.build":        { risk: "safe",   run: () => buildT.build() },
    "edith.test":         { risk: "safe",   run: () => buildT.test() },
    "edith.lint":         { risk: "safe",   run: () => buildT.lint() },
    "edith.health_check": { risk: "safe",   run: (i) => buildT.healthCheck(i) },

    "edith.git_status":   { risk: "safe",   run: () => gitT.status() },
    "edith.git_diff":     { risk: "safe",   run: (i) => gitT.diff(i) },
    "edith.git_log":      { risk: "safe",   run: (i) => gitT.log(i) },
    "edith.git_init":     { risk: "review", run: () => gitT.init() },
    "edith.git_commit":   { risk: "review", run: (i) => gitT.commit(i) },

    "edith.deploy":       { risk: "dangerous", run: (i) => runDeploy(deploy, i) },
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
edith.list_files {dir?} — list a directory.
edith.read_file {file} — read a file's contents.
edith.search_code {query, glob?} — search text across the workspace.
edith.write_file {file, content} — create or overwrite a file.
edith.edit_file {file, find, replace, all?} — exact-string replace in a file.
edith.move_file {from, to} — move/rename a file.
edith.delete_file {file} — delete a file (DANGEROUS; needs confirmation).
edith.run_command {command, cwd?, timeoutMs?} — run a real shell command (risk depends on the command).
edith.detect_project {} — detect framework, package manager, scripts.
edith.install {} — install dependencies with the detected package manager.
edith.build {} — run the project's build script.
edith.test {} — run the project's test script.
edith.lint {} — run lint or typecheck.
edith.health_check {url} — real HTTP check of a deployed URL.
edith.git_status {} / edith.git_diff {staged?} / edith.git_log {n?} — real git inspection.
edith.git_init {} / edith.git_commit {message} — init / commit (real hash reported).
edith.deploy {provider, prod?} — deploy via a connected provider (fails clearly if not connected).
`.trim();
