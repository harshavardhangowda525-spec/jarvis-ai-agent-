import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { setLive, getLive } from "@/lib/calls/live";

describe("what the Calls window on the laptop is doing (for the dashboard)", () => {
  it("keeps the latest report, trims it, and forgets a window that went quiet", () => {
    const now = 1_000_000;
    setLive("u1", { running: true, via: "WhatsApp Desktop", wait: null, error: null,
      checks: [{ label: "JARVIS hears the call (speakers)", ok: false, detail: "Enable Stereo Mix" }],
      lines: Array.from({ length: 50 }, (_, i) => ({ who: i % 2 ? "jarvis" as const : "them" as const, text: `line ${i}`, at: i })) }, now);
    const l = getLive("u1", now + 1000)!;
    expect(l.online).toBe(true);
    expect(l.checks[0]).toMatchObject({ ok: false, detail: "Enable Stereo Mix" });
    expect(l.lines).toHaveLength(40);
    expect(l.lines.at(-1)?.text).toBe("line 49");
    expect(getLive("u1", now + 120_000)).toBeNull();
    expect(getLive("someone-else", now)).toBeNull();
  });
});
