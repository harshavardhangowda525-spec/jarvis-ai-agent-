"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mic, MicOff, Send, Paperclip, Volume2, VolumeX, Loader2,
  Terminal, ScanLine, BarChart3, Search, FileText, Lock,
  ExternalLink, Power, Check, AlertTriangle, Monitor, Brain, AudioLines,
} from "lucide-react";
import { Orb, type OrbState, orbStateLabel } from "@/components/orb";
import { HudPanel } from "@/components/hud/panel";
import { Waveform } from "@/components/hud/visuals";
import { useVoice, useResumeVoice, type SpeechStream } from "@/hooks/useVoice";
import { instantAnswer } from "@/lib/instant";
import { inIndia, parseOpenSite } from "@/lib/open-site";
import { EmailComposePopup, useEmailPopups } from "./email-popup";
import type { AgentTiming } from "@/hooks/useAgent";
import { useAgent } from "@/hooks/useAgent";
import { useDeviceMetrics } from "@/hooks/useDeviceMetrics";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useScreenVision } from "@/hooks/useScreenVision";
import { HumanoidView } from "@/components/console/humanoid-view";
import { EvView, type EvState } from "@/components/console/ev-view";
import { WeatherPopup, type WeatherData } from "@/components/console/weather-popup";
import { cn, timeAgo } from "@/lib/utils";

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

interface Services { [k: string]: boolean }
interface Stats {
  tasks: { all: number; completed: number; pending: number; high: number };
  totals: { notes: number; memories: number; conversations: number };
  recentActivity: { tool: string; status: string; at: string }[];
  upcoming: { id: string; title: string; dueAt: string; priority: string }[];
  activeTasks: { id: string; title: string; priority: string }[];
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
  const fetchWeatherRef = useRef<(place?: string) => void>(() => {});
  const evActiveRef = useRef(false);
  const evPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [services, setServices] = useState<Services | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const readScreenRef = useRef<(prompt?: string) => void>(() => {});
  const metrics = useDeviceMetrics();
  const screen = useScreenVision();

  const onNavigate = useCallback((path: string) => {
    if (path.startsWith("/dashboard") && path !== "/dashboard") router.push(path);
  }, [router]);

  const flashEv = useCallback((kind: "success" | "error") => {
    if (evPulseTimer.current) clearTimeout(evPulseTimer.current);
    setEvPulse(kind);
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
    onOpen: (url) => {
      // An EV-generated image reveals as a liquid-glass message inside the EV
      // dashboard rather than hijacking a tab.
      if (evActiveRef.current && /\/api\/ev\/media\//.test(url)) {
        setEvImage({ url });
        flashEv("success");
        return;
      }
      // Otherwise open in a NEW tab, never hijack the current one. If the pop-up
      // blocker stops it, the "Open X" button in the reply is the fallback.
      openTab(url); // blocked → the "Open X" button in the reply is the fallback
    },
  });

  const sleep = useCallback(() => { voice.stop(); setVoiceStarted(false); }, [voice]);
  const launchUltron = useCallback(() => {
    setLaunchingUltron(true);
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Bringing ULTRON online.");
    setTimeout(() => router.push("/dashboard/ultron"), 1900);
  }, [router, voice, voiceStarted]);
  const launchDarwin = useCallback(() => {
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("Opening DARWIN. Lead systems online.");
    setTimeout(() => router.push("/dashboard/darwin"), 700);
  }, [router, voice, voiceStarted]);
  const openHumanoid = useCallback(() => {
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
    evActiveRef.current = true;
    setEvAwaitingApproval(false);
    setEvCommand("");
    setEvPhase("in");
    if (voiceStarted && !voice.muted && voice.enabled) voice.speak("EV online. Marketing systems ready.");
    setTimeout(() => setEvPhase("active"), 1400);
  }, [voice, voiceStarted]);
  const closeEv = useCallback(() => {
    evActiveRef.current = false;
    setEvImage(null);
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
  useEffect(() => {
    sendRef.current = (t: string) => {
      const low = t.toLowerCase().trim();
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
      // "DARWIN", "open DARWIN", "activate DARWIN" → open the lead-gen/CRM console.
      if (/^darwin[\s!.,]*$|\b(open|launch|activate|start|switch to|go to|bring up)\s+darwin\b|\bdarwin[,\s]+(online|wake up|come online)\b/.test(low)) {
        launchDarwin();
        return;
      }
      // "Open Amazon", "go to youtube.com", "search Flipkart for shoes" → open the
      // site right now, while the keypress/click still allows a new tab (an AI
      // round trip first — especially on the PC brain — gets it pop-up-blocked).
      const site = evActiveRef.current ? null : parseOpenSite(t, { india: inIndia() });
      if (site) {
        const opened = openTab(site.url);
        const msg = `Opening ${site.label}.`;
        agent.appendLocalExchange(t, opened ? msg : `Your browser blocked the new tab — click "Open ${site.label}" below, or allow pop-ups for this site (icon at the right of Chrome's address bar).`, [{ url: site.url, label: `Open ${site.label}` }]);
        if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(msg); } catch { /* ignore */ } }
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
  }, [agent, sleep, launchUltron, launchDarwin, openHumanoid, closeHumanoid, openEv, closeEv, evPhase, voice, voiceStarted]);

  // Voice was on in the agent you just left → switch it back on here.
  const resumingVoice = useResumeVoice(enableVoice);
  const wake = useWakeWord({
    // The "hey Jarvis" listener only runs while voice is off, and stays out of
    // the way while voice is being resumed (two recognizers would fight).
    enabled: !voiceStarted && !resumingVoice,
    onWake: async () => { const ok = await enableVoice(); if (ok && voiceConfigured) setTimeout(() => voice.speak("Yes?"), 350); },
  });

  const loadPanels = useCallback(() => {
    fetch("/api/status").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setServices(j.data.services)).catch(() => {});
    fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setStats(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/voice/config").then((r) => (r.ok ? r.json() : null))
      .then((j) => setVoiceConfigured(j?.data?.configured ?? false))
      .catch(() => setVoiceConfigured(false));
    loadPanels();
  }, [loadPanels]);

  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !agent.streaming) loadPanels();
    wasStreaming.current = agent.streaming;
  }, [agent.streaming, loadPanels]);

  const orbState: OrbState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "error";
    if (voice.status === "speaking") return "speaking";
    if (agent.streaming) return agent.activity[0]?.kind === "tool" ? "executing" : "thinking";
    if (voice.status === "recording") return "listening";
    if (voice.status === "processing") return "thinking";
    if (voice.status === "listening") return "listening";
    return "idle";
  })();
  const statusLabel = agent.streaming ? (orbState === "executing" ? "Executing" : "Thinking") : orbStateLabel(orbState);

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

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const t = input.trim(); if (!t) return;
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

  const dock = useMemo(() => [
    { icon: Terminal, label: "Command", run: () => focusCommand("") },
    { icon: ScanLine, label: "Scan", run: () => { loadPanels(); agent.send("Run a status check: summarize which systems and tools are online."); } },
    { icon: Mic, label: "Voice", center: true, run: () => (voiceStarted ? voice.toggleMute() : enableVoice()) },
    { icon: Monitor, label: screen.reading ? "Reading…" : "Screen", run: () => readScreen(input.trim() || undefined) },
    { icon: FileText, label: "Note", run: () => focusCommand("Create a note: ") },
  ], [agent, focusCommand, loadPanels, voice, voiceStarted, screen.reading, readScreen, input]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastAssistant = [...agent.messages].reverse().find((m) => m.role === "assistant");
  const lastUserMsg = [...agent.messages].reverse().find((m) => m.role === "user");
  const subtitle = lastAssistant?.content ?? "";
  const subtitleLinks = lastAssistant?.links ?? [];
  const hasMessages = agent.messages.length > 0;

  const servicesPct = services ? Math.round((Object.values(services).filter(Boolean).length / Object.values(services).length) * 100) : 0;
  const t = stats?.tasks;
  const completionPct = t && t.all > 0 ? Math.round((t.completed / t.all) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  const listenLabel = voice.status === "recording" ? "Listening…"
    : voice.status === "processing" ? "Analyzing…"
    : voice.status === "speaking" ? "Speaking…"
    : voice.status === "listening" ? "Listening…"
    : voiceStarted ? "Idle" : "Voice off";

  return (
    <div className="jarvis-scene relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#02060e]">
      {launchingUltron && <UltronLaunchOverlay />}
      {evPhase !== "off" && (
        <EvView
          state={evState}
          activity={evActivity}
          command={evCommand}
          level={voice.level}
          phase={evPhase === "in" ? "in" : evPhase === "out" ? "out" : "active"}
          image={evImage}
          caption={subtitle}
          onDismissImage={() => setEvImage(null)}
          publishSignal={evPublishSignal}
          captionOverride={evCaptionOverride}
          onPublishResult={(r) => {
            flashEv(r.ok ? "success" : "error");
            if (r.ok) setEvAwaitingApproval(false);
            if (voiceStarted && !voice.muted && voice.enabled) voice.speak(r.message);
          }}
          input={input}
          onInput={setInput}
          onSubmit={() => handleSend()}
          voiceStarted={voiceStarted}
          muted={voice.muted}
          onMic={() => (voiceStarted ? voice.toggleMute() : enableVoice())}
          onSleep={sleep}
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

      {/* live weather — animated liquid-glass popup */}
      {weather && <WeatherPopup data={weather} onClose={() => setWeather(null)} />}
      {emails.current && <EmailComposePopup key={emails.current.id} email={emails.current} waiting={emails.waiting} onClose={emails.close} />}

      {/* ambient glows */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-[42%] h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.22),transparent_62%)] blur-2xl" />
        <div className="absolute inset-x-0 top-0 h-24 [background:linear-gradient(hsl(var(--accent)/0.06),transparent)]" />
        {/* curved wall highlights, like the reference */}
        <div className="absolute -left-24 top-1/2 h-[70vmin] w-40 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,hsl(var(--accent)/0.16),transparent_70%)] blur-2xl" />
        <div className="absolute -right-24 top-1/2 h-[70vmin] w-40 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,hsl(var(--accent)/0.16),transparent_70%)] blur-2xl" />
      </div>

      {/* ===== CENTER STAGE: cards flank the orb ===== */}
      <div className="relative z-10 flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 pb-40">
        <div className="flex w-full max-w-5xl items-center justify-center gap-3 md:gap-6">
          {/* LEFT CARD — Listening */}
          <StatusCard side="left" className="hidden md:flex">
            <MiniEq active={voice.status === "recording" || voice.status === "listening"} level={voice.level} />
            <div className="min-w-0">
              <div className="text-sm text-foreground/90">{listenLabel}</div>
              <ProgressBar value={voice.status === "recording" ? Math.min(1, voice.level * 6) : voice.status === "listening" ? 0.25 : 0} />
            </div>
          </StatusCard>

          {/* CENTER — the sphere */}
          <div className="relative flex flex-col items-center">
            <JarvisSphere state={orbState} level={voice.level} />
            {agent.activeProvider && (
              <span className="hud-label mt-3 rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-[8px] text-accent"
                title={agent.lastTiming ? timingDetail(agent.lastTiming) : undefined}>
                {PROVIDER_LABELS[agent.activeProvider] ?? agent.activeProvider}
                {/* How long you waited for the first word of the last answer. */}
                {!agent.streaming && agent.lastTiming?.clientMs != null && (
                  <span className={cn("ml-1.5", agent.lastTiming.clientMs <= 1500 ? "text-success" : agent.lastTiming.clientMs <= 4000 ? "text-warning" : "text-destructive")}>
                    ⚡ {agent.lastTiming.clientMs < 1000 ? `${agent.lastTiming.clientMs}ms` : `${(agent.lastTiming.clientMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* RIGHT CARD — Processing */}
          <StatusCard side="right" className="hidden md:flex">
            <Brain className={cn("h-6 w-6 shrink-0", agent.streaming ? "text-accent-bright animate-hud-pulse" : "text-accent/60")} />
            <div className="min-w-0">
              <div className="text-sm text-foreground/90">{agent.streaming ? "Processing…" : "Ready"}</div>
              <ProgressBar value={agent.streaming ? -1 : 0.08} />
            </div>
          </StatusCard>
        </div>

        {/* status word + provider */}
        <div className="mt-6 text-center">
          <div className="hud-label text-[11px] tracking-[0.35em] text-accent-bright text-glow">{statusLabel.toUpperCase()}</div>
        </div>

        {/* subtitle caption */}
        <div className="mt-4 w-full max-w-2xl text-center">
          {hasMessages && lastUserMsg?.content && <p className="mb-1.5 truncate text-[11px] text-accent/70">“{lastUserMsg.content}”</p>}
          <div className="max-h-28 overflow-y-auto">
            {subtitle ? (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/95 [text-shadow:0_0_12px_hsl(var(--accent)/0.35)]">{subtitle}</p>
            ) : agent.streaming ? null : !hasMessages ? (
              <p className="text-sm text-muted-foreground">How can I help you today, {userName}?</p>
            ) : null}
          </div>
          {subtitleLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {subtitleLinks.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent transition hover:bg-accent/20">
                  <ExternalLink className="h-3.5 w-3.5" /> Open {l.label}
                </a>
              ))}
            </div>
          )}
          {voice.error && <div className="mt-2 text-xs text-destructive">{voice.error}</div>}
          {!voiceStarted && voiceConfigured && (
            <button onClick={enableVoice} className="mt-4 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-5 py-2 text-sm text-accent-bright transition hover:bg-accent/20 box-glow-soft">
              <Mic className="h-4 w-4" /> Enable JARVIS Voice
            </button>
          )}
        </div>
      </div>

      {/* live voice caption — shows what JARVIS is hearing */}
      {voiceStarted && !voice.muted && (voice.status === "listening" || voice.status === "recording" || voice.status === "processing" || voice.transcript) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-6">
          <div className="flex max-w-xl items-center gap-2 rounded-full border border-accent/20 bg-black/40 px-4 py-1.5 backdrop-blur-md">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", voice.status === "recording" ? "bg-accent animate-hud-pulse" : voice.status === "processing" ? "bg-warning animate-hud-pulse" : "bg-accent/60 animate-hud-pulse")} />
            <span className="truncate text-sm text-foreground/90">
              {voice.transcript
                ? <>“{voice.transcript}”</>
                : voice.error && voice.status !== "recording" ? <span className="text-warning">{voice.error}</span>
                : voice.status === "processing" ? "Thinking…"
                : voice.status === "recording" ? "Listening…"
                : "Listening… speak now"}
            </span>
          </div>
        </div>
      )}

      {/* ===== bottom command bar ===== */}
      <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <form onSubmit={handleSend} className="hud-panel box-glow-soft relative w-full max-w-2xl backdrop-blur-md">
          <span className="hud-corners" aria-hidden />
          <div className="flex items-center gap-2 p-2">
            <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,.pdf,.txt,.md,.json,.csv" />
            <IconBtn onClick={() => fileRef.current?.click()} label="Upload file" disabled={uploading} type="button">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </IconBtn>
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1} placeholder={`How can I help you, ${userName}?`}
              className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground" />
            <IconBtn onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())} label={voiceStarted ? (voice.muted ? "Unmute" : "Mute") : "Enable voice"}>
              {voiceStarted && voice.muted ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className={cn("h-4 w-4", voiceStarted ? "text-accent" : "text-muted-foreground")} />}
            </IconBtn>
            {voiceStarted && (
              <IconBtn onClick={sleep} label="Sleep"><Power className="h-4 w-4 text-muted-foreground" /></IconBtn>
            )}
            <button type="submit" disabled={!input.trim() || agent.streaming}
              className="flex h-9 w-9 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40" aria-label="Send">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- pieces ----

function MiniStat({ value, label, tone }: { value: number | string; label: string; tone?: "success" | "warning" }) {
  return (
    <div className="hud-row rounded p-2">
      <div className={cn("hud-display text-xl", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground")}>{value}</div>
      <div className="hud-label text-[7px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Gauge({ value, label, small }: { value: number; label: string; small?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = 30, circ = 2 * Math.PI * r, dash = (v / 100) * circ;
  const size = small ? "h-16 w-16" : "h-20 w-20";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn("relative", size)}>
        <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--accent) / 0.12)" strokeWidth="5" />
          <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="5" strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round" style={{ transition: "stroke-dasharray 600ms ease-out", filter: "drop-shadow(0 0 4px hsl(var(--accent)))" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center hud-display text-sm text-foreground">{v}%</div>
      </div>
      <span className="hud-label text-[8px] text-muted-foreground">{label}</span>
    </div>
  );
}

function AreaChart({ history }: { history: { mem: number; net: number; fps: number }[] }) {
  const W = 300, H = 110, pad = 4;
  const n = Math.max(history.length, 2);
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  const line = history.length < 2 ? "" : history.map((h, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(h.fps).toFixed(1)}`).join(" ");
  const area = history.length < 2 ? "" : `${line} L${x(history.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <div className="flex h-full flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--warning) / 0.5)" />
            <stop offset="100%" stopColor="hsl(var(--warning) / 0)" />
          </linearGradient>
        </defs>
        {[0, 33, 66, 100].map((g) => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="hsl(var(--accent) / 0.07)" />)}
        {history.length < 2 ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}>Sampling live telemetry…</text>
        ) : (
          <>
            <path d={area} fill="url(#areaFill)" />
            <path d={line} fill="none" stroke="hsl(var(--warning))" strokeWidth="1.8" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 3px hsl(var(--warning)))" }} />
          </>
        )}
      </svg>
      <div className="mt-auto flex justify-between text-[8px] text-muted-foreground"><span>live render rate</span><span>{Math.max(0, history.length)} samples</span></div>
    </div>
  );
}

function BarChart({ stats }: { stats: Stats | null }) {
  const bars = [
    { label: "Tasks", value: stats?.tasks.all ?? 0 },
    { label: "Done", value: stats?.tasks.completed ?? 0 },
    { label: "Notes", value: stats?.totals.notes ?? 0 },
    { label: "Memory", value: stats?.totals.memories ?? 0 },
    { label: "Convos", value: stats?.totals.conversations ?? 0 },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex h-24 items-end justify-around gap-2">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-16 w-full items-end justify-center">
            <div className="w-5 rounded-t bg-gradient-to-t from-accent-deep to-accent-bright box-glow-soft"
              style={{ height: `${(b.value / max) * 100}%`, minHeight: b.value > 0 ? 4 : 1, transition: "height 500ms ease-out" }} />
          </div>
          <span className="hud-display text-xs text-foreground">{b.value}</span>
          <span className="hud-label text-[7px] text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusList({ services }: { services: Services | null }) {
  const rows: { key: string; label: string }[] = [
    { key: "ai", label: "AI Core" },
    { key: "voice", label: "Voice" },
    { key: "database", label: "Database" },
    { key: "tools", label: "Tools" },
    { key: "search", label: "Web Search" },
    { key: "weather", label: "Weather" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const on = services?.[r.key];
        return (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-success shadow-[0_0_8px_hsl(var(--success))] animate-hud-pulse" : "bg-muted-foreground/40")} />
            <span className="text-foreground/85">{r.label}</span>
            <span className={cn("hud-label ml-auto text-[8px]", on ? "text-success" : "text-muted-foreground")}>{services == null ? "…" : on ? "online" : "standby"}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActivityFeed({ items, recent, streaming }: {
  items: { id: string; label: string; kind: string; status?: string }[];
  recent: { tool: string; status: string; at: string }[];
  streaming: boolean;
}) {
  const live = items.slice(0, 6);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {live.length === 0 && recent.length === 0 && (
          <p className="text-xs text-muted-foreground">System idle. Awaiting command.</p>
        )}
        {live.map((it) => (
          <div key={it.id} className="flex items-start gap-2 text-xs animate-fade-in">
            {it.kind === "error" || it.status === "error"
              ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              : it.kind === "tool" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              : <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            <span className={cn(it.kind === "error" ? "text-destructive" : "text-foreground/85")}>{it.label}</span>
          </div>
        ))}
        {live.length === 0 && recent.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {a.status === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : <Check className="h-3.5 w-3.5 text-success" />}
            <span className="text-foreground/85">{a.tool}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(a.at)}</span>
          </div>
        ))}
      </div>
      {streaming && <div className="mt-2 flex items-center gap-2 text-[10px] text-accent"><Loader2 className="h-3 w-3 animate-spin" /> processing…</div>}
    </div>
  );
}

function IconBtn({ children, onClick, label, disabled, type = "button" }: {
  children: React.ReactNode; onClick?: () => void; label: string; disabled?: boolean; type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition hover:bg-accent/10 hover:text-accent disabled:opacity-40">
      {children}
    </button>
  );
}

/** Cinematic transition played when the user says "ULTRON" — a portal that
 *  expands into the ULTRON dashboard. Pure CSS/SVG, ~1.9s. */
function UltronLaunchOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-md animate-fade-in">
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_center,hsl(var(--accent)/0.15),transparent_60%)]" />
      <div className="relative flex flex-col items-center">
        <svg viewBox="0 0 400 400" style={{ width: "min(70vmin,520px)", height: "min(70vmin,520px)" }}>
          <defs>
            <radialGradient id="ultron-launch" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgb(120,200,255)" stopOpacity="0.9" />
              <stop offset="40%" stopColor="rgb(120,200,255)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="rgb(120,200,255)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="200" cy="200" r="150" fill="url(#ultron-launch)" style={{ transformOrigin: "200px 200px", animation: "ultron-bar 1.9s ease-out forwards" }} />
          {[190, 150, 110, 70].map((r, i) => (
            <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="rgb(120,200,255)" strokeOpacity={0.4 - i * 0.06} strokeWidth="1.5"
              strokeDasharray={i % 2 ? "4 8" : undefined}
              style={{ transformOrigin: "200px 200px", animation: `ultron-spin ${6 + i * 3}s linear infinite ${i % 2 ? "reverse" : ""}` }} />
          ))}
        </svg>
        <div className="absolute flex flex-col items-center">
          <div className="hud-display text-3xl tracking-[0.5em] text-foreground text-glow">ULTRON</div>
          <div className="hud-label mt-2 text-[10px] tracking-[0.4em] text-accent-bright animate-hud-pulse">BRINGING ONLINE…</div>
        </div>
      </div>
    </div>
  );
}

/* ================= cinematic dashboard pieces ================= */

/** The JARVIS sphere — glassy blue orb with concentric rings, radial ticks and a
 *  bright core. Reactive to state (colour) and live mic level (glow/scale). */
function JarvisSphere({ state, level = 0 }: { state: OrbState; level?: number }) {
  const color = state === "error" ? "248,113,113" : state === "executing" ? "251,191,36" : state === "thinking" ? "167,139,250" : "90,180,255";
  const active = state !== "idle" && state !== "offline";
  const pulse = 1 + Math.min(0.06, level * 0.5);
  return (
    <div className="relative" style={{ width: "min(52vmin,440px)", height: "min(52vmin,440px)", transform: `scale(${pulse})`, transition: "transform 120ms ease-out" }}>
      <svg viewBox="0 0 400 400" className="h-full w-full">
        <defs>
          <radialGradient id="jv-glass" cx="42%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#eafaff" stopOpacity="0.95" />
            <stop offset="22%" stopColor={`rgb(${color})`} stopOpacity="0.9" />
            <stop offset="70%" stopColor="#0b3a66" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#041226" stopOpacity="0.95" />
          </radialGradient>
          <radialGradient id="jv-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={`rgb(${color})`} stopOpacity="0.7" />
            <stop offset="55%" stopColor={`rgb(${color})`} stopOpacity="0.12" />
            <stop offset="100%" stopColor={`rgb(${color})`} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* outer glow */}
        <circle cx="200" cy="200" r="180" fill="url(#jv-glow)" />

        {/* outer reticle ring with tick marks */}
        <circle cx="200" cy="200" r="170" fill="none" stroke={`rgb(${color})`} strokeOpacity="0.25" strokeWidth="1" />
        <g stroke={`rgb(${color})`} strokeOpacity="0.5" strokeWidth="1.5"
           style={active ? { transformOrigin: "200px 200px", animation: "ultron-spin 40s linear infinite" } : undefined}>
          {Array.from({ length: 60 }).map((_, i) => {
            const a = (i / 60) * Math.PI * 2;
            const r1 = 168, r2 = i % 5 === 0 ? 156 : 162;
            return <line key={i} x1={200 + r1 * Math.cos(a)} y1={200 + r1 * Math.sin(a)} x2={200 + r2 * Math.cos(a)} y2={200 + r2 * Math.sin(a)} />;
          })}
        </g>

        {/* rotating arcs */}
        {[150, 138].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke={`rgb(${color})`} strokeOpacity="0.5" strokeWidth="2"
            strokeDasharray={i ? "120 400" : "200 340"} strokeLinecap="round"
            style={active ? { transformOrigin: "200px 200px", animation: `ultron-spin ${14 + i * 8}s linear infinite ${i ? "reverse" : ""}` } : undefined} />
        ))}

        {/* the glass sphere */}
        <circle cx="200" cy="200" r="118" fill="url(#jv-glass)" stroke={`rgb(${color})`} strokeOpacity="0.5" strokeWidth="1.5" />
        {/* inner concentric rings */}
        {[100, 80, 58, 34].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#dff3ff" strokeOpacity={0.18} strokeWidth="1"
            style={active ? { transformOrigin: "200px 200px", animation: `ultron-spin ${20 + r / 4}s linear infinite ${r % 2 ? "reverse" : ""}` } : undefined} />
        ))}
        {/* crosshair ticks */}
        <g stroke="#dff3ff" strokeOpacity="0.4" strokeWidth="1">
          <line x1="200" y1="86" x2="200" y2="110" /><line x1="200" y1="290" x2="200" y2="314" />
          <line x1="86" y1="200" x2="110" y2="200" /><line x1="290" y1="200" x2="314" y2="200" />
        </g>
        {/* glossy highlight */}
        <ellipse cx="168" cy="150" rx="48" ry="26" fill="#ffffff" opacity="0.25" transform="rotate(-25 168 150)" />
        {/* bright core */}
        <circle cx="200" cy="200" r="16" fill="#f2fdff" style={{ filter: `drop-shadow(0 0 12px rgb(${color}))` }} />
      </svg>
    </div>
  );
}

/** A HUD status card (angled corners) that flanks the sphere. */
function StatusCard({ side, className, children }: { side: "left" | "right"; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn(
      "relative flex w-52 items-center gap-3 border border-accent/25 bg-accent/[0.05] px-4 py-3 backdrop-blur-md box-glow-soft",
      className,
    )}
      style={{ clipPath: "polygon(8% 0, 100% 0, 100% 78%, 92% 100%, 0 100%, 0 22%)" }}>
      {children}
      {/* connector nub toward the orb */}
      <span className={cn("absolute top-1/2 h-2 w-3 -translate-y-1/2 bg-accent/40", side === "left" ? "-right-3" : "-left-3")} />
    </div>
  );
}

/** Small live equalizer for the Listening card. */
function MiniEq({ active, level = 0 }: { active: boolean; level?: number }) {
  const bars = 5;
  const hs = useMemo(() => [40, 75, 100, 65, 45], []);
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center gap-[2px]" aria-hidden>
      {hs.map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-accent-bright"
          style={{
            height: active ? `${Math.min(100, h + level * 120)}%` : "22%",
            opacity: active ? 0.9 : 0.4,
            transition: "height 120ms ease",
            animation: active ? `ultron-bar 700ms ease-in-out ${i * 90}ms infinite alternate` : undefined,
          }} />
      ))}
    </div>
  );
}

/** Thin progress bar. value in [0,1], or -1 for an indeterminate animation. */
function ProgressBar({ value }: { value: number }) {
  if (value < 0) {
    return (
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-accent/10">
        <div className="h-full w-1/3 rounded-full bg-accent-bright" style={{ animation: "jv-indet 1.2s ease-in-out infinite" }} />
      </div>
    );
  }
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-accent/10">
      <div className="h-full rounded-full bg-accent-bright transition-[width] duration-150" style={{ width: `${Math.max(4, Math.min(100, value * 100))}%` }} />
    </div>
  );
}
