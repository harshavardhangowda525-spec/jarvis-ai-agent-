import { describe, it, expect } from "vitest";
import { chooseMode, frameAllowed, officialEmbed } from "@/lib/web-embed";
import { addressToUrl } from "@/components/console/browser-popup";
import { keyEventParams, modifierMask, mouseEventParams, viewSize } from "../edith/src/browser.mjs";

const APP = "https://jarvis-ai.vercel.app";

describe("official embeds", () => {
  it("YouTube videos, shorts, youtu.be, playlists", () => {
    expect(officialEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s")?.url).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=65");
    expect(officialEmbed("https://youtu.be/dQw4w9WgXcQ")?.url).toContain("/embed/dQw4w9WgXcQ");
    expect(officialEmbed("https://m.youtube.com/shorts/abcdefghijk")?.url).toContain("/embed/abcdefghijk");
    expect(officialEmbed("https://www.youtube.com/playlist?list=PL1234_abc")?.url).toBe("https://www.youtube.com/embed/videoseries?list=PL1234_abc");
    expect(officialEmbed("https://www.youtube.com/")).toBeNull(); // the home page isn't a player
    expect(officialEmbed("https://www.youtube.com/results?search_query=lofi")).toBeNull();
  });
  it("Maps, Spotify, Vimeo", () => {
    expect(officialEmbed("https://www.google.com/maps/search/coffee%20near%20MG%20Road")?.url).toBe("https://maps.google.com/maps?output=embed&q=coffee%20near%20MG%20Road");
    expect(officialEmbed("https://www.google.com/maps/")?.label).toBe("Google Maps");
    expect(officialEmbed("https://open.spotify.com/intl-en/track/4uLU6hMCjMI75M1A2tKUQC")?.url).toBe("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(officialEmbed("https://open.spotify.com/")).toBeNull();
    expect(officialEmbed("https://vimeo.com/76979871")?.url).toBe("https://player.vimeo.com/video/76979871?autoplay=1");
    expect(officialEmbed("javascript:alert(1)")).toBeNull();
  });
});

describe("may JARVIS frame a site?", () => {
  it("honours X-Frame-Options", () => {
    expect(frameAllowed({ xFrameOptions: "DENY" }, APP)).toBe(false);
    expect(frameAllowed({ xFrameOptions: "SAMEORIGIN" }, APP)).toBe(false);
    expect(frameAllowed({ xFrameOptions: "ALLOW-FROM https://x.com" }, APP)).toBe(false);
    expect(frameAllowed({}, APP)).toBe(true);
  });
  it("honours CSP frame-ancestors (which wins over X-Frame-Options)", () => {
    expect(frameAllowed({ csp: "default-src 'self'; frame-ancestors 'none'" }, APP)).toBe(false);
    expect(frameAllowed({ csp: "frame-ancestors 'self' https://*.google.com" }, APP)).toBe(false);
    expect(frameAllowed({ csp: "frame-ancestors *", xFrameOptions: "DENY" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors https:" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors https://*.vercel.app" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors https://jarvis-ai.vercel.app:443" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors http://localhost:3000" }, "http://localhost:3000")).toBe(true);
    expect(frameAllowed({ csp: "script-src 'self'" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors *, frame-ancestors 'none'" }, APP)).toBe(false); // every policy must allow
  });
  it("picks the best way to show it", () => {
    expect(chooseMode({ embed: true, frameable: false, live: false, mixedContent: false })).toBe("embed");
    expect(chooseMode({ embed: false, frameable: true, live: true, mixedContent: false })).toBe("frame");
    expect(chooseMode({ embed: false, frameable: false, live: true, mixedContent: false })).toBe("live");
    expect(chooseMode({ embed: false, frameable: true, live: true, mixedContent: true })).toBe("live");
    expect(chooseMode({ embed: false, frameable: false, live: false, mixedContent: false })).toBe("preview");
    expect(chooseMode({ embed: false, frameable: null, live: false, mixedContent: false })).toBe("frame");
  });
});

describe("the address bar", () => {
  it("takes addresses, site names or a search", () => {
    expect(addressToUrl("github.com/vercel")).toBe("https://github.com/vercel");
    expect(addressToUrl("youtube")).toBe("https://www.youtube.com/");
    expect(addressToUrl("best pizza near me")).toBe("https://www.google.com/search?q=best%20pizza%20near%20me");
    expect(addressToUrl("  ")).toBeNull();
    expect(addressToUrl("127.0.0.1:4601/next?q=typed in bar")).toBe("http://127.0.0.1:4601/next?q=typed%20in%20bar");
    expect(addressToUrl("google maps")).toBe("https://www.google.com/maps/");
  });
});

describe("live browser input (ULTRON)", () => {
  it("turns key presses into real key events", () => {
    expect(keyEventParams({ type: "down", key: "a", code: "KeyA", keyCode: 65 })).toMatchObject({ type: "keyDown", text: "a", windowsVirtualKeyCode: 65 });
    expect(keyEventParams({ type: "down", key: "Enter", code: "Enter", keyCode: 13 })).toMatchObject({ type: "keyDown", text: "\r" });
    expect(keyEventParams({ type: "down", key: "Backspace", keyCode: 8 })).toMatchObject({ type: "rawKeyDown", text: "", windowsVirtualKeyCode: 8 });
    expect(keyEventParams({ type: "down", key: "a", keyCode: 65, ctrl: true })).toMatchObject({ type: "rawKeyDown", text: "", modifiers: 2 });
    expect(keyEventParams({ type: "up", key: "a", keyCode: 65 })).toMatchObject({ type: "keyUp", text: "" });
    expect(modifierMask({ alt: true, shift: true })).toBe(9);
  });
  it("turns pointer events into mouse events inside the page", () => {
    const size = { width: 800, height: 600 };
    expect(mouseEventParams({ type: "down", x: 10.4, y: 20, button: "left", clicks: 2 }, size)).toMatchObject({ type: "mousePressed", x: 10, y: 20, button: "left", buttons: 1, clickCount: 2 });
    expect(mouseEventParams({ type: "move", x: 5000, y: -3, buttons: 1 }, size)).toMatchObject({ type: "mouseMoved", x: 799, y: 0, button: "left", buttons: 1 });
    expect(mouseEventParams({ type: "up", x: 1, y: 1, button: "right" }, size)).toMatchObject({ type: "mouseReleased", button: "right", buttons: 0 });
    expect(mouseEventParams({ type: "wheel", x: 1, y: 1, dy: 120 }, size)).toMatchObject({ type: "mouseWheel", deltaY: 120 });
    expect(viewSize(99999, 10)).toEqual({ width: 2560, height: 240 });
  });
});

import { pageMeta } from "@/lib/web-check";
describe("preview card info", () => {
  it("reads og tags, title and icon", () => {
    const html = `<html><head><title>Fallback &amp; title</title><meta property="og:title" content="Real &quot;Title&quot;"><meta name="description" content="A page."><meta property="og:image" content="/img/card.png"><link rel="shortcut icon" href="/fav.png"><meta property="og:site_name" content="Example"></head></html>`;
    expect(pageMeta(html, "https://example.com/a/b")).toEqual({ title: 'Real "Title"', description: "A page.", image: "https://example.com/img/card.png", siteName: "Example", icon: "https://example.com/fav.png" });
    expect(pageMeta("<title>Only &amp; title</title>", "https://x.org/").title).toBe("Only & title");
    expect(pageMeta('<meta property="og:image" content="javascript:alert(1)">', "https://x.org/").image).toBeNull();
  });
});

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
// Linux here: the sandbox's Chromium. Windows: whatever ULTRON finds (Chrome, else Edge).
const CHROME = process.env.ULTRON_BROWSER_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : process.platform === "win32" ? "auto" : "");
const HAVE_DEPS = fs.existsSync("edith/node_modules/ws") && fs.existsSync("edith/node_modules/playwright-core");
describe.skipIf(!CHROME || !HAVE_DEPS)("ULTRON live browser socket (real Chromium)", () => {
  let server: any; let site: http.Server; const port = 7460 + Math.floor(Math.random() * 20);
  beforeAll(async () => {
    process.env.ULTRON_TOKEN = "browser-test-token";
    if (CHROME !== "auto") process.env.ULTRON_BROWSER_PATH = CHROME;
    process.env.ULTRON_BROWSER_PROFILE = path.join(os.tmpdir(), `ultron-browser-${Date.now()}`);
    site = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html", "X-Frame-Options": "DENY" });
      res.end(req.url!.startsWith("/next") ? `<title>Next</title>${decodeURIComponent(req.url!.split("q=")[1] ?? "")}` : `<title>Form</title><form action="/next"><input name=q autofocus style="position:absolute;left:0;top:0;width:300px;height:40px"></form>`);
    }).listen(0);
    const { startServer } = await import("../edith/src/server.mjs");
    const { Workspace } = await import("../edith/src/workspace.mjs");
    server = startServer({ port, ws: new Workspace(path.join(os.tmpdir(), `ultron-bws-${Date.now()}`)) });
    await new Promise((r) => setTimeout(r, 300));
  });
  afterAll(async () => {
    const { closeBrowser } = await import("../edith/src/browser.mjs");
    await closeBrowser();
    server?.httpServer?.close(); server?.wss?.close(); site?.close();
    delete process.env.ULTRON_TOKEN; delete process.env.ULTRON_BROWSER_PATH; delete process.env.ULTRON_BROWSER_PROFILE;
  });

  it("streams real frames, takes clicks and typing, and refuses other websites", async () => {
    const { default: WebSocket } = await import("../edith/node_modules/ws/index.js" as string);
    const bad = new WebSocket(`ws://127.0.0.1:${port}/browser?token=browser-test-token`, { origin: "https://evil.example.com" });
    expect(await new Promise((r) => bad.on("close", (c: number) => r(c)))).toBe(4003);
    const wrongToken = new WebSocket(`ws://127.0.0.1:${port}/browser?token=nope`);
    expect(await new Promise((r) => wrongToken.on("close", (c: number) => r(c)))).toBe(4001);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/browser?token=browser-test-token`, { origin: "http://localhost:3000" });
    let frames = 0; const states: any[] = []; let frame: Buffer | null = null;
    ws.on("message", (d: Buffer, bin: boolean) => { if (bin) { frames++; frame = d; } else states.push(JSON.parse(d.toString())); });
    await new Promise((r) => ws.on("open", r));
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const until = async (f: () => boolean, ms = 15000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100)); return f(); };
    const sitePort = (site.address() as any).port;
    send({ t: "open", url: `http://127.0.0.1:${sitePort}/`, width: 640, height: 400, dpr: 1 });
    expect(await until(() => states.some((s) => s.t === "state" && s.title === "Form") && frames > 0)).toBe(true);
    expect(frame!.subarray(0, 2).toString("hex")).toBe("ffd8"); // a JPEG
    send({ t: "mouse", type: "down", x: 20, y: 20, button: "left" }); send({ t: "mouse", type: "up", x: 20, y: 20, button: "left" });
    for (const ch of "hi") send({ t: "key", type: "down", key: ch, keyCode: ch.toUpperCase().charCodeAt(0) });
    send({ t: "key", type: "down", key: "Enter", code: "Enter", keyCode: 13 });
    expect(await until(() => states.some((s) => s.t === "state" && /\/next\?q=hi$/.test(s.url) && !s.loading))).toBe(true);
    send({ t: "nav", url: "file:///etc/passwd" });
    expect(await until(() => states.some((s) => s.t === "error" && /isn't a web address/.test(s.message)))).toBe(true);
    ws.close();
  }, 60_000);
});
