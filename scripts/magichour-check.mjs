#!/usr/bin/env node
/**
 * npm run ev:check-video — runs EV's Magic Hour video steps one by one with
 * your real key and prints Magic Hour's exact answer at each step, so an error
 * like "invalid url" can be pinned to the step that causes it.
 *
 *   npm run ev:check-video            → checks the key and the image upload (free)
 *   npm run ev:check-video -- --create → also starts one 3-second test video
 *                                        (uses Magic Hour credits) and waits for it
 *
 * The API key is never printed. Everything shown is also saved to
 * magichour-check.txt so it can be copied in one go.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREATE = process.argv.includes("--create");
const lines = [];
const say = (s = "") => { console.log(s); lines.push(s); };
const save = () => { try { fs.writeFileSync(path.join(ROOT, "magichour-check.txt"), lines.join("\n") + "\n"); } catch { /* read-only */ } };

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("="); if (eq < 1) continue;
    const k = s.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "").trim();
    if (!(k in out)) out[k] = v; // same as npm run local
  }
  return out;
}
const real = (v) => typeof v === "string" && v.trim() !== "" && !/^\[sensitive\]$/i.test(v.trim());
const env = { ...readEnv(path.join(ROOT, ".env")), ...readEnv(path.join(ROOT, ".env.local")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /MAGIC_?HOUR/.test(k))) };
const key = [env.MAGICHOUR_API_KEY, env.MAGIC_HOUR_API_KEY].find(real)?.trim() ?? "";
const base = (real(env.MAGICHOUR_BASE_URL) ? env.MAGICHOUR_BASE_URL.trim() : "https://api.magichour.ai").replace(/\/$/, "");
const short = (v, n = 500) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };
const hostOf = (u) => { try { return new URL(u).host; } catch { return "(not a URL)"; } };

async function call(method, p, body) {
  const url = `${base}${p}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, ok: res.ok, json, text };
  } catch (e) {
    return { status: 0, ok: false, json: null, text: `${e?.name ?? "Error"}: ${e?.message ?? e}${e?.cause ? ` (${e.cause.code ?? e.cause.message ?? e.cause})` : ""}` };
  }
}
const show = (label, r) => say(`   ${label}: HTTP ${r.status || "—"} ${r.ok ? "OK" : "FAILED"}\n     answer: ${short(r.json ?? r.text)}`);

say(`EV → Magic Hour video check  (${new Date().toISOString()})`);
say(`   JARVIS code: ${spawnSync("git log -1 --format=%h·%cs·%s", { cwd: ROOT, shell: true, encoding: "utf8" }).stdout?.trim() || "?"}`);
say(`   API address: ${base}${base === "https://api.magichour.ai" ? "" : "   ← NOT the normal address (MAGICHOUR_BASE_URL is set)"}`);
say(`   API key: ${key ? `set (${key.length} characters, from ${real(env.MAGICHOUR_API_KEY) ? "MAGICHOUR_API_KEY" : "MAGIC_HOUR_API_KEY"})` : "MISSING — add MAGICHOUR_API_KEY to .env.local"}`);
for (const k of ["MAGICHOUR_VIDEO_MODEL", "MAGICHOUR_VIDEO_RESOLUTION", "EV_MEDIA_PROVIDER"]) if (real(env[k])) say(`   ${k}=${env[k]}`);
if (!key) { save(); process.exit(1); }

// 1. an upload address for the start picture (free)
say("\n1. Ask Magic Hour for an upload address (/v1/files/upload-urls)");
const up = await call("POST", "/v1/files/upload-urls", { items: [{ type: "image", extension: "jpg" }] });
const item = up.json?.items?.[0];
// the upload link carries a temporary signature — show only where it points
if (item?.upload_url) up.json.items[0] = { ...item, upload_url: `https://${hostOf(item.upload_url)}/…` };
show("result", up);
if (!up.ok || !item?.upload_url || !item?.file_path) { say("\n→ Stopped: Magic Hour didn't give an upload address. The answer above says why."); save(); process.exit(1); }
say(`   file_path: ${item.file_path}   upload host: ${hostOf(item.upload_url)}`);

// 2. upload a test picture (a plain 720×1280 JPEG made here)
say("\n2. Upload a test picture to that address (PUT)");
let jpeg;
try {
  const sharp = createRequire(path.join(ROOT, "package.json"))("sharp");
  jpeg = await sharp({ create: { width: 720, height: 1280, channels: 3, background: { r: 30, g: 64, b: 175 } } }).jpeg({ quality: 85 }).toBuffer();
} catch (e) { say(`   couldn't make the test picture (${e.message}) — run npm install first.`); save(); process.exit(1); }
try {
  const put = await fetch(item.upload_url, { method: "PUT", body: new Uint8Array(jpeg), signal: AbortSignal.timeout(60_000) });
  const t = await put.text().catch(() => "");
  say(`   result: HTTP ${put.status} ${put.ok ? "OK" : "FAILED"}${t ? `\n     answer: ${short(t, 300)}` : ""}  (${jpeg.length} bytes)`);
  if (!put.ok) { say("\n→ Stopped: the upload was refused."); save(); process.exit(1); }
} catch (e) { say(`   result: FAILED — ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""}`); say("\n→ Stopped: this PC couldn't reach Magic Hour's upload storage."); save(); process.exit(1); }

if (!CREATE) {
  say("\n→ The key and the upload work. To test starting a video too (uses Magic Hour credits for one 3-second clip):");
  say("     npm run ev:check-video -- --create");
  save(); process.exit(0);
}

// 3. start an image-to-video from the uploaded picture (uses credits)
const body = {
  name: "EV check", end_seconds: 3,
  ...(real(env.MAGICHOUR_VIDEO_MODEL) ? { model: env.MAGICHOUR_VIDEO_MODEL.trim() } : {}),
  ...(real(env.MAGICHOUR_VIDEO_RESOLUTION) ? { resolution: env.MAGICHOUR_VIDEO_RESOLUTION.trim() } : {}),
  assets: { image_file_path: item.file_path },
  style: { prompt: "slow cinematic push-in" },
};
say(`\n3. Start image-to-video (/v1/image-to-video)\n   sent: ${short(body, 400)}`);
let start = await call("POST", "/v1/image-to-video", body);
show("result", start);
if (!start.ok) {
  say("\n   Trying a text-to-video instead (/v1/text-to-video) to see if it's the picture or everything:");
  const t2v = await call("POST", "/v1/text-to-video", { name: "EV check", end_seconds: 3, aspect_ratio: "9:16", style: { prompt: "slow cinematic push-in on a bakery counter" } });
  show("result", t2v);
  if (!t2v.ok) { say("\n→ Both kinds of video were refused — the answers above are Magic Hour's reasons."); save(); process.exit(1); }
  start = t2v;
}
const id = start.json?.id;
if (!id) { say("\n→ Magic Hour didn't return a project id."); save(); process.exit(1); }

// 4. wait for the render
say(`\n4. Waiting for project ${id} (up to 6 minutes)…`);
const t0 = Date.now();
let last = "";
while (Date.now() - t0 < 6 * 60_000) {
  const r = await call("GET", `/v1/video-projects/${encodeURIComponent(id)}`);
  const st = String(r.json?.status ?? `HTTP ${r.status}`);
  if (st !== last) { say(`   ${Math.round((Date.now() - t0) / 1000)}s: ${st}${r.json?.error ? ` — error: ${short(r.json.error, 300)}` : ""}`); last = st; }
  if (["complete", "error", "canceled"].includes(st)) {
    const url = r.json?.downloads?.[0]?.url ?? r.json?.download?.url ?? null;
    say(st === "complete" ? `\n→ Magic Hour made the video. Download host: ${hostOf(url)}` : `\n→ The render failed. Magic Hour's reason: ${short(r.json?.error ?? st, 400)}`);
    save(); process.exit(st === "complete" ? 0 : 1);
  }
  if (!r.ok && r.status >= 400 && r.status < 500) { say(`\n→ Magic Hour refused the status check: ${short(r.json ?? r.text)}`); save(); process.exit(1); }
  await new Promise((res) => setTimeout(res, 5_000));
}
say("\n→ Still rendering after 6 minutes (that alone isn't an error — it may still finish).");
save();
