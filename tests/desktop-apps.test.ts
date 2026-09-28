import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { findApp, matchScore, normalizeName } from "../edith/src/apps.mjs";
import { parseOpenApp } from "@/lib/local-apps";

// The kind of list Windows' Get-StartApps returns (names only here).
const WIN = [
  "Spotify", "Uninstall Spotify", "WhatsApp", "Visual Studio Code", "Word", "Excel", "PowerPoint", "Outlook", "Google Chrome", "Microsoft Edge",
  "Calculator", "Notepad", "Paint", "File Explorer", "Settings", "Task Manager", "Control Panel", "Discord", "Steam", "VLC media player",
  "Windows PowerShell", "Command Prompt", "Terminal", "Microsoft Teams", "Snipping Tool", "Microsoft Store", "Clock", "Adobe Photoshop 2024",
  "OBS Studio", "Android Studio", "Zoom Workplace", "Telegram Desktop", "Python 3.12 Documentation", "Git Bash",
].map((name) => ({ name, launch: { file: "explorer.exe", args: [] } }));
const pick = (q: string) => findApp(q, WIN).app?.name ?? null;

describe("finding the installed app you meant", () => {
  it.each([
    ["spotify", "Spotify"], ["Spotify", "Spotify"], ["whatsapp", "WhatsApp"], ["whats app", "WhatsApp"],
    ["vs code", "Visual Studio Code"], ["vscode", "Visual Studio Code"], ["visual studio code", "Visual Studio Code"],
    ["chrome", "Google Chrome"], ["edge", "Microsoft Edge"], ["word", "Word"], ["ms word", "Word"], ["ppt", "PowerPoint"],
    ["calculator", "Calculator"], ["calc", "Calculator"], ["notepad", "Notepad"], ["file explorer", "File Explorer"], ["this pc", "File Explorer"],
    ["windows settings", "Settings"], ["task manager", "Task Manager"], ["cmd", "Command Prompt"], ["photoshop", "Adobe Photoshop 2024"],
    ["obs", "OBS Studio"], ["zoom", "Zoom Workplace"], ["telegram", "Telegram Desktop"], ["teams", "Microsoft Teams"], ["store", "Microsoft Store"],
    ["spotfy", "Spotify"], ["discrod", "Discord"], ["vlc", "VLC media player"],
  ])("%s → %s", (q, want) => { expect(pick(q)).toBe(want); });

  it("never picks an uninstaller or docs", () => {
    expect(matchScore("spotify", "Uninstall Spotify")).toBe(0);
    expect(pick("python")).toBeNull(); // only "Python 3.12 Documentation" is listed
  });
  it("says so when it isn't installed, with near misses", () => {
    expect(findApp("netflix", WIN)).toEqual({ app: null, suggestions: [] });
    expect(findApp("stem", WIN).app?.name).toBe("Steam");
  });
  it("normalises names", () => {
    expect(normalizeName("Microsoft® Word 2019 (64-bit)")).toBe("word");
    expect(normalizeName("The Spotify App")).toBe("spotify");
  });
});

describe("open-app commands", () => {
  it.each([
    ["open spotify", ["spotify"]], ["Jarvis, open Spotify.", ["Spotify"]], ["launch VS Code", ["VS Code"]],
    ["could you open the calculator app please", ["calculator"]], ["start whatsapp and spotify", ["whatsapp", "spotify"]],
    ["open word, excel and powerpoint", ["word", "excel", "powerpoint"]], ["open file explorer on my PC", ["file explorer"]],
    ["fire up steam", ["steam"]],
  ])("%s", (t, want) => { expect(parseOpenApp(t)).toEqual(want); });

  it.each([
    "open youtube.com", "open amazon website", "open gmail in the browser", "open amazon and search for shoes",
    "open EV", "open DARWIN", "open humanoid view", "open settings", "open today's content", "enable gesture mode",
    "what time is it", "search youtube for lofi", "open youtube in a new tab", "open this link https://example.com",
    "open the link", "open that link", "open https://github.com", "open spotify in the browser",
  ])("%s → not an app", (t) => { expect(parseOpenApp(t)).toBeNull(); });
});

describe("ULTRON /apps endpoint", () => {
  let server: any; let token = ""; const port = 7430 + Math.floor(Math.random() * 20);
  beforeAll(async () => {
    process.env.ULTRON_TOKEN = "apps-test-token";
    const { startServer } = await import("../edith/src/server.mjs");
    const { Workspace } = await import("../edith/src/workspace.mjs");
    const ws = new Workspace(path.join(os.tmpdir(), `ultron-apps-${Date.now()}`));
    server = startServer({ port, ws });
    token = server.token;
    await new Promise((r) => setTimeout(r, 300));
  });
  afterAll(() => { server?.httpServer?.close(); server?.wss?.close(); delete process.env.ULTRON_TOKEN; delete process.env.ULTRON_APPS; });

  const open = (headers: Record<string, string>, name = "definitely-not-an-installed-app-xyz") =>
    fetch(`http://127.0.0.1:${port}/apps/open`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ name }) });

  it("refuses without the pairing token or from other websites", async () => {
    expect((await open({})).status).toBe(401);
    expect((await open({ Authorization: `Bearer ${token}`, Origin: "https://evil.example.com" })).status).toBe(403);
  });
  it("reports honestly when the app isn't installed (nothing is launched)", async () => {
    const r = await open({ Authorization: `Bearer ${token}`, Origin: "http://localhost:3000" });
    expect(r.status).toBe(404);
    const j = await r.json();
    expect(j).toMatchObject({ ok: false, notFound: true });
    expect(j.message).toMatch(/couldn't find/);
  });
  it("lists installed apps to the paired app only", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/apps`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    expect(Array.isArray((await r.json()).apps)).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/apps`)).status).toBe(401);
  });
  it("opens only real web links in the default browser, and only for the paired app", async () => {
    const post = (url: string, headers: Record<string, string> = { Authorization: `Bearer ${token}` }) =>
      fetch(`http://127.0.0.1:${port}/open-url`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ url }) });
    expect((await post("https://example.com/", {})).status).toBe(401);
    expect((await post("https://example.com/", { Authorization: `Bearer ${token}`, Origin: "https://evil.example.com" })).status).toBe(403);
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ms-settings:", "https://user:pw@example.com/", "not a url"]) {
      const r = await post(bad);
      expect(r.status).toBe(409);
      expect((await r.json()).message).toMatch(/isn't a web address/);
    }
  });
  it("can be switched off", async () => {
    process.env.ULTRON_APPS = "off";
    const r = await open({ Authorization: `Bearer ${token}` }, "spotify");
    expect(r.status).toBe(409);
    expect((await r.json()).message).toMatch(/turned off/);
    delete process.env.ULTRON_APPS;
  });
});

import { parseExec } from "../edith/src/apps.mjs";
describe("linux .desktop launch lines", () => {
  it("strips field codes and respects quotes, never via a shell", () => {
    expect(parseExec("/usr/bin/code --unity-launch %F")).toEqual({ file: "/usr/bin/code", args: ["--unity-launch"] });
    expect(parseExec('"/opt/My App/app" --flag %U')).toEqual({ file: "/opt/My App/app", args: ["--flag"] });
    expect(parseExec("sh -c 'rm -rf ~'")).toBeNull();
    expect(parseExec("")).toBeNull();
  });
});

import { safeWebUrl } from "../edith/src/apps.mjs";
describe("ULTRON web links", () => {
  it("accepts http(s) only, normalised, never a shell-ish string", () => {
    expect(safeWebUrl("https://www.youtube.com/results?search_query=lo fi")).toBeNull(); // raw space → not a URL we pass on
    expect(safeWebUrl("https://www.youtube.com/results?search_query=lo%20fi")).toBe("https://www.youtube.com/results?search_query=lo%20fi");
    expect(safeWebUrl("http://localhost:3000/dashboard")).toBe("http://localhost:3000/dashboard");
    expect(safeWebUrl('https://a.com/"&calc')).toBe("https://a.com/%22&calc");
    for (const bad of ["javascript:alert(1)", "file:///C:/Windows", "ftp://x.com", "data:text/html,hi", "", "https://u:p@x.com"]) expect(safeWebUrl(bad)).toBeNull();
  });
});

import { planOpen, isInstalledApp } from "@/lib/local-apps";
describe("app or website — decided instantly", () => {
  const apps = ["Spotify", "Visual Studio Code", "Google Chrome", "Calculator", "WhatsApp"];
  it("an installed app wins; a site that isn't installed opens as a tab now", () => {
    const p = planOpen(["spotify", "youtube", "gmail", "chrome", "calculator"], { installed: apps, ultronKnown: true });
    expect(p.map((x) => x.kind)).toEqual(["app", "web", "web", "app", "app"]);
    expect(p[1].site?.url).toBe("https://www.youtube.com/");
  });
  it("no ULTRON on this browser → every known site is a tab straight away", () => {
    expect(planOpen(["spotify", "netflix"], { installed: null, ultronKnown: false }).every((x) => x.kind === "web")).toBe(true);
    expect(planOpen(["spotify"], { installed: [], ultronKnown: true })[0].kind).toBe("web"); // ULTRON offline
  });
  it("still asks ULTRON for names that aren't websites, or before the list has loaded", () => {
    expect(planOpen(["notepad"], { installed: [], ultronKnown: false })[0]).toMatchObject({ kind: "app", site: null });
    expect(planOpen(["spotify"], { installed: null, ultronKnown: true })[0].kind).toBe("app");
  });
  it("matches the way ULTRON does", () => {
    expect(isInstalledApp("vs code", apps)).toBe(true);
    expect(isInstalledApp("youtube", apps)).toBe(false);
    expect(isInstalledApp("youtube", null)).toBeNull();
  });
});
