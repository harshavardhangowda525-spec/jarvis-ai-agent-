import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { launchCandidates, staleBrowserCommand } from "../edith/src/browser.mjs";

/**
 * Windows specifics for ULTRON (the pure parts run everywhere; the real ones
 * run on a Windows machine — see .github/workflows/windows.yml).
 */
describe("finding a browser on Windows", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\Home\\AppData\\Local", PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)" };
  it("uses the installed Chrome, then Edge, each with its own profile", () => {
    const have = new Set(["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]);
    const c = launchCandidates({ platform: "win32", env, exists: (p: string) => have.has(p) });
    expect(c.slice(0, 2)).toEqual([
      { label: "Google Chrome", id: "chrome", opts: { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" } },
      { label: "Microsoft Edge", id: "msedge", opts: { executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" } },
    ]);
  });
  it("prefers a per-user Chrome, falls back to Playwright's lookup, and takes a quoted custom path", () => {
    const c = launchCandidates({ platform: "win32", env: { ...env, ULTRON_BROWSER_PATH: '"D:\\Apps\\Brave\\brave.exe"' }, exists: (p: string) => p.startsWith("C:\\Users\\Home\\AppData\\Local\\Google") });
    expect(c[0]).toEqual({ label: "D:\\Apps\\Brave\\brave.exe", id: "custom", opts: { executablePath: "D:\\Apps\\Brave\\brave.exe" } });
    expect(c[1].opts).toEqual({ executablePath: "C:\\Users\\Home\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe" });
    expect(c[2]).toEqual({ label: "Microsoft Edge", id: "msedge", opts: { channel: "msedge" } });
  });
  it("stops only leftover browsers that use JARVIS's own profile, without quoting the path into a command", () => {
    const dir = "C:\\Users\\O'Brien\\jarvis\\edith\\.browser-profile\\chrome";
    const cmd = staleBrowserCommand("win32", dir);
    expect(cmd.file).toBe("powershell.exe");
    expect(cmd.env).toEqual({ JARVIS_BROWSER_PROFILE: dir });
    expect(cmd.args.join(" ")).not.toContain("O'Brien");
    expect(cmd.args.join(" ")).toContain("CommandLine.Contains($d)");
  });
});

const WIN = process.platform === "win32";
const HAVE_DEPS = fs.existsSync("edith/node_modules/ws") && fs.existsSync("edith/node_modules/playwright-core");

describe.skipIf(!WIN || !HAVE_DEPS)("on a real Windows PC", () => {
  const cleanups: (() => unknown)[] = [];
  afterAll(async () => { for (const f of cleanups.reverse()) await f(); });

  it("finds Chrome or Edge where Windows installs them", () => {
    const c = launchCandidates();
    const exe = c.find((x) => x.opts.executablePath);
    expect(exe, JSON.stringify(c)).toBeTruthy();
    expect(fs.existsSync(exe!.opts.executablePath!)).toBe(true);
  });

  it("lists installed apps from the Start menu", async () => {
    const { listApps, findApp } = await import("../edith/src/apps.mjs");
    const apps = await listApps({ fresh: true });
    expect(apps.length).toBeGreaterThan(3);
    expect(findApp("file explorer", apps).app).toBeTruthy();
    expect(findApp("edge", apps).app?.name).toMatch(/edge/i);
  }, 60_000);

  it("opens a link in the default browser (rundll32, no shell)", async () => {
    const { openUrl } = await import("../edith/src/apps.mjs");
    expect(await openUrl("https://example.com/?a=1&b=2")).toMatchObject({ ok: true });
    expect(await openUrl("file:///C:/Windows/win.ini")).toMatchObject({ ok: false });
  }, 30_000);

  it("runs the live browser, and recovers when a leftover browser holds its profile", async () => {
    const root = path.join(os.tmpdir(), `ultron-win-${Date.now()}`);
    process.env.ULTRON_BROWSER_PROFILE = root;
    const first = launchCandidates()[0] as any;
    // a stray browser from an "earlier run" that was killed hard, holding the profile
    const dir = path.join(root, first.id);
    fs.mkdirSync(dir, { recursive: true });
    const exe = first.opts.executablePath;
    const stray = spawn(exe, ["--headless", `--user-data-dir=${dir}`, "--remote-debugging-port=9339", "about:blank"], { detached: true, stdio: "ignore" });
    stray.unref();
    await new Promise((r) => setTimeout(r, 4000));

    const site = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
      res.end(req.url!.startsWith("/next") ? `<title>Next</title>${decodeURIComponent(req.url!.split("q=")[1] ?? "")}` : `<title>Form</title><form action="/next"><input name=q autofocus style="position:absolute;left:0;top:0;width:300px;height:40px"></form>`);
    }).listen(0);
    cleanups.push(() => site.close());
    process.env.ULTRON_TOKEN = "win-test-token";
    const port = 7490 + Math.floor(Math.random() * 9);
    const { startServer } = await import("../edith/src/server.mjs");
    const { Workspace } = await import("../edith/src/workspace.mjs");
    const server: any = startServer({ port, ws: new Workspace(path.join(os.tmpdir(), `ultron-winws-${Date.now()}`)) });
    cleanups.push(async () => { const { closeBrowser } = await import("../edith/src/browser.mjs"); await closeBrowser(); server.httpServer.close(); server.wss.close(); });
    await new Promise((r) => setTimeout(r, 300));

    const { default: WebSocket } = await import("../edith/node_modules/ws/index.js" as string);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/browser?token=win-test-token`, { origin: "http://localhost:3000" });
    let frames = 0; const states: any[] = [];
    ws.on("message", (d: Buffer, bin: boolean) => { if (bin) frames++; else states.push(JSON.parse(d.toString())); });
    await new Promise((r) => ws.on("open", r));
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const until = async (f: () => boolean, ms = 45_000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 150)); return f(); };
    send({ t: "open", url: `http://127.0.0.1:${(site.address() as any).port}/`, width: 640, height: 400, dpr: 1.25 });
    const ok = await until(() => states.some((s) => s.t === "state" && s.title === "Form") && frames > 0);
    expect(ok, JSON.stringify(states.slice(-3))).toBe(true);
    send({ t: "mouse", type: "down", x: 20, y: 20, button: "left" }); send({ t: "mouse", type: "up", x: 20, y: 20, button: "left" });
    for (const ch of "win") send({ t: "key", type: "down", key: ch, keyCode: ch.toUpperCase().charCodeAt(0) });
    send({ t: "key", type: "down", key: "Enter", code: "Enter", keyCode: 13 });
    expect(await until(() => states.some((s) => s.t === "state" && /\/next\?q=win$/.test(s.url) && !s.loading)), JSON.stringify(states.slice(-3))).toBe(true);
    ws.close();
    delete process.env.ULTRON_BROWSER_PROFILE;
  }, 180_000);
});
