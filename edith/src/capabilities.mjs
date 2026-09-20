/**
 * Real capability check — actual command probes, not assumptions. Kept separate
 * from the WS server so it can run without the `ws` dependency.
 */
import { execSync } from "node:child_process";
import { hasProvider, providerName } from "./provider.mjs";
import { deploymentAdapters } from "./tools/build.mjs";

export function capabilityCheck(ws) {
  const probe = (cmd) => {
    try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
    catch { return null; }
  };
  const node = probe("node -v");
  const npm = probe("npm -v");
  const git = probe("git --version");
  const python = probe("python3 --version") || probe("python --version");
  const docker = probe("docker --version");
  let isRepo = false;
  try {
    isRepo = execSync("git rev-parse --is-inside-work-tree", { cwd: ws.root, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() === "true";
  } catch { /* not a repo */ }
  const deploy = deploymentAdapters(ws);
  return {
    aiProvider: { ok: hasProvider(), detail: providerName() },
    workspace: { ok: true, detail: ws.root },
    terminal: { ok: true, detail: "ready" },
    node: { ok: !!node, detail: node || "not found" },
    npm: { ok: !!npm, detail: npm || "not found" },
    git: { ok: !!git, detail: git || "not found", repo: isRepo },
    python: { ok: !!python, detail: python || "not found" },
    docker: { ok: !!docker, detail: docker || "not installed" },
    deploy: Object.fromEntries(Object.entries(deploy).map(([k, v]) => [k, { ok: v.connected, requires: v.requires }])),
  };
}
