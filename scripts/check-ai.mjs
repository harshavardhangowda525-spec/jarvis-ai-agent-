#!/usr/bin/env node
/**
 * Check JARVIS's AI keys from .env.local — whether each one works and how much of today's limit is left.
 * Keys are only sent to their own provider; they are never printed.   node scripts/check-ai.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
try {
  for (const l of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { console.log(".env.local wasn't found in the JARVIS folder."); process.exit(1); }

const t = (ms) => AbortSignal.timeout(ms);
const say = (name, ok, msg) => console.log(`${ok ? "OK  " : "FAIL"}  ${name.padEnd(11)} ${msg}`);

async function groq() {
  const k = env.GROQ_API_KEY; if (!k) return say("Groq", false, "no GROQ_API_KEY in .env.local");
  const h = { Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
  const ms = await fetch("https://api.groq.com/openai/v1/models", { headers: h, signal: t(20000) });
  if (!ms.ok) return say("Groq", false, `${ms.status} ${(await ms.text()).slice(0, 160)}`);
  const ids = (await ms.json()).data.map((m) => m.id);
  const model = env.GROQ_MODEL || env.AI_MODEL || ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"].find((x) => ids.includes(x)) || ids[0];
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: h, signal: t(30000), body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "Say OK" }] }) });
  const rem = ["x-ratelimit-remaining-requests", "x-ratelimit-limit-requests", "x-ratelimit-remaining-tokens", "x-ratelimit-limit-tokens"].map((x) => r.headers.get(x));
  if (!r.ok) return say("Groq", false, `${r.status} ${(await r.text()).slice(0, 200)}`);
  say("Groq", true, `key works (${model}) — requests left today: ${rem[0] ?? "?"}/${rem[1] ?? "?"}, tokens left this minute: ${rem[2] ?? "?"}/${rem[3] ?? "?"}`);
  const vision = ids.filter((id) => /vision|llama-4|scout|maverick/i.test(id));
  console.log(`      Groq vision-capable models on your account: ${vision.join(", ") || "none"}${vision.length ? "  (put one in .env.local as GROQ_VISION_MODEL=… to use it as a vision backup)" : ""}`);
}
async function gemini() {
  const k = env.GEMINI_API_KEY; if (!k) return say("Gemini", false, "no GEMINI_API_KEY in .env.local (needed for laptop control / calls by sight)");
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, signal: t(60000), body: JSON.stringify({ model: env.GEMINI_MODEL || "gemini-3.6-flash", max_tokens: 50, reasoning_effort: "low", messages: [{ role: "user", content: "Say OK" }] }) });
  if (!r.ok) return say("Gemini", false, `${r.status} ${(await r.text()).slice(0, 200)}`);
  say("Gemini", true, "key works (laptop control / calls by sight use it)");
}
async function openrouter() {
  const k = env.OPENROUTER_API_KEY; if (!k) return say("OpenRouter", true, "not set (optional)");
  const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${k}` }, signal: t(20000) });
  if (!r.ok) return say("OpenRouter", false, `${r.status} — this key is invalid; remove OPENROUTER_API_KEY from .env.local or replace it`);
  const d = (await r.json()).data ?? {};
  say("OpenRouter", true, `key works${d.limit_remaining != null ? ` — credit left: ${d.limit_remaining}` : ""}`);
}
console.log("Checking JARVIS's AI keys (keys are never shown)…\n");
for (const f of [groq, gemini, openrouter]) { try { await f(); } catch (e) { say(f.name, false, e.message); } }
console.log("\nMain brain: " + (env.AI_PROVIDER || "(auto)") + (env.CLAUDE_FOR_ALL_AGENTS === "1" ? " — Claude on this PC is ON for all agents (slow); run use-groq.cmd to switch" : ""));
