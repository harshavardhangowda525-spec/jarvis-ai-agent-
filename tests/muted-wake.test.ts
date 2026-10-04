import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRecognizerLock, claimRecognizer, recognizerHolder, releaseRecognizer } from "@/lib/voice/mic-lock";
import { startMutedWake } from "@/lib/voice/muted-wake";
import { isVoiceSilent, onVoiceSilent, setVoiceSilent } from "@/lib/voice/silence";

// a Chrome-ish recognizer: tracks what's running, lets the test "say" things
let running: any[] = [];
class FakeSR {
  onresult: any; onerror: any; onend: any; continuous = false; interimResults = false; lang = "";
  start() { running.push(this); }
  abort() { running = running.filter((r) => r !== this); setTimeout(() => this.onend?.(), 0); }
  say(text: string) { this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] }); }
}
const say = (t: string) => running[0]?.say(t);

beforeEach(() => {
  vi.useFakeTimers();
  running = [];
  __resetRecognizerLock();
  const store = new Map<string, string>();
  (globalThis as any).window = new EventTarget();
  (globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});
afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).sessionStorage; });

const flush = async (ms = 400) => { await vi.advanceTimersByTimeAsync(ms); };

describe("muted: only 'Hey JARVIS' is heard", () => {
  it("listens only while muted, ignores everything else, and 'hey jarvis' unmutes", async () => {
    const events: Array<[boolean, string | undefined]> = [];
    onVoiceSilent((s, via) => events.push([s, via]));
    const stop = startMutedWake({ SR: FakeSR, micAllowed: async () => true });
    await flush();
    expect(running.length).toBe(0); // not muted → not listening

    setVoiceSilent(true);
    await flush();
    expect(running.length).toBe(1);

    say("what time is it");
    say("call lead seven tomorrow");
    say("Jarvis");
    await flush();
    expect(isVoiceSilent()).toBe(true); // all ignored

    say("hey Jarvis");
    await flush();
    expect(isVoiceSilent()).toBe(false);
    expect(events.at(-1)).toEqual([false, "wake"]);
    expect(running.length).toBe(0); // released for the agent to reopen its mic
    expect(recognizerHolder()).toBe(null);
    stop();
  });

  it("never takes the recognizer from a voice engine — waits until it's free", async () => {
    const engine = { id: Symbol("jarvis"), name: "jarvis", standDown: vi.fn() };
    claimRecognizer(engine);
    const stop = startMutedWake({ SR: FakeSR, micAllowed: async () => true });
    setVoiceSilent(true);
    await flush();
    expect(running.length).toBe(0);
    expect(engine.standDown).not.toHaveBeenCalled();
    releaseRecognizer(engine.id); // the engine let go on mute
    await flush();
    expect(running.length).toBe(1);
    stop();
  });

  it("steps aside when a voice engine forces the mic back on, and comes back when it's freed", async () => {
    const stop = startMutedWake({ SR: FakeSR, micAllowed: async () => true });
    setVoiceSilent(true);
    await flush();
    expect(running.length).toBe(1);
    const engine = { id: Symbol("rubin"), name: "rubin", standDown: vi.fn() };
    claimRecognizer(engine, true);
    await flush();
    expect(running.length).toBe(0);
    releaseRecognizer(engine.id);
    await flush();
    expect(running.length).toBe(1);
    stop();
    await flush();
    expect(running.length).toBe(0);
  });

  it("keeps listening after Chrome ends a session on silence", async () => {
    const stop = startMutedWake({ SR: FakeSR, micAllowed: async () => true });
    setVoiceSilent(true);
    await flush();
    const first = running[0];
    running = []; first.onend();
    await flush();
    expect(running.length).toBe(1);
    expect(running[0]).not.toBe(first);
    say("hello jarvis");
    await flush();
    expect(isVoiceSilent()).toBe(false);
    stop();
  });

  it("doesn't open the mic if permission was never given", async () => {
    const stop = startMutedWake({ SR: FakeSR, micAllowed: async () => false });
    setVoiceSilent(true);
    await flush(2000);
    expect(running.length).toBe(0);
    stop();
  });

  it("stops listening when unmuted another way (the pill / mic button)", async () => {
    const stop = startMutedWake({ SR: FakeSR, micAllowed: async () => true });
    setVoiceSilent(true);
    await flush();
    expect(running.length).toBe(1);
    setVoiceSilent(false);
    await flush();
    expect(running.length).toBe(0);
    expect(recognizerHolder()).toBe(null);
    stop();
  });
});
