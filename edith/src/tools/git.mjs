/**
 * Real git tools (via the terminal). Reports actual git output — never a
 * fabricated commit hash. Commit/push are REVIEW/DANGEROUS per the safety policy.
 */
import { runCommand } from "./terminal.mjs";

export function makeGitTools(ws) {
  const git = (args, opts) => runCommand(ws, `git ${args}`, { timeoutMs: 60_000, ...opts });

  return {
    async isRepo() {
      const r = await git("rev-parse --is-inside-work-tree");
      return r.ok && r.stdout.trim() === "true";
    },
    async status() {
      const r = await git("status --short --branch");
      return { ok: r.ok, output: r.stdout || "(clean)", error: r.ok ? null : r.stderr };
    },
    async diff({ staged = false } = {}) {
      const r = await git(`diff ${staged ? "--staged" : ""} --stat`);
      const full = await git(`diff ${staged ? "--staged" : ""}`);
      return { ok: r.ok, stat: r.stdout, patch: full.stdout.slice(0, 20_000), error: r.ok ? null : r.stderr };
    },
    async log({ n = 10 } = {}) {
      const r = await git(`log --oneline -n ${Number(n) || 10}`);
      return { ok: r.ok, output: r.stdout, error: r.ok ? null : r.stderr };
    },
    async init() {
      const r = await git("init");
      return { ok: r.ok, output: r.stdout || r.stderr };
    },
    async add({ paths = "." } = {}) {
      const r = await git(`add ${paths}`);
      return { ok: r.ok, error: r.ok ? null : r.stderr };
    },
    async commit({ message }) {
      if (!message) throw new Error("A commit message is required.");
      await git("add -A");
      const r = await git(`commit -m ${JSON.stringify(message)}`);
      // Report the REAL resulting hash, or the real reason it didn't commit.
      const head = await git("rev-parse --short HEAD");
      return { ok: r.ok, hash: r.ok ? head.stdout.trim() : null, output: r.stdout || r.stderr };
    },
    async branch() {
      const r = await git("branch --show-current");
      return { ok: r.ok, branch: r.stdout.trim(), error: r.ok ? null : r.stderr };
    },
  };
}
