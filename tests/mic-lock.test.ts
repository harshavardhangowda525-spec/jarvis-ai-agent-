import { beforeEach, describe, expect, it } from "vitest";
import { __resetRecognizerLock, claimRecognizer, holderName, onRecognizerFree, recognizerFreeFor, recognizerHolder, releaseRecognizer, type Holder } from "@/lib/voice/mic-lock";

const make = (name: string) => {
  const h: Holder & { stoodDown: number } = { id: Symbol(name), name, stoodDown: 0, standDown: () => { h.stoodDown++; } };
  return h;
};

describe("one speech recognizer at a time", () => {
  beforeEach(() => __resetRecognizerLock());

  it("switching agents: the screen you open takes the mic; the old one is stood down", () => {
    const jarvis = make("jarvis"), robin = make("robin");
    expect(claimRecognizer(jarvis, true)).toBe(true);
    expect(holderName()).toBe("jarvis");
    expect(claimRecognizer(robin, true)).toBe(true);
    expect(holderName()).toBe("robin");
    expect(jarvis.stoodDown).toBe(1);
    // the old screen finishing its last reply can't take it back automatically
    expect(claimRecognizer(jarvis)).toBe(false);
    expect(holderName()).toBe("robin");
    expect(robin.stoodDown).toBe(0);
  });

  it("an automatic restart never steals; it gets the mic back once it's free", () => {
    const jarvis = make("jarvis"), ultron = make("ultron");
    claimRecognizer(jarvis, true);
    claimRecognizer(ultron, true); // ULTRON's panel opens over JARVIS
    expect(recognizerFreeFor(jarvis.id)).toBe(false);
    let told = 0;
    const off = onRecognizerFree(() => { told++; });
    releaseRecognizer(jarvis.id); // not the holder → nothing happens
    expect(recognizerHolder()).toBe(ultron.id);
    releaseRecognizer(ultron.id); // the panel closes
    expect(told).toBe(1);
    expect(recognizerFreeFor(jarvis.id)).toBe(true);
    expect(claimRecognizer(jarvis)).toBe(true);
    off();
  });

  it("the 'hey JARVIS' listener only listens when nobody else is, and steps aside", () => {
    const voice = make("jarvis"), wake = make("wake");
    claimRecognizer(voice, true);
    expect(claimRecognizer(wake)).toBe(false);
    releaseRecognizer(voice.id);
    expect(claimRecognizer(wake)).toBe(true);
    claimRecognizer(voice, true);
    expect(wake.stoodDown).toBe(1);
    expect(claimRecognizer(voice, true)).toBe(true); // re-claiming your own is fine
    expect(voice.stoodDown).toBe(0);
  });
});
