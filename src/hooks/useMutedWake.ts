"use client";

import { useEffect, useState } from "react";
import { startMutedWake } from "@/lib/voice/muted-wake";

/**
 * While muted, listen only for "Hey JARVIS" — saying it unmutes every agent
 * (see lib/voice/muted-wake). Mounted once, in the app shell, so it works on
 * every agent's screen. Returns whether it's listening for the phrase now.
 */
export function useMutedWake(): boolean {
  const [listening, setListening] = useState(false);
  useEffect(() => startMutedWake({
    SR: (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null,
    micAllowed: async () => {
      try {
        const p = await (navigator as any).permissions?.query({ name: "microphone" });
        return p ? p.state === "granted" : false;
      } catch { return false; }
    },
    onListening: setListening,
  }), []);
  return listening;
}
