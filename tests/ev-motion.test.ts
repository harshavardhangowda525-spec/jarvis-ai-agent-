import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileMotion, MotionCodeError } from "@/lib/ev/motion/sandbox";
import { probeFrames, renderStill, renderVideo } from "@/lib/ev/motion/render";
import { ffmpegPath } from "@/lib/ev/daily/reel";

// a small, real motion graphic in the format Claude is asked for
const CODE = `
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
function frame(t) {
  const p = ease(t / 1.2), q = ease((t - 1) / 1.5);
  const r = 120 + 260 * p;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#3b2fb5"/></linearGradient></defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/>' +
    '<circle cx="' + (W / 2) + '" cy="' + (H * 0.4) + '" r="' + r + '" fill="#f59e0b" opacity="' + (0.25 + 0.6 * p) + '"/>' +
    '<text x="' + (W / 2) + '" y="' + (H * 0.72 + 80 * (1 - q)) + '" text-anchor="middle" font-family="Inter" font-weight="800" font-size="96" fill="#fff" opacity="' + q + '">Websites that sell</text>' +
    '</svg>';
}`;

describe("EV motion graphics: Claude's code in a sandbox", () => {
  it("runs frame(t) and returns SVG for any time", () => {
    const p = compileMotion(CODE, { width: 1080, height: 1920, seconds: 4 });
    expect(p.frame(0)).toMatch(/^<svg/);
    expect(p.frame(0)).not.toBe(p.frame(2));
  });

  it("can't reach Node, the host or create code, and can't hang", () => {
    const escapes = [
      "function frame(t){ return String(this.constructor.constructor('return process')()) }",
      "function frame(t){ return (function(){}).constructor('return process')() }",
      "function frame(t){ return String(globalThis.process) + typeof require }",
      "const f = frame; function frame(t){ return Object.getPrototypeOf(globalThis) === null ? '<svg>' + typeof process + '</svg>' : 'x' }",
    ];
    for (const code of escapes) {
      let out = "";
      try { out = compileMotion(code, { width: 10, height: 10, seconds: 1 }).frame(0); } catch (e) { expect(e).toBeInstanceOf(MotionCodeError); continue; }
      expect(out).not.toMatch(/object process|\[object process\]|function/);
    }
    expect(() => compileMotion("function frame(t){ while(true){} }", { width: 10, height: 10, seconds: 1 }).frame(0)).toThrow(/timed out|failed/);
    expect(() => compileMotion("const x = require('fs'); function frame(){}", { width: 10, height: 10, seconds: 1 })).toThrow(/plain drawing code/);
    expect(() => compileMotion("function frame(t){ return '<svg><image href=\"https://evil.example/x.png\"/></svg>' }", { width: 10, height: 10, seconds: 1 }).frame(0)).toThrow(/outside images/);
    expect(() => compileMotion("function frame(t){ return 'hello' }", { width: 10, height: 10, seconds: 1 }).frame(0)).toThrow(/<svg>/);
  });

  it("renders a real PNG still (in the helper process), and rejects a blank one", async () => {
    const r = await renderStill({ code: CODE, width: 1080, height: 1080, seconds: 4 }, 3, 1080);
    expect(r.png.subarray(1, 4).toString()).toBe("PNG");
    expect([r.width, r.height]).toEqual([1080, 1080]);
    const flat = "function frame(){ return '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"' + W + '\" height=\"' + H + '\"><rect width=\"100%\" height=\"100%\" fill=\"#000\"/></svg>' }";
    await expect(renderStill({ code: flat, width: 200, height: 200, seconds: 1 }, 0, 200)).rejects.toThrow(/blank/);
  }, 30_000);

  it("a renderer crash on Claude's frame is a reported error — JARVIS keeps running", async () => {
    // real code Claude wrote that made resvg panic (it took the whole server down before the helper process)
    const reply = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/motion-resvg-crash.json"), "utf8"));
    await expect(probeFrames({ code: reply.code, width: 1080, height: 1920, seconds: reply.seconds }, [0])).rejects.toThrow(/vector renderer crashed while drawing the frame at 0\.00s/);
    expect(process.exitCode ?? 0).toBe(0);
  }, 30_000);

  it("encodes a real 9:16 MP4 that moves", async () => {
    const r = await renderVideo({ code: CODE, width: 1080, height: 1920, seconds: 3 }, { fps: 30, renderWidth: 360, outWidth: 540, outHeight: 960 });
    expect(r.frames).toBe(90);
    expect(r.distinct).toBeGreaterThan(10);
    const f = path.join(os.tmpdir(), `ev-motion-${process.pid}.mp4`);
    fs.writeFileSync(f, r.mp4);
    let probe = "";
    try { execFileSync(ffmpegPath(), ["-i", f], { stdio: "pipe" }); } catch (e) { probe = String((e as { stderr?: Buffer }).stderr ?? ""); }
    fs.rmSync(f, { force: true });
    expect(probe).toMatch(/Video: h264/);
    expect(probe).toMatch(/540x960/);
    expect(probe).toMatch(/Duration: 00:00:03/);
  }, 60_000);

  it("refuses a 'video' where nothing moves", async () => {
    const still = { code: CODE.replace("function frame(t) {", "function frame(_) { const t = 3;"), width: 1080, height: 1920, seconds: 2 };
    await expect(renderVideo(still, { fps: 15, renderWidth: 180, outWidth: 180, outHeight: 320 })).rejects.toThrow(/doesn't move/);
  }, 30_000);
});

describe("Claude's answer → a checked animation", () => {
  it("gives Claude its exact error once, and accepts a code-only answer", async () => {
    const { designMotion } = await import("@/lib/ev/motion/claude");
    const asks: string[] = [];
    const replies = [
      JSON.stringify({ title: "Broken", seconds: 4, still: 3, code: "function frame(t){ return notDefined(t) }" }),
      "Fixed:\n```js\n" + CODE + "\n```",
    ];
    const r = await designMotion(async (_s, u) => { asks.push(u); return replies.shift()!; }, { brief: "Gym website offer", aspect: "portrait", seconds: 4, video: true });
    expect(r.repaired).toBe(true);
    expect(asks[1]).toMatch(/couldn't be rendered: frame\(0\.00\) failed: notDefined is not defined/);
    expect(r.motion).toMatchObject({ width: 1080, height: 1920, seconds: 4 });
    await expect(designMotion(async () => "Sorry, I can't.", { brief: "x", aspect: "square", seconds: 4, video: false })).rejects.toThrow(/didn't return the animation code/);
  }, 60_000);

  it("a renderer crash goes back to Claude to fix", async () => {
    const { designMotion } = await import("@/lib/ev/motion/claude");
    const crash = fs.readFileSync(path.join(__dirname, "fixtures/motion-resvg-crash.json"), "utf8");
    const asks: string[] = [];
    const replies = [crash, JSON.stringify({ title: "Fixed", seconds: 4, still: 3, code: CODE })];
    const r = await designMotion(async (_s, u) => { asks.push(u); return replies.shift()!; }, { brief: "Gym", aspect: "portrait", seconds: 4, video: true });
    expect(r.repaired).toBe(true);
    expect(asks[1]).toMatch(/vector renderer crashed/);
  });
});
