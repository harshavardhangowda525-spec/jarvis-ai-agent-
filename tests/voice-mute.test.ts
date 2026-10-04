import { describe, expect, it } from "vitest";
import { muteIntent } from "@/lib/voice/silence";

describe("'mute' works the same in every agent", () => {
  it("hears mute — plainly, with an agent's name, or in other words", () => {
    for (const t of ["mute", "Mute.", "mute yourself", "Jarvis, mute", "hey jarvis mute", "Rubin mute", "mute Darwin", "MIKE, mute please", "ultron mute", "mute your voice", "mute everything", "be quiet", "stop talking", "shut up", "go silent", "silent mode", "voice off", "mute the mic", "mute microphone", "turn off the mic", "mic off", "stop listening"]) expect(muteIntent(t), t).toBe("mute");
  });
  it("hears unmute", () => {
    for (const t of ["unmute", "Un-mute", "unmute yourself", "Jarvis, unmute", "Rubin unmute", "speak again", "talk to me", "you can talk now", "voice on", "turn your voice back on", "unmute the mic", "turn on the mic", "mic on"]) expect(muteIntent(t), t).toBe("unmute");
  });
  it("leaves everything else alone — other things to mute and longer sentences", () => {
    for (const t of ["mute the video", "is my mic working", "how many follow ups do we have", "what does mute mean", "is the mute button working", "stop", "open darwin", "be quiet in the meeting tomorrow"]) expect(muteIntent(t), t).toBeNull();
  });
});
