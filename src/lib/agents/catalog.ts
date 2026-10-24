/**
 * The agents you can chat with (client-safe). JARVIS keeps its own voice-first
 * console; every other agent IS its chat screen (+ optional voice mode),
 * each with its own identity, brain prompt and tools on the server (runAgent).
 */
export type ChatAgentId = "darwin" | "robin" | "ev" | "mike" | "aston" | "friday";

export interface ChatAgent {
  id: ChatAgentId;
  name: string;
  role: string;
  /** Accent for the avatar / orb (hex). */
  color: string;
  /** Starter prompts on an empty chat. */
  suggestions: string[];
}

export const CHAT_AGENTS: Record<ChatAgentId, ChatAgent> = {
  darwin: {
    id: "darwin", name: "DARWIN", role: "Lead generation & verification", color: "#38bdf8",
    suggestions: ["Find 20 gyms in Indiranagar without a website", "How many leads did you find today?", "Show me the best leads from this week", "Which leads still need verification?"],
  },
  robin: {
    id: "robin", name: "RUBIN", role: "Sales, outreach & follow-ups", color: "#2563eb",
    suggestions: ["Which clients need follow-up today?", "Show my interested leads", "Draft a WhatsApp message for my hottest lead", "Summarise today's client interactions"],
  },
  ev: {
    id: "ev", name: "EV", role: "Instagram marketing & content", color: "#a855f7",
    suggestions: ["Plan this week's Instagram posts", "Write a reel script for a gym website offer", "How did my last posts perform?", "Give me 5 caption ideas for a café demo"],
  },
  mike: {
    id: "mike", name: "MIKE", role: "Market analysis (never trades)", color: "#22c55e",
    suggestions: ["How is Bitcoin looking today?", "Analyse NIFTY on the daily chart", "What's the trend on Reliance?", "Explain the last setup you found"],
  },
  aston: {
    id: "aston", name: "ASTON", role: "Website & app demos · teleprompter", color: "#f59e0b",
    suggestions: ["Build a premium website demo for a cafe in Indiranagar", "Make an app demo for my best gym lead", "Show my demos", "Open today's teleprompter"],
  },
  friday: {
    id: "friday", name: "FRIDAY", role: "3D modelling, renders & holographic viewer", color: "#22d3ee",
    suggestions: ["Model the EDITH smart glasses from my notes", "Make the frame thinner and matte black", "Re-render the top view", "Export an STL of the latest version"],
  },
};

export const isChatAgent = (s: string | undefined | null): s is ChatAgentId => !!s && s in CHAT_AGENTS;
