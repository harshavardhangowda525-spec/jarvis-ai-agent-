/**
 * The caller's loop — runs in JARVIS's own calls window on your laptop. Pure
 * logic over an IO interface (Phone Link, the virtual audio cable, JARVIS's
 * server), so it is tested with fakes; the /calls/live page wires the real IO.
 *
 * One call: dial → wait for them to say "hello" (that's how we know a person
 * answered; ringing and silence aren't words) → JARVIS's opening line (it says
 * it's an AI) → listen / answer until the call ends → hang up → report.
 *
 * Feels quicker on the phone: if the answer takes a moment, JARVIS says a
 * short "Mm-hmm," first; they can talk over JARVIS (it stops and listens); and
 * it answers in their language (English, Hindi, Kannada).
 */
import { LINES, detectLang, type Lang } from "./rules";

export interface CallJob { id: string; to: string; name: string; maxMs: number; maxTurns: number }

export interface CallerIO {
  api: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  dial: (to: string) => Promise<{ ok: boolean; error?: string }>;
  hangup: () => Promise<void>;
  /** Is Phone Link still on a call? null = can't tell. */
  inCall: () => Promise<boolean | null>;
  /** Speak into the call (the virtual cable is Phone Link's microphone). Stops early if they talk over it. */
  speak: (text: string, lang: Lang) => Promise<{ interrupted: boolean }>;
  /** The next thing said on the call: text, "" (noise / no words), or null (nothing within maxWaitMs). */
  listen: (maxWaitMs: number) => Promise<string | null>;
  /** The language speech-to-text heard in the last thing said (null = go by the script). */
  heardLang?: () => Lang | null;
  label: (text: string | null) => void;
  log: (line: { who: "jarvis" | "them" | "info"; text: string }) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  stopped: () => boolean;
}

export const RING_MS = 45_000;
export const SILENCE_MS = 12_000;
/** If the answer isn't ready by then, say a short filler first. */
export const FILLER_AFTER_MS = 700;
/** On a call to you: if you pick up and say nothing for this long, JARVIS speaks first. */
export const OWNER_SPEAK_AFTER_MS = 6_000;

export async function runOneCall(io: CallerIO, c: CallJob): Promise<string> {
  let lang: Lang = "en";
  const finish = async (reason: string, error?: string) => {
    await io.hangup().catch(() => {});
    io.label(null);
    const r: Record<string, unknown> = await io.api({ action: "finish", id: c.id, reason, error: error ?? null }).catch(() => ({}));
    io.log({ who: "info", text: `Call ended (${reason})${r.outcome ? ` — ${String(r.outcome).replace(/_/g, " ")}` : ""}.` });
    return reason;
  };
  const say = async (text: string, l: Lang) => { io.log({ who: "jarvis", text }); return io.speak(text, l); };
  io.label(`Calling ${c.name}`);
  io.log({ who: "info", text: `Dialling ${c.name} (${c.to}) from the laptop…` });
  const d = await io.dial(c.to);
  if (!d.ok) return finish("failed", d.error ?? "Phone Link couldn't place the call.");
  const started = io.now();

  // 1. ringing: wait for a person to say something. On a call TO YOU, JARVIS
  // speaks up by itself after a few quiet seconds (you may pick up and just listen).
  // calls to you, and calls you asked for to people you know ("call Mom…"), don't wait forever for a hello
  const toOwner = c.id.startsWith("own_") || c.id.startsWith("per_");
  let first: string | null = null, spoke = 0, interrupted = false;
  const opener = async (heard: string) => {
    const open = await io.api({ action: "turn", id: c.id, heard, opener: true, lang });
    if (open.end || !open.say) return false; // an operator message / voicemail
    if (!spoke) await io.api({ action: "event", id: c.id, state: "answered" }).catch(() => ({}));
    io.label(`On a call with ${c.name}`);
    spoke++;
    interrupted = (await say(String(open.say), "en")).interrupted;
    return true;
  };
  while (io.now() - started < RING_MS) {
    if (io.stopped()) return finish("stopped");
    const left = Math.max(1000, RING_MS - (io.now() - started));
    const heard = await io.listen(toOwner ? Math.min(OWNER_SPEAK_AFTER_MS, left) : left);
    if (heard === null) {
      if (!toOwner) break;
      if ((await io.inCall()) === false && io.now() - started > 5000) return finish(spoke ? "hung_up" : "no_answer");
      if (spoke < 2 && !(await opener(""))) return finish("ended");
      continue;
    }
    if (heard.trim()) { first = heard.trim(); break; }
    if ((await io.inCall()) === false && io.now() - started > 5000) return finish(spoke ? "hung_up" : "no_answer");
  }
  if (!first && !spoke) return finish("no_answer");

  // 2. the opening line (the server writes it: it always says JARVIS is an AI).
  // If JARVIS already spoke first, what you said is your first turn instead.
  let carry: string | null = null;
  if (first && spoke) carry = first;
  else if (first) {
    io.log({ who: "them", text: first });
    lang = io.heardLang?.() ?? detectLang(first);
    if (!(await opener(first))) return finish("ended");
  }

  // 3. the conversation
  let silences = 0, fillers = 0;
  for (let turn = 0; turn < c.maxTurns; turn++) {
    if (io.stopped()) return finish("stopped");
    if (io.now() - started > c.maxMs) { await say(LINES[lang].bye, lang); return finish("timeout"); }
    const heard = carry ?? await io.listen(SILENCE_MS);
    carry = null;
    if (heard === null) {
      if ((await io.inCall()) === false) return finish("hung_up");
      silences++;
      if (silences >= 2) return finish("hung_up");
      interrupted = (await say(LINES[lang].hello, lang)).interrupted;
      continue;
    }
    if (!heard.trim()) { turn--; if ((await io.inCall()) === false) return finish("hung_up"); continue; }
    silences = 0;
    io.log({ who: "them", text: heard });
    lang = io.heardLang?.() ?? detectLang(heard);
    // ask JARVIS's brain; if it takes a moment, a short "Mm-hmm," fills the gap (not every turn)
    let answer: Record<string, unknown> | null = null;
    const pending = io.api({ action: "turn", id: c.id, heard, lang, interrupted }).then((r) => (answer = r));
    interrupted = false;
    await Promise.race([pending, io.sleep(FILLER_AFTER_MS)]);
    if (!answer && fillers < Math.ceil((turn + 1) / 2)) {
      fillers++;
      const f = LINES[lang].fillers;
      await io.speak(f[turn % f.length], lang);
    }
    const t = (await pending) as Record<string, unknown>;
    const tl = (["en", "hi", "kn"] as const).includes(t.lang as Lang) ? (t.lang as Lang) : lang;
    if (t.say) interrupted = (await say(String(t.say), tl)).interrupted;
    // JARVIS said goodbye: the call ends — even if a noise cut the goodbye short (it used to keep listening)
    if (t.end) { await io.sleep(interrupted ? 300 : 700); return finish("ended"); }
  }
  return finish("ended");
}

/** Keep calling while it's allowed: the server decides what may be dialled and when. */
export async function runCaller(io: CallerIO, opts: { idleMs?: number; onWait?: (why: string) => void } = {}) {
  while (!io.stopped()) {
    let r: Record<string, unknown>;
    try { r = await io.api({ action: "next" }); } catch (e) { opts.onWait?.(`JARVIS didn't answer (${(e as Error).message}).`); await io.sleep(opts.idleMs ?? 20_000); continue; }
    const call = r.call as CallJob | null;
    if (!call) { opts.onWait?.(String(r.wait ?? "Waiting.")); await io.sleep(opts.idleMs ?? 20_000); continue; }
    await runOneCall(io, call);
    await io.sleep(4000); // breathe between calls
  }
}
