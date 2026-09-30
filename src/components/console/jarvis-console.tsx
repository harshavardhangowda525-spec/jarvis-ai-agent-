"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BriefingPopup } from "@/components/console/briefing-popup";
import type { Briefing } from "@/lib/briefing/build";
import { briefingRequest } from "@/lib/briefing/intent";
import { yesterdayIn } from "@/lib/activity/dates";
import { logActivity } from "@/lib/activity/client";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Paperclip, Loader2, Power, X, LayoutGrid, Volume2 } from "lucide-react";
import { type OrbState } from "@/components/orb";
import { useVoice, useResumeVoice, type SpeechStream } from "@/hooks/useVoice";
import { instantAnswer } from "@/lib/instant";
import { inIndia, parseOpenLinkRef, parseOpenSite, pickLink, type SiteTarget } from "@/lib/open-site";
import { installedAppNames, openLocalApp, openUrlOnPc, parseOpenApp, planOpen, refreshInstalledApps, ultronKnown } from "@/lib/local-apps";
import { parseMemoryCommand } from "@/lib/memory/intent";
import { EmailComposePopup, useEmailPopups } from "./email-popup";
import type { AgentTiming } from "@/hooks/useAgent";
import { useAgent } from "@/hooks/useAgent";
import { useRenderWatch } from "@/hooks/useRenderWatch";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useScreenVision } from "@/hooks/useScreenVision";
import { HumanoidView } from "@/components/console/humanoid-view";
import { EvView, type EvState } from "@/components/console/ev-view";
import { useDailyContent, type DailyUiAction } from "@/components/console/ev/today-content";
import { parseDailyCommand } from "@/lib/ev/daily/intent";
import { useGesture, useGestureHandler } from "@/components/gesture/gesture-provider";
import { gestureModeCommand } from "@/lib/gesture/intent";
import { DarwinReportCard, useDarwinReport } from "@/components/console/darwin-report";
import { darwinDailyRequest, darwinProgressLine } from "@/lib/darwin/daily/intent";
import { WeatherPopup, type WeatherData } from "@/components/console/weather-popup";
import { BrowserPopup, type BrowserTarget } from "@/components/console/browser-popup";
import { NiosAlerts, useNiosWatch } from "@/components/console/nios-alert";
import { parsePowerIntent, parseConfirmation, spokenDelay } from "@/lib/power-command";
import { laptopPower } from "@/lib/local-power";
import { JarvisMotion, type JarvisMotionHandle, type JState, type AgentName, type Pt } from "./jarvis/jarvis-motion";
import { KineticStage, KineticWord, type KineticStyle } from "./jarvis/kinetic";
import { HoloPanel } from "./jarvis/holo-panel";
import { cn } from "@/lib/utils";

// "publish" / "post it" / "publish with caption …" while an EV image is open.
const EV_PUBLISH_RE = /^(please\s+)?(publish|post|upload|share)\b|\b(publish|post|upload) (it|this|that|now|the (image|post|picture|photo|video|reel))\b|\bgo ahead( and (publish|post))?\b|\b(publish|post|put it) (to|on) (instagram|insta|ig)\b/i;
// …but not requests for NEW content ("publish a post about X tomorrow").
const EV_NEW_CONTENT_RE = /\b(about|schedule|tomorrow|later|next week|idea|ideas|another|new|create|make|generate)\b/i;
const captionFromCommand = (t: string) => t.match(/\bcaption\s*[:\-]?\s*(?:is\s+|as\s+)?(.+)$/i)?.[1]?.trim();

// Weather intents ("what's the weather", "forecast for Tokyo", "will it rain").
const WEATHER_RE = /\b(weather|forecast|temperature|humidity|how (hot|cold|warm)|(will|is|does|gonna) it (be )?(going to |gonna )?(rain|raining|snow|snowing|sunny|cloudy|cold|hot|windy|storm)|need an umbrella)\b/i;

/** Pull a place out of a weather question ("weather in London" → "London"). */
function parseWeatherPlace(text: string): string | undefined {
  const clean = (s: string) =>
    s.replace(/\b(please|now|today|tomorrow|tonight|right now|currently|this week|like)\b/gi, "")
      .replace(/'s\b/gi, "").replace(/\s+/g, " ").trim().replace(/[.?!,]+$/, "") || undefined;

  // "weather in Bangalore", "forecast for Tokyo, Japan"
  const m = text.match(/\b(?:in|for|at|of)\s+([A-Za-z][\w'.,\- ]{1,60})$/i) || text.match(/\b(?:in|for|at|of)\s+([A-Za-z][\w'.,\- ]{1,60})\b/i);
  if (m) return clean(m[1]);

  // "Bangalore weather", "bangalore's weather today", "Mumbai forecast"
  const lead = text.match(/^(?:what'?s|whats|how'?s|hows|show me|tell me|get|check)?\s*(?:the\s+)?([A-Za-z][\w'.,\- ]{1,40}?)\s+(?:weather|forecast|temperature)\b/i);
  if (lead) {
    const place = clean(lead[1]);
    if (place && !/^(the|current|today|todays|local|my|our|this|weekly|daily)$/i.test(place)) return place;
  }
  return undefined;
}

/** Viewer's country (ISO-2) from the browser locale — used to prefer local cities. */
function viewerCountry(): string {
  try {
    const loc = navigator.language || "";
    const m = loc.match(/[-_]([A-Za-z]{2})$/);
    if (m) return m[1].toUpperCase();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/Kolkata|Calcutta/.test(tz)) return "IN";
  } catch { /* ignore */ }
  return "";
}

/** Tooltip: where the time of the last answer went. */
function timingDetail(t: AgentTiming): string {
  const lines = [
    `First word after ${(((t.clientMs ?? t.firstWordMs) ?? 0) / 1000).toFixed(2)}s (${t.provider} · ${t.model})`,
    `• server prep (login, database): ${(t.setupMs / 1000).toFixed(2)}s`,
    t.firstWordMs != null ? `• model's first word: ${((t.firstWordMs - t.setupMs) / 1000).toFixed(2)}s` : "",
    `• whole answer: ${(t.totalMs / 1000).toFixed(2)}s`,
  ];
  if (t.setupMs > 700) lines.push("Server prep is slow — put your Vercel functions in the same region as your database (Vercel → Settings → Functions → Region).");
  if (t.provider === "ollama" && (t.firstWordMs ?? 0) > 3000) lines.push("Your PC brain is the slow part — a smaller Ollama model (e.g. qwen2.5:1.5b) or a GPU answers faster.");
  return lines.filter(Boolean).join("\n");
}

/**
 * Open a URL in a new tab and report whether the browser allowed it. (A plain
 * window.open with "noopener" always returns null, so a blocked pop-up couldn't
 * be told apart; opening a blank tab first, cutting its link back to JARVIS,
 * then sending it to the site gives the same safety AND a reliable answer.)
 */
function openTab(url: string): boolean {
  try {
    const w = window.open("", "_blank");
    if (!w) return false;
    w.opener = null;
    w.location.href = url;
    return true;
  } catch {
    return false;
  }
}

type OpenedHow = "tab" | "pc" | "blocked" | "jarvis";
/** "… in a new tab", "… in my browser" → a real browser tab, not JARVIS's pop-up. */
const NEW_TAB = /\b(?:in|on)\s+(?:a\s+)?(?:new|another|separate|different)\s+(?:browser\s+)?(?:tab|window)\b|\bin\s+(?:the|my)\s+(?:real\s+)?browser\b/i;
/**
 * Open a web link in a new tab. The tab opens synchronously (call this before
 * any await, inside the click/keypress). If the browser blocks it — voice
 * commands and AI replies aren't clicks — ULTRON opens it in your default
 * browser instead, when it runs on this PC.
 */
function openSite(site: SiteTarget): Promise<OpenedHow> {
  if (openTab(site.url)) return Promise.resolve("tab");
  if (!ultronKnown()) return Promise.resolve("blocked");
  return openUrlOnPc(site.url).then((ok) => (ok ? "pc" : "blocked"));
}

function blockedLine(labels: string[]): string {
  const what = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0];
  return `Your browser blocked the new tab for ${what} — click the button below, or allow pop-ups for this site (icon at the right of Chrome's address bar).`;
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq", gemini: "Gemini", cerebras: "Cerebras",
  openrouter: "OpenRouter", openai: "OpenAI", anthropic: "Claude", ollama: "Ollama",
};

export function JarvisConsole({ userName }: { assistantName: string; userName: string }) {
  const router = useRouter();
  const [voiceConfigured, setVoiceConfigured] = useState<boolean | null>(null);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [launchingUltron, setLaunchingUltron] = useState(false);
  const [humanoidPhase, setHumanoidPhase] = useState<"off" | "in" | "active" | "out">("off");
  // EV marketing agent — cinematic overlay presentation of the same JARVIS brain.
  const [evPhase, setEvPhase] = useState<"off" | "in" | "active" | "out">("off");
  const [evCommand, setEvCommand] = useState("");
  const [evAwaitingApproval, setEvAwaitingApproval] = useState(false);
  const [evPulse, setEvPulse] = useState<null | "success" | "error">(null);
  const [evImage, setEvImage] = useState<{ url: string } | null>(null);
  const evImageRef = useRef<{ url: string } | null>(null);
  evImageRef.current = evImage;
  // "publish" voice/text → bumps this; the EV image message performs the real post.
  const [evPublishSignal, setEvPublishSignal] = useState(0);
  const [evCaptionOverride, setEvCaptionOverride] = useState<string | undefined>();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  // JARVIS's glass browser pop-up — links open here instead of a new tab
  const [browser, setBrowser] = useState<BrowserTarget | null>(null);
  const browserRef = useRef<BrowserTarget | null>(null);
  browserRef.current = browser;
  const showInJarvis = useCallback((site: SiteTarget) => { setBrowser({ url: site.url, label: site.label, key: Date.now() }); }, []);
  const fetchWeatherRef = useRef<(place?: string) => void>(() => {});
  const evActiveRef = useRef(false);
  const evPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const readScreenRef = useRef<(prompt?: string) => void>(() => {});
  const screen = useScreenVision();
  // The motion OS: canvas engine + DOM layers that follow it.
  const motion = useRef<JarvisMotionHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState<{ logo: boolean; online: boolean; done: boolean }>({ logo: false, online: false, done: false });
  // ===== previous-day intelligence briefing =====
  const [brief, setBrief] = useState<{ phase: "analyzing" | "open"; data: Briefing | null; error: string | null; closing: boolean } | null>(null);
  const [briefSpeaking, setBriefSpeaking] = useState(false);
  const openBriefingRef = useRef<(range?: { from: string; to: string; label: string }) => Promise<void>>(async () => {});
  const [layout, setLayout] = useState<{ hub: Pt; agents: Record<AgentName, Pt>; ribbonY: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [anomalyAt, setAnomalyAt] = useState<Pt | null>(null);
  const [buildLabel, setBuildLabel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [services, setServices] = useState<Record<string, boolean> | null>(null);
  // A tool can finish in milliseconds — EXECUTING stays on screen for a beat.
  const [execHold, setExecHold] = useState(false);
  const execTimer = useRef<ReturnType<typeof setTimeout>>();
  const holdExecuting = useCallback(() => {
    setExecHold(true);
    clearTimeout(execTimer.current);
    execTimer.current = setTimeout(() => setExecHold(false), 1500);
  }, []);
  const turnTool = useRef(false);
  const turnFailed = useRef(false);

  const onNavigate = useCallback((path: string) => {
    if (path.startsWith("/dashboard") && path !== "/dashboard") router.push(path);
  }, [router]);

  const flashEv = useCallback((kind: "success" | "error") => {
    if (evPulseTimer.current) clearTimeout(evPulseTimer.current);
    setEvPulse(kind);
    if (kind === "success") motion.current?.agentReturn("EV");
    evPulseTimer.current = setTimeout(() => setEvPulse(null), kind === "success" ? 1500 : 1300);
  }, []);

  // EV runs inside this console; while it's active JARVIS speaks in EV's voice.
  const voice = useVoice({
    onTranscript: (t) => sendRef.current(t),
    autoListen: true,
    voiceProfile: evPhase === "off" ? "jarvis" : "ev",
  });
  // The reply is spoken sentence by sentence while it streams in, so JARVIS
  // starts talking after the first sentence rather than the whole answer.
  const speechRef = useRef<SpeechStream | null>(null);
  // Emails being sent open in the liquid-glass compose popup and type out live.
  const emails = useEmailPopups();
  // NIOS board watcher: new official notices pop up here and are spoken.
  const nios = useNiosWatch({ speak: (t) => { if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(t); } catch { /* ignore */ } } } });
  // EV daily content: today's post + Reel. The hook keeps the pipeline moving
  // while JARVIS is open and tells us when something real changes.
  const [evToday, setEvToday] = useState(false);
  const dailyAskedAt = useRef(0);
  const sayRef = useRef<(t: string) => void>(() => {});
  const watchRenderRef = useRef<(p: Parameters<ReturnType<typeof useRenderWatch>["watch"]>[0]) => void>(() => {});
  const agentRef = useRef<{ appendLocalExchange: (u: string, a: string, l?: { url: string; label: string }[], o?: { note?: boolean }) => void }>({ appendLocalExchange: () => {} });
  const daily = useDailyContent({
    onChange: (kind, v) => {
      const p = v.pkg;
      if (kind === "ready") {
        dailyAskedAt.current = Date.now();
        sayRef.current(evActiveRef.current ? "Today's content is ready. Would you like me to publish it?" : "EV has today's Instagram content ready for your approval.");
      } else if (kind === "published") { flashEv("success"); sayRef.current("Today's content is published on Instagram."); }
      else if (kind === "publish_error" && p?.publishError) { flashEv("error"); sayRef.current(`It's approved, but it isn't published yet. ${p.publishError}`); }
      else if (kind === "failed" && evActiveRef.current) sayRef.current(v.spoken);
    },
  });
  const dailyRef = useRef(daily); dailyRef.current = daily;
  // DARWIN's daily lead search reports here when it's done.
  const darwinReport = useDarwinReport({ speak: (t) => sayRef.current(t) });
  const darwinReportRef = useRef(darwinReport); darwinReportRef.current = darwinReport;
  // Gesture control shares this console's command router with your voice.
  const gesture = useGesture();
  const gestureRef = useRef(gesture); gestureRef.current = gesture;
  const agent = useAgent({
    onTextDelta: (delta) => {
      if (!(voiceStarted && !voice.muted && voice.enabled)) return;
      if (!speechRef.current) speechRef.current = voice.speakStream();
      speechRef.current.push(delta);
    },
    onAssistantComplete: (text) => {
      // EV prepares content by presenting "CONTENT READY …" — that's the signal
      // it's waiting for the user's approval before any external action.
      if (evActiveRef.current && /content ready|awaiting (your )?approval|for your approval/i.test(text)) {
        setEvAwaitingApproval(true);
      }
      const stream = speechRef.current;
      speechRef.current = null;
      if (stream) stream.end();
      else if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text);
    },
    // Failed / aborted turn: finish whatever was already being spoken.
    onTurnEnd: () => { speechRef.current?.end(); speechRef.current = null; },
    onEmail: emails.push,
    onTool: (t) => {
      holdExecuting();
      if (t.status === "ok") turnTool.current = true;
      else if (!turnFailed.current) { turnFailed.current = true; motion.current?.anomaly(); }
      if (!evActiveRef.current) return;
      if (t.status === "error") { flashEv("error"); return; }
      if (/waiting for (your )?approval|ready for (your )?approval|for your approval|is ready for your approval/i.test(t.summary)) {
        setEvAwaitingApproval(true);
      }
      if (/✅|\bpublished\b|\bscheduled\b|\bapproved\b/i.test(t.summary)) {
        setEvAwaitingApproval(false);
        flashEv("success");
      }
    },
    onNavigate,
    onOpenApp: (names) => { void openAppsRef.current("", names); },
    // A Magic Hour render still going — watched in the background, shown when done.
    onPendingMedia: (p) => watchRenderRef.current(p),
    onOpen: (url) => {
      // An EV-generated image reveals as a liquid-glass message inside the EV
      // dashboard rather than hijacking a tab.
      if (evActiveRef.current && /\/api\/ev\/media\//.test(url)) {
        setEvImage({ url });
        flashEv("success");
        return;
      }
      // Otherwise open it right here, in JARVIS's glass browser (never hijack
      // this tab, and no pop-up blocker in the way).
      let label = url;
      try { label = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
      showInJarvis({ url, label });
    },
  });

  // EV's Magic Hour renders finish minutes later: show them the moment they're done.
  const renders = useRenderWatch({
    onReady: (r) => {
      const what = r.kind === "video" ? "video" : "image";
      if (evActiveRef.current) { setEvImage({ url: r.url }); flashEv("success"); }
      const msg = `Your ${what} is ready${r.label ? ` — ${r.label}` : ""}.`;
      agentRef.current.appendLocalExchange("", msg, [{ url: r.url, label: r.kind === "video" ? "View video" : "View image" }], { note: true });
      sayRef.current(`Your ${what} is ready.`);
    },
    onNote: (_r, note) => {
      agentRef.current.appendLocalExchange("", note, undefined, { note: true });
      sayRef.current(note);
    },
    onFailed: (r) => {
      if (evActiveRef.current) flashEv("error");
      agentRef.current.appendLocalExchange("", `The ${r.kind} didn't render. ${r.error}`, undefined, { note: true });
      sayRef.current(`The ${r.kind} didn't render. ${r.error}`);
    },
  });
  watchRenderRef.current = renders.watch;
  agentRef.current = agent;

  const sleep = useCallback(() => { voice.stop(); setVoiceStarted(false); }, [voice]);
  sayRef.current = (t: string) => { if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(t); } catch { /* ignore */ } } };
  // "open Spotify" → the installed app on this PC (via ULTRON); "open YouTube"
  // → a new tab. Which one is decided instantly from the installed-app list, so
  // a website's tab opens inside the keypress that allows it.
  const openAppsRef = useRef<(said: string, names: string[], o?: { strong?: boolean; fallback?: () => void }) => Promise<void>>(async () => {});
  openAppsRef.current = async (said, names, o = {}) => {
    const strong = o.strong ?? true;
    const plan = planOpen(names, { installed: installedAppNames(), ultronKnown: ultronKnown(), india: inIndia() });
    // The first website opens in JARVIS's glass browser; more (or "in a new
    // tab") open as tabs, which start NOW (before any await).
    const wantTab = NEW_TAB.test(said);
    let popupUsed = false;
    const openWeb = (site: SiteTarget): Promise<OpenedHow> => {
      if (!wantTab && !popupUsed) { popupUsed = true; showInJarvis(site); return Promise.resolve("jarvis"); }
      return openSite(site);
    };
    const tabs = plan.map((p) => (p.kind === "web" ? openWeb(p.site) : null));
    const opened: string[] = [], missing: string[] = [], notes: string[] = [], blocked: string[] = [];
    const links: { url: string; label: string }[] = [];
    let offline: string | null = null;
    const web = (site: SiteTarget, how: OpenedHow, note?: string) => {
      links.push({ url: site.url, label: `Open ${site.label}` });
      if (how === "blocked") blocked.push(site.label);
      else if (note) notes.push(note);
      else opened.push(how === "pc" ? `${site.label} in your browser` : site.label);
    };
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      if (p.kind === "web") { web(p.site, await tabs[i]!); continue; }
      const r = await openLocalApp(p.name);
      if (r.ok) { opened.push(r.app); continue; }
      if (p.site) {
        web(p.site, await openWeb(p.site), r.reason === "not_found" ? `${p.site.label} isn't installed as an app on this PC, so I opened the website instead.` : undefined);
        continue;
      }
      if (r.reason === "not_found") missing.push(r.suggestions.length ? `${p.name} (did you mean ${r.suggestions.join(" or ")}?)` : p.name);
      else offline = r.message;
    }
    if (!strong && !opened.length && !links.length) { o.fallback?.(); return; }
    const parts: string[] = [];
    if (opened.length) parts.push(`Opening ${opened.length > 1 ? `${opened.slice(0, -1).join(", ")} and ${opened[opened.length - 1]}` : opened[0]}.`);
    parts.push(...notes);
    if (blocked.length) parts.push(blockedLine(blocked));
    if (missing.length) parts.push(`I couldn't find ${missing.join(", ")} installed on this computer.`);
    if (offline) parts.push(offline);
    const msg = parts.join(" ");
    agent.appendLocalExchange(said, msg, links.length ? links : undefined);
    sayRef.current(msg.replace(/ \(did you mean[^)]*\)/g, "").replace(/ — click .*$/, "."));
    if (opened.length) {
      motion.current?.taskComplete();
      logActivity({ category: "agent", agent: "JARVIS", action: `Opened ${opened.join(", ")} on the PC`, importance: 1 });
    }
  };
  // "open https://…", "go to youtube.com", "search YouTube for lo-fi", "open that link"
  const openWebRef = useRef<(said: string, site: SiteTarget) => void>(() => {});
  openWebRef.current = (said, site) => {
    const links = [{ url: site.url, label: `Open ${site.label}` }];
    if (!NEW_TAB.test(said)) {
      showInJarvis(site);
      const msg = `Opening ${site.label}.`;
      agent.appendLocalExchange(said, msg, links);
      sayRef.current(msg);
      return;
    }
    void openSite(site).then((how) => {
      const msg = how === "blocked" ? blockedLine([site.label]) : how === "pc" ? `Opening ${site.label} in your browser.` : `Opening ${site.label}.`;
      agent.appendLocalExchange(said, msg, links);
      sayRef.current(msg.replace(/ — click .*$/, "."));
    });
  };
  // Keep the installed-app list fresh (only once ULTRON has been used on this browser).
  useEffect(() => {
    const refresh = () => { if (ultronKnown()) void refreshInstalledApps(); };
    refresh();
    const iv = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(iv); window.removeEventListener("focus", refresh); };
  }, []);
  const launchUltron = useCallback(() => {
    if (launchingUltron) return;
    setLaunchingUltron(true);
    // The developer agent: a website assembles itself on a holographic canvas,
    // a data stream links JARVIS → ULTRON, then ULTRON takes over.
    motion.current?.buildWebsite();
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Bringing ULTRON online.");
    setTimeout(() => router.push("/dashboard/ultron"), 3200);
  }, [router, voice, voiceStarted, launchingUltron]);
  const launchDarwin = useCallback(() => {
    motion.current?.activateAgent("DARWIN");
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Opening DARWIN. Lead systems online.");
    setTimeout(() => router.push("/dashboard/darwin"), 1000);
  }, [router, voice, voiceStarted]);
  const launchMike = useCallback(() => {
    // MIKE takes over the trading-analysis interface.
    logActivity({ category: "agent", agent: "MIKE", action: "Activated MIKE", importance: 1 });
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Activating MIKE. Market intelligence online.");
    setTimeout(() => router.push("/dashboard/mike"), 900);
  }, [router, voice, voiceStarted]);
  const openHumanoid = useCallback(() => {
    logActivity({ category: "agent", agent: "HUMANOID", action: "Opened Humanoid View", importance: 1 });
    setHumanoidPhase("in");
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Humanoid view activated.");
    setTimeout(() => setHumanoidPhase("active"), 1400);
  }, [voice, voiceStarted]);
  const closeHumanoid = useCallback(() => {
    setHumanoidPhase("out");
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Returning to the normal interface.");
    setTimeout(() => setHumanoidPhase("off"), 900);
  }, [voice, voiceStarted]);
  const openEv = useCallback(() => {
    logActivity({ category: "agent", agent: "EV", action: "Opened EV", importance: 1 });
    motion.current?.activateAgent("EV");
    evActiveRef.current = true;
    setEvAwaitingApproval(false);
    setEvCommand("");
    setEvPhase("in");
    // Opening EV shows TODAY'S CONTENT first, and EV says where it really stands.
    const v = dailyRef.current.view;
    if (v?.pkg) setEvToday(true);
    const st = v?.pkg?.status;
    if (st === "ready") dailyAskedAt.current = Date.now();
    const line = st === "ready" ? "EV online. Today's content is ready. Would you like me to publish it?"
      : v?.pkg && st !== "published" ? `EV online. ${v.spoken}`
      : "EV online. Marketing systems ready.";
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak(line);
    setTimeout(() => setEvPhase("active"), 1400);
  }, [voice, voiceStarted]);
  const closeEv = useCallback(() => {
    evActiveRef.current = false;
    setEvImage(null);
    setEvToday(false);
    setEvPhase("out");
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("EV standing down. Back to JARVIS.");
    setTimeout(() => setEvPhase("off"), 900);
  }, [voice, voiceStarted]);

  // Real weather → liquid-glass popup with a live animated scene.
  const fetchWeather = useCallback(async (place?: string) => {
    const speak = (t: string) => { if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(t); } catch { /* ignore */ } } };
    const blank = (extra: Partial<WeatherData>): WeatherData => ({
      location: { name: "", country: "", admin: "", timezone: null },
      current: { temp: 0, feelsLike: 0, humidity: 0, wind: 0, isDay: true, condition: "", icon: "cloudy" },
      daily: [], ...extra,
    });
    const errObj = (msg: string): WeatherData => blank({ error: msg });
    // Open the glass popup IMMEDIATELY in a loading state, so the request is
    // visibly acknowledged even before the forecast arrives.
    setWeather(blank({ loading: true, location: { name: place ?? "", country: "", admin: "", timezone: null } }));
    try {
      let url = "";
      if (place) {
        url = `/api/weather?q=${encodeURIComponent(place)}&cc=${viewerCountry()}`;
      } else {
        // No place named → try the browser's location; fall back to asking.
        // Race against a hard timeout: some browsers never fire either callback
        // while the permission prompt is still open.
        const coords = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          const hard = setTimeout(() => resolve(null), 8000);
          navigator.geolocation.getCurrentPosition(
            (p) => { clearTimeout(hard); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
            () => { clearTimeout(hard); resolve(null); },
            { timeout: 6000, maximumAge: 600000 },
          );
        });
        if (!coords) { speak("Which city's weather would you like?"); setWeather(errObj("Tell me a city — e.g. “weather in London”.")); return; }
        url = `/api/weather?lat=${coords.lat}&lon=${coords.lon}`;
      }
      const res = await fetch(url);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setWeather(errObj(j.error || "Weather is unavailable right now.")); return; }
      const data: WeatherData = j.data;
      setWeather(data);
      speak(`It's ${data.current.temp} degrees and ${data.current.condition.toLowerCase()} in ${data.location.name}.`);
    } catch {
      setWeather(errObj("Network error — couldn't reach the weather service."));
    }
  }, [voice, voiceStarted]);
  useEffect(() => { fetchWeatherRef.current = fetchWeather; }, [fetchWeather]);
  // "Shut down my laptop" waits for a spoken/typed yes (20 s) before anything happens.
  const pendingShutdown = useRef<{ delaySec: number; until: number } | null>(null);
  useEffect(() => {
    sendRef.current = (t: string) => {
      const low = t.toLowerCase().trim();
      const reply = (answer: string) => {
        agent.appendLocalExchange(t, answer);
        if (voiceStarted && !voice.muted && voice.enabled) voice.speak(answer);
      };

      // ===== memory: "remember that …", "forget …", "what do you remember?" =====
      // Saved straight to the database (shared by every agent and brain) — no AI
      // needed, so it's kept even when the PC brain is off.
      if (parseMemoryCommand(t)) {
        fetch("/api/memories/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) })
          .then(async (r) => {
            const j = await r.json().catch(() => ({}));
            const d = j?.data;
            if (!r.ok || !d) { reply(j?.error || "I couldn't reach my memory just now — say it again in a moment."); return; }
            if (!d.handled) { agent.send(t, evActiveRef.current ? { agent: "ev" } : undefined); return; }
            if (d.kind === "list" && d.memories?.length) {
              agent.appendLocalExchange(t, `${d.message}\n\n${(d.memories as string[]).map((m) => `• ${m}`).join("\n")}`);
              if (voiceStarted && !voice.muted && voice.enabled) voice.speak(d.message);
              return;
            }
            reply(d.message);
            if (d.kind === "remember" && d.saved) motion.current?.taskComplete();
          })
          .catch(() => reply("I couldn't reach my memory just now — say it again in a moment."));
        return;
      }

      // ===== gesture mode (camera opens only while it's on) =====
      const gm = gestureModeCommand(t);
      if (gm && gestureRef.current) {
        const g = gestureRef.current;
        if (gm === "off") { g.disable(); reply("Gesture mode off. I've released the camera."); return; }
        reply("Gesture mode on. Raise your hand when you're ready.");
        void g.enable().then((ok) => { if (!ok) setTimeout(() => { const e = gestureRef.current?.error; if (e) reply(e); }, 50); });
        return;
      }

      // ===== DARWIN's daily lead search: "DARWIN report", "how many leads did DARWIN find today" =====
      if (darwinDailyRequest(t)) {
        const w = darwinReportRef.current;
        void w.reload().then((v) => {
          if (!v) { reply("I couldn't reach DARWIN right now."); return; }
          reply(darwinProgressLine({ run: v.run, startLabel: v.startLabel, due: v.due }, v.spoken));
          if (v.report) w.openReport();
        });
        return;
      }

      // ===== laptop power (confirm first; always cancellable) =====
      const pend = pendingShutdown.current;
      if (pend && Date.now() < pend.until) {
        const yes = parseConfirmation(t);
        if (yes !== null) {
          pendingShutdown.current = null;
          if (!yes) { reply("Okay — I won't shut the laptop down."); return; }
          void laptopPower("shutdown", pend.delaySec).then((r) => reply(r.ok
            ? `Shutting down your laptop in ${spokenDelay(pend.delaySec)}. Save your work — say "cancel shutdown" if you change your mind.`
            : r.message));
          return;
        }
      }
      pendingShutdown.current = null;
      const power = parsePowerIntent(t);
      if (power?.kind === "cancel") {
        void laptopPower("cancel").then((r) => reply(r.ok ? "Shutdown cancelled — your laptop stays on." : r.message));
        return;
      }
      if (power?.kind === "shutdown") {
        pendingShutdown.current = { delaySec: power.delaySec, until: Date.now() + 20_000 };
        reply(`Shut down your laptop? Say "yes" to confirm — it will power off ${spokenDelay(power.delaySec)} later, and you can still say "cancel shutdown".`);
        return;
      }

      // ===== "What did I do yesterday?" / "last week" / "on September 25" → the briefing =====
      const hist = briefingRequest(t, browserTz());
      if (hist) { void openBriefingRef.current(hist.label === "Yesterday" ? undefined : hist); return; }

      if (/\b(go to sleep|jarvis[,\s]*sleep|sleep now|power down|good ?night|stand ?by)\b/.test(low)) { sleep(); return; }

      // ===== EV marketing agent =====
      // Deactivate first (only meaningful while EV is active).
      if (evActiveRef.current &&
          (/\b(close|exit|deactivate|shut ?down)\s+ev\b|\bback to jarvis\b|\bev[,\s]+(stand down|close|exit)\b/.test(low) || /^(close|exit)[\s!.,]*$/.test(low))) {
        closeEv();
        return;
      }
      // Activate EV.
      if (evPhase === "off" &&
          (/\b(activate|open|start|launch|bring up|switch to|go to)\s+ev\b|\bev\s+mode\b|^ev[\s!.,]*$/.test(low))) {
        openEv();
        return;
      }
      // ===== EV daily content (TODAY'S CONTENT) =====
      const dc = parseDailyCommand(t);
      const dv = dailyRef.current.view;
      const dp = dv?.pkg ?? null;
      const mentionsToday = /\btoday'?s?\b|\bdaily\b/.test(low);
      if (dc && !evImageRef.current && (evActiveRef.current || mentionsToday)) {
        const recentlyAsked = Date.now() - dailyAskedAt.current < 3 * 60_000;
        const panel = evActiveRef.current && evToday;
        const run = (a: DailyUiAction) => {
          if (!evActiveRef.current) openEv();
          setEvToday(true);
          void dailyRef.current.act(a).then((r) => {
            if (!r.ok) flashEv("error");
            agent.appendLocalExchange(t, r.message);
            sayRef.current(r.message);
          });
        };
        if (dc.action === "show" || dc.action === "status") {
          if (!evActiveRef.current) openEv();
          setEvToday(true);
          if (dc.action === "status" || evActiveRef.current) { const line = dv?.spoken ?? "Loading today's content."; agent.appendLocalExchange(t, line); sayRef.current(line); }
          if (dp?.status === "ready") dailyAskedAt.current = Date.now();
          return;
        }
        if (dc.action === "decline" && recentlyAsked && dp?.status === "ready") {
          dailyAskedAt.current = 0;
          reply("Okay — I'll keep it ready. Say \"publish it\" whenever you want.");
          return;
        }
        if (dc.action === "approve" && dp && (!dc.weak || recentlyAsked)) {
          if (dp.status === "ready" || (dp.status === "approved" && dp.publishError)) { dailyAskedAt.current = 0; run({ action: "approve" }); return; }
          if (panel || mentionsToday) { reply(dv!.spoken); return; }
        }
        if (dp && (panel || mentionsToday || recentlyAsked)) {
          switch (dc.action) {
            case "reject": case "regenerate": case "another": case "video": case "retry":
              run({ action: dc.action }); return;
            case "caption":
              run(dc.caption ? { action: "caption", caption: dc.caption, instruction: dc.instruction } : { action: "caption", instruction: dc.instruction }); return;
            case "tone":
              run({ action: "tone", tone: dc.tone, instruction: dc.instruction }); return;
          }
        }
        if (!dp && dv && (dc.action === "approve" || mentionsToday) && !("weak" in dc && dc.weak)) {
          if (!evActiveRef.current) openEv();
          setEvToday(true);
          reply(dv.spoken);
          return;
        }
      }
      // "publish" with an EV image on screen → post THAT image + caption to
      // Instagram directly (your words are the approval), no model round-trip.
      if (evActiveRef.current && evImageRef.current && EV_PUBLISH_RE.test(low) && !EV_NEW_CONTENT_RE.test(low.replace(/caption.*$/, ""))) {
        setEvCommand(t);
        setEvCaptionOverride(captionFromCommand(t));
        setEvPublishSignal((n) => n + 1);
        return;
      }
      // While EV is active, everything else goes to EV's marketing brain.
      if (evActiveRef.current) {
        setEvCommand(t);
        setEvAwaitingApproval(false);
        agent.send(t, { agent: "ev" });
        return;
      }

      // Humanoid View mode switch (works from either mode).
      if (/\b(open|show|activate|enter|start)\s+(the\s+)?humanoid(\s+view)?\b|\bhumanoid view\b|\bshow yourself\b/.test(low)) { openHumanoid(); return; }
      if (/\b(get me |go |take me )?back to (the )?normal( interface| view)?\b|\b(close|exit|leave)\s+humanoid\b|\bnormal (interface|view|mode)\b/.test(low)) { closeHumanoid(); return; }
      // "ULTRON", "open ULTRON", "activate ULTRON", "developer mode" → launch ULTRON.
      // Also catches common mishearings ("ultra on", "altron") and the old name EDITH.
      const U = "(?:ultron|ultra[\\s-]?on|altron|ultran|edith)";
      if (new RegExp(`^${U}[\\s!.,]*$|\\b(open|launch|activate|start|switch to|go to|bring up)\\s+${U}\\b|\\b${U}[,\\s]+(come online|wake up|online|developer mode)\\b|\\bdeveloper mode\\b`).test(low)) {
        launchUltron();
        return;
      }
      // "Learn my preferences" / "learn from our past chats" → save lasting facts
      // from earlier conversations as memories (shared by every agent and brain).
      if (/\blearn\b.*\b(my preferences|about me|from (our|my) (past |old |previous )?(chats|conversations))\b/.test(low)) {
        const say = (m: string) => { if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(m); } catch { /* ignore */ } } };
        say("Reading our past chats. This can take a minute.");
        fetch("/api/memories/learn", { method: "POST" })
          .then(async (r) => {
            const j = await r.json().catch(() => ({}));
            const msg = !r.ok ? (j.error || "I couldn't read our past chats right now.")
              : j.data.scanned === 0 ? "There are no past chats to learn from yet."
              : `Done — I learned ${j.data.added.length} new thing${j.data.added.length === 1 ? "" : "s"} about you${j.data.alreadyKnown ? ` and already knew ${j.data.alreadyKnown}` : ""}. You can see them on the Memory page.`;
            agent.appendLocalExchange(t, msg);
            say(msg);
          })
          .catch(() => { agent.appendLocalExchange(t, "I couldn't reach the server."); say("I couldn't reach the server."); });
        return;
      }
      // "Activate Mike", "open MIKE", "Mike online" → MIKE takes over (trading intelligence).
      if (/^mike[\s!.,]*$|\b(open|launch|activate|start|switch to|go to|bring up)\s+mike\b|\bmike[,\s]+(online|wake up|come online|take over)\b/.test(low)) {
        launchMike();
        return;
      }
      // "DARWIN", "open DARWIN", "activate DARWIN" → open the lead-gen/CRM console.
      if (/^darwin[\s!.,]*$|\b(open|launch|activate|start|switch to|go to|bring up)\s+darwin\b|\bdarwin[,\s]+(online|wake up|come online)\b/.test(low)) {
        launchDarwin();
        return;
      }
      // "Open Spotify", "launch VS Code", "start WhatsApp and Spotify" → the real
      // app on this PC. "start/run …" only counts when such an app is installed;
      // otherwise it carries on to JARVIS's brain ("run the tests" isn't an app).
      // "close the browser", "close it" while the glass browser is open
      if (browserRef.current && /^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:please\s+)?(?:close|exit|hide|dismiss|shut)\s+(?:the\s+|this\s+|that\s+)?(?:browser|web ?page|website|site|page|tab|pop-?up|window|video|it)(?:\s+please)?[.!\s]*$/i.test(t)) {
        setBrowser(null);
        agent.appendLocalExchange(t, "Closed.");
        sayRef.current("Closed.");
        return;
      }
      // "open that link", "open the second link" → a link already in the chat.
      const ref = evActiveRef.current ? null : parseOpenLinkRef(t);
      if (ref) {
        const link = pickLink(agent.messages, ref);
        if (link) openWebRef.current(t, { url: link.url, label: link.label.replace(/^Open\s+/i, "") });
        else { const msg = "There's no link in our conversation yet — tell me the site or paste the address."; agent.appendLocalExchange(t, msg); sayRef.current(msg); }
        return;
      }
      const apps = evActiveRef.current ? null : parseOpenApp(t);
      if (apps) {
        const strong = !/^\s*(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:start|run)\b/i.test(t);
        void openAppsRef.current(t, apps, { strong, fallback: () => agent.send(t) });
        return;
      }
      // "Open Amazon", "go to youtube.com", "search Flipkart for shoes" → open the
      // site right now, while the keypress/click still allows a new tab (an AI
      // round trip first — especially on the PC brain — gets it pop-up-blocked).
      const site = evActiveRef.current ? null : parseOpenSite(t, { india: inIndia() });
      if (site) {
        openWebRef.current(t, site);
        return;
      }
      // "read my screen", "what's on my screen", "look at my screen"…
      if (/\b(read|look at|see|analyz|check|what('?s| is) on).{0,20}\b(screen|display|monitor)\b/.test(low)) {
        readScreenRef.current(t);
        return;
      }
      // "what's the weather", "forecast for Tokyo", "will it rain in London" →
      // real forecast in the animated liquid-glass weather popup.
      if (WEATHER_RE.test(low)) {
        fetchWeatherRef.current(parseWeatherPlace(t));
        return;
      }
      // Time, date and plain arithmetic are answered right here — instantly,
      // with no AI round trip (EV keeps its own conversation).
      const instant = evActiveRef.current ? null : instantAnswer(t);
      if (instant) {
        agent.appendLocalExchange(t, instant);
        if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(instant); } catch { /* ignore */ } }
        return;
      }
      agent.send(t);
    };
  }, [agent, sleep, launchUltron, launchDarwin, launchMike, openHumanoid, closeHumanoid, openEv, closeEv, evPhase, evToday, flashEv, voice, voiceStarted]);

  // Voice was on in the agent you just left → switch it back on here.
  const resumingVoice = useResumeVoice(enableVoice);
  const wake = useWakeWord({
    // The "hey Jarvis" listener only runs while voice is off, and stays out of
    // the way while voice is being resumed (two recognizers would fight).
    enabled: !voiceStarted && !resumingVoice,
    onWake: async () => { const ok = await enableVoice(); if (ok && voiceConfigured) setTimeout(() => voice.speak("Yes?"), 350); },
  });

  useEffect(() => {
    fetch("/api/voice/config").then((r) => (r.ok ? r.json() : null))
      .then((j) => setVoiceConfigured(j?.data?.configured ?? false))
      .catch(() => setVoiceConfigured(false));
    fetch("/api/status").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data?.services && setServices(j.data.services)).catch(() => {});
  }, []);

  // A turn ends: a real task (a tool ran OK) → COMPLETE; a failure → ANOMALY.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (agent.streaming && !wasStreaming.current) { turnTool.current = false; turnFailed.current = false; setDismissedId(null); }
    if (!agent.streaming && wasStreaming.current) {
      const failed = agent.activity[0]?.kind === "error";
      if (failed && !turnFailed.current) motion.current?.anomaly();
      else if (!failed && turnTool.current && !turnFailed.current) motion.current?.taskComplete();
    }
    wasStreaming.current = agent.streaming;
  }, [agent.streaming, agent.activity]);

  const orbState: OrbState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "error";
    if (voice.status === "speaking") return "speaking";
    if (agent.streaming) return agent.activity[0]?.kind === "tool" ? "executing" : "thinking";
    if (voice.status === "recording") return "listening";
    if (voice.status === "processing") return "thinking";
    if (voice.status === "listening") return "listening";
    return "idle";
  })();

  // EV operating state — derived from the SAME real voice + agent signals.
  const evState: EvState = (() => {
    if (evPulse === "error" || voice.status === "denied" || voice.status === "error") return "ERROR";
    if (evPulse === "success") return "SUCCESS";
    if (evAwaitingApproval && !agent.streaming) return "WAITING_FOR_APPROVAL";
    if (agent.streaming) {
      const act = agent.activity[0];
      if (act?.kind === "tool") return "EXECUTING";
      if (/content|idea|caption|reel|post|story|\bad\b|draft|writ|generat/i.test(act?.label ?? "")) return "GENERATING";
      return "THINKING";
    }
    if (voice.status === "speaking") return "GENERATING";
    if (voice.status === "recording" || voice.status === "listening") return "LISTENING";
    if (voice.status === "processing") return "THINKING";
    return "IDLE";
  })();
  const evActivity = agent.streaming
    ? (agent.activity[0]?.label ?? "Thinking…")
    : evState === "WAITING_FOR_APPROVAL" ? "Waiting for approval…"
    : evState === "LISTENING" ? "Listening…"
    : evState === "SUCCESS" ? "Done."
    : evState === "ERROR" ? "Something went wrong."
    : voice.status === "speaking" ? "Speaking…"
    : "Idle";

  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }
  const focusCommand = useCallback((prefill?: string) => {
    if (prefill != null) setInput(prefill);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  }, []);

  // ---- previous-day briefing: core scans → glass popup → voice → back to normal ----
  const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
  const briefReqRef = useRef(0);
  const openBriefing = useCallback(async (range?: { from: string; to: string; label: string }) => {
    const req = ++briefReqRef.current;
    voice.stopSpeaking();
    setBriefSpeaking(false);
    setBrief({ phase: "analyzing", data: null, error: null, closing: false });
    const started = Date.now();
    const qs = new URLSearchParams({ tz: browserTz(), ...(range ? { from: range.from, to: range.to, label: range.label } : {}) });
    let data: Briefing | null = null, error: string | null = null;
    try {
      const res = await fetch(`/api/briefing?${qs}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok) data = j.data as Briefing; else error = j.error || "I couldn't load the briefing.";
    } catch { error = "I couldn't reach the server for the briefing."; }
    // Let the core's scan play for a beat before the glass materialises.
    const wait = Math.max(0, 1100 - (Date.now() - started));
    setTimeout(() => { if (req === briefReqRef.current) setBrief({ phase: "open", data, error, closing: false }); }, wait);
  }, [voice]);
  useEffect(() => { openBriefingRef.current = openBriefing; }, [openBriefing]);
  const speakBriefing = useCallback(async (force = false) => {
    const text = brief?.data?.spoken;
    if (!text) return;
    let ready = voiceStarted && !voice.muted && voice.enabled;
    if (!ready && force) ready = await enableVoice();
    if (!ready) return;
    voice.stopSpeaking();
    setBriefSpeaking(true);
    try { await voice.speak(text); } finally { setBriefSpeaking(false); }
  }, [brief?.data?.spoken, voice, voiceStarted]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeBriefing = useCallback(() => {
    voice.stopSpeaking(); setBriefSpeaking(false);
    setBrief((b) => (b ? { ...b, closing: true } : b));
    setTimeout(() => setBrief(null), 450);
  }, [voice]);
  const forgetEvent = useCallback(async (id: string) => {
    const res = await fetch(`/api/activity/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok || !brief?.data) return;
    const { from, to, label } = brief.data;
    // Recompute from the history so every number reflects the removal.
    const qs = new URLSearchParams({ tz: browserTz(), from, to, label });
    const j = await fetch(`/api/briefing?${qs}`).then((r) => r.json()).catch(() => null);
    if (j?.data) setBrief((b) => (b ? { ...b, data: j.data } : b));
  }, [brief?.data]);
  // Opening JARVIS: brief on yesterday once per session (a refresh doesn't repeat it).
  useEffect(() => {
    if (!intro.done) return;
    const key = `jarvis.briefing.${yesterdayIn(browserTz())}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* private mode: still brief */ }
    const t = setTimeout(() => { if (evPhase === "off" && humanoidPhase === "off") void openBriefing(); }, 700);
    return () => clearTimeout(t);
  }, [intro.done]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const t = input.trim(); if (!t) return;
    // The command dissolves into particles that fly up into the environment.
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect && evPhase === "off" && humanoidPhase === "off") motion.current?.commandToParticles(t, rect);
    setInput("");
    // Route typed commands through the same handler as voice, so "open ULTRON",
    // "read my screen", "go to sleep" etc. trigger their shortcuts too.
    sendRef.current(t);
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("prompt", input.trim() || "Analyze this file and summarize it.");
      setInput("");
      const res = await fetch("/api/files/analyze", { method: "POST", body: form });
      const j = await res.json();
      const answer = res.ok ? j.data.answer : j.error || "Could not analyze the file.";
      agent.appendLocalExchange(`📎 ${file.name}`, answer);
      if (voiceStarted && !voice.muted && res.ok) voice.speak(answer);
    } finally { setUploading(false); }
  }

  const readScreen = useCallback(async (prompt?: string) => {
    if (!screen.supported) {
      agent.appendLocalExchange("🖥️ Read my screen", "Screen reading isn't supported in this browser. Try Chrome or Edge on desktop.");
      return;
    }
    try {
      const result = await screen.readScreen(prompt);
      if (!result) return; // user cancelled the picker
      agent.appendLocalExchange(prompt || "🖥️ Read my screen", result.answer);
      if (voiceStarted && !voice.muted && voice.enabled) voice.speak(result.answer);
    } catch (e: any) {
      agent.appendLocalExchange("🖥️ Read my screen", e?.message || "JARVIS couldn't read the screen.");
    }
  }, [screen, agent, voice, voiceStarted]);
  readScreenRef.current = readScreen;

  const lastAssistant = [...agent.messages].reverse().find((m) => m.role === "assistant");
  const lastUserMsg = [...agent.messages].reverse().find((m) => m.role === "user");
  const subtitle = lastAssistant?.content ?? "";
  const subtitleLinks = lastAssistant?.links ?? [];
  // The caption under a creative on EV's screen is EV's own words — never a note like "your video is ready".
  const evCaption = evImage ? ([...agent.messages].reverse().find((m) => m.role === "assistant" && !m.note)?.content ?? "") : subtitle;
  const hasMessages = agent.messages.length > 0;

  // ================= what the motion OS shows =================
  const latest = agent.activity[0];
  useEffect(() => () => clearTimeout(execTimer.current), []);
  const jState: JState = (() => {
    if (brief?.phase === "analyzing") return "research"; // the core wakes and scans while yesterday is analysed
    if (voice.status === "speaking") return "speaking";
    if (voice.status === "recording") return "listening";
    if (agent.streaming) {
      if (latest?.kind === "activity" && /search|research|reading website|website data|brows|looking up/i.test(latest.label)) return "research";
      if (execHold) return "executing";
      if (!latest || latest.kind !== "activity" || /understanding request/i.test(latest.label)) return "thinking";
      return "executing";
    }
    if (voice.status === "processing") return "thinking";
    return "idle";
  })();
  useEffect(() => { if (jState !== "thinking") setProcessing(false); }, [jState]);
  // SYSTEM ONLINE types itself once, then steps back.
  const [onlineVisible, setOnlineVisible] = useState(false);
  useEffect(() => { if (!intro.online) return; setOnlineVisible(true); const t = setTimeout(() => setOnlineVisible(false), 3600); return () => clearTimeout(t); }, [intro.online]);
  useEffect(() => { if (!buildLabel) return; const t = setTimeout(() => setBuildLabel(false), 2600); return () => clearTimeout(t); }, [buildLabel]);

  const kinetic: { word: string | null; style: KineticStyle } =
    buildLabel ? { word: "ULTRON ACTIVE", style: "emerge" }
    : jState === "listening" ? { word: "LISTENING", style: "wave" }
    : jState === "thinking" ? (processing ? { word: "PROCESSING", style: "converge" } : { word: null, style: "slide" })
    : jState === "executing" ? { word: "EXECUTING", style: "rush" }
    : jState === "research" ? { word: "ANALYZING", style: "slide" }
    : { word: null, style: "sweep" };
  // Where the word sits ON the ribbon: thinking left, listening at the ring, speaking right.
  const wordX = jState === "thinking" ? 0.22 : jState === "speaking" ? 0.77 : 0.5;
  const kineticFinal: { word: string | null; style: KineticStyle } = jState === "speaking" && !buildLabel ? { word: "SPEAKING", style: "wave" } : kinetic;
  const opLabel = agent.streaming && latest?.kind === "activity" && !/understanding request/i.test(latest.label) ? latest.label : "";

  const panelOpen = evPhase === "off" && !!(subtitle || subtitleLinks.length) && lastAssistant?.id !== dismissedId;

  // pointer → parallax / reflections on every glass layer
  const ptrRaf = useRef(0);
  const onStageMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const el = ev.currentTarget; const r = el.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * 2 - 1, py = ((ev.clientY - r.top) / r.height) * 2 - 1;
    cancelAnimationFrame(ptrRaf.current);
    ptrRaf.current = requestAnimationFrame(() => { el.style.setProperty("--px", px.toFixed(3)); el.style.setProperty("--py", py.toFixed(3)); });
  };
  const measure = useMemo(() => (typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")), []);
  const onType = (value: string) => {
    if (value.length > input.length && inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      let w = value.length * 7;
      if (measure) { measure.font = "14px Barlow, system-ui, sans-serif"; w = measure.measureText(value).width; }
      motion.current?.keystroke(r.left + Math.min(w, r.width - 4), r.top + r.height / 2);
    }
    setInput(value);
  };
  const agentMeta: Record<AgentName, { role: string; run: () => void }> = {
    ULTRON: { role: "Developer", run: launchUltron },
    DARWIN: { role: "Lead Intelligence", run: launchDarwin },
    EV: { role: "Marketing", run: openEv },
  };

  // The JARVIS core reacts to every recognised gesture.
  useEffect(() => {
    const on = (e: Event) => {
      const ev = (e as CustomEvent<{ action: string; pointer?: { x: number; y: number } }>).detail;
      if (!ev) return;
      if (ev.pointer) motion.current?.keystroke(ev.pointer.x * innerWidth, ev.pointer.y * innerHeight);
      if (ev.action === "approve" || ev.action === "wake" || ev.action === "ev" || ev.action === "darwin" || ev.action === "ultron") motion.current?.taskComplete();
    };
    window.addEventListener("jarvis-gesture", on);
    return () => window.removeEventListener("jarvis-gesture", on);
  }, []);

  // Arriving with ?open=ev (swipe up from DARWIN or ULTRON) opens EV straight away.
  const openEvRef = useRef(openEv); openEvRef.current = openEv;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("open") !== "ev") return;
    router.replace("/dashboard");
    const t = setTimeout(() => { if (!evActiveRef.current) openEvRef.current(); }, 400);
    return () => clearTimeout(t);
  }, [router]);

  // ===== gestures → the same command router / actions as voice =====
  useGestureHandler((ev) => {
    const say = (t: string) => { if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(t); } catch { /* ignore */ } } };
    const dp = dailyRef.current.view?.pkg ?? null;
    const dailyWaiting = !!dp && (dp.status === "ready" || (dp.status === "approved" && !!dp.publishError));
    switch (ev.action) {
      case "wake": {
        if (!intro.done) motion.current?.skipIntro();
        motion.current?.taskComplete();
        if (!voiceStarted) { void enableVoice(); return "JARVIS ACTIVE"; }
        if (voice.muted) voice.toggleMute();
        say("I'm listening.");
        return "JARVIS ACTIVE";
      }
      case "jarvis": {
        // closed fist → back to JARVIS: stop talking, close whatever is open on top
        voice.stopSpeaking();
        speechRef.current?.end(); speechRef.current = null;
        if (agent.streaming) agent.stop();
        document.querySelectorAll("video, audio").forEach((m) => { if (!(m as HTMLMediaElement).paused && !m.closest("[data-gesture-ui]")) (m as HTMLMediaElement).pause(); });
        if (brief) closeBriefing();
        if (browserRef.current) setBrowser(null);
        if (weather) setWeather(null);
        if (evActiveRef.current) closeEv();
        if (humanoidPhase !== "off") closeHumanoid();
        return "JARVIS";
      }
      case "approve": {
        if (pendingShutdown.current) return "SAY “YES” TO CONFIRM SHUTDOWN";
        if (evActiveRef.current && evImageRef.current) { sendRef.current("publish it"); return "APPROVED · PUBLISHING"; }
        if (dailyWaiting) { sendRef.current(evActiveRef.current ? "Approved" : "Approve today's content"); return "APPROVED"; }
        if (evActiveRef.current && evAwaitingApproval) { sendRef.current("Approve it"); return "APPROVED"; }
        return undefined;
      }
      case "reject": {
        if (pendingShutdown.current) { sendRef.current("no"); return "SHUTDOWN CANCELLED"; }
        if (evActiveRef.current && evImageRef.current) { setEvImage(null); return "DISMISSED"; }
        if (dp && (dp.status === "ready" || dp.status === "approved") && (evActiveRef.current || dailyWaiting)) {
          sendRef.current(evActiveRef.current ? "Reject it" : "Reject today's content");
          return "REJECTED · NEW VERSION";
        }
        if (evActiveRef.current && evAwaitingApproval) { sendRef.current("Reject it"); return "REJECTED"; }
        return undefined;
      }
      // open hand: → DARWIN, ← ULTRON, ↑ EV
      case "darwin": {
        if (brief) closeBriefing();
        if (evActiveRef.current) closeEv();
        if (humanoidPhase !== "off") closeHumanoid();
        launchDarwin();
        return "DARWIN";
      }
      case "ultron": {
        if (brief) closeBriefing();
        if (evActiveRef.current) closeEv();
        if (humanoidPhase !== "off") closeHumanoid();
        launchUltron();
        return "ULTRON";
      }
      case "ev": {
        if (evActiveRef.current) return "ALREADY IN EV";
        if (brief) closeBriefing();
        if (humanoidPhase !== "off") { closeHumanoid(); setTimeout(openEv, 950); return "EV"; }
        openEv();
        return "EV";
      }
      default:
        return undefined; // click / prev / next: the gesture layer's defaults (click what you point at, move between items)
    }
  });

  return (
    <div ref={stageRef} onPointerMove={onStageMove} onClick={() => { if (!intro.done) motion.current?.skipIntro(); }}
      className="jarvis-os relative h-[calc(100dvh-4rem)] select-none overflow-hidden bg-[#020306] text-white">
      {evPhase !== "off" && (
        <EvView
          state={evState}
          activity={evActivity}
          command={evCommand}
          level={voice.level}
          phase={evPhase === "in" ? "in" : evPhase === "out" ? "out" : "active"}
          image={evImage}
          caption={evCaption}
          onDismissImage={() => setEvImage(null)}
          publishSignal={evPublishSignal}
          captionOverride={evCaptionOverride}
          onPublishResult={(r) => {
            flashEv(r.ok ? "success" : "error");
            if (r.ok) setEvAwaitingApproval(false);
            if (voiceStarted && !voice.muted && voice.enabled) voice.speak(r.message);
          }}
          onCommand={(t) => sendRef.current(t)}
          input={input}
          onInput={setInput}
          onSubmit={() => handleSend()}
          voiceStarted={voiceStarted}
          muted={voice.muted}
          onMic={() => (voiceStarted ? voice.toggleMute() : enableVoice())}
          onSleep={sleep}
          daily={daily}
          todayOpen={evToday}
          onToggleToday={setEvToday}
          onDailyAction={(a) => {
            void daily.act(a).then((r) => {
              if (!r.ok) flashEv("error");
              if (voiceStarted && !voice.muted && voice.enabled) voice.speak(r.message);
            });
          }}
        />
      )}
      {humanoidPhase !== "off" && (
        <HumanoidView
          userName={userName}
          state={orbState}
          level={voice.level}
          streaming={agent.streaming}
          task={agent.activity[0]?.label ?? null}
          subtitle={subtitle}
          phase={humanoidPhase === "in" ? "in" : humanoidPhase === "out" ? "out" : "active"}
          input={input}
          onInput={setInput}
          onSubmit={() => handleSend()}
          voiceStarted={voiceStarted}
          muted={voice.muted}
          onMic={() => (voiceStarted ? voice.toggleMute() : enableVoice())}
          onSleep={sleep}
        />
      )}
      {weather && <WeatherPopup data={weather} onClose={() => setWeather(null)} />}
      {browser && <BrowserPopup target={browser} onClose={() => setBrowser(null)} onOpenTab={(u) => { openTab(u); }} />}
      <NiosAlerts watch={nios} />
      <DarwinReportCard w={darwinReport} onOpenDarwin={launchDarwin} />
      {brief?.phase === "open" && (
        <BriefingPopup
          briefing={brief.data}
          error={brief.error}
          closing={brief.closing}
          speaking={briefSpeaking}
          onReady={() => { void speakBriefing(); }}
          onReplay={() => { void speakBriefing(true); }}
          onSkip={closeBriefing}
          onAsk={() => { closeBriefing(); focusCommand(""); }}
          onOpenEv={() => { closeBriefing(); openEv(); setEvToday(true); }}
          onForget={(id) => { void forgetEvent(id); }}
        />
      )}
      {emails.current && <EmailComposePopup key={emails.current.id} email={emails.current} waiting={emails.waiting} onClose={emails.close} />}

      {/* the living environment */}
      <JarvisMotion ref={motion} className="absolute inset-0" cssTarget={stageRef}
        state={jState} micLevel={voice.status === "recording" ? voice.level : 0} voiceLevel={voice.getOutputLevel}
        paused={evPhase === "active" || humanoidPhase === "active"}
        onIntro={(p) => setIntro((s) => ({ ...s, [p]: true }))}
        onLayout={setLayout}
        onProcessing={() => setProcessing(true)}
        onAnomaly={(p) => { setAnomalyAt(p); setTimeout(() => setAnomalyAt(null), 2700); }}
        onBuildReady={() => setBuildLabel(true)} />

      {/* cinematic vignette (composited by the browser, not repainted) */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 47%, transparent 45%, rgba(0,0,0,0.55) 100%)" }} />

      {!intro.done && (
        <button onClick={(e) => { e.stopPropagation(); motion.current?.skipIntro(); }} className="absolute bottom-5 right-5 z-30 text-[10px] uppercase tracking-[0.35em] text-white/25 transition hover:text-white/60">Skip</button>
      )}

      {/* JARVIS node label (the compressed intro typography) + SYSTEM ONLINE */}
      {layout && intro.logo && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: layout.hub.x, top: layout.hub.y }}>
          <span className="block pl-[0.4em] text-[11px] font-light tracking-[0.4em] text-white/90" style={{ animation: "ultron-emerge .6s ease both", textShadow: "0 0 12px rgba(140,210,255,.7)" }}>JARVIS</span>
        </div>
      )}
      {layout && onlineVisible && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2" style={{ left: layout.hub.x, top: layout.hub.y + 40 }}>
          <KineticWord word="SYSTEM ONLINE" style="type" className="text-[10px] tracking-[0.45em] text-cyan-100/70" />
        </div>
      )}

      {/* agent constellation: labels beside each node (click to activate) */}
      {layout && intro.done && (Object.keys(layout.agents) as AgentName[]).map((name) => {
        const p = layout.agents[name];
        return (
          <button key={name} onClick={(e) => { e.stopPropagation(); agentMeta[name].run(); }} title={`Activate ${name}`}
            className="group absolute z-10 flex items-center gap-2 text-left"
            style={{ left: p.x - 20, top: p.y - 20, animation: "ultron-emerge .9s ease both" }}>
            <span className="h-10 w-10 shrink-0 rounded-full" />
            <span className="leading-tight">
              <span className="block text-[10px] tracking-[0.3em] text-white/75 transition group-hover:text-white">{name}</span>
              <span className="block text-[8px] tracking-[0.12em] text-cyan-100/40 transition group-hover:text-cyan-100/75">{agentMeta[name].role}</span>
            </span>
          </button>
        );
      })}

      {/* kinetic state typography riding the ribbon */}
      {layout && (
        <div className="pointer-events-none absolute z-10 flex -translate-x-1/2 flex-col items-center transition-[left] duration-700 ease-out"
          style={{ left: `${wordX * 100}%`, top: layout.ribbonY - 20 }}>
          <KineticStage word={kineticFinal.word} style={kineticFinal.style}
            className="h-10 text-[24px] font-light tracking-[0.14em] text-white [text-shadow:0_0_18px_rgba(140,210,255,.75),0_0_2px_rgba(0,0,0,.9)] sm:text-[30px]" />
          {opLabel && <span key={opLabel} className="mt-1 text-[10px] uppercase tracking-[0.3em] text-cyan-100/55" style={{ animation: "ultron-word .5s ease both" }}>{opLabel}</span>}
        </div>
      )}

      {/* systems along the edges (real status) */}
      {intro.done && (
        <>
          {([["NEURAL CORE", services?.ai], ["MEMORY", services?.database], ["NETWORK", services?.search]] as const).map(([label, on], i) => (
            <SideLabel key={label} label={label} on={on} side="left" top={`${22 + i * 26}%`} />
          ))}
          {([["VOICE", services?.voice], ["TOOLS", services?.tools], ["SYSTEM INTEGRITY", services ? Object.values(services).every(Boolean) : undefined]] as const).map(([label, on], i) => (
            <SideLabel key={label} label={label} on={on} side="right" top={`${22 + i * 26}%`} />
          ))}
        </>
      )}

      {/* anomaly label where the stream broke */}
      {anomalyAt && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2" style={{ left: anomalyAt.x, top: anomalyAt.y - 64 }}>
          <div className="rounded-full border border-amber-300/30 bg-amber-300/[0.07] px-3 py-1 backdrop-blur-md">
            <KineticWord word="ANOMALY DETECTED" style="distort" stagger={20} className="text-[10px] tracking-[0.35em] text-amber-200" />
          </div>
        </div>
      )}

      {/* response — a spatial holographic panel */}
      <div className="absolute left-1/2 top-[3.5%] z-20 w-[min(92vw,44rem)] -translate-x-1/2">
        <HoloPanel open={panelOpen}>
          <div className="px-5 pb-4 pt-3">
            <div className="mb-2 flex items-center gap-3">
              {lastUserMsg?.content && <p className="min-w-0 flex-1 truncate text-[11px] tracking-wide text-cyan-100/55">“{lastUserMsg.content}”</p>}
              {agent.activeProvider && (
                <span className="shrink-0 text-[9px] uppercase tracking-[0.25em] text-white/35" title={agent.lastTiming ? timingDetail(agent.lastTiming) : undefined}>
                  {PROVIDER_LABELS[agent.activeProvider] ?? agent.activeProvider}
                  {!agent.streaming && agent.lastTiming?.clientMs != null && (
                    <span className={cn("ml-1.5", agent.lastTiming.clientMs <= 1500 ? "text-cyan-200/80" : agent.lastTiming.clientMs <= 4000 ? "text-amber-200/80" : "text-rose-300/80")}>
                      {agent.lastTiming.clientMs < 1000 ? `${agent.lastTiming.clientMs}ms` : `${(agent.lastTiming.clientMs / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </span>
              )}
              <button onClick={(e) => { e.stopPropagation(); setDismissedId(lastAssistant?.id ?? null); }} aria-label="Close" className="shrink-0 text-white/35 transition hover:text-white/80"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="max-h-[30vh] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
              <p className="jv-voice-text select-text whitespace-pre-wrap text-[15px] font-light leading-relaxed text-white/95">{subtitle}</p>
            </div>
            {subtitleLinks.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {subtitleLinks.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      // a plain click opens it in JARVIS's browser; ctrl/⌘/middle-click → a real tab
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0 || /\/api\/ev\/media\//.test(l.url)) return;
                      e.preventDefault();
                      showInJarvis({ url: l.url, label: l.label.replace(/^Open\s+/i, "") });
                    }}
                    className="rounded-full border border-cyan-100/20 bg-cyan-100/[0.06] px-3 py-1 text-[11px] text-cyan-50 transition hover:bg-cyan-100/[0.12]">
                    {/^open /i.test(l.label) ? l.label : `Open ${l.label}`} ↗
                  </a>
                ))}
              </div>
            )}
          </div>
        </HoloPanel>
      </div>

      {/* top corners: operator / brain / status — system state, menu */}
      {intro.done && (
        <>
          <div className="pointer-events-none absolute left-5 top-4 z-20 flex gap-6" style={{ animation: "ultron-emerge .8s ease both" }}>
            <TopMeta label="Operator" value={userName} />
            <TopMeta label="Brain" value={agent.activeProvider ? (PROVIDER_LABELS[agent.activeProvider] ?? agent.activeProvider) : "Standing by"} className="hidden sm:block" />
            <TopMeta label="Status" value={!voiceStarted ? "Voice off" : voice.muted ? "Muted" : voice.status === "speaking" ? "Speaking" : voice.status === "recording" ? "Hearing you" : "Listening"}
              dot={!voiceStarted ? "bg-white/25" : voice.muted ? "bg-amber-300/70" : "bg-cyan-300"} />
          </div>
          <div className="absolute right-4 top-4 z-30 flex items-center gap-3" style={{ animation: "ultron-emerge .8s ease both" }}>
            <span className="hidden text-[10px] uppercase tracking-[0.3em] text-white/45 sm:inline">
              System: <span className={agent.streaming ? "text-rose-300" : "text-white/75"}>{agent.streaming ? "Active" : "Ready"}</span>
              {agent.streaming && <span className="ml-1.5 inline-block text-rose-300">◂</span>}
            </span>
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} aria-label="Systems menu" title="Systems"
              className={cn("flex h-9 w-9 items-center justify-center rounded-full transition", menuOpen ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/85")}>
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute right-4 top-16 z-30 w-60">
            <HoloPanel open={menuOpen} depth={0.6}>
              <nav className="grid grid-cols-2 gap-1 p-3 text-[12px]">
                {[
                  ["Tasks", "/dashboard/tasks"], ["Notes", "/dashboard/notes"], ["Memory", "/dashboard/memory"],
                  ["Operator", "/dashboard/operator"], ["Settings", "/dashboard/settings"],
                ].map(([label, href]) => (
                  <button key={href} onClick={() => { setMenuOpen(false); router.push(href); }} className="rounded-xl px-3 py-2 text-left text-white/70 transition hover:bg-white/[0.06] hover:text-white">{label}</button>
                ))}
                <button onClick={() => { setMenuOpen(false); openHumanoid(); }} className="rounded-xl px-3 py-2 text-left text-white/70 transition hover:bg-white/[0.06] hover:text-white">Humanoid</button>
              </nav>
            </HoloPanel>
          </div>
        </>
      )}

      {/* what JARVIS is hearing */}
      {voiceStarted && !voice.muted && (voice.transcript || voice.error) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[5.6rem] z-20 flex justify-center px-6">
          <span key={voice.transcript} className="jv-voice-text max-w-xl truncate text-[13px] font-light text-white/80" style={{ animation: "ultron-word .4s ease both" }}>
            {voice.transcript ? <>“{voice.transcript}”</> : <span className="text-amber-200/80">{voice.error}</span>}
          </span>
        </div>
      )}

      {/* thin liquid-glass command bar */}
      {intro.logo && (
        <div className="absolute inset-x-0 bottom-5 z-20 flex flex-col items-center px-4" style={{ animation: "ultron-emerge .9s ease both" }} onClick={(e) => e.stopPropagation()}>
          <div ref={barRef} className={cn("jv-bar w-full transition-[max-width,transform] duration-500 ease-out", focused ? "max-w-2xl -translate-y-0.5" : "max-w-xl")}>
            {focused && <span aria-hidden className="jv-bar-border" />}
            <form onSubmit={handleSend} className="relative flex items-center gap-1 py-1 pl-2 pr-1">
              <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,.pdf,.txt,.md,.json,.csv" />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Upload a file" title="Upload a file"
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition hover:text-white/85 disabled:opacity-40">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>
              <input ref={inputRef} value={input} onChange={(e) => onType(e.target.value)}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                placeholder="Talk to JARVIS..."
                className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1.5 text-sm font-light text-white shadow-none outline-none ring-0 placeholder:text-white/35 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0" />
              <button type="button" onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())}
                aria-label={voiceStarted ? (voice.muted ? "Unmute" : "Mute") : "Enable voice"} title={voiceStarted ? (voice.muted ? "Unmute" : "Mute") : "Enable voice"}
                className={cn("flex h-8 w-8 items-center justify-center rounded-full transition", voiceStarted && !voice.muted ? "text-cyan-200" : "text-white/40 hover:text-white/85", !voiceStarted && "animate-pulse")}>
                {voiceStarted && voice.muted ? <MicOff className="h-4 w-4 text-amber-200/80" /> : voiceStarted ? <Volume2 className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              {voiceStarted && (
                <button type="button" onClick={sleep} aria-label="Sleep" title="Sleep" className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition hover:text-white/85"><Power className="h-4 w-4" /></button>
              )}
              <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
              <button type="submit" disabled={!input.trim()}
                className="flex h-8 items-center rounded-full border border-white/15 bg-white/[0.08] px-4 text-[12px] tracking-wide text-white transition hover:bg-white/[0.16] disabled:opacity-40">
                Execute
              </button>
            </form>
          </div>
          {!voiceStarted && (
            <span className="mt-2 text-[10px] tracking-[0.2em] text-white/30">Tap the mic — or say “Hey JARVIS”</span>
          )}
        </div>
      )}
    </div>
  );
}

function TopMeta({ label, value, dot, className }: { label: string; value: string; dot?: string; className?: string }) {
  return (
    <div className={cn("leading-tight", className)}>
      <div className="text-[9px] uppercase tracking-[0.25em] text-white/35">{label}</div>
      <div className="mt-0.5 flex max-w-[10rem] items-center gap-1.5 truncate text-[13px] font-light text-white/85">
        {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

/** A system label on the screen edge with a live dot (real /api/status). */
function SideLabel({ label, on, side, top }: { label: string; on: boolean | undefined; side: "left" | "right"; top: string }) {
  return (
    <div className={cn("pointer-events-none absolute z-10 hidden items-center gap-2 md:flex", side === "left" ? "left-5 flex-row-reverse" : "right-5")}
      style={{ top, animation: "ultron-emerge 1s ease both" }}>
      <span className={cn("h-1.5 w-1.5 rounded-full ring-2 ring-white/10", on ? "bg-cyan-300" : on === false ? "bg-white/25" : "bg-white/10")} />
      <span className={cn("leading-tight", side === "left" ? "text-right" : "text-left")}>
        <span className="block text-[10px] tracking-[0.22em] text-white/60">{label}</span>
        <span className="block text-[8px] uppercase tracking-[0.2em] text-cyan-100/35">{on == null ? "…" : on ? "online" : "standby"}</span>
      </span>
    </div>
  );
}
