"use client";

/**
 * RUBEN island voice: microphone capture that ends itself when you stop
 * talking (a simple energy detector — no audio leaves the PC until a phrase is
 * complete), the existing speech-to-text endpoint, and RUBIN's own voice for
 * replies (with the OS voice as a fallback). Levels drive the outline's motion.
 */

export interface Capture { stop: () => void; level: () => number; done: Promise<Blob | null> }

/** Average loudness 0..1 of the latest audio frame. */
function rmsOf(an: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * Record one phrase from `stream`: starts at the first speech, ends after
 * `silenceMs` of quiet (or `maxMs`). Resolves null if nobody spoke within `waitMs`.
 */
export function capturePhrase(stream: MediaStream, o: { silenceMs?: number; maxMs?: number; waitMs?: number; minSpeechMs?: number } = {}): Capture {
  const silenceMs = o.silenceMs ?? 1100, maxMs = o.maxMs ?? 12_000, waitMs = o.waitMs ?? 7000, minSpeechMs = o.minSpeechMs ?? 350;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(new ArrayBuffer(an.fftSize * 4));
  const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const rec = new MediaRecorder(stream, { mimeType: type });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  let level = 0, floor = 0.008, speechAt = 0, lastLoud = 0, stopped = false;
  const t0 = performance.now();
  let resolveDone: (b: Blob | null) => void = () => {};
  const done = new Promise<Blob | null>((r) => { resolveDone = r; });
  const finish = (keep: boolean) => {
    if (stopped) return;
    stopped = true;
    clearInterval(iv);
    rec.onstop = () => { void ctx.close().catch(() => {}); resolveDone(keep && chunks.length ? new Blob(chunks, { type }) : null); };
    if (rec.state !== "inactive") rec.stop(); else rec.onstop(new Event("stop"));
  };
  rec.start(250);
  const iv = setInterval(() => {
    const r = rmsOf(an, buf);
    level = Math.min(1, r * 9);
    const now = performance.now();
    const loud = r > Math.max(0.02, floor * 3);
    if (!loud && !speechAt) floor = floor * 0.95 + r * 0.05; // learn the room's noise
    if (loud) { lastLoud = now; if (!speechAt) speechAt = now; }
    if (!speechAt && now - t0 > waitMs) return finish(false);
    if (speechAt && now - lastLoud > silenceMs) return finish(now - speechAt >= minSpeechMs);
    if (now - t0 > maxMs) return finish(!!speechAt);
  }, 50);
  return { stop: () => finish(!!speechAt), level: () => level, done };
}

export async function transcribe(blob: Blob): Promise<{ text: string } | { error: string }> {
  const fd = new FormData();
  fd.append("audio", blob, "phrase.webm");
  const r = await fetch("/api/voice/stt", { method: "POST", body: fd }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  if (!r?.ok) return { error: j?.error || "Speech recognition isn't available right now." };
  return { text: String(j?.data?.text ?? "").trim() };
}

export interface Speech { level: () => number; done: Promise<void>; stop: () => void }

/** RUBIN's voice (ElevenLabs via the server); falls back to the computer's own voice. */
export function speak(text: string): Speech {
  let level = 0, stopFn = () => {};
  const done = (async () => {
    const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 600), agent: "robin" }) }).catch(() => null);
    if (r?.ok && r.body) {
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaElementSource(audio).connect(an);
      an.connect(ctx.destination);
      const buf = new Float32Array(new ArrayBuffer(an.fftSize * 4));
      const iv = setInterval(() => { level = Math.min(1, rmsOf(an, buf) * 6); }, 40);
      stopFn = () => { audio.pause(); audio.dispatchEvent(new Event("ended")); };
      await new Promise<void>((res) => { audio.onended = () => res(); audio.onerror = () => res(); void audio.play().catch(() => res()); });
      clearInterval(iv); level = 0;
      URL.revokeObjectURL(url); void ctx.close().catch(() => {});
      return;
    }
    if (typeof speechSynthesis === "undefined") return;
    await new Promise<void>((res) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => res(); u.onerror = () => res();
      // no audio data from the OS voice — a gentle, steady motion instead
      const iv = setInterval(() => { level = 0.25 + Math.random() * 0.35; }, 90);
      u.addEventListener("end", () => { clearInterval(iv); level = 0; });
      stopFn = () => { speechSynthesis.cancel(); clearInterval(iv); level = 0; res(); };
      speechSynthesis.speak(u);
    });
  })();
  return { level: () => level, done, stop: () => stopFn() };
}

/** "Open CRM", "Hey Ruben …" — the wake phrases (the rest of the sentence is the command). */
export function wakeCommand(text: string): { woke: boolean; rest: string } {
  const t = text.trim().replace(/[.!?]+$/, "");
  const m = t.match(/^(?:hey|ok|okay|hi)?[,\s]*(?:rubin|ruben|reuben|rueben|robin)\b[,\s]*(.*)$/i);
  if (m) return { woke: true, rest: m[1].trim() };
  if (/\bopen (?:the |my )?crm\b/i.test(t)) return { woke: true, rest: "" };
  return { woke: false, rest: "" };
}
