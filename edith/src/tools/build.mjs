/**
 * Real build / test / dev-server / deploy detection and execution.
 * Detects the project's actual tooling from package.json and runs the real
 * scripts. Deploy adapters are declared but marked "not connected" until real
 * provider credentials exist — never a fake deployment.
 */
import fs from "node:fs";
import { runCommand } from "./terminal.mjs";

function readPkg(ws) {
  try { return JSON.parse(fs.readFileSync(ws.resolve("package.json"), "utf8")); }
  catch { return null; }
}

/** Detect framework + package manager + available scripts. */
export function detectProject(ws) {
  const pkg = readPkg(ws);
  const files = fs.readdirSync(ws.root).catch?.() ?? safeReaddir(ws.root);
  const has = (f) => files.includes(f);
  const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("package-lock.json") ? "npm"
    : has("requirements.txt") || has("pyproject.toml") ? "pip" : pkg ? "npm" : "unknown";
  let framework = "unknown";
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  if (deps.next) framework = "next";
  else if (deps.vite) framework = "vite";
  else if (deps["react-scripts"]) framework = "cra";
  else if (deps.express || deps.fastify) framework = "node-server";
  else if (has("requirements.txt") || has("pyproject.toml")) framework = "python";
  else if (pkg) framework = "node";
  return { pkg: !!pkg, packageManager: pm, framework, scripts: pkg?.scripts ?? {}, files: files.slice(0, 50) };
}

function safeReaddir(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

export function makeBuildTools(ws) {
  const run = (cmd, timeoutMs) => runCommand(ws, cmd, { timeoutMs });

  return {
    detect: () => detectProject(ws),

    async install() {
      const { packageManager } = detectProject(ws);
      const cmd = packageManager === "pip" ? "pip install -r requirements.txt"
        : packageManager === "unknown" ? null : `${packageManager} install`;
      if (!cmd) throw new Error("No recognizable package manifest to install from.");
      return run(cmd, 300_000);
    },

    async build() {
      const { scripts, packageManager } = detectProject(ws);
      if (!scripts.build) throw new Error('No "build" script found in package.json.');
      return run(`${packageManager} run build`, 300_000);
    },

    async test() {
      const { scripts, packageManager } = detectProject(ws);
      if (!scripts.test) throw new Error('No "test" script found in package.json.');
      return run(`${packageManager} test`, 300_000);
    },

    async lint() {
      const { scripts, packageManager } = detectProject(ws);
      if (scripts.lint) return run(`${packageManager} run lint`, 180_000);
      if (scripts.typecheck) return run(`${packageManager} run typecheck`, 180_000);
      throw new Error('No "lint" or "typecheck" script found.');
    },

    /**
     * HTTP health check against a real URL. Returns actual status + latency.
     */
    async healthCheck({ url }) {
      if (!url) throw new Error("A URL is required for a health check.");
      const started = Date.now();
      try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) });
        return {
          url, ok: res.ok, status: res.status, statusText: res.statusText,
          latencyMs: Date.now() - started,
          https: url.startsWith("https://"),
        };
      } catch (err) {
        return { url, ok: false, status: null, error: String(err.message), latencyMs: Date.now() - started };
      }
    },
  };
}

