import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { scriptLang, wavFromFloat32, cleanForSpeech, PIPER_VOICES } from "@/lib/voice/local-tts";
import { piperAsset, VOICE_FILES, voiceFits } from "../scripts/voice-setup.mjs";

describe("JARVIS's own voice (pure parts)", () => {
  it("picks the voice by the text's script", () => {
    expect(scriptLang("Hello there")).toBe("en");
    expect(scriptLang("नमस्ते, कैसे हैं?")).toBe("hi");
    expect(scriptLang("ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಾ?")).toBe("kn");
  });
  it("makes a valid 16-bit mono WAV", () => {
    const w = wavFromFloat32(new Float32Array([0, 1, -1, 0.5]), 16000);
    expect(w.subarray(0, 4).toString()).toBe("RIFF");
    expect(w.subarray(8, 12).toString()).toBe("WAVE");
    expect(w.readUInt32LE(24)).toBe(16000);
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.length).toBe(44 + 8);
    expect(w.readInt16LE(46)).toBe(32767);
    expect(w.readInt16LE(48)).toBe(-32767);
  });
  it("gives Piper one clean line", () => {
    expect(cleanForSpeech("**Hi!**\nVisit https://x.com now\t ok")).toBe("Hi! Visit now ok");
  });
  it("only installs voices the voice program can read (newer ones crash it: \"aɪ\" is not a single codepoint)", () => {
    expect(voiceFits(JSON.stringify({ phoneme_id_map: { a: [14], "ɪ": [74], " ": [3] } }))).toBe(true);
    expect(voiceFits(JSON.stringify({ phoneme_id_map: { a: [14], "aɪ": [161] } }))).toBe(false);
    expect(voiceFits("not json")).toBe(false);
    expect(PIPER_VOICES.en).toBe("en_GB-alan-medium");
  });
  it("downloads the right engine for the PC, and the voices the app expects", () => {
    expect(piperAsset("win32", "x64")).toBe("piper_windows_amd64.zip");
    expect(piperAsset("linux", "x64")).toBe("piper_linux_x86_64.tar.gz");
    expect(piperAsset("darwin", "arm64")).toBe("piper_macos_aarch64.tar.gz");
    expect(piperAsset("freebsd", "x64")).toBeNull();
    expect((VOICE_FILES as string[]).map((v) => v.split("/").pop())).toEqual([PIPER_VOICES.en, PIPER_VOICES.hi]);
  });
});
