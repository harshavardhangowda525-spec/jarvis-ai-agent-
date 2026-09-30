import { describe, it, expect } from "vitest";
import { isMikeActivation, isMikeDeactivation, stripMikeWake } from "@/lib/mike/wake";
import { parseMikeCommand } from "@/lib/mike/command";

describe("waking MIKE however speech recognition spells it", () => {
  it("activates on Mike, mic, Mick, Myke, Mikey", () => {
    for (const s of ["Activate Mike", "activate mic", "Activate mic.", "activate Mick", "Activate Myke", "activate mikey", "open mic", "launch Mike", "switch to mic",
      "JARVIS, activate mic", "please activate mic", "Mike", "mic", "Mike, come online", "mic, take over", "bring up Mike", "hey mic"]) {
      expect(isMikeActivation(s), s).toBe(true);
    }
  });
  it("microphone commands and other sentences don't", () => {
    for (const s of ["turn on the mic", "turn off mic", "unmute mic", "mute the mic", "start mic", "mic check", "test my mic", "open microphone settings",
      "activate DARWIN", "what's the weather", "Michael Jordan stats", "the mic is too quiet"]) {
      expect(isMikeActivation(s), s).toBe(false);
    }
  });
  it("wake word is stripped from MIKE commands, and 'deactivate mic' leaves MIKE", () => {
    expect(stripMikeWake("Mic, scan the market")).toBe("scan the market");
    expect(parseMikeCommand("Mic, scan the market")).toEqual({ kind: "scan", setups: false });
    expect(parseMikeCommand("Mick analyze Bitcoin")).toMatchObject({ kind: "analyze", asset: { symbol: "BTCUSDT" } });
    expect(parseMikeCommand("mic, pull up the Tesla chart")).toEqual({ kind: "chart", query: "Tesla", timeframe: null });
    expect(isMikeDeactivation("deactivate mic")).toBe(true);
    expect(isMikeDeactivation("Mick, stand down")).toBe(true);
    expect(parseMikeCommand("deactivate mic").kind).toBe("exit");
    expect(isMikeDeactivation("turn off the mic")).toBe(false);
  });
});
