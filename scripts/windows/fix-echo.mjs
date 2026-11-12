// JARVIS - finds and fixes what makes you hear your own voice on WhatsApp calls, makes JARVIS's voice
// clear and loud in the call, sends JARVIS a report of what it found/changed, then has JARVIS call you.
// Run by fix-echo.cmd (double-click). Only sound settings change; nothing is deleted.
//
// How a call should be wired (anything else = echo or a quiet JARVIS):
//   JARVIS's voice  -> CABLE Input  -> (cable) -> CABLE Output = WhatsApp's microphone -> your phone
//   your voice      -> WhatsApp     -> the laptop's real speakers -> JARVIS hears it (system sound)
// Echo happens when your voice is played INTO the cable (Windows' default speaker = the cable,
// WhatsApp's speaker = the cable, or "Listen to this device" looping a recording device back).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SVV = path.join(ROOT, "tools", "calls-audio", "SoundVolumeView.exe");
const WA_APPS = ["msedgewebview2.exe", "WhatsApp.exe", "WhatsApp.Root.exe"];

// ---------- pure parts (tested) ----------

/** SoundVolumeView's JSON export (often UTF-16 with a BOM) -> rows. */
export function parseSvv(buf) {
  let t = Buffer.isBuffer(buf) ? (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8")) : String(buf);
  t = t.replace(/^﻿/, "").trim();
  const rows = JSON.parse(t);
  return Array.isArray(rows) ? rows : [];
}

const g = (r, k) => String(r?.[k] ?? "");
const isCable = (r) => /cable|vb-audio|virtual/i.test(`${g(r, "Name")} ${g(r, "Device Name")}`);
const isMix = (r) => /stereo mix|what u hear|wave out|loopback/i.test(g(r, "Name"));
const isDefault = (r) => /render|capture/i.test(`${g(r, "Default")}${g(r, "Default Multimedia")}${g(r, "Default Communications")}`);
const idOf = (r) => g(r, "Command-Line Friendly ID") || g(r, "Item ID") || g(r, "Name");
const label = (r) => (r ? `"${g(r, "Name")}" (${g(r, "Device Name")})` : "none");

/** Look at the sound devices and say what's wrong + exactly which SoundVolumeView commands fix it. */
export function plan(rows) {
  const devs = rows.filter((r) => /^device$/i.test(g(r, "Type")) && /active/i.test(g(r, "Device State") || "active"));
  const render = devs.filter((r) => /render/i.test(g(r, "Direction")));
  const capture = devs.filter((r) => /capture/i.test(g(r, "Direction")));
  const cableIn = render.find((r) => isCable(r) && /cable input/i.test(g(r, "Name"))) ?? render.find(isCable);
  const cableOut = capture.find((r) => isCable(r) && /cable output/i.test(g(r, "Name"))) ?? capture.find(isCable);
  const realOut = render.filter((r) => !isCable(r));
  const realIn = capture.filter((r) => !isCable(r) && !isMix(r));
  // prefer what Windows already uses (if it's a real device), then anything called speakers / microphone
  const speaker = realOut.find(isDefault) ?? realOut.find((r) => /speaker|headphone/i.test(g(r, "Name"))) ?? realOut[0] ?? null;
  const mic = realIn.find(isDefault) ?? realIn.find((r) => /mic/i.test(g(r, "Name"))) ?? realIn[0] ?? null;

  const problems = [];
  const blockers = [];
  if (!cableIn || !cableOut) blockers.push("VB-Audio Virtual Cable isn't installed (no CABLE Input / CABLE Output). Run setup-calls-audio first.");
  if (!speaker) blockers.push("No real speakers / headphones found that are switched on.");
  for (const r of render.filter((r) => isCable(r) && isDefault(r)))
    problems.push(`ECHO CAUSE: Windows' default speaker is ${label(r)} - every sound, including your voice from WhatsApp, was being played into the call.`);
  for (const r of capture.filter((r) => (isCable(r) || isMix(r)) && isDefault(r)))
    problems.push(`Windows' default microphone was ${label(r)} - apps that use the default mic were recording the call/cable.`);
  const apps = rows.filter((r) => /^application$/i.test(g(r, "Type")) && WA_APPS.some((a) => g(r, "Process Path").toLowerCase().endsWith(a.toLowerCase())));
  for (const r of apps) {
    const where = `${g(r, "Device Name")} ${g(r, "Command-Line Friendly ID")} ${g(r, "Name")}`;
    if (/render/i.test(g(r, "Direction")) && /cable input/i.test(where)) problems.push(`ECHO CAUSE: WhatsApp was playing the call into "CABLE Input" (your voice went straight back to you).`);
    if (/capture/i.test(g(r, "Direction")) && !/cable output/i.test(where) && where.trim()) problems.push(`WhatsApp's microphone wasn't "CABLE Output" (${where.trim().slice(0, 80)}) - JARVIS's voice couldn't reach the call, the laptop mic could.`);
  }
  for (const r of [cableIn, cableOut].filter(Boolean)) {
    const v = Number.parseFloat(g(r, "Volume Percent"));
    if (/yes/i.test(g(r, "Muted"))) problems.push(`${label(r)} was muted - JARVIS would be silent on the call.`);
    else if (Number.isFinite(v) && v < 90) problems.push(`${label(r)} was at ${Math.round(v)}% - JARVIS sounded quiet on the call.`);
  }

  const cmds = [];
  if (!blockers.length) {
    const sp = idOf(speaker);
    cmds.push(["/SetDefault", sp, "all"]);
    if (mic) cmds.push(["/SetDefault", idOf(mic), "all"]);
    // "Listen to this device" plays a recording device out loud - on the cable / Stereo Mix / mic that loops sound back
    for (const r of capture) cmds.push(["/SetListenToThisDevice", idOf(r), "0"]);
    for (const a of WA_APPS) { cmds.push(["/SetAppDefault", idOf(cableOut), "all", a]); cmds.push(["/SetAppDefault", sp, "all", a]); }
    for (const r of [cableIn, cableOut]) { cmds.push(["/Unmute", idOf(r)]); cmds.push(["/SetVolume", idOf(r), "100"]); }
  }
  return { speaker, mic, cableIn, cableOut, problems: [...new Set(problems)], blockers, cmds };
}

/** After the fix: is everything wired the way calls need? */
export function verify(rows) {
  const p = plan(rows);
  return { ok: !p.blockers.length && !p.problems.some((x) => /ECHO CAUSE|muted|default speaker/i.test(x)), left: [...p.blockers, ...p.problems] };
}

// ---------- the laptop side ----------

const run = (file, args, timeout = 20_000) => new Promise((res) => {
  execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) => res({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}`.trim() }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (t = "") => console.log(t);

async function ensureSvv() {
  if (fs.existsSync(SVV)) return true;
  say("Downloading SoundVolumeView (free sound-settings tool from nirsoft.net)...");
  fs.mkdirSync(path.dirname(SVV), { recursive: true });
  const zip = path.join(path.dirname(SVV), "svv.zip");
  try {
    const r = await fetch("https://www.nirsoft.net/utils/soundvolumeview-x64.zip");
    if (!r.ok) throw new Error(String(r.status));
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    await run("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${path.dirname(SVV)}' -Force`], 60_000);
  } catch (e) { say(`Couldn't download it (${e.message}).`); }
  return fs.existsSync(SVV);
}

async function snapshot() {
  const f = path.join(os.tmpdir(), `jarvis-sound-${Date.now()}.json`);
  await run(SVV, ["/sjson", f]);
  try { return parseSvv(fs.readFileSync(f)); } catch { return []; } finally { fs.rmSync(f, { force: true }); }
}

/** Windows turns other sounds down by 80% when it sees a call - that made JARVIS's voice quiet. Set "Do nothing". */
async function noDucking() {
  const r = await run("reg.exe", ["add", "HKCU\\Software\\Microsoft\\Multimedia\\Audio", "/v", "UserDuckingPreference", "/t", "REG_DWORD", "/d", "3", "/f"]);
  return r.ok;
}

async function restartWhatsApp() {
  for (const p of ["WhatsApp.Root.exe", "WhatsApp.exe"]) await run("taskkill.exe", ["/F", "/IM", p]);
  await sleep(2500);
  spawn("cmd.exe", ["/c", "start", "", "whatsapp:"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  await sleep(9000); // let it open so Windows applies its per-app sound settings
}

function link() {
  try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, "operator", ".finder.json"), "utf8")); return j?.url && j?.token ? j : null; } catch { return null; }
}

async function jarvisUp(url) {
  try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(4000) }); return r.status < 500; } catch { return false; }
}

async function main() {
  if (process.platform !== "win32") { say("This fixes Windows sound settings - run it on the laptop (fix-echo.cmd)."); process.exit(1); }
  say("JARVIS sound check for calls");
  say("============================");
  if (!(await ensureSvv())) { say("SoundVolumeView is missing - run setup-calls-audio once, then this again."); process.exit(1); }

  say("1/5  Looking at your sound devices...");
  const before = await snapshot();
  if (!before.length) { say("Couldn't read the sound devices."); process.exit(1); }
  const p = plan(before);
  say(`     Speakers:   ${label(p.speaker)}`);
  say(`     Microphone: ${label(p.mic)}`);
  say(`     Cable:      ${p.cableIn && p.cableOut ? "installed" : "MISSING"}`);
  if (p.problems.length) { say("     Found:"); for (const x of p.problems) say(`       - ${x}`); } else say("     Nothing obviously wrong in the devices.");
  if (p.blockers.length) { for (const x of p.blockers) say(`     CAN'T FIX: ${x}`); }

  say("2/5  Fixing...");
  let failed = 0;
  for (const c of p.cmds) { const r = await run(SVV, c); if (!r.ok) failed++; }
  const ducking = await noDucking();
  say(`     ${p.cmds.length - failed}/${p.cmds.length} sound settings applied; "lower other sounds during calls" ${ducking ? "turned off" : "couldn't be changed"}.`);

  say("3/5  Restarting WhatsApp so it picks the settings up...");
  await restartWhatsApp();

  say("4/5  Checking again...");
  const v = verify(await snapshot());
  say(v.ok ? "     All good: WhatsApp hears only JARVIS, your voice stays on the speakers." : "     Still not right:");
  if (!v.ok) for (const x of v.left) say(`       - ${x}`);

  const report = [
    `Speakers: ${label(p.speaker)} | Mic: ${label(p.mic)} | Cable: ${p.cableIn && p.cableOut ? "yes" : "no"}`,
    `Found: ${p.problems.length ? p.problems.join(" / ") : "nothing obvious"}`,
    p.blockers.length ? `Blocked: ${p.blockers.join(" / ")}` : "",
    `Applied ${p.cmds.length - failed}/${p.cmds.length}; ducking off: ${ducking}`,
    `After: ${v.ok ? "OK" : v.left.join(" / ")}`,
    `Devices: ${before.filter((r) => /^device$/i.test(g(r, "Type"))).map((r) => `${g(r, "Direction")}:${g(r, "Name")}[${g(r, "Device Name")}]${isDefault(r) ? "*" : ""}${/yes/i.test(g(r, "Muted")) ? "(muted)" : ""}`).join("; ")}`,
  ].filter(Boolean).join("\n").slice(0, 11_500);

  say("5/5  Telling JARVIS and asking it to call you...");
  const l = link();
  if (!l) { say("     JARVIS isn't paired on this laptop yet (start JARVIS once), so no test call. The sound is fixed anyway."); return; }
  if (!(await jarvisUp(l.url))) {
    say("     JARVIS isn't running - starting it (a new window opens)...");
    spawn("cmd.exe", ["/c", "start", "JARVIS", path.join(ROOT, "start-jarvis.cmd")], { detached: true, stdio: "ignore", cwd: ROOT }).unref();
    for (let i = 0; i < 36 && !(await jarvisUp(l.url)); i++) await sleep(5000);
  }
  try {
    const r = await fetch(`${l.url}/api/prospects/calls/caller`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${l.token}` },
      body: JSON.stringify({ action: "audio_report", summary: (v.ok ? "Call sound fixed. " : "Call sound still has a problem. ") + (p.problems[0] ?? "").slice(0, 200), report, fixed: v.ok, callMe: true }),
    });
    const j = await r.json().catch(() => null);
    if (j?.data?.called) say("     Done. JARVIS will call you on WhatsApp in about 20-30 seconds - pick up and talk to it.");
    else say(`     Report sent, but JARVIS couldn't start the call: ${j?.data?.why ?? j?.error ?? r.status}`);
  } catch (e) { say(`     Couldn't reach JARVIS (${e.message}). Start JARVIS and say "give me a test call".`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`Something went wrong: ${e.message}`); process.exit(1); });
}
