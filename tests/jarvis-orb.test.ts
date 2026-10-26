import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as M from "../edith/src/app-match.mjs";

const req = createRequire(import.meta.url);
const P = req("../desktop/jarvis-orb/planner.cjs");
const { createExecutor } = req("../desktop/jarvis-orb/executor.cjs");
const L = req("../desktop/jarvis-orb/lib.cjs");

describe("JARVIS 2.0: understanding desktop commands", () => {
  const steps = (t: string, ctx = {}) => P.plan(t, ctx)?.steps;
  it("asks which app for 'open apps', then takes the names", () => {
    expect(P.plan("JARVIS, open apps.")).toEqual({ clarify: "Which application would you like to open?", pending: "open" });
    expect(steps("Chrome and Spotify", { pending: "open" })).toEqual([{ kind: "open_app", app: "Chrome" }, { kind: "open_app", app: "Spotify" }]);
    expect(P.plan("Chrome and Spotify")).toBeNull(); // without the question, a bare name isn't a command
  });
  it("splits multi-step commands without splitting app lists", () => {
    expect(steps("Open Chrome and Claude Code")).toEqual([{ kind: "open_app", app: "Chrome" }, { kind: "open_app", app: "Claude Code" }]);
    expect(steps("Open Chrome, open my business website, and then open Claude Code")).toEqual([
      { kind: "open_app", app: "Chrome" }, { kind: "url", site: "business website" }, { kind: "open_app", app: "Claude Code" }]);
    expect(steps("minimize chrome and then open notepad")).toEqual([{ kind: "window", op: "minimize", app: "chrome" }, { kind: "open_app", app: "notepad" }]);
  });
  it("knows projects, folders, files, web addresses and windows", () => {
    expect(steps("Switch to my Infinity Web & Apps project")).toEqual([{ kind: "project", name: "Infinity Web & Apps" }]);
    expect(steps("Switch to Claude Code")).toEqual([{ kind: "focus", app: "Claude Code" }]);
    expect(steps("Find my JARVIS project")).toEqual([{ kind: "find", query: "JARVIS", type: "project", latest: false }]);
    expect(steps("Search for my latest website project")).toEqual([{ kind: "find", query: "website", type: "project", latest: true }]);
    expect(steps("Open my Downloads folder")).toEqual([{ kind: "folder", folder: "downloads" }]);
    expect(steps("Open this file with the correct application")).toEqual([{ kind: "open_last" }]);
    expect(steps("Create a new project folder called Acme Gym")).toEqual([{ kind: "new_folder", name: "Acme Gym", where: null, project: true }]);
    expect(steps("put chrome and vs code side by side")).toEqual([{ kind: "arrange", left: "chrome", right: "vs code" }]);
    expect(steps("open youtube.com")).toEqual([{ kind: "url", url: "https://youtube.com" }]);
    expect(steps("press ctrl+s in word")).toEqual([{ kind: "key", keys: "^s", label: "ctrl+s", app: "word", safe: false }]);
    expect(steps("show my apps")).toEqual([{ kind: "show_apps" }]);
  });
  it("stop, pause and resume win over everything else in the sentence", () => {
    expect(steps("JARVIS, stop")).toEqual([{ kind: "stop" }]);
    expect(steps("open chrome and then stop")).toEqual([{ kind: "stop" }]);
    expect(steps("pause automation")).toEqual([{ kind: "pause" }]);
  });
  it("leaves questions to JARVIS's brain and never runs half-understood plans", () => {
    expect(P.plan("what is the weather today")).toBeNull();
    expect(P.plan("open chrome and tell me a joke")).toBeNull();
    expect(P.plan("Hey JARVIS")).toMatchObject({ wake: true });
  });
});

/** A fake Windows desktop: installed apps, open windows, and a record of every OS call. */
function fakeDesktop(o: { apps?: string[]; windows?: { id: number; name: string; title: string; active?: boolean }[]; confirm?: boolean; launchOpens?: boolean } = {}) {
  const calls: unknown[] = [];
  let wins = (o.windows ?? []).map((w) => ({ active: false, ...w }));
  const apps = (o.apps ?? ["Google Chrome", "Visual Studio Code", "Spotify", "Notepad", "Claude"]).map((name) => ({ name, launch: { file: "explorer.exe", args: [name] } }));
  const opened: string[] = [];
  const asked: string[] = [];
  const ex = createExecutor({
    platform: "win32", sleep: async () => {}, homedir: () => "C:\\Users\\Home",
    apps: { listApps: async () => apps, findApp: M.findApp, matchScore: M.matchScore, normalizeName: M.normalizeName,
      launch: async (a: { name: string }) => { calls.push({ launch: a.name }); if (o.launchOpens !== false) wins.push({ id: 900 + wins.length, name: a.name.split(" ").pop()!.toLowerCase(), title: a.name, active: true }); return { ok: true }; } },
    win: async (a: { op: string; id?: number }) => {
      calls.push(a);
      if (a.op === "list") return wins;
      if (a.op === "focus") { wins = wins.map((w) => ({ ...w, active: w.id === a.id })); return { ok: true }; }
      return { ok: true };
    },
    confirm: async (q: string) => { asked.push(q); return o.confirm ?? false; },
    exists: () => true, openPath: async (p: string) => { opened.push(p); return ""; }, openExternal: async (u: string) => { opened.push(u); },
    safeWebUrl: (u: string) => (/^https?:\/\//.test(u) ? u : null), mkdir: () => {}, readdir: () => [], stat: () => ({ mtimeMs: 0 }),
    settings: () => ({ sites: [{ name: "business website", url: "https://infinitywebapps.in" }] }),
  });
  return { ex, calls, opened, asked, wins: () => wins };
}

describe("JARVIS 2.0: doing it (fake Windows desktop)", () => {
  it("opens several apps and verifies each window really appeared", async () => {
    const f = fakeDesktop();
    const r = await f.ex.run("Open Chrome and VS Code");
    expect(r).toMatchObject({ handled: true, ok: true, reply: "Opened Google Chrome. Opened Visual Studio Code." });
    expect(r.results.map((x: { verified: boolean }) => x.verified)).toEqual([true, true]);
  });
  it("switches to an app that's already open instead of opening a duplicate", async () => {
    const f = fakeDesktop({ windows: [{ id: 5, name: "chrome", title: "Gmail - Google Chrome" }] });
    const r = await f.ex.run("open chrome");
    expect(r.reply).toBe("Google Chrome is already open — switched to it.");
    expect(f.calls.some((c) => (c as { launch?: string }).launch)).toBe(false);
  });
  it("says honestly when a launch didn't show a window, an app is missing, or a name is ambiguous", async () => {
    expect((await fakeDesktop({ launchOpens: false }).ex.run("open spotify")).reply).toBe("Started Spotify, but its window hasn't appeared yet.");
    expect((await fakeDesktop().ex.run("open Photoshop")).reply).toBe('I couldn\'t find "Photoshop" installed on this computer.');
    const amb = await fakeDesktop({ apps: ["Visual Studio Code", "Visual Studio Code Insiders", "Visual Studio Community"] }).ex.run("open visual studio");
    expect(amb.clarify).toMatch(/^Which one — /);
    // "Claude Code" isn't an installed app — JARVIS suggests the closest instead of guessing
    expect((await fakeDesktop().ex.run("open Claude Code")).reply).toMatch(/couldn't find "Claude Code".*Claude/);
  });
  it("switches between two open apps and confirms which one is in front", async () => {
    const f = fakeDesktop({ windows: [{ id: 1, name: "chrome", title: "Google Chrome", active: true }, { id: 2, name: "code", title: "app.ts - Visual Studio Code" }] });
    expect((await f.ex.run("switch to vs code")).results[0]).toMatchObject({ ok: true, verified: true, say: "Switched to Visual Studio Code." });
    expect((await f.ex.run("switch to chrome")).results[0]).toMatchObject({ ok: true, verified: true, say: "Switched to Google Chrome." });
  });
  it("asks before closing or typing, and does nothing when you say no", async () => {
    const f = fakeDesktop({ windows: [{ id: 3, name: "notepad", title: "notes.txt - Notepad" }], confirm: false });
    expect((await f.ex.run("close notepad")).reply).toBe("Okay, I left Notepad open.");
    expect((await f.ex.run("type hello in notepad")).reply).toBe("Okay, nothing was typed.");
    expect(f.asked).toEqual(["Close Notepad?", "Type this into Notepad?"]);
    expect(f.calls.some((c) => ["close", "keys"].includes((c as { op?: string }).op ?? ""))).toBe(false);
    const yes = fakeDesktop({ windows: [{ id: 3, name: "notepad", title: "notes.txt - Notepad" }], confirm: true });
    expect((await yes.ex.run("type hello in notepad")).reply).toBe("Typed it into Notepad.");
    // moving around needs no dialog
    expect((await yes.ex.run("scroll down in notepad")).reply).toBe("Scrolled down in Notepad.");
    expect(yes.asked).toEqual(["Type this into Notepad?"]);
  });
  it("pause blocks every action until resumed; stop ends a running command", async () => {
    const f = fakeDesktop();
    await f.ex.run("pause automation");
    expect((await f.ex.run("open spotify")).reply).toMatch(/paused/);
    await f.ex.run("resume automation");
    expect((await f.ex.run("open spotify")).ok).toBe(true);
  });
  it("opens configured websites and refuses unknown ones", async () => {
    const f = fakeDesktop();
    expect((await f.ex.run("open my business website")).reply).toBe("Opened infinitywebapps.in in your browser.");
    expect((await f.ex.run("open my trading dashboard")).reply).toMatch(/don't have a web address/);
  });
});

describe("JARVIS 2.0: files on a real folder tree", () => {
  it("finds projects (folders with project files), the latest one, opens it, and never overwrites", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "orb-"));
    const mk = (p: string, files: string[] = []) => { fs.mkdirSync(path.join(home, p), { recursive: true }); for (const f of files) fs.writeFileSync(path.join(home, p, f), "x"); };
    mk("Documents/Projects/jarvis-ai-agent", ["package.json"]);
    mk("Documents/notes/jarvis ideas"); // a folder, not a project
    mk("Desktop/gym-website", ["index.html"]);
    mk("Desktop/old-website", ["index.html"]);
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(home, "Desktop/gym-website"), now, now);
    fs.utimesSync(path.join(home, "Desktop/old-website"), now - 86400 * 30, now - 86400 * 30);
    const opened: string[] = [];
    const ex = createExecutor({
      platform: "linux", sleep: async () => {}, homedir: () => home,
      apps: { listApps: async () => [], findApp: M.findApp, matchScore: M.matchScore, normalizeName: M.normalizeName, launch: async () => ({ ok: true }) },
      win: async () => ({ ok: false }), confirm: async () => false,
      exists: (p: string) => fs.existsSync(p), readdir: (p: string) => fs.readdirSync(p, { withFileTypes: true }), stat: (p: string) => fs.statSync(p), mkdir: (p: string) => fs.mkdirSync(p),
      openPath: async (p: string) => { opened.push(p); return ""; }, openInEditor: async () => ({ ok: false }), settings: () => ({}),
    });
    const f = await ex.run("find my JARVIS project");
    expect(f.results[0].found.map((x: { name: string }) => x.name)).toEqual(["jarvis-ai-agent"]);
    expect((await ex.run("open it")).ok).toBe(true);
    expect(opened.at(-1)).toBe(path.join(home, "Documents/Projects/jarvis-ai-agent"));
    expect((await ex.run("search for my latest website project")).results[0].found[0].name).toBe("gym-website");
    expect((await ex.run("open my downloads folder")).reply).toBe("I couldn't find your downloads folder.");
    expect((await ex.run("create a new folder called Acme Gym in documents")).reply).toBe(`Created ${path.join(home, "Documents", "Acme Gym")}.`);
    expect((await ex.run("create a new folder called Acme Gym in documents")).reply).toMatch(/already exists .* I didn't touch it/);
  });
});

describe("JARVIS 2.0: the orb window stays in the bottom-right corner", () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  it("starts bottom-right, opens the chat above-left of the orb, and stays on screen", () => {
    expect(L.orbBounds(null, [primary], primary, "orb")).toEqual({ x: 1920 - L.ORB.w - 16, y: 1040 - L.ORB.h - 16, width: L.ORB.w, height: L.ORB.h });
    const open = L.orbBounds(null, [primary], primary, "popup");
    expect(open.x + open.width).toBe(1920 - 16);
    expect(open.y + open.height).toBe(1040 - 16);
    // dragged near the top-left, the popup still fits on screen
    const moved = L.orbBounds({ right: 200, bottom: 300 }, [primary], primary, "popup");
    expect(moved.x).toBeGreaterThanOrEqual(0);
    expect(moved.y).toBeGreaterThanOrEqual(0);
  });
});

describe("JARVIS 2.0: the wake phrase", () => {
  it("acts only on what follows the wake phrase, and a bare wake phrase just wakes it", async () => {
    const { splitWake } = await import("@/components/orb/voice");
    expect(splitWake("Hey JARVIS, open Chrome")).toEqual({ woke: true, rest: "open Chrome" });
    expect(splitWake("jarvis")).toEqual({ woke: true, rest: "" });
    expect(splitWake("open chrome")).toEqual({ woke: false, rest: "open chrome" });
    expect(splitWake("Okay Friday open my project", "friday")).toEqual({ woke: true, rest: "open my project" });
    expect(splitWake("jarvisville is a town")).toEqual({ woke: false, rest: "jarvisville is a town" });
  });
});

describe("JARVIS 2.0: stop during a slow step", () => {
  it("finishes the step in progress honestly and never starts the next one", async () => {
    let release: () => void = () => {};
    const launched: string[] = [];
    const ex = createExecutor({
      platform: "win32", sleep: async () => {}, homedir: () => "C:\\Users\\Home",
      apps: { listApps: async () => [{ name: "Spotify" }, { name: "Notepad" }], findApp: M.findApp, matchScore: M.matchScore, normalizeName: M.normalizeName,
        launch: async (a: { name: string }) => { launched.push(a.name); if (a.name === "Spotify") await new Promise<void>((r) => { release = r; }); return { ok: true }; } },
      win: async (a: { op: string }) => (a.op === "list" ? [] : { ok: true }),
      confirm: async () => false, exists: () => true, openPath: async () => "", settings: () => ({}),
    });
    const running = ex.run("open spotify, then open notepad");
    await new Promise((r) => setTimeout(r, 10));
    ex.stop();
    release();
    const r = await running;
    expect(launched).toEqual(["Spotify"]);
    expect(r.results.map((x: { say: string }) => x.say)).toEqual(["Started Spotify, but its window hasn't appeared yet.", "Stopped before this step."]);
  });
});
