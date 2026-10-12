/**
 * ASTON Core — the pure rules behind the interface (client-safe, no DOM).
 * What state the core shows, the line under it, and what a heard utterance
 * means for the always-on "ASTON" wake word.
 */
import { stripWake } from "./scripts/format";

export type CoreState = "idle" | "listening" | "processing" | "speaking" | "executing" | "attention" | "error";

export interface CoreInputs {
  mode: "idle" | "listening" | "processing" | "speaking";
  /** A real task is running (website build, approved action). */
  executing: boolean;
  /** Something is broken that the owner can retry (server unreachable, mic blocked …). */
  fault: boolean;
  /** Open critical/high incidents. */
  attention: boolean;
}

/** One state for the core, in priority order: what you're doing now beats background status. */
export function coreState(i: CoreInputs): CoreState {
  if (i.mode === "listening") return "listening";
  if (i.mode === "speaking") return "speaking";
  if (i.mode === "processing") return "processing";
  if (i.executing) return "executing";
  if (i.fault) return "error";
  if (i.attention) return "attention";
  return "idle";
}

export const STATE_WORD: Record<CoreState, string> = {
  idle: "Online",
  listening: "Listening",
  processing: "Analyzing",
  speaking: "Speaking",
  executing: "Executing",
  attention: "Attention required",
  error: "Fault",
};

/** "Good morning / afternoon / evening" for a local hour. */
export function greeting(hour: number): string {
  const part = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening";
  return `Good ${part}. How may I assist?`;
}

/** The line under the core when nothing more specific is being said. */
export function defaultLine(state: CoreState, hour: number): string {
  switch (state) {
    case "listening": return "Listening for your command…";
    case "processing": return "Analyzing your request…";
    case "executing": return "Executing workflow…";
    case "speaking": return "";
    default: return greeting(hour);
  }
}

export type WakeResult = { kind: "command"; text: string } | { kind: "wake" } | null;

/**
 * What a phrase heard by the always-on listener means. Only phrases that start
 * with "ASTON" count — everything else said in the room is ignored.
 */
export function wakeIntent(heard: string): WakeResult {
  const { text, woke } = stripWake(heard);
  if (!woke) return null;
  const cmd = text.replace(/^[\s,.:!?-]+/, "").trim();
  if (!cmd || /^(hi|hello|hey|are you there|you there)\??$/i.test(cmd)) return { kind: "wake" };
  return { kind: "command", text: cmd };
}

/** Progress arcs: 0..1 when the task reports progress, null when it can't (indeterminate). */
export const clamp01 = (v: number | null | undefined): number | null => (v == null || Number.isNaN(v) ? null : Math.min(1, Math.max(0, v)));

/** Hands-free conversation: how long ASTON keeps listening for your next phrase after it answers. */
export const CONVERSATION_LISTEN_MS = 10_000;

/** "That's all", "stop", "goodbye", "never mind"… — ends a hands-free conversation. */
export function isConversationEnd(heard: string): boolean {
  const t = stripWake(heard).text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  return /^(ok(ay)? )?(thanks?( you)?( aston)? )?(that'?s all|that is all|that'?s it|stop|stop listening|goodbye|good bye|bye|bye bye|never ?mind|nothing( else)?|no thanks|no thank you|i'?m done|we'?re done|all done|end( the)? conversation|go to sleep|you can stop|thanks|thank you|thank you aston|thanks aston)( thanks?( you)?)?$/.test(t);
}

/** Pages ASTON can open by voice ("ASTON, open JARVIS"). */
const PAGES: { label: string; href: string; names: string[] }[] = [
  { label: "JARVIS", href: "/dashboard", names: ["jarvis", "jarvis dashboard", "dashboard", "home", "command center", "the dashboard"] },
  { label: "ULTRON", href: "/dashboard/ultron", names: ["ultron", "ultran", "edith"] },
  { label: "DARWIN", href: "/dashboard/darwin", names: ["darwin"] },
  { label: "MIKE", href: "/dashboard/mike", names: ["mike"] },
  { label: "RUBIN", href: "/dashboard/rubin", names: ["rubin", "ruben", "reuben"] },
  { label: "ROBIN", href: "/dashboard/robin", names: ["robin"] },
  { label: "Operator", href: "/dashboard/operator", names: ["operator"] },
  { label: "Tasks", href: "/dashboard/tasks", names: ["tasks", "my tasks", "task list", "calendar"] },
  { label: "Files", href: "/dashboard/notes", names: ["files", "notes", "my files", "my notes"] },
  { label: "Memory", href: "/dashboard/memory", names: ["memory", "database", "ai agents", "agents"] },
  { label: "Settings", href: "/dashboard/settings", names: ["settings", "systems", "system settings", "network"] },
];

/**
 * "open JARVIS", "go to DARWIN", "take me to my tasks", "show the dashboard" →
 * the page to open. Only short, whole-phrase commands count, so a sentence that
 * merely mentions an agent never navigates away.
 */
export function navIntent(text: string): { label: string; href: string } | null {
  const t = stripWake(text).text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(please |can you |could you |hey )+/, "").replace(/( please| now| for me)+$/, "");
  const m = t.match(/^(open up|open|go back to|go to|show me|show|launch|switch to|switch over to|take me to|bring up|start|load) (the )?(.+?)( page| dashboard| agent| app| screen| window)?$/);
  if (!m) return null;
  const name = m[3].trim();
  const page = PAGES.find((p) => p.names.includes(name));
  return page ? { label: page.label, href: page.href } : null;
}
