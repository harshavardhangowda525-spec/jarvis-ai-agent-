#!/usr/bin/env node
/**
 * npm run aston:check-groq — a REAL check of ASTON's Groq setup with your key:
 *   1. lists the models your Groq account can use and confirms GROQ_MODEL is one
 *   2. asks the model to call a tool (ASTON's agent workflows need tool calling)
 *   3. asks for JSON output (ASTON's alert summaries use it)
 * and prints your remaining free quota from Groq's rate-limit headers.
 *
 * Uses 2 small chat requests from your daily quota. The key is never printed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("="); if (eq < 1) continue;
    const k = s.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "").trim();
    if (!(k in out)) out[k] = v;
  }
  return out;
}
const env = { ...readEnv(path.join(ROOT, ".env")), ...readEnv(path.join(ROOT, ".env.local")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("GROQ_"))) };
const key = (env.GROQ_API_KEY ?? "").trim();
const model = (env.GROQ_MODEL ?? "").trim() || "openai/gpt-oss-120b";
const BASE = "https://api.groq.com/openai/v1";
const hide = (s) => String(s).replaceAll(key || "\u0000", "[key]").replace(/gsk_[A-Za-z0-9]{8,}/g, "[key]");

if (!key) { console.log("GROQ_API_KEY is not set (in .env or the environment). Get a free key at https://console.groq.com/keys"); process.exit(1); }

const quota = (h) => `requests left today: ${h.get("x-ratelimit-remaining-requests") ?? "?"}/${h.get("x-ratelimit-limit-requests") ?? "?"} · tokens left this minute: ${h.get("x-ratelimit-remaining-tokens") ?? "?"}/${h.get("x-ratelimit-limit-tokens") ?? "?"}`;
async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

let ok = true;
try {
  console.log(`ASTON · Groq check — model "${model}"\n`);
  const { res, body } = await call(`${BASE}/models`);
  if (!res.ok) { console.log(`✗ Groq refused the key (HTTP ${res.status}): ${hide(body?.error?.message ?? "")}`); process.exit(1); }
  const ids = (body.data ?? []).filter((m) => m.active !== false).map((m) => m.id).sort();
  const m = (body.data ?? []).find((x) => x.id === model);
  console.log(m ? `✓ Model is available (context window ${m.context_window ?? "?"} tokens)` : `✗ "${model}" is NOT in your account's model list. Available: ${ids.join(", ")}`);
  ok &&= !!m;

  const tool = await call(`${BASE}/chat/completions`, { method: "POST", body: JSON.stringify({
    model, max_tokens: 200, tool_choice: "required", ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
    messages: [{ role: "user", content: "Check the status of project Alpha using the tool." }],
    tools: [{ type: "function", function: { name: "project_status", description: "Get a project's status", parameters: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } } }],
  }) });
  const calls = tool.body?.choices?.[0]?.message?.tool_calls ?? [];
  console.log(tool.res.ok && calls.length ? `✓ Tool calling works (${calls[0].function.name}(${calls[0].function.arguments}))` : `✗ Tool calling failed (HTTP ${tool.res.status}): ${hide(tool.body?.error?.message ?? "no tool call returned")}`);
  ok &&= tool.res.ok && calls.length > 0;

  const json = await call(`${BASE}/chat/completions`, { method: "POST", body: JSON.stringify({
    model, max_tokens: 100, response_format: { type: "json_object" }, ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
    messages: [{ role: "system", content: 'Reply with JSON only: {"ok": true}' }, { role: "user", content: "ping" }],
  }) });
  let parsed = null;
  try { parsed = JSON.parse(json.body?.choices?.[0]?.message?.content ?? ""); } catch { /* not JSON */ }
  console.log(json.res.ok && parsed?.ok === true ? "✓ JSON output works" : `✗ JSON output failed (HTTP ${json.res.status}): ${hide(json.body?.error?.message ?? "unexpected reply")}`);
  ok &&= json.res.ok && parsed?.ok === true;
  console.log(`\nQuota: ${quota(json.res.headers)}`);
  console.log("Limits are per Groq organization (shared with JARVIS). Check console.groq.com/settings/limits for your plan.");
} catch (e) {
  ok = false;
  console.log(`✗ Could not reach Groq: ${hide(e?.message ?? e)}`);
}
console.log(ok ? "\nASTON can use Groq." : "\nFix the ✗ items above, then run this again.");
process.exit(ok ? 0 : 1);
