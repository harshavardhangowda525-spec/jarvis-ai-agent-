import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { wakeCommand } from "@/components/island/voice";
import { jarvisUrl, cloudUrl } from "../scripts/rubin.mjs";

const L = createRequire(import.meta.url)("../desktop/rubin/lib.cjs");
const PC = createRequire(import.meta.url)("../desktop/rubin/pc.cjs");

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const right = { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 680 } }; // 2nd monitor, different size/scale

describe("RUBEN desktop: placement", () => {
  it("starts top-centre of the main screen", () => {
    expect(L.initialBounds(null, [primary, right], primary)).toEqual({ x: 750, y: 4, width: 420, height: L.COLLAPSED_H });
  });
  it("comes back where you left it, on the monitor you left it on", () => {
    expect(L.initialBounds({ x: 2100, y: 300 }, [primary, right], primary)).toMatchObject({ x: 2100, y: 300 });
  });
  it("returns to the main screen when that monitor is unplugged", () => {
    expect(L.initialBounds({ x: 2100, y: 300 }, [primary], primary)).toMatchObject({ x: 750, y: 4 });
  });
  it("never goes off screen or under the taskbar", () => {
    expect(L.clampToWorkArea({ x: -300, y: -50, width: 420, height: 76 }, primary.workArea)).toEqual({ x: 0, y: 0, width: 420, height: 76 });
    expect(L.clampToWorkArea({ x: 1900, y: 1030, width: 420, height: 76 }, primary.workArea)).toEqual({ x: 1500, y: 964, width: 420, height: 76 });
    // the open pop-up on a short screen shrinks to fit
    expect(L.clampToWorkArea({ x: 2000, y: 200, width: 420, height: 900 }, right.workArea)).toEqual({ x: 2000, y: 0, width: 420, height: 680 });
  });
  it("the dashboard grows around the outline's centre and fits a laptop screen", () => {
    const outline = { x: 750, y: 4, width: 420, height: L.COLLAPSED_H };
    expect(L.resizeAround(outline, true, primary.workArea)).toEqual({ x: 500, y: 4, width: 920, height: 680 });
    expect(L.resizeAround({ x: 500, y: 4, width: 920, height: 680 }, false, primary.workArea)).toEqual(outline);
    // small laptop screen (1366×728 work area): narrower and shorter, still fully on screen
    const laptop = { x: 0, y: 0, width: 1366, height: 728 };
    expect(L.resizeAround({ x: 1300, y: 4, width: 420, height: 76 }, true, laptop)).toEqual({ x: 446, y: 4, width: 920, height: 680 });
    expect(L.resizeAround({ x: 10, y: 4, width: 420, height: 76 }, true, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 0, y: 4, width: 784, height: 584 });
  });
  it("picks the monitor under the pointer while dragging", () => {
    expect(L.displayFor([primary, right], { x: 2500, y: 100 }).id).toBe(2);
    expect(L.displayFor([primary, right], { x: 2500, y: 900 }).id).toBe(2); // below the shorter screen → nearest
    expect(L.displayFor([primary, right], { x: 10, y: 10 }).id).toBe(1);
  });
});

describe("RUBEN desktop: settings and pages", () => {
  it("fills in defaults and drops junk", () => {
    expect(L.readSettings("")).toEqual({ ...L.DEFAULTS });
    expect(L.readSettings("{not json")).toEqual({ ...L.DEFAULTS });
    const s = L.readSettings(JSON.stringify({ url: "javascript:alert(1)", wake: "yes", voiceReplies: false, pos: { x: 10.4, y: "a" }, shortcut: "Alt+R" }));
    expect(s).toMatchObject({ url: L.DEFAULTS.url, wake: true, voiceReplies: false, pos: null, shortcut: "Alt+R" });
    expect(L.readSettings(JSON.stringify({ url: "http://192.168.1.5:3000/" })).url).toBe("http://192.168.1.5:3000");
  });
  it("the island page can only change its own options (not the JARVIS address or shortcuts)", () => {
    expect(L.pagePatch({ wake: true, url: "http://evil.example", shortcut: "A", micId: "abc", launchAtLogin: true })).toEqual({ wake: true, micId: "abc", launchAtLogin: true });
    expect(L.pagePatch({ micId: "" })).toEqual({ micId: null });
  });
  it("closes the sign-in window only when JARVIS has let you in", () => {
    const j = "http://localhost:3000";
    expect(L.authFinished("http://localhost:3000/island", j)).toBe(true);
    expect(L.authFinished("http://localhost:3000/dashboard", j)).toBe(true);
    expect(L.authFinished("http://localhost:3000/unlock?next=/island", j)).toBe(false);
    expect(L.authFinished("http://localhost:3000/login", j)).toBe(false);
    expect(L.authFinished("http://evil.example/island", j)).toBe(false);
    expect(L.authPath("/login")).toBe("/login");
    expect(L.authPath("/api/robin/island")).toBeNull();
  });
});

describe("npm run rubin", () => {
  it("finds JARVIS: --url, then RUBIN_JARVIS_URL, then the local port", () => {
    expect(jarvisUrl(["--url", "http://192.168.1.20:3000/"], {})).toBe("http://192.168.1.20:3000");
    expect(jarvisUrl([], { RUBIN_JARVIS_URL: "https://jarvis.example.com/x" })).toBe("https://jarvis.example.com");
    expect(jarvisUrl([], { JARVIS_LOCAL_PORT: "3005" })).toBe("http://localhost:3005");
    expect(() => jarvisUrl(["--url", "file:///etc/passwd"], {})).toThrow(/isn't a JARVIS address/);
  });
});

describe("wake phrase", () => {
  it("wakes on 'Open CRM' and on RUBEN's name, keeping the rest as the command", () => {
    expect(wakeCommand("Open CRM.")).toEqual({ woke: true, rest: "" });
    expect(wakeCommand("Hey Ruben, which clients need follow-up today?")).toEqual({ woke: true, rest: "which clients need follow-up today" });
    expect(wakeCommand("Rubin show my interested prospects")).toEqual({ woke: true, rest: "show my interested prospects" });
  });
  it("ignores ordinary talk", () => {
    expect(wakeCommand("I'll call Ruben's gym later").woke).toBe(false);
    expect(wakeCommand("the weather is nice").woke).toBe(false);
  });
});

describe("RUBEN without JARVIS on this PC", () => {
  it("uses this PC's JARVIS when it answers, else the online one, else neither", () => {
    expect(L.pickServer(true, true, "http://localhost:3000", "https://jarvis.example.com")).toBe("http://localhost:3000");
    expect(L.pickServer(false, true, "http://localhost:3000", "https://jarvis.example.com")).toBe("https://jarvis.example.com");
    expect(L.pickServer(false, false, "http://localhost:3000", "https://jarvis.example.com")).toBeNull();
    expect(L.pickServer(false, true, "http://localhost:3000", null)).toBeNull();
  });
  it("finds the online JARVIS in .env.local (public https only)", () => {
    expect(cloudUrl([], {}, 'APP_URL="https://my-jarvis.vercel.app/"\n')).toBe("https://my-jarvis.vercel.app");
    expect(cloudUrl([], {}, "APP_URL=http://localhost:3000")).toBeNull();
    expect(cloudUrl([], {}, "")).toBeNull();
    expect(cloudUrl(["--cloud-url", "https://a.example.com"], { RUBIN_CLOUD_URL: "https://b.example.com" }, "APP_URL=https://c.example.com")).toBe("https://a.example.com");
  });
  it("'Hey Rubin' is on by default, and only RUBEN itself can switch app control on", () => {
    expect(L.readSettings("")).toMatchObject({ wake: true, pcControl: null, cloudUrl: null });
    expect(L.pagePatch({ pcControl: true, cloudUrl: "https://evil.example" })).toEqual({});
  });
});

describe("RUBEN on this PC: understanding the words", () => {
  const p = PC.parsePcCommand;
  it("reads app commands", () => {
    expect(p("Open Spotify")).toEqual({ kind: "open", app: "Spotify", explicit: false });
    expect(p("hey rubin, launch the calculator app")).toEqual({ kind: "open", app: "calculator", explicit: true });
    expect(p("switch to Chrome")).toEqual({ kind: "focus", app: "Chrome", explicit: true });
    expect(p("minimise WhatsApp")).toMatchObject({ kind: "minimize", app: "WhatsApp" });
    expect(p("maximize the word window")).toMatchObject({ kind: "maximize", app: "word" });
    expect(p("close Notepad.")).toEqual({ kind: "close", app: "Notepad", explicit: true });
    expect(p('type "hello there" in Notepad')).toEqual({ kind: "type", text: "hello there", app: "Notepad", explicit: true });
    expect(p("press ctrl+s in Word")).toMatchObject({ kind: "key", keys: "^s", app: "Word" });
    expect(p("press enter in notepad")).toMatchObject({ kind: "key", keys: "{ENTER}" });
    expect(p("what apps are open")).toMatchObject({ kind: "list" });
    expect(p("show desktop")).toMatchObject({ kind: "desktop" });
  });
  it("leaves CRM commands to the CRM", () => {
    for (const t of ["Open CRM", "Close CRM", "open the details for this business", "open lead 7", "open 12", "Open ABC Cafe", "close this lead",
      "show my interested leads", "Prepare a pitch for this gym", "mark this lead as rejected", "Find clients who need follow-up", "start a follow-up"]) {
      expect([t, p(t)]).toEqual([t, null]);
    }
  });
  it("turns keys and text into safe SendKeys", () => {
    expect(PC.keysFor("control shift t")).toBe("^+t");
    expect(PC.keysFor("alt f4")).toBe("%{F4}");
    expect(PC.keysFor("a")).toBeNull(); // a bare letter is typing
    expect(PC.keysFor("ctrl+banana")).toBeNull();
    expect(PC.literalKeys("50% off (today) {x} ^+~")).toBe("50{%} off {(}today{)} {{}x{}} {^}{+}{~}");
  });
});

describe("RUBEN on this PC: what needs your Yes", () => {
  const appsModule = {
    listApps: async () => [{ name: "Spotify" }, { name: "Notepad" }],
    findApp: (q: string, list: { name: string }[]) => ({ app: list.find((a) => a.name.toLowerCase() === q.toLowerCase()) ?? null, suggestions: [] }),
    openApp: async (q: string) => (q.toLowerCase() === "spotify" ? { ok: true, message: "Opening Spotify." } : { ok: false, message: `I couldn't find "${q}" installed on this computer.` }),
    matchScore: (q: string, n: string) => (n.toLowerCase().includes(q.toLowerCase()) ? 90 : 0),
    normalizeName: (s: string) => String(s).toLowerCase().trim(),
  };
  const windows = [{ id: 11, name: "notepad", title: "notes.txt - Notepad" }, { id: 22, name: "chrome", title: "Inbox - Google Chrome" }];
  const ran: unknown[] = [];
  const powershell = async (a: unknown) => { ran.push(a); return { ok: true }; };
  const o = { appsModule, windows, powershell, platform: "win32" };

  it("opens installed apps; 'open ABC Cafe' isn't an app, so the CRM gets it", async () => {
    expect(await PC.planPc("open Spotify", o)).toEqual({ handled: true, ok: true, say: "Opening Spotify." });
    expect(await PC.planPc("open Moonlight", o)).toEqual({ handled: false });
    expect(await PC.planPc("launch Moonlight", o)).toMatchObject({ handled: true, ok: false });
  });
  it("switching and minimising happen straight away", async () => {
    ran.length = 0;
    expect(await PC.planPc("switch to chrome", o)).toMatchObject({ ok: true, say: "Switched to Google Chrome." });
    expect(ran).toEqual([{ op: "focus", id: 22 }]);
  });
  it("closing, typing and keys only come back as a question — nothing runs", async () => {
    ran.length = 0;
    const close = await PC.planPc("close notepad", o);
    expect(close.confirm).toMatchObject({ question: "Close Notepad?", action: { op: "close", id: 11 } });
    const type = await PC.planPc("type 50% off in notepad", o);
    expect(type.confirm).toMatchObject({ question: "Type this into Notepad?", action: { op: "keys", id: 11, keys: "50{%} off" } });
    const enter = await PC.planPc("press enter in chrome", o);
    expect(enter.confirm.detail).toMatch(/can send a message/);
    expect(ran).toEqual([]);
    expect(await PC.runConfirmed(close.confirm, { powershell })).toEqual({ ok: true, say: "Asked Notepad to close." });
    expect(ran).toEqual([{ op: "close", id: 11, keys: undefined }]);
  });
  it("won't type without a target, or into an app that isn't open", async () => {
    expect(await PC.planPc("type hello", o)).toMatchObject({ handled: true, ok: false, say: expect.stringMatching(/Which app/) });
    expect(await PC.planPc("type hello in Excel", o)).toMatchObject({ handled: true, ok: false, say: expect.stringMatching(/isn't open/) });
  });
  it("only close and keys can ever be confirmed", async () => {
    expect(await PC.runConfirmed({ action: { op: "focus", id: 11 } }, { powershell })).toMatchObject({ ok: false });
    expect(await PC.runConfirmed({ action: { op: "keys", id: "11", keys: "x" } }, { powershell })).toMatchObject({ ok: false });
  });
});
