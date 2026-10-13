import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { wakeCommand } from "@/components/island/voice";
import { jarvisUrl } from "../scripts/rubin.mjs";

const L = createRequire(import.meta.url)("../desktop/rubin/lib.cjs");

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
    expect(s).toMatchObject({ url: L.DEFAULTS.url, wake: false, voiceReplies: false, pos: null, shortcut: "Alt+R" });
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
