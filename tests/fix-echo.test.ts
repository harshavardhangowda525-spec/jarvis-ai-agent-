import { describe, it, expect } from "vitest";
import { parseSvv, plan, verify } from "../scripts/windows/fix-echo.mjs";
import { louder, wavFromFloat32 } from "@/lib/voice/local-tts";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

const dev = (Name: string, dir: "Render" | "Capture", deviceName: string, extra: Record<string, string> = {}) => ({
  Name, Type: "Device", Direction: dir, "Device Name": deviceName, "Device State": "Active", Default: "", "Default Multimedia": "", "Default Communications": "",
  "Command-Line Friendly ID": `${deviceName}\\Device\\${Name}\\${dir}`, Muted: "No", "Volume Percent": "100.0%", ...extra,
});
const base = () => [
  dev("Speakers / Headphones", "Render", "Realtek Audio"),
  dev("CABLE Input", "Render", "VB-Audio Virtual Cable"),
  dev("Microphone Array", "Capture", "Realtek Audio", { Default: "Capture" }),
  dev("Stereo Mix", "Capture", "Realtek Audio"),
  dev("CABLE Output", "Capture", "VB-Audio Virtual Cable"),
];

describe("fix-echo: finding what loops your voice back", () => {
  it("reads SoundVolumeView's UTF-16 JSON export", () => {
    const rows = [{ Name: "Speakers" }];
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(rows), "utf16le")]);
    expect(parseSvv(buf)).toEqual(rows);
  });
  it("names the cable as Windows' default speaker as the echo cause and switches to the real speakers (by its exact id, whatever it's called)", () => {
    const rows = base();
    rows[1].Default = "Render";
    const p = plan(rows);
    expect(p.problems.join(" ")).toMatch(/ECHO CAUSE: Windows' default speaker is "CABLE Input"/);
    expect(p.speaker?.Name).toBe("Speakers / Headphones");
    expect(p.mic?.Name).toBe("Microphone Array");
    expect(p.cmds[0]).toEqual(["/SetDefault", "Realtek Audio\\Device\\Speakers / Headphones\\Render", "all"]);
    expect(p.cmds).toContainEqual(["/SetAppDefault", "VB-Audio Virtual Cable\\Device\\CABLE Output\\Capture", "all", "msedgewebview2.exe"]);
    expect(p.cmds).toContainEqual(["/SetListenToThisDevice", "Realtek Audio\\Device\\Stereo Mix\\Capture", "0"]);
    expect(p.cmds).toContainEqual(["/SetVolume", "VB-Audio Virtual Cable\\Device\\CABLE Input\\Render", "100"]);
    expect(verify(rows).ok).toBe(false);
    rows[1].Default = ""; rows[0].Default = "Render";
    expect(verify(rows).ok).toBe(true);
  });
  it("spots WhatsApp playing into the cable, and a muted / quiet cable", () => {
    const rows: Record<string, string>[] = [...base(), { Name: "WhatsApp", Type: "Application", Direction: "Render", "Device Name": "VB-Audio Virtual Cable", "Command-Line Friendly ID": "VB-Audio Virtual Cable\\Device\\CABLE Input\\Render\\msedgewebview2.exe", "Process Path": "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\msedgewebview2.exe" }];
    rows[4].Muted = "Yes"; rows[1]["Volume Percent"] = "40%";
    const t = plan(rows).problems.join(" | ");
    expect(t).toMatch(/WhatsApp was playing the call into "CABLE Input"/);
    expect(t).toMatch(/CABLE Output.*muted/);
    expect(t).toMatch(/CABLE Input.*40%/);
  });
  it("won't touch anything when the cable isn't installed", () => {
    const p = plan(base().filter((r) => !/CABLE/.test(r.Name)));
    expect(p.blockers.join(" ")).toMatch(/isn't installed/);
    expect(p.cmds).toEqual([]);
  });
});

describe("JARVIS's voice: even loudness", () => {
  it("raises a quiet sentence (up to ×4) to just under full scale and leaves a loud one alone", () => {
    const quiet = wavFromFloat32(Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.3), 22050);
    const up = louder(quiet);
    let peak = 0; for (let i = 44; i < up.length; i += 2) peak = Math.max(peak, Math.abs(up.readInt16LE(i)));
    expect(peak / 32767).toBeGreaterThan(0.85); expect(peak / 32767).toBeLessThanOrEqual(0.9);
    const loud = wavFromFloat32(Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.95), 22050);
    expect(louder(loud)).toBe(loud);
    expect(louder(Buffer.from("not a wav"))).toEqual(Buffer.from("not a wav"));
  });
});

import { getDb, isDbConfigured } from "@/lib/db";
import { beforeAll, afterAll } from "vitest";
const d = isDbConfigured ? describe : describe.skip;
d("fix-echo: the report reaches JARVIS and it calls only you (integration)", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `echo-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  it("stores the report, queues a test call to you, and refuses a wrong key", async () => {
    const P = await import("@/lib/prospects/service");
    const Ph = await import("@/lib/phone/service");
    const token = await P.pairFinder(userId);
    await Ph.saveSettings(userId, { enabled: true, mode: "laptop", toNumber: "+91 99808 01231", callMethod: "whatsapp" });
    const { POST } = await import("@/app/api/prospects/calls/caller/route");
    const body = { action: "audio_report", summary: "Call sound fixed.", report: "Found: ECHO CAUSE ...", fixed: true, callMe: true };
    const r = await POST(new Request("http://x/api/prospects/calls/caller", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(await r.json()).toMatchObject({ ok: true, data: { saved: true, called: true } });
    expect(await getDb().phoneEvent.count({ where: { userId, kind: "test", status: "queued" } })).toBe(1);
    const ev = await getDb().activityEvent.findFirst({ where: { userId, action: { contains: "echo fix" } } });
    expect(ev?.result).toMatch(/Call sound fixed/);
    const bad = await POST(new Request("http://x/api/prospects/calls/caller", { method: "POST", headers: { authorization: "Bearer jmf_wrong", "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(bad.status).toBe(401);
  });
});
