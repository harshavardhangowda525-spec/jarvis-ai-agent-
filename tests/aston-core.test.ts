import { describe, it, expect } from "vitest";
import { coreState, defaultLine, greeting, wakeIntent, clamp01, isConversationEnd } from "@/lib/aston/core-state";
import { coreGeometry } from "@/components/aston/core/geometry";

describe("ASTON core state", () => {
  const base = { mode: "idle" as const, executing: false, fault: false, attention: false };

  it("is idle with nothing going on", () => {
    expect(coreState(base)).toBe("idle");
  });

  it("what you're doing now beats background status", () => {
    expect(coreState({ ...base, mode: "listening", fault: true, attention: true, executing: true })).toBe("listening");
    expect(coreState({ ...base, mode: "speaking", attention: true })).toBe("speaking");
    expect(coreState({ ...base, mode: "processing", executing: true })).toBe("processing");
  });

  it("a running task beats a fault; a fault beats open alerts", () => {
    expect(coreState({ ...base, executing: true, fault: true })).toBe("executing");
    expect(coreState({ ...base, fault: true, attention: true })).toBe("error");
    expect(coreState({ ...base, attention: true })).toBe("attention");
  });

  it("greets by the local time of day", () => {
    expect(greeting(8)).toBe("Good morning. How may I assist?");
    expect(greeting(14)).toBe("Good afternoon. How may I assist?");
    expect(greeting(21)).toBe("Good evening. How may I assist?");
    expect(greeting(2)).toBe("Good evening. How may I assist?");
  });

  it("shows a line per state", () => {
    expect(defaultLine("listening", 9)).toBe("Listening for your command…");
    expect(defaultLine("processing", 9)).toBe("Analyzing your request…");
    expect(defaultLine("executing", 9)).toBe("Executing workflow…");
    expect(defaultLine("idle", 15)).toBe("Good afternoon. How may I assist?");
  });

  it("clamps progress, keeping null for indeterminate tasks", () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(null)).toBeNull();
    expect(clamp01(Number.NaN)).toBeNull();
  });
});

describe("ASTON wake word", () => {
  it("ignores anything that doesn't start with ASTON", () => {
    expect(wakeIntent("build me a website")).toBeNull();
    expect(wakeIntent("I told Aston about it")).toBeNull();
    expect(wakeIntent("")).toBeNull();
  });

  it("a bare ASTON (or a hello) waits for the command", () => {
    expect(wakeIntent("ASTON")).toEqual({ kind: "wake" });
    expect(wakeIntent("Hey Aston")).toEqual({ kind: "wake" });
    expect(wakeIntent("aston, hello")).toEqual({ kind: "wake" });
  });

  it("ASTON + a phrase is a command, including common mis-hearings", () => {
    expect(wakeIntent("ASTON, build a website for a café")).toEqual({ kind: "command", text: "build a website for a café" });
    expect(wakeIntent("Austin what's the status")).toEqual({ kind: "command", text: "what's the status" });
    expect(wakeIntent("ok Ashton open the teleprompter")).toEqual({ kind: "command", text: "open the teleprompter" });
  });
});

describe("ASTON core geometry", () => {
  it("keeps the core and its rings on a phone screen", () => {
    const g = coreGeometry(412, 915);
    expect(g.cx).toBe(206);
    expect(g.u * 2).toBeLessThanOrEqual(412);
    expect(g.cy - g.u).toBeGreaterThan(80); // below the wordmark
    expect(g.cy + g.u * 1.06 + 90).toBeLessThan(915 - 80); // the status line clears the command bar
  });

  it("leaves room for the status line and command bar on a laptop", () => {
    const g = coreGeometry(1440, 900);
    expect(g.cy + g.u * 1.06 + 60).toBeLessThan(900 - 80);
    expect(g.cy - g.u).toBeGreaterThan(70);
  });

  it("fits short landscape phones", () => {
    const g = coreGeometry(844, 390);
    expect(g.cy + g.u).toBeLessThan(390 - 80);
    expect(g.u).toBeGreaterThanOrEqual(60);
  });
});

describe("ASTON hands-free conversation", () => {
  it("ends on a natural sign-off", () => {
    for (const t of ["that's all", "That is all.", "thanks, that's all", "Thank you ASTON", "stop", "goodbye", "bye bye", "never mind", "no thanks", "I'm done", "ASTON, that's all", "okay that's it", "end the conversation"]) {
      expect(isConversationEnd(t), t).toBe(true);
    }
  });
  it("keeps going for real requests (even ones containing those words)", () => {
    for (const t of ["what's the status", "stop the deploy for Kerbside Bistro", "is that all the alerts", "say goodbye to the client in the script", "thanks for the update, now build a website"]) {
      expect(isConversationEnd(t), t).toBe(false);
    }
  });
});

describe("ASTON voice choice", () => {
  const v = (name: string, lang: string, localService: boolean) => ({ name, lang, localService }) as SpeechSynthesisVoice;
  it("prefers an on-device voice over Chrome's online Google voices (they go silent behind firewalls)", async () => {
    const { bestVoice } = await import("@/lib/aston/voice");
    const voices = [v("Google UK English Male", "en-GB", false), v("Google UK English Female", "en-GB", false), v("Microsoft Hazel - English (United Kingdom)", "en-GB", true), v("Microsoft George - English (United Kingdom)", "en-GB", true), v("Microsoft Ravi - English (India)", "en-IN", true)];
    expect(bestVoice(voices)?.name).toBe("Microsoft George - English (United Kingdom)");
    expect(bestVoice(voices.slice(0, 2))?.name).toBe("Google UK English Male"); // "Female" doesn't count as male
    expect(bestVoice([v("Google UK English Male", "en-GB", false)], { localOnly: true })).toBeNull();
    expect(bestVoice([v("Microsoft Ravi - English (India)", "en-IN", true), v("Microsoft Zira", "en-US", true)])?.name).toBe("Microsoft Ravi - English (India)");
  });
});

describe("ASTON opens pages by voice", () => {
  it("opens JARVIS and the agents", async () => {
    const { navIntent } = await import("@/lib/aston/core-state");
    expect(navIntent("open JARVIS")).toEqual({ label: "JARVIS", href: "/dashboard" });
    expect(navIntent("ASTON, open Jarvis please")).toEqual({ label: "JARVIS", href: "/dashboard" });
    expect(navIntent("go to the Jarvis dashboard")).toEqual({ label: "JARVIS", href: "/dashboard" });
    expect(navIntent("take me to DARWIN")).toMatchObject({ href: "/dashboard/darwin" });
    expect(navIntent("switch to Ultron")).toMatchObject({ href: "/dashboard/ultron" });
    expect(navIntent("open EDITH")).toMatchObject({ href: "/dashboard/ultron" });
    expect(navIntent("show me my tasks")).toMatchObject({ href: "/dashboard/tasks" });
    expect(navIntent("can you open settings")).toMatchObject({ href: "/dashboard/settings" });
  });
  it("doesn't navigate on sentences that merely mention an agent", async () => {
    const { navIntent } = await import("@/lib/aston/core-state");
    expect(navIntent("what is jarvis doing")).toBeNull();
    expect(navIntent("open a ticket for darwin's failed run")).toBeNull();
    expect(navIntent("open the teleprompter")).toBeNull();
    expect(navIntent("build a website for jarvis cafe")).toBeNull();
  });
});

describe("ASTON sample call by voice", () => {
  it("recognises a request for a sample call, and nothing else", async () => {
    const { isCallMeRequest } = await import("@/lib/aston/core-state");
    for (const t of ["call me", "ASTON, give me a sample call now", "make a test call", "test the phone call", "please call me", "give me a call"]) expect(isCallMeRequest(t), t).toBe(true);
    for (const t of ["call the client tomorrow", "write a cold call script", "who called me", "call me when the deploy fails"]) expect(isCallMeRequest(t), t).toBe(false);
  });
});

describe("ASTON never answers its own voice", () => {
  it("recognises its own sentence coming back through the mic, but not a short real reply", async () => {
    const { rememberSpoken, isEcho, markSelfSpeech } = await import("@/lib/aston/voice");
    rememberSpoken("All systems are running normally. Your latest website is ready for review.");
    markSelfSpeech(true);
    markSelfSpeech(false);
    expect(isEcho("all systems are running normally")).toBe(true);
    expect(isEcho("your latest website is ready")).toBe(true);
    expect(isEcho("yes")).toBe(false); // too short to judge — a real answer
    expect(isEcho("build a website for a cafe in indiranagar")).toBe(false);
    // long after ASTON stopped talking, nothing is treated as an echo
    expect(isEcho("all systems are running normally", Date.now() + 10_000)).toBe(false);
  });
});

describe("ASTON lets you finish", () => {
  it("waits longer when the last word clearly isn't the end", async () => {
    const { phraseSilenceMs, PHRASE_SILENCE_MS } = await import("@/lib/aston/core-state");
    expect(phraseSilenceMs("build a website for")).toBeGreaterThan(PHRASE_SILENCE_MS);
    expect(phraseSilenceMs("ASTON")).toBeGreaterThan(PHRASE_SILENCE_MS);
    expect(phraseSilenceMs("a café with")).toBeGreaterThan(PHRASE_SILENCE_MS);
    expect(phraseSilenceMs("build a website for a cafe in indiranagar")).toBe(PHRASE_SILENCE_MS);
  });
});

describe("ASTON lets you finish · sentence endings", () => {
  it("doesn't over-wait on words that often end a sentence", async () => {
    const { phraseSilenceMs, PHRASE_SILENCE_MS } = await import("@/lib/aston/core-state");
    expect(phraseSilenceMs("how many alerts are open")).toBe(PHRASE_SILENCE_MS);
    expect(phraseSilenceMs("open settings")).toBe(PHRASE_SILENCE_MS);
  });
});
