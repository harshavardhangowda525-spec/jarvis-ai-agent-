/**
 * While every agent is muted, listen for ONE thing: "Hey JARVIS" (or "hey
 * Rubin", "Jarvis wake up", "unmute"). Hearing it unmutes everything; anything
 * else said while muted is dropped on the spot — never shown, sent or acted on.
 *
 * Uses the browser's recognizer only while muted, never takes it from a voice
 * engine (it waits for it to be free), and only if mic permission was already
 * given — muting before voice was ever on doesn't pop a permission prompt.
 * Client-safe, framework-free (the React hook is useMutedWake).
 */
import { claimRecognizer, onRecognizerFree, releaseRecognizer, type Holder } from "./mic-lock";
import { isUnmuteWake, isVoiceSilent, onVoiceSilent, setVoiceSilent } from "./silence";

export interface MutedWakeOptions {
  /** The SpeechRecognition constructor (null = unsupported → does nothing). */
  SR: (new () => any) | null;
  /** Has the user already allowed the microphone? */
  micAllowed: () => Promise<boolean>;
  /** Told whenever it starts / stops listening for the wake phrase. */
  onListening?: (on: boolean) => void;
}

/** Start watching the mute switch; returns a stop function. */
export function startMutedWake({ SR, micAllowed, onListening }: MutedWakeOptions): () => void {
  if (!SR) return () => {};
  let rec: any = null;
  let active = false; // supposed to be listening (muted)
  let unsubFree: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let fails = 0;

  const stopRec = () => {
    const r = rec; rec = null;
    if (r) { r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* not running */ } }
    onListening?.(false);
  };
  const holder: Holder = {
    id: Symbol("muted-wake"),
    name: "muted-wake",
    // a voice engine took the recognizer (e.g. the mic button) — step aside, retry when it's free
    standDown: () => { stopRec(); if (active) waitForFree(); },
  };
  const waitForFree = () => {
    if (unsubFree) return;
    unsubFree = onRecognizerFree(() => { unsubFree?.(); unsubFree = null; schedule(60); });
  };
  const schedule = (ms: number) => {
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => { retry = null; void start(); }, ms);
  };

  const start = async () => {
    if (!active || rec) return;
    if (!(await micAllowed().catch(() => false)) || !active || rec) return;
    if (!claimRecognizer(holder)) { waitForFree(); return; } // someone's using it — never steal
    try {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (e: any) => {
        fails = 0;
        for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
          if (isUnmuteWake(String(e.results[i][0]?.transcript || ""))) { wakeUp(); return; }
        }
        // anything else: ignored — it's muted
      };
      r.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") active = false; // mic blocked — the pill still works
        else fails++;
      };
      r.onend = () => {
        if (rec !== r) return;
        rec = null; onListening?.(false);
        if (!active) { releaseRecognizer(holder.id); return; }
        schedule(Math.min(150 * 2 ** Math.min(fails, 5), 5000)); // Chrome ends sessions on silence — keep going
      };
      rec = r;
      r.start();
      onListening?.(true);
    } catch {
      rec = null; onListening?.(false);
      releaseRecognizer(holder.id);
      if (active) schedule(Math.min(300 * 2 ** Math.min(++fails, 5), 5000));
    }
  };

  const wakeUp = () => {
    active = false;
    stopRec();
    releaseRecognizer(holder.id); // free before the agents reopen the mic
    setVoiceSilent(false, "wake");
  };

  const apply = (silent: boolean) => {
    if (silent) {
      if (active) return;
      active = true; fails = 0;
      schedule(250); // let the agent's own recognizer finish shutting down first
    } else {
      active = false;
      if (retry) { clearTimeout(retry); retry = null; }
      unsubFree?.(); unsubFree = null;
      stopRec();
      releaseRecognizer(holder.id);
    }
  };
  apply(isVoiceSilent());
  const off = onVoiceSilent((s) => apply(s));
  return () => { off(); apply(false); };
}
