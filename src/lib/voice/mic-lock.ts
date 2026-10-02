/**
 * One browser speech recognizer at a time.
 *
 * Chrome lets a page run only ONE SpeechRecognition session. Every agent screen
 * (JARVIS, DARWIN, RUBIN, MIKE, ULTRON's panel) and the "hey JARVIS" listener
 * has its own recognizer, so without a referee they knock each other out and
 * the mic goes deaf — typically right after switching agents.
 *
 * The rule: whoever the user is talking to holds the recognizer.
 *  - A claim with `force` (turning voice on, unmuting, a screen opening with
 *    voice on) takes it: the previous holder is told to stand down.
 *  - An automatic restart (after speaking, after Chrome ends a session) never
 *    steals it — it waits until the recognizer is free.
 *  - Releasing it (mute, stop, the screen closing) frees it, and a holder that
 *    was stood down can take it back (e.g. JARVIS after ULTRON's panel closes).
 * Client-safe, no DOM.
 */

export interface Holder {
  id: symbol;
  /** Human-readable, for debugging ("robin", "jarvis", "wake"). */
  name: string;
  /** Stop your recognizer now (without restarting) — someone else has it. */
  standDown: () => void;
}

let current: Holder | null = null;
const waiters = new Set<() => void>();

/** Who holds the recognizer right now (null = free). */
export const recognizerHolder = (): symbol | null => current?.id ?? null;
export const holderName = (): string | null => current?.name ?? null;

/** Is the recognizer free for `id` (free, or already yours)? */
export const recognizerFreeFor = (id: symbol): boolean => !current || current.id === id;

/**
 * Take the recognizer. With `force`, a current holder is stood down; without it
 * you only get it when it's free. Returns whether you hold it now.
 */
export function claimRecognizer(h: Holder, force = false): boolean {
  if (!current || current.id === h.id) { current = h; return true; }
  if (!force) return false;
  const prev = current;
  current = h;
  try { prev.standDown(); } catch { /* the old holder is gone */ }
  return true;
}

/** Give it back (mute, stop, unmount). Anyone waiting is told it's free. */
export function releaseRecognizer(id: symbol): void {
  if (current?.id !== id) return;
  current = null;
  for (const w of [...waiters]) { try { w(); } catch { /* ignore */ } }
}

/** Be told when the recognizer becomes free (returns an unsubscribe). */
export function onRecognizerFree(fn: () => void): () => void {
  waiters.add(fn);
  return () => { waiters.delete(fn); };
}

/** Tests only. */
export function __resetRecognizerLock() { current = null; waiters.clear(); }
