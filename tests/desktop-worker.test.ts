import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DesktopWorker, createOverlay, overlayLine } from "../operator/src/desktop/worker.mjs";

describe("laptop control in JARVIS's helper (no orb): the on-screen bar", () => {
  it("each command is one line; text can't add commands", () => {
    expect(overlayLine("show", "Opening Notepad")).toBe("show\tOpening Notepad\n");
    expect(overlayLine("show", "evil\nexit\tnow")).toBe("show\tevil exit now\n");
    expect(overlayLine("ripple", 10, 20)).toBe("ripple\t10\t20\n");
  });

  it("asks Yes / No on the bar and passes Stop through; off Windows it never says yes", async () => {
    const written: string[] = [];
    const stdout = new PassThrough();
    const proc = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), stdin: { write: (l: string) => written.push(l) }, exitCode: null });
    const onStop = vi.fn();
    const o = createOverlay({ onStop, platform: "win32", spawnImpl: (() => proc) as never });
    const answer = o.ask("Send this email?", "JARVIS wants to click Send.");
    expect(written.at(-1)).toBe("ask\tq1\tSend this email?\tJARVIS wants to click Send.\n");
    stdout.write("ready\nanswer\tq1\tyes\n");
    expect(await answer).toBe(true);
    const second = o.ask("Delete it?", "");
    stdout.write("answer\tq2\tno\nstop\n");
    expect(await second).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(onStop).toHaveBeenCalledOnce();
    expect(await createOverlay({ platform: "linux" }).ask("Pay?", "")).toBe(false);
    // screenshots come from the overlay process (fast), with a clear error when it can't
    const shot = o.shot();
    expect(written.at(-1)).toBe("shot\ts3\n");
    stdout.write("shot\ts3\t1366\t768\t1.5\tAAAA\n");
    expect(await shot).toEqual({ ok: true, data: "AAAA", w: 1366, h: 768, factor: 1.5 });
    const bad = o.shot();
    stdout.write("shoterr\ts4\tAccess denied\n");
    expect(await bad).toEqual({ ok: false, error: "Access denied" });
  });
});

describe("laptop control in JARVIS's helper (no orb): doing a job", () => {
  it("picks up a job, works on the screen with the laptop key, and reports back", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const linkFile = path.resolve("operator/.finder.json");
    const had = fs.existsSync(linkFile) ? fs.readFileSync(linkFile, "utf8") : null;
    fs.writeFileSync(linkFile, JSON.stringify({ url: "http://localhost:3999", token: "jmf_test" }));
    try {
      const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
      let steps = 0;
      const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, body, auth: (init.headers as Record<string, string>).Authorization });
        let data: unknown = {};
        if (url.endsWith("/api/desktop/tasks") && body.action === "next") data = { task: steps ? null : { id: "t1", goal: "open Notepad and type hi", maxSteps: 5 } };
        if (url.endsWith("/api/desktop/act")) data = [
          { action: { type: "open_app", app: "Notepad" }, say: "Opening Notepad", confirm: null, blocked: null },
          { action: { type: "click", x: 100, y: 50, target: "Text editor" }, say: "Clicking the page", confirm: null, blocked: null },
          { action: { type: "type", text: "hi", enter: false, target: "" }, say: "Typing", confirm: null, blocked: null },
          { action: { type: "done", summary: "Typed hi in Notepad." }, say: "Done", confirm: null, blocked: null },
        ][steps++];
        return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
      });
      const ps = vi.fn(async (a: Record<string, unknown>) => {
        if (a.op === "screenshot") return { ok: true, data: "AA==", w: 1366, h: 768, factor: 1.5 };
        if (a.op === "uia") return [{ name: "Text editor", role: "Document", x: 150, y: 75, w: 300, h: 150, password: false }];
        return { ok: true };
      });
      const overlay = { show: vi.fn(), hide: vi.fn(), ripple: vi.fn(), ask: vi.fn(async () => true), close: vi.fn() };
      const w = new DesktopWorker({ fetchImpl: fetchImpl as never, ps: ps as never, overlay: overlay as never, platform: "win32" });
      await w.poll();
      expect(calls.every((c) => c.auth === "Bearer jmf_test")).toBe(true);
      const act = calls.find((c) => c.url.endsWith("/api/desktop/act"))!;
      expect(act.body.elements).toEqual([{ id: 1, name: "Text editor", role: "Document", x: 100, y: 50, w: 200, h: 100, password: false }]); // real pixels → screenshot pixels
      expect(act.body.image).toBe("data:image/jpeg;base64,AA==");
      expect(ps).toHaveBeenCalledWith({ op: "open-app", app: "Notepad" });
      expect(ps).toHaveBeenCalledWith({ op: "input", kind: "click", x: 150, y: 75 }); // back to real pixels
      expect(ps).toHaveBeenCalledWith({ op: "input", kind: "type", text: "hi", enter: false });
      expect(overlay.ripple).toHaveBeenCalledWith(150, 75);
      expect(overlay.show).toHaveBeenCalledWith("open Notepad and type hi");
      expect(overlay.hide).toHaveBeenCalled();
      expect(calls.at(-1)?.body).toMatchObject({ action: "report", id: "t1", status: "done", result: "Typed hi in Notepad." });
    } finally {
      if (had === null) fs.rmSync(linkFile, { force: true }); else fs.writeFileSync(linkFile, had);
    }
  }, 30_000);
});
