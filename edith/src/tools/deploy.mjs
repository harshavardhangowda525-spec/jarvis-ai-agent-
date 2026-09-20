/**
 * Real deployment providers for EDITH. Each adapter:
 *   1. is "connected" only when its credential env var is actually present,
 *   2. runs the provider's REAL CLI to deploy the current workspace,
 *   3. extracts the live deployment URL from the CLI output,
 *   4. VERIFIES the deployment with real HTTP(S) checks (status, latency, SSL),
 *   5. returns a structured, honest result — never a fabricated success.
 *
 * If the token is missing, the adapter returns { ok:false, connected:false }
 * with the exact env var to set. Nothing is simulated.
 */
import { runCommand } from "./terminal.mjs";

const read = (n) => (process.env[n] ?? "").trim();

/** Pull the deployment URL out of a provider CLI's stdout/stderr. */
export function extractDeployUrl(text) {
  if (!text) return null;
  // Prefer an explicit "Production:"/"Preview:" line, else the last https URL.
  const labeled = text.match(/(?:Production|Preview|Website|Deployed to|URL):\s*(https:\/\/[^\s]+)/i);
  if (labeled) return clean(labeled[1]);
  const all = text.match(/https:\/\/[^\s)"']+/g);
  if (!all?.length) return null;
  // Vercel prints the canonical deployment URL last; skip inspect/dashboard links.
  const candidates = all.filter((u) => !/vercel\.com\/(?!.*\.vercel\.app)/.test(u) && !/\/inspect\b/.test(u));
  return clean((candidates.length ? candidates : all).pop());
}
const clean = (u) => u.replace(/[.,);]+$/, "");

/**
 * Verify a deployed URL is actually live. Retries a few times because a fresh
 * deployment can take a few seconds to route. Returns real status + latency.
 */
export async function verifyDeployment(url, { attempts = 5, delayMs = 3000 } = {}) {
  if (!url) return { ok: false, error: "No deployment URL to verify." };
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const started = Date.now();
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) });
      last = {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        latencyMs: Date.now() - started,
        https: url.startsWith("https://"),
        finalUrl: res.url,
        attempt: i + 1,
      };
      if (res.ok) return last;
    } catch (err) {
      last = { ok: false, status: null, error: String(err.message), latencyMs: Date.now() - started, attempt: i + 1 };
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last ?? { ok: false, error: "Verification failed." };
}

export function deploymentAdapters(ws) {
  return {
    vercel: {
      connected: !!read("VERCEL_TOKEN"),
      requires: ["VERCEL_TOKEN"],
      async deploy({ prod = false } = {}) {
        const token = read("VERCEL_TOKEN");
        if (!token) return { ok: false, connected: false, provider: "vercel", message: "Vercel not connected — set VERCEL_TOKEN." };
        const flags = [prod ? "--prod" : "", "--yes", `--token ${token}`].filter(Boolean).join(" ");
        const run = await runCommand(ws, `npx --yes vercel ${flags}`, { timeoutMs: 600_000 });
        const url = extractDeployUrl(`${run.stdout}\n${run.stderr}`);
        if (!run.ok) {
          return { ok: false, provider: "vercel", deployed: false, url, exitCode: run.exitCode,
            message: `Vercel deploy failed (exit ${run.exitCode}). ${firstError(run.stderr)}`, output: tail(run.stderr || run.stdout) };
        }
        if (!url) {
          return { ok: false, provider: "vercel", deployed: true, url: null,
            message: "Deploy command succeeded but no URL was found in the output.", output: tail(run.stdout) };
        }
        const verify = await verifyDeployment(url);
        return {
          ok: verify.ok,
          provider: "vercel",
          deployed: true,
          prod,
          url,
          verify,
          message: verify.ok
            ? `Deployed to ${url} and verified live (HTTP ${verify.status}, ${verify.latencyMs}ms${verify.https ? ", HTTPS" : ""}).`
            : `Deployed to ${url} but verification did not return 200 (${verify.status ?? verify.error}). The build may still be propagating.`,
        };
      },
    },

    netlify: {
      connected: !!read("NETLIFY_AUTH_TOKEN"),
      requires: ["NETLIFY_AUTH_TOKEN"],
      async deploy({ prod = false } = {}) {
        if (!read("NETLIFY_AUTH_TOKEN")) return { ok: false, connected: false, provider: "netlify", message: "Netlify not connected — set NETLIFY_AUTH_TOKEN." };
        const run = await runCommand(ws, `npx --yes netlify deploy ${prod ? "--prod" : ""} --json`, { timeoutMs: 600_000 });
        let url = null;
        try { url = JSON.parse(run.stdout)?.deploy_url || JSON.parse(run.stdout)?.url; } catch { url = extractDeployUrl(run.stdout); }
        if (!run.ok) return { ok: false, provider: "netlify", deployed: false, message: `Netlify deploy failed (exit ${run.exitCode}). ${firstError(run.stderr)}`, output: tail(run.stderr) };
        const verify = url ? await verifyDeployment(url) : { ok: false, error: "no url" };
        return { ok: verify.ok, provider: "netlify", deployed: true, url, verify,
          message: url ? `Deployed to ${url}${verify.ok ? ` (verified HTTP ${verify.status})` : " (not yet verified)"}.` : "Deployed, but no URL was returned." };
      },
    },

    cloudflare: {
      connected: !!read("CLOUDFLARE_API_TOKEN"),
      requires: ["CLOUDFLARE_API_TOKEN"],
      async deploy() {
        if (!read("CLOUDFLARE_API_TOKEN")) return { ok: false, connected: false, provider: "cloudflare", message: "Cloudflare not connected — set CLOUDFLARE_API_TOKEN." };
        const run = await runCommand(ws, `npx --yes wrangler deploy`, { timeoutMs: 600_000 });
        const url = extractDeployUrl(`${run.stdout}\n${run.stderr}`);
        if (!run.ok) return { ok: false, provider: "cloudflare", deployed: false, message: `Cloudflare deploy failed (exit ${run.exitCode}). ${firstError(run.stderr)}`, output: tail(run.stderr) };
        const verify = url ? await verifyDeployment(url) : { ok: false, error: "no url" };
        return { ok: verify.ok, provider: "cloudflare", deployed: true, url, verify,
          message: url ? `Deployed to ${url}${verify.ok ? ` (verified HTTP ${verify.status})` : ""}.` : "Deployed via wrangler." };
      },
    },
  };
}

function firstError(stderr) {
  const line = String(stderr || "").split("\n").find((l) => /error|failed|missing|not found/i.test(l));
  return (line || "").trim().slice(0, 200);
}
function tail(text) { return String(text || "").split("\n").slice(-12).join("\n"); }
