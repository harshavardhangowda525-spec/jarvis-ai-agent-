/**
 * Builds RUBEN's standalone parts from the JARVIS source (one esbuild run, a
 * few seconds; skipped when nothing changed):
 *   dist/ui.js      — the island screen (React)
 *   dist/server.cjs — RUBEN's own backend (CRM + voice), run inside Electron
 * Called by `npm run rubin`. Prisma isn't bundled: it loads from JARVIS's
 * node_modules (the same generated client JARVIS uses).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DIST = path.join(HERE, "dist");

function sourcesHash() {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|cjs|js|json|prisma)$/.test(e.name)) { h.update(p); h.update(fs.readFileSync(p)); }
    }
  };
  for (const d of ["src/lib", "src/components/island", "desktop/rubin/standalone"]) walk(path.join(ROOT, d));
  h.update(fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma")));
  return h.digest("hex");
}

export async function buildStandalone({ force = false, log = console.log } = {}) {
  const hash = sourcesHash();
  const stamp = path.join(DIST, ".stamp");
  if (!force && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === hash && fs.existsSync(path.join(DIST, "server.cjs")) && fs.existsSync(path.join(DIST, "ui.js"))) return false;
  log("RUBEN: building its screen and backend (a few seconds)…");
  const esbuild = createRequire(path.join(ROOT, "package.json"))("esbuild");
  const common = {
    absWorkingDir: ROOT, bundle: true, logLevel: "error", legalComments: "none",
    alias: { "@": path.join(ROOT, "src"), "server-only": path.join(ROOT, "tests", "stubs", "server-only.ts") },
    tsconfig: path.join(ROOT, "tsconfig.json"),
  };
  await esbuild.build({
    ...common, entryPoints: [path.join(HERE, "standalone", "ui.tsx")], outfile: path.join(DIST, "ui.js"),
    platform: "browser", format: "iife", target: "chrome120", jsx: "automatic", minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await esbuild.build({
    ...common, entryPoints: [path.join(HERE, "standalone", "server.ts")], outfile: path.join(DIST, "server.cjs"),
    platform: "node", format: "cjs", target: "node20",
    // Prisma (native engine) and Electron load at runtime; the rest is bundled
    external: ["@prisma/client", ".prisma/client", "electron"],
    // dist/ sits inside desktop/rubin — let it find JARVIS's node_modules
    banner: { js: `module.paths.push(${JSON.stringify(path.join(ROOT, "node_modules"))});` },
  });
  fs.writeFileSync(stamp, hash);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildStandalone({ force: process.argv.includes("--force") }).then((b) => console.log(b ? "built" : "up to date")).catch((e) => { console.error(e.message); process.exit(1); });
}
