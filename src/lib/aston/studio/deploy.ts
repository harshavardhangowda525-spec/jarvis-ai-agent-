import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { AstonProject, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formsRuntime } from "./forms-runtime";
import { siteDir, versionDir, writeMetadata } from "./store";
import { projectSpecSchema } from "./spec";

/**
 * Getting a website out of ASTON. `prepareDeploy` only checks and packages;
 * `deployProject` publishes — and only runs when you asked and confirmed. The
 * URL reported is the one Vercel itself returned; nothing is ever assumed.
 */

const SECRET_PATTERNS: [string, RegExp][] = [
  ["a Stripe secret key", /\bsk_(live|test)_[A-Za-z0-9]{10,}/], ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/], ["a Google API key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/], ["a Groq key", /\bgsk_[A-Za-z0-9]{20,}/], ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an OpenAI/Anthropic key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
];

/** Where deployed sites send their forms: JARVIS at a public address. */
export function formsBase(): string | null {
  const u = (process.env.ASTON_FORMS_URL?.trim() || env.appUrl).replace(/\/$/, "");
  return /^https:\/\//.test(u) && !/localhost|127\.0\.0\.1/.test(u) ? u : null;
}

async function files(p: AstonProject, n: number) {
  const root = siteDir(p, n);
  const out: Record<string, Uint8Array> = {};
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f); else out[path.relative(root, f).split(path.sep).join("/")] = await fs.readFile(f);
    }
  };
  await walk(root);
  return out;
}

export async function prepareDeploy(userId: string, id: string) {
  const p = await getDb().astonProject.findFirst({ where: { id, userId } });
  if (!p) throw new Error("That website project doesn't exist.");
  if (!p.currentVersion) throw new Error("There's no finished version to deploy yet.");
  const n = p.currentVersion;
  const spec = projectSpecSchema.safeParse(p.spec);
  const v = await getDb().astonProjectVersion.findUnique({ where: { projectId_n: { projectId: p.id, n } } });
  const tests = (v?.tests ?? null) as { passed?: number; failed?: number; checks?: { status: string; detail: string }[] } | null;
  const all = await files(p, n);
  const checks: { ok: boolean; text: string }[] = [];
  checks.push({ ok: v?.status === "ready", text: `Version ${n} is ${v?.status ?? "missing"}.` });
  checks.push(tests ? { ok: !tests.failed, text: tests.failed ? `${tests.failed} browser test(s) still failing: ${(tests.checks ?? []).filter((c) => c.status === "fail").slice(0, 3).map((c) => c.detail).join(" | ")}` : `Browser tests: ${tests.passed} passed, none failing.` } : { ok: false, text: "This version hasn't been browser-tested." });
  const leaks: string[] = [];
  for (const [f, b] of Object.entries(all)) {
    if (!/\.(html|css|js|json|txt|svg|xml)$/.test(f)) continue;
    const t = Buffer.from(b).toString("utf8");
    for (const [what, re] of SECRET_PATTERNS) if (re.test(t)) leaks.push(`${what} in ${f}`);
  }
  checks.push({ ok: !leaks.length, text: leaks.length ? `Possible secrets in the site files: ${leaks.join(", ")} — remove them before deploying.` : "No secrets found in the site files." });
  const hasForms = !!spec.success && spec.data.forms.length > 0;
  const fb = formsBase();
  if (hasForms) checks.push(fb ? { ok: true, text: `Forms will send to JARVIS at ${fb}.` } : { ok: false, text: "The site has forms, but JARVIS isn't at a public https address, so a deployed site's forms couldn't reach it. Set APP_URL (or ASTON_FORMS_URL) to your JARVIS on Vercel." });
  const envs = spec.success ? spec.data.envVars : [];
  if (envs.length) checks.push({ ok: false, text: `Integrations still to configure: ${envs.map((e) => `${e.name} (${e.why})`).join("; ")}.` });
  // the package: the site + forms.js pointing at the public handler
  if (hasForms && fb) all["_aston/forms.js"] = strToU8(formsRuntime(`${fb}/api/aston/forms/${p.previewToken}`));
  const zipDir = path.join(versionDir(p, n), "deploy");
  await fs.mkdir(zipDir, { recursive: true });
  const zipFile = path.join(zipDir, `${p.slug}-v${String(n).padStart(3, "0")}.zip`);
  await fs.writeFile(zipFile, zipSync(all, { level: 9 }));
  const provider = process.env.VERCEL_TOKEN?.trim() ? "Vercel" : null;
  checks.push(provider ? { ok: true, text: "Deployment provider: Vercel (VERCEL_TOKEN is set)." } : { ok: false, text: "No deployment provider is set up. Add VERCEL_TOKEN (a Vercel access token) to .env.local to deploy from ASTON — or upload the zip to any static host." });
  return { version: n, ready: checks.every((c) => c.ok), checks, zip: zipFile, zipUrl: `/api/aston/projects/${p.id}/file?v=${n}&path=${encodeURIComponent(`deploy/${path.basename(zipFile)}`)}`, provider, files: Object.keys(all).length };
}

export async function deployProject(userId: string, id: string) {
  const prep = await prepareDeploy(userId, id);
  const blocking = prep.checks.filter((c) => !c.ok && !/^Integrations still to configure/.test(c.text));
  if (blocking.length) throw new Error(`Not deployed: ${blocking.map((c) => c.text).join(" ")}`);
  const token = process.env.VERCEL_TOKEN!.trim();
  const p = (await getDb().astonProject.findFirst({ where: { id, userId } }))!;
  const all = await files(p, prep.version);
  const fb = formsBase();
  if (fb) all["_aston/forms.js"] = strToU8(formsRuntime(`${fb}/api/aston/forms/${p.previewToken}`));
  const team = process.env.VERCEL_TEAM_ID?.trim();
  const q = team ? `?teamId=${encodeURIComponent(team)}` : "";
  const r = await fetch(`https://api.vercel.com/v13/deployments${q}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `aston-${p.slug}`.slice(0, 90), target: "production", projectSettings: { framework: null }, files: Object.entries(all).map(([file, b]) => ({ file, data: Buffer.from(b).toString("base64"), encoding: "base64" })) }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await r.json().catch(() => ({})) as { id?: string; url?: string; readyState?: string; error?: { message?: string } };
  if (!r.ok || !j.id) throw new Error(`Vercel refused the deployment: ${j.error?.message ?? `HTTP ${r.status}`}`);
  let state = j.readyState ?? "QUEUED", url = j.url ?? "";
  for (let i = 0; i < 60 && !["READY", "ERROR", "CANCELED"].includes(state); i++) {
    await new Promise((res) => setTimeout(res, 3000));
    const s = await fetch(`https://api.vercel.com/v13/deployments/${j.id}${q}`, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch(() => null) as { readyState?: string; url?: string } | null;
    if (s?.readyState) state = s.readyState;
    if (s?.url) url = s.url;
  }
  const live = url ? await fetch(`https://${url}/`, { method: "GET", signal: AbortSignal.timeout(20_000) }).then((x) => x.status).catch(() => 0) : 0;
  const deploy = { status: state === "READY" ? "deployed" : state.toLowerCase(), provider: "Vercel", url: url ? `https://${url}` : null, id: j.id, version: prep.version, at: new Date().toISOString(), httpCheck: live };
  await getDb().astonProject.update({ where: { id: p.id }, data: { deploy: deploy as unknown as Prisma.InputJsonValue, ...(state === "READY" ? { state: "deployed", stateNote: deploy.url } : {}) } });
  await writeMetadata(p.id);
  if (state !== "READY") throw new Error(`Vercel reports the deployment as ${state}${deploy.url ? ` (${deploy.url})` : ""}.`);
  return deploy;
}
